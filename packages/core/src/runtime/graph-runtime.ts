import { assertValidLoopGraph } from "../schema/validation.js";
import type {
  ProjectGraphContext,
  ProjectGraphProvider
} from "../context/project-graph-provider.js";
import type {
  ConditionEvidence,
  GraphStatus,
  HarnessAdapter,
  LoopDefinition,
  LoopExecutionResult,
  LoopGraph,
  LoopResult,
  LoopStatus
} from "../schema/types.js";
import { evaluateCompletionConditions } from "./completion-evaluator.js";

export interface LoopRuntimeState {
  status: LoopStatus;
  currentIteration: number;
  waitingFor: string[];
  result?: LoopResult;
}

export interface GraphRunResult {
  status: GraphStatus;
  loops: Record<string, LoopRuntimeState>;
  results: LoopResult[];
}

export interface GraphRuntimeOptions {
  graph: LoopGraph;
  adapter: HarnessAdapter;
  projectRoot: string;
  maxConcurrentLoops?: number;
  projectGraphProvider?: ProjectGraphProvider;
  hooks?: GraphRuntimeHooks;
}

export interface GraphRuntimeHooks {
  onGraphStarted?(result: GraphRunSnapshot): Promise<void> | void;
  onLoopStarted?(event: LoopStartedEvent): Promise<void> | void;
  onLoopContextPrepared?(event: LoopContextPreparedEvent): Promise<void> | void;
  onConditionChecked?(event: ConditionCheckedEvent): Promise<void> | void;
  onLoopCompleted?(event: LoopCompletedEvent): Promise<void> | void;
  onLoopBlocked?(event: LoopCompletedEvent): Promise<void> | void;
  onGraphFinished?(result: GraphRunResult): Promise<void> | void;
}

export interface GraphRunSnapshot {
  status: GraphStatus;
  loops: Record<string, LoopRuntimeState>;
}

export interface LoopStartedEvent {
  loopId: string;
  iteration: number;
  snapshot: GraphRunSnapshot;
}

export interface LoopContextPreparedEvent {
  loopId: string;
  context: ProjectGraphContext;
}

export interface ConditionCheckedEvent {
  loopId: string;
  iteration: number;
  evidence: ConditionEvidence[];
  passed: boolean;
}

export interface LoopCompletedEvent {
  loopId: string;
  result: LoopResult;
  snapshot: GraphRunSnapshot;
}

const DEFAULT_MAX_ITERATIONS = 4;
const DEFAULT_MAX_CONCURRENT_LOOPS = 2;

export class GraphRuntime {
  private readonly graph: LoopGraph;
  private readonly adapter: HarnessAdapter;
  private readonly projectRoot: string;
  private readonly loopOrder: string[];
  private readonly states = new Map<string, LoopRuntimeState>();
  private readonly results = new Map<string, LoopResult>();
  private readonly maxConcurrentLoops: number;
  private readonly projectGraphProvider?: ProjectGraphProvider;
  private readonly hooks: GraphRuntimeHooks;

  constructor(options: GraphRuntimeOptions) {
    this.graph = assertValidLoopGraph(options.graph);
    this.adapter = options.adapter;
    this.projectRoot = options.projectRoot;
    this.loopOrder = this.graph.loops.map((loop) => loop.id);
    this.maxConcurrentLoops =
      options.maxConcurrentLoops ??
      this.graph.defaults?.maxConcurrentLoops ??
      DEFAULT_MAX_CONCURRENT_LOOPS;
    this.projectGraphProvider = options.projectGraphProvider;
    this.hooks = options.hooks ?? {};

    for (const loop of this.graph.loops) {
      this.states.set(loop.id, {
        status: loop.dependsOn.length === 0 ? "ready" : "waiting",
        currentIteration: 0,
        waitingFor: [...loop.dependsOn]
      });
    }
  }

  async run(signal = new AbortController().signal): Promise<GraphRunResult> {
    const running = new Map<string, Promise<void>>();
    let adapterInitialized = false;
    let providerInitialized = false;
    let runError: unknown;

    try {
      if (this.projectGraphProvider !== undefined) {
        await this.projectGraphProvider.initialize(this.projectRoot);
        providerInitialized = true;
        await this.projectGraphProvider.ensureCurrent({ incremental: true, signal });
      }

      await this.adapter.initialize({
        projectRoot: this.projectRoot,
        graph: this.graph
      });
      adapterInitialized = true;

      this.refreshStatuses();
      await this.hooks.onGraphStarted?.(this.toRunSnapshot("running"));

      while (!this.isTerminal()) {
        if (signal.aborted) {
          await this.cancelRunning(running);
          this.cancelPending();
          break;
        }

        const capacity = this.effectiveConcurrencyLimit() - running.size;
        const readyLoops = this.getReadyLoops().slice(0, Math.max(0, capacity));

        for (const loop of readyLoops) {
          this.states.get(loop.id)!.status = "running";
          const promise = this.runLoop(loop, signal).finally(() => {
            running.delete(loop.id);
            this.refreshStatuses();
          });
          running.set(loop.id, promise);
        }

        if (running.size === 0) {
          this.blockUnreachableLoops();
          break;
        }

        await Promise.race(running.values());
      }

      await Promise.allSettled(running.values());
      this.refreshStatuses();

      const result = this.toRunResult();
      await this.hooks.onGraphFinished?.(result);
      return result;
    } catch (error) {
      runError = error;
      throw error;
    } finally {
      const shutdowns: Promise<void>[] = [];
      if (adapterInitialized) {
        shutdowns.push(this.adapter.shutdown());
      }
      if (providerInitialized && this.projectGraphProvider !== undefined) {
        shutdowns.push(this.projectGraphProvider.shutdown());
      }
      const shutdownResults = await Promise.allSettled(shutdowns);
      const rejected = shutdownResults.find(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );
      if (runError === undefined && rejected !== undefined) {
        throw rejected.reason;
      }
    }
  }

  private async runLoop(loop: LoopDefinition, signal: AbortSignal): Promise<void> {
    const state = this.states.get(loop.id)!;
    const maxIterations = loop.maxIterations ?? this.graph.defaults?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    let previousResult: LoopExecutionResult | undefined;
    const projectGraphContext = await this.prepareProjectGraphContext(loop, signal);

    while (state.currentIteration < maxIterations) {
      if (signal.aborted) {
        state.status = "cancelled";
        return;
      }

      state.currentIteration += 1;
      await this.hooks.onLoopStarted?.({
        loopId: loop.id,
        iteration: state.currentIteration,
        snapshot: this.toRunSnapshot("running")
      });

      let adapterResult: LoopExecutionResult;
      try {
        adapterResult = await this.adapter.executeLoop(
          {
            graph: this.graph,
            loop,
            dependencyResults: this.getDependencyResults(loop),
            currentIteration: state.currentIteration,
            maxIterations,
            previousResult,
            projectRoot: this.projectRoot,
            projectGraphContext
          },
          signal
        );
      } catch (error) {
        if (signal.aborted) {
          this.cancelLoop(loop, state);
          return;
        }
        throw error;
      }

      if (signal.aborted) {
        this.cancelLoop(loop, state);
        return;
      }

      previousResult = adapterResult;

      if (adapterResult.status === "failed") {
        state.status = "failed";
        state.result = this.toLoopResult(loop, adapterResult, "failed", []);
        this.results.set(loop.id, state.result);
        await this.hooks.onLoopBlocked?.({
          loopId: loop.id,
          result: state.result,
          snapshot: this.toRunSnapshot("running")
        });
        return;
      }

      if (adapterResult.status === "blocked") {
        state.status = "blocked";
        state.result = this.toLoopResult(loop, adapterResult, "blocked", []);
        this.results.set(loop.id, state.result);
        await this.hooks.onLoopBlocked?.({
          loopId: loop.id,
          result: state.result,
          snapshot: this.toRunSnapshot("running")
        });
        return;
      }

      const completion = await evaluateCompletionConditions(
        loop.completionConditions,
        adapterResult,
        { projectRoot: this.projectRoot }
      );
      await this.hooks.onConditionChecked?.({
        loopId: loop.id,
        iteration: state.currentIteration,
        evidence: completion.evidence,
        passed: completion.passed
      });

      if (completion.passed) {
        state.status = "completed";
        state.result = this.toLoopResult(loop, adapterResult, "completed", completion.evidence);
        this.results.set(loop.id, state.result);
        await this.hooks.onLoopCompleted?.({
          loopId: loop.id,
          result: state.result,
          snapshot: this.toRunSnapshot("running")
        });
        return;
      }
    }

    state.status = "blocked";
    state.result = {
      loopId: loop.id,
      status: "blocked",
      iterationsUsed: state.currentIteration,
      summary: previousResult?.summary ?? "Loop did not complete before maxIterations was reached.",
      changedFiles: previousResult?.changedFiles ?? [],
      verification: previousResult?.completionEvidence ?? [],
      handoff: normalizeHandoff(previousResult?.handoff ?? []),
      blockedReason: previousResult?.blockedReason ?? "Maximum iterations reached"
    };
    this.results.set(loop.id, state.result);
    await this.hooks.onLoopBlocked?.({
      loopId: loop.id,
      result: state.result,
      snapshot: this.toRunSnapshot("running")
    });
  }

  private async prepareProjectGraphContext(
    loop: LoopDefinition,
    signal: AbortSignal
  ): Promise<ProjectGraphContext | undefined> {
    if (this.projectGraphProvider === undefined) {
      return undefined;
    }

    const context = await this.projectGraphProvider.query(
      {
        graph: this.graph,
        loop,
        dependencyResults: this.getDependencyResults(loop)
      },
      signal
    );
    await this.hooks.onLoopContextPrepared?.({ loopId: loop.id, context });
    return context;
  }

  private toLoopResult(
    loop: LoopDefinition,
    adapterResult: LoopExecutionResult,
    status: LoopStatus,
    verification: LoopResult["verification"]
  ): LoopResult {
    const state = this.states.get(loop.id)!;

    return {
      loopId: loop.id,
      status,
      iterationsUsed: state.currentIteration,
      summary: adapterResult.summary,
      changedFiles: adapterResult.changedFiles,
      verification,
      handoff: normalizeHandoff(adapterResult.handoff),
      blockedReason: adapterResult.blockedReason ?? undefined
    };
  }

  private refreshStatuses(): void {
    for (const loop of this.graph.loops) {
      const state = this.states.get(loop.id)!;

      if (isTerminalLoopStatus(state.status) || state.status === "running") {
        continue;
      }

      const dependencyStatuses = loop.dependsOn.map((dependency) => this.states.get(dependency)!.status);
      const blockedDependency = dependencyStatuses.some((status) =>
        status === "blocked" || status === "failed" || status === "cancelled"
      );

      if (blockedDependency) {
        state.status = "blocked";
        state.waitingFor = [];
        state.result = {
          loopId: loop.id,
          status: "blocked",
          iterationsUsed: state.currentIteration,
          summary: "Loop was blocked by an upstream dependency.",
          changedFiles: [],
          verification: [],
          handoff: [],
          blockedReason: "Upstream dependency did not complete"
        };
        this.results.set(loop.id, state.result);
        continue;
      }

      const waitingFor = loop.dependsOn.filter((dependency) => this.states.get(dependency)!.status !== "completed");
      state.waitingFor = waitingFor;
      state.status = waitingFor.length === 0 ? "ready" : "waiting";
    }
  }

  private getReadyLoops(): LoopDefinition[] {
    return this.graph.loops.filter((loop) => this.states.get(loop.id)?.status === "ready");
  }

  private getDependencyResults(loop: LoopDefinition): LoopResult[] {
    return loop.dependsOn
      .map((dependency) => this.results.get(dependency))
      .filter((result): result is LoopResult => result !== undefined);
  }

  private effectiveConcurrencyLimit(): number {
    if (!this.adapter.capabilities.supportsParallelLoops) {
      return 1;
    }

    return this.maxConcurrentLoops;
  }

  private isTerminal(): boolean {
    return [...this.states.values()].every((state) => isTerminalLoopStatus(state.status));
  }

  private blockUnreachableLoops(): void {
    for (const [loopId, state] of this.states.entries()) {
      if (!isTerminalLoopStatus(state.status)) {
        state.status = "blocked";
        state.result = {
          loopId,
          status: "blocked",
          iterationsUsed: state.currentIteration,
          summary: "Loop could not be reached by the scheduler.",
          changedFiles: [],
          verification: [],
          handoff: [],
          blockedReason: "No runnable loops remained"
        };
        this.results.set(loopId, state.result);
      }
    }
  }

  private cancelPending(): void {
    for (const [loopId, state] of this.states.entries()) {
      if (!isTerminalLoopStatus(state.status)) {
        state.status = "cancelled";
        state.result = {
          loopId,
          status: "cancelled",
          iterationsUsed: state.currentIteration,
          summary: "Loop was cancelled.",
          changedFiles: [],
          verification: [],
          handoff: [],
          blockedReason: "Cancelled"
        };
        this.results.set(loopId, state.result);
      }
    }
  }

  private cancelLoop(loop: LoopDefinition, state: LoopRuntimeState): void {
    state.status = "cancelled";
    state.result = {
      loopId: loop.id,
      status: "cancelled",
      iterationsUsed: state.currentIteration,
      summary: "Loop was cancelled.",
      changedFiles: [],
      verification: [],
      handoff: [],
      blockedReason: "Cancelled"
    };
    this.results.set(loop.id, state.result);
  }

  private async cancelRunning(running: Map<string, Promise<void>>): Promise<void> {
    if (this.adapter.cancelLoop === undefined) {
      return;
    }

    await Promise.all([...running.keys()].map((loopId) => this.adapter.cancelLoop!(loopId)));
  }

  private toRunResult(): GraphRunResult {
    const loops = Object.fromEntries(this.states.entries());
    const states = [...this.states.values()].map((state) => state.status);
    const status: GraphStatus = states.every((state) => state === "completed")
      ? "completed"
      : states.some((state) => state === "failed")
        ? "failed"
        : states.some((state) => state === "cancelled")
          ? "cancelled"
          : "completed_with_blocks";

    return {
      status,
      loops,
      results: this.loopOrder
        .map((loopId) => this.results.get(loopId))
        .filter((result): result is LoopResult => result !== undefined)
    };
  }

  private toRunSnapshot(status: GraphStatus): GraphRunSnapshot {
    return {
      status,
      loops: Object.fromEntries(
        [...this.states.entries()].map(([loopId, state]) => [
          loopId,
          {
            ...state,
            waitingFor: [...state.waitingFor],
            result: state.result === undefined
              ? undefined
              : {
                  ...state.result,
                  changedFiles: [...state.result.changedFiles],
                  verification: [...state.result.verification],
                  handoff: [...state.result.handoff]
                }
          }
        ])
      )
    };
  }
}

function isTerminalLoopStatus(status: LoopStatus): boolean {
  return status === "completed" || status === "blocked" || status === "failed" || status === "cancelled";
}

function normalizeHandoff(handoff: string | string[]): string[] {
  return Array.isArray(handoff) ? handoff : [handoff].filter(Boolean);
}
