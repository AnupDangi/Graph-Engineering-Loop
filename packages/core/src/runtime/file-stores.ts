import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import type { GraphRunResult, GraphRunSnapshot, GraphRuntimeHooks, LoopCompletedEvent } from "./graph-runtime.js";
import type { CompletionCondition, GraphStatus, LoopGraph, LoopResult, LoopStatus } from "../schema/types.js";
import type { ProjectGraphContext } from "../context/project-graph-provider.js";

export interface RunMetadata {
  runId: string;
  graphName: string;
  graphHash: string;
  projectRoot: string;
  startedAt: string;
}

export interface StateFile {
  version: 1;
  runId: string;
  graphName: string;
  graphHash: string;
  status: GraphStatus;
  startedAt: string;
  updatedAt: string;
  loops: GraphRunSnapshot["loops"];
}

export interface LockFile {
  runId: string;
  pid: number;
  startedAt: string;
  projectRoot: string;
}

export interface StatusLoop {
  id: string;
  title: string;
  objective: string;
  tasks: string[];
  dependsOn: string[];
  completionConditions: CompletionCondition[];
  status: LoopStatus;
  currentIteration: number;
  maxIterations: number;
  waitingFor: string[];
}

export interface StatusFile {
  version: 1;
  runId: string;
  graphName: string;
  graphGoal: string;
  graphStatus: GraphStatus;
  activity: string;
  startedAt: string;
  updatedAt: string;
  completedLoops: number;
  totalLoops: number;
  loops: StatusLoop[];
}

export class LoopGraphFiles {
  readonly loopgraphDir: string;
  readonly resultsDir: string;
  readonly contextDir: string;
  readonly statePath: string;
  readonly lockPath: string;
  readonly eventsPath: string;
  readonly statusPath: string;
  readonly statusMarkdownPath: string;
  private statusWriteQueue: Promise<void> = Promise.resolve();

  constructor(readonly projectRoot: string) {
    this.loopgraphDir = join(projectRoot, ".loopgraph");
    this.resultsDir = join(this.loopgraphDir, "results");
    this.contextDir = join(this.loopgraphDir, "context");
    this.statePath = join(this.loopgraphDir, "state.json");
    this.lockPath = join(this.loopgraphDir, "lock.json");
    this.eventsPath = join(this.loopgraphDir, "events.jsonl");
    this.statusPath = join(this.loopgraphDir, "status.json");
    this.statusMarkdownPath = join(this.loopgraphDir, "status.md");
  }

  async ensure(): Promise<void> {
    await mkdir(this.resultsDir, { recursive: true });
  }

  async writeState(metadata: RunMetadata, snapshot: GraphRunSnapshot | GraphRunResult): Promise<void> {
    const state: StateFile = {
      version: 1,
      runId: metadata.runId,
      graphName: metadata.graphName,
      graphHash: metadata.graphHash,
      status: snapshot.status,
      startedAt: metadata.startedAt,
      updatedAt: new Date().toISOString(),
      loops: snapshot.loops
    };

    await atomicWriteJson(this.statePath, state);
  }

  async writeRawState(state: StateFile): Promise<void> {
    await atomicWriteJson(this.statePath, state);
    const currentStatus = await readJson<StatusFile>(this.statusPath);
    if (currentStatus !== null && currentStatus.runId === state.runId) {
      const loops = currentStatus.loops.map((loop) => {
        const runtimeLoop = state.loops[loop.id];
        return runtimeLoop === undefined
          ? loop
          : {
              ...loop,
              status: runtimeLoop.status,
              currentIteration: runtimeLoop.currentIteration,
              waitingFor: runtimeLoop.waitingFor
            };
      });
      const status: StatusFile = {
        ...currentStatus,
        graphStatus: state.status,
        activity: state.status === "cancelled" ? "Graph cancelled by the operator." : currentStatus.activity,
        updatedAt: state.updatedAt,
        completedLoops: loops.filter((loop) => loop.status === "completed").length,
        loops
      };
      await this.writeStatusFiles(status);
    }
  }

  async createLock(metadata: RunMetadata): Promise<void> {
    await this.ensure();

    if (existsSync(this.lockPath)) {
      const existing = await readJson<LockFile>(this.lockPath);
      if (existing !== null && processExists(existing.pid)) {
        throw new Error(`LoopGraph is already running for this project (pid ${existing.pid}).`);
      }
    }

    const lock: LockFile = {
      runId: metadata.runId,
      pid: process.pid,
      startedAt: metadata.startedAt,
      projectRoot: metadata.projectRoot
    };

    await atomicWriteJson(this.lockPath, lock);
  }

  async removeLock(): Promise<void> {
    await rm(this.lockPath, { force: true });
  }

  async appendEvent(type: string, payload: Record<string, unknown>): Promise<void> {
    await this.ensure();
    await writeFile(
      this.eventsPath,
      `${JSON.stringify({ type, timestamp: new Date().toISOString(), ...payload })}\n`,
      { flag: "a" }
    );
  }

  async writeLoopResult(result: LoopResult): Promise<void> {
    await this.ensure();
    await atomicWriteJson(join(this.resultsDir, `${result.loopId}.json`), result);
    await atomicWriteText(join(this.resultsDir, `${result.loopId}.md`), formatLoopResultMarkdown(result));
  }

  async writeLoopContext(loopId: string, context: ProjectGraphContext): Promise<void> {
    await this.ensure();
    await atomicWriteJson(join(this.contextDir, `${loopId}.json`), context);
  }

  async readState(): Promise<StateFile | null> {
    return readJson<StateFile>(this.statePath);
  }

  hooks(metadata: RunMetadata, graph: LoopGraph): GraphRuntimeHooks {
    return {
      onGraphStarted: async (snapshot) => {
        await this.appendEvent("graph.started", { runId: metadata.runId });
        await this.persistSnapshot(metadata, graph, snapshot, "Graph started; scheduler is selecting ready loops.");
      },
      onLoopStarted: async (event) => {
        await this.appendEvent("loop.started", {
          runId: metadata.runId,
          loopId: event.loopId,
          iteration: event.iteration
        });
        await this.persistSnapshot(
          metadata,
          graph,
          event.snapshot,
          `Running loop ${event.loopId}, iteration ${event.iteration}.`
        );
      },
      onLoopContextPrepared: async (event) => {
        await this.writeLoopContext(event.loopId, event.context);
        await this.appendEvent("loop.context-prepared", {
          runId: metadata.runId,
          loopId: event.loopId,
          provider: event.context.provider,
          relevantFileCount: event.context.relevantFiles.length
        });
      },
      onConditionChecked: async (event) => {
        await this.appendEvent("condition.checked", {
          runId: metadata.runId,
          loopId: event.loopId,
          iteration: event.iteration,
          passed: event.passed
        });
      },
      onLoopCompleted: async (event) => {
        await this.persistLoopEvent(metadata, graph, "loop.completed", event);
      },
      onLoopBlocked: async (event) => {
        await this.persistLoopEvent(metadata, graph, "loop.blocked", event);
      },
      onGraphFinished: async (result) => {
        await this.appendEvent("graph.finished", {
          runId: metadata.runId,
          status: result.status
        });
        await this.persistSnapshot(
          metadata,
          graph,
          result,
          `Graph finished with status ${result.status}.`
        );
      }
    };
  }

  private async persistLoopEvent(
    metadata: RunMetadata,
    graph: LoopGraph,
    type: string,
    event: LoopCompletedEvent
  ): Promise<void> {
    await this.writeLoopResult(event.result);
    await this.appendEvent(type, {
      runId: metadata.runId,
      loopId: event.loopId,
      status: event.result.status,
      iterationsUsed: event.result.iterationsUsed
    });
    await this.persistSnapshot(
      metadata,
      graph,
      event.snapshot,
      `Loop ${event.loopId} ${event.result.status} after ${event.result.iterationsUsed} iteration(s).`
    );
  }

  private async persistSnapshot(
    metadata: RunMetadata,
    graph: LoopGraph,
    snapshot: GraphRunSnapshot | GraphRunResult,
    activity: string
  ): Promise<void> {
    const operation = this.statusWriteQueue.then(async () => {
      await this.writeState(metadata, snapshot);
      const status = createStatusFile(metadata, graph, snapshot, activity);
      await this.writeStatusFiles(status);
    });
    this.statusWriteQueue = operation.catch(() => undefined);
    await operation;
  }

  private async writeStatusFiles(status: StatusFile): Promise<void> {
    await atomicWriteJson(this.statusPath, status);
    await atomicWriteText(this.statusMarkdownPath, formatStatusMarkdown(status));
  }
}

function createStatusFile(
  metadata: RunMetadata,
  graph: LoopGraph,
  snapshot: GraphRunSnapshot | GraphRunResult,
  activity: string
): StatusFile {
  const loops = graph.loops.map((loop) => {
    const runtime = snapshot.loops[loop.id];
    return {
      id: loop.id,
      title: loop.title ?? loop.id,
      objective: loop.objective,
      tasks: loop.tasks ?? [],
      dependsOn: loop.dependsOn,
      completionConditions: loop.completionConditions,
      status: runtime.status,
      currentIteration: runtime.currentIteration,
      maxIterations: loop.maxIterations ?? graph.defaults?.maxIterations ?? 4,
      waitingFor: runtime.waitingFor
    };
  });

  return {
    version: 1,
    runId: metadata.runId,
    graphName: graph.name,
    graphGoal: graph.goal,
    graphStatus: snapshot.status,
    activity,
    startedAt: metadata.startedAt,
    updatedAt: new Date().toISOString(),
    completedLoops: loops.filter((loop) => loop.status === "completed").length,
    totalLoops: loops.length,
    loops
  };
}

export function createRunMetadata(graph: LoopGraph, projectRoot: string): RunMetadata {
  return {
    runId: `run_${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}_${randomBytes(3).toString("hex")}`,
    graphName: graph.name,
    graphHash: hashGraph(graph),
    projectRoot,
    startedAt: new Date().toISOString()
  };
}

export function hashGraph(graph: LoopGraph): string {
  return createHash("sha256").update(JSON.stringify(graph)).digest("hex");
}

export function isTerminalGraphStatus(status: GraphStatus): boolean {
  return status === "completed" || status === "completed_with_blocks" || status === "failed" || status === "cancelled";
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await atomicWriteText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function atomicWriteText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  const file = await open(tmpPath, "w");

  try {
    await file.writeFile(value, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }

  await rename(tmpPath, path);
}

function formatStatusMarkdown(status: StatusFile): string {
  const progress = formatProgress(status.completedLoops, status.totalLoops);
  const activeLoops = status.loops.filter((loop) => loop.status === "running");
  const activeSection = activeLoops.length === 0
    ? "No loop is currently running. The scheduler may be preparing work or the graph is terminal."
    : activeLoops.map((loop) => {
        const tasks = loop.tasks.length === 0
          ? "- No advisory tasks. Follow the objective and completion conditions."
          : loop.tasks.map((task) => `- ${escapeMarkdown(task)}`).join("\n");
        return `### ${escapeMarkdown(loop.title)}\n\n` +
          `- Loop: \`${loop.id}\`\n` +
          `- Iteration: ${loop.currentIteration} / ${loop.maxIterations}\n` +
          `- Objective: ${escapeMarkdown(loop.objective)}\n\n` +
          `Tasks:\n\n${tasks}`;
      }).join("\n\n");
  const rows = status.loops.map((loop) =>
    `| \`${loop.id}\` | ${statusIcon(loop.status)} ${loop.status} | ` +
    `${loop.currentIteration}/${loop.maxIterations} | ${escapeMarkdown(loop.waitingFor.join(", ") || "—")} | ` +
    `${escapeMarkdown(loop.objective)} |`
  ).join("\n");
  const nodes = status.loops.map((loop, index) =>
    `  n${index}["${escapeMermaid(loop.title)}<br/>${statusIcon(loop.status)} ${loop.status} · ` +
    `${loop.currentIteration}/${loop.maxIterations}"]\n  class n${index} ${loop.status};`
  ).join("\n");
  const indexes = new Map(status.loops.map((loop, index) => [loop.id, index]));
  const edges = status.loops.flatMap((loop, targetIndex) =>
    loop.dependsOn.map((dependency) => {
      const sourceIndex = indexes.get(dependency);
      return sourceIndex === undefined ? "" : `  n${sourceIndex} --> n${targetIndex}`;
    })
  ).filter(Boolean).join("\n");

  return `# LoopGraph Live Status\n\n` +
    `> ${escapeMarkdown(status.activity)}\n\n` +
    `- Run: \`${status.runId}\`\n` +
    `- Graph: ${escapeMarkdown(status.graphName)}\n` +
    `- Status: **${status.graphStatus}**\n` +
    `- Progress: ${progress} ${status.completedLoops}/${status.totalLoops} loops completed\n` +
    `- Updated: ${status.updatedAt}\n\n` +
    `## Active work\n\n${activeSection}\n\n` +
    `## Dependency graph\n\n` +
    "```mermaid\nflowchart LR\n" +
    `${nodes}\n${edges}\n` +
    "  classDef waiting fill:#f3f4f6,stroke:#9ca3af,color:#111827;\n" +
    "  classDef ready fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a;\n" +
    "  classDef running fill:#fef3c7,stroke:#f59e0b,color:#78350f;\n" +
    "  classDef completed fill:#dcfce7,stroke:#22c55e,color:#14532d;\n" +
    "  classDef blocked fill:#fee2e2,stroke:#ef4444,color:#7f1d1d;\n" +
    "  classDef failed fill:#fecaca,stroke:#b91c1c,color:#450a0a;\n" +
    "  classDef cancelled fill:#e5e7eb,stroke:#6b7280,color:#111827;\n```\n\n" +
    `## All loops\n\n| Loop | Status | Iteration | Waiting for | Objective |\n` +
    `|---|---|---:|---|---|\n${rows}\n`;
}

function formatProgress(completed: number, total: number): string {
  const width = 12;
  const filled = total === 0 ? 0 : Math.round((completed / total) * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

function statusIcon(status: LoopStatus): string {
  const icons: Record<LoopStatus, string> = {
    waiting: "⏳",
    ready: "🔵",
    running: "🔄",
    completed: "✅",
    blocked: "⛔",
    failed: "❌",
    cancelled: "🛑"
  };
  return icons[status];
}

function escapeMarkdown(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function escapeMermaid(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/["<>]/g, "'");
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function formatLoopResultMarkdown(result: LoopResult): string {
  const handoff = result.handoff.length > 0
    ? result.handoff.map((entry) => `- ${entry}`).join("\n")
    : "- No handoff notes.";

  return `# ${result.loopId}\n\nStatus: ${result.status}\nIterations used: ${result.iterationsUsed}\n\n## Summary\n\n${result.summary}\n\n## Handoff\n\n${handoff}\n`;
}
