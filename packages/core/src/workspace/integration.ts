import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LoopGraph, LoopResult } from "../schema/types.js";
import { currentBranch, type WorktreeInfo, type WorktreeManager } from "./worktree.js";

const execFileAsync = promisify(execFile);

export type IntegrationStepStatus = "pending" | "merged" | "failed" | "skipped";

export interface IntegrationStep {
  loopId: string;
  branch: string;
  status: IntegrationStepStatus;
  message?: string;
}

export interface IntegrationPlan {
  baseBranch: string;
  steps: IntegrationStep[];
}

export interface IntegrationSupervisorOptions {
  gitPath?: string;
}

export class IntegrationSupervisor {
  private readonly git: string;

  constructor(
    private readonly worktreeManager: WorktreeManager,
    options: IntegrationSupervisorOptions = {}
  ) {
    this.git = options.gitPath ?? "git";
  }

  async buildPlan(
    graph: LoopGraph,
    results: LoopResult[],
    worktrees: WorktreeInfo[]
  ): Promise<IntegrationPlan> {
    const baseBranch = await currentBranch(this.worktreeManager.projectRoot, this.git);
    const ordered = topologicalOrder(graph);
    const byLoopId = new Map(worktrees.map((info) => [info.loopId, info]));
    const completed = new Set(
      results.filter((result) => result.status === "completed").map((result) => result.loopId)
    );

    const steps: IntegrationStep[] = ordered.flatMap((loopId) => {
      const info = byLoopId.get(loopId);
      if (info === undefined) {
        return [];
      }
      return [
        {
          loopId,
          branch: info.branch,
          status: completed.has(loopId) ? "pending" : "skipped"
        }
      ];
    });

    return { baseBranch, steps };
  }

  async integrate(graph: LoopGraph, results: LoopResult[]): Promise<IntegrationPlan> {
    const worktrees = await this.worktreeManager.list();
    const plan = await this.buildPlan(graph, results, worktrees);

    for (const step of plan.steps) {
      if (step.status !== "pending") {
        continue;
      }

      const info = worktrees.find((entry) => entry.loopId === step.loopId);
      if (info !== undefined) {
        await this.commitWorktree(info);
      }

      try {
        await execFileAsync(
          this.git,
          ["merge", "--no-ff", step.branch, "-m", `Integrate loop ${step.loopId}`],
          {
            cwd: this.worktreeManager.projectRoot
          }
        );
        step.status = "merged";
      } catch (error) {
        await execFileAsync(this.git, ["merge", "--abort"], { cwd: this.worktreeManager.projectRoot }).catch(
          () => undefined
        );
        step.status = "failed";
        step.message = error instanceof Error ? error.message : String(error);
      }
    }

    return plan;
  }

  private async commitWorktree(info: WorktreeInfo): Promise<void> {
    await execFileAsync(this.git, ["add", "-A"], { cwd: info.path });
    await execFileAsync(this.git, ["commit", "-m", `Loop ${info.loopId} work`], { cwd: info.path }).catch(
      () => undefined
    );
  }

  async finalize(graph: LoopGraph, results: LoopResult[]): Promise<IntegrationPlan> {
    const plan = await this.integrate(graph, results);
    await this.worktreeManager.removeAll();
    return plan;
  }
}

function topologicalOrder(graph: LoopGraph): string[] {
  const ids = new Set(graph.loops.map((loop) => loop.id));
  const byId = new Map(graph.loops.map((loop) => [loop.id, loop]));
  const visited = new Set<string>();
  const ordered: string[] = [];

  const visit = (loopId: string): void => {
    if (visited.has(loopId)) {
      return;
    }
    visited.add(loopId);
    const loop = byId.get(loopId);
    if (loop === undefined) {
      return;
    }
    for (const dependency of loop.dependsOn) {
      if (ids.has(dependency)) {
        visit(dependency);
      }
    }
    ordered.push(loopId);
  };

  const stable = [...graph.loops.map((loop) => loop.id)].sort();
  for (const loopId of stable) {
    visit(loopId);
  }

  return ordered;
}
