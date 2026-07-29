import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AdapterInitializationContext,
  HarnessAdapter,
  LoopExecutionRequest,
  LoopExecutionResult
} from "graph-engineering-loop-core";

export class FakeAdapter implements HarnessAdapter {
  readonly name = "fake";
  readonly capabilities = {
    supportsParallelLoops: true,
    supportsSubagents: false,
    supportsResume: false,
    supportsStructuredOutput: true,
    supportsIsolatedWorktrees: false
  };

  async initialize(_context: AdapterInitializationContext): Promise<void> {
    return undefined;
  }

  async executeLoop(request: LoopExecutionRequest): Promise<LoopExecutionResult> {
    const fakeWrites = Array.isArray(request.loop.metadata?.fakeWrites)
      ? request.loop.metadata.fakeWrites
      : [];

    const changedFiles: string[] = [];

    for (const entry of fakeWrites) {
      if (!isFakeWrite(entry)) {
        continue;
      }

      const absolutePath = join(request.projectRoot, entry.path);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, entry.content ?? `${request.loop.id}\n`, "utf8");
      changedFiles.push(entry.path);
    }

    return {
      status: "complete",
      summary: `Fake adapter executed loop '${request.loop.id}'.`,
      completedTasks: request.loop.tasks ?? [],
      remainingWork: [],
      changedFiles,
      commandsRun: [],
      completionEvidence: request.loop.completionConditions.map((condition, conditionIndex) => ({
        conditionIndex,
        passed: condition.type === "assertion",
        checkedAt: new Date().toISOString(),
        evidence: {
          adapter: "fake",
          loopId: request.loop.id,
          conditionType: condition.type
        }
      })),
      handoff: [`${request.loop.id} completed by fake adapter.`],
      blockedReason: null
    };
  }

  async shutdown(): Promise<void> {
    return undefined;
  }
}

function isFakeWrite(value: unknown): value is { path: string; content?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    typeof value.path === "string" &&
    (!("content" in value) || typeof value.content === "string")
  );
}
