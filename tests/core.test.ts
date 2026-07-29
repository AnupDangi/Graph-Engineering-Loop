import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  GraphRuntime,
  GraphValidationError,
  assertValidLoopGraph,
  type HarnessAdapter,
  type LoopExecutionRequest,
  type LoopExecutionResult,
  type LoopGraph
} from "../packages/core/src/index.ts";

test("validates a minimal graph", () => {
  const graph = makeGraph([
    {
      id: "foundation",
      objective: "Create a foundation file.",
      dependsOn: [],
      completionConditions: [{ type: "fileExists", path: "foundation.txt" }]
    }
  ]);

  assert.equal(assertValidLoopGraph(graph).name, "test-graph");
});

test("rejects missing dependencies with a useful error", () => {
  const graph = makeGraph([
    {
      id: "backend",
      objective: "Build backend.",
      dependsOn: ["foundation"],
      completionConditions: [{ type: "fileExists", path: "backend.txt" }]
    }
  ]);

  assert.throws(
    () => assertValidLoopGraph(graph),
    (error: unknown) =>
      error instanceof GraphValidationError &&
      error.message.includes("Dependency 'foundation' does not reference an existing loop")
  );
});

test("rejects dependency cycles with the cycle path", () => {
  const graph = makeGraph([
    {
      id: "foundation",
      objective: "Foundation.",
      dependsOn: ["backend"],
      completionConditions: [{ type: "fileExists", path: "foundation.txt" }]
    },
    {
      id: "backend",
      objective: "Backend.",
      dependsOn: ["foundation"],
      completionConditions: [{ type: "fileExists", path: "backend.txt" }]
    }
  ]);

  assert.throws(
    () => assertValidLoopGraph(graph),
    (error: unknown) =>
      error instanceof GraphValidationError &&
      error.message.includes("Dependency cycle detected")
  );
});

test("runs a foundation, backend/frontend, integration graph through a fake adapter", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-runtime-"));
  const graph = makeGraph([
    {
      id: "foundation",
      objective: "Create foundation output.",
      dependsOn: [],
      completionConditions: [{ type: "fileExists", path: "foundation.txt" }]
    },
    {
      id: "backend",
      objective: "Create backend output.",
      dependsOn: ["foundation"],
      completionConditions: [{ type: "fileExists", path: "backend.txt" }]
    },
    {
      id: "frontend",
      objective: "Create frontend output.",
      dependsOn: ["foundation"],
      completionConditions: [{ type: "fileExists", path: "frontend.txt" }]
    },
    {
      id: "integration",
      objective: "Create integration output.",
      dependsOn: ["backend", "frontend"],
      completionConditions: [{ type: "fileExists", path: "integration.txt" }]
    }
  ]);
  const adapter = new ScriptedAdapter({
    foundation: async () => writeFile(join(projectRoot, "foundation.txt"), "ok"),
    backend: async () => writeFile(join(projectRoot, "backend.txt"), "ok"),
    frontend: async () => writeFile(join(projectRoot, "frontend.txt"), "ok"),
    integration: async () => writeFile(join(projectRoot, "integration.txt"), "ok")
  });

  const runtime = new GraphRuntime({ graph, adapter, projectRoot });
  const result = await runtime.run();

  assert.equal(result.status, "completed");
  assert.deepEqual(result.results.map((entry) => entry.loopId), [
    "foundation",
    "backend",
    "frontend",
    "integration"
  ]);
  assert.equal(result.loops.integration.status, "completed");
  assert.deepEqual(adapter.started.slice(0, 1), ["foundation"]);
  assert(adapter.started.indexOf("integration") > adapter.started.indexOf("backend"));
  assert(adapter.started.indexOf("integration") > adapter.started.indexOf("frontend"));
});

test("blocks a loop when maxIterations is exhausted and blocks downstream loops", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-blocked-"));
  const graph = makeGraph(
    [
      {
        id: "foundation",
        objective: "Never creates its completion file.",
        dependsOn: [],
        completionConditions: [{ type: "fileExists", path: "missing.txt" }],
        maxIterations: 2
      },
      {
        id: "integration",
        objective: "Depends on foundation.",
        dependsOn: ["foundation"],
        completionConditions: [{ type: "fileExists", path: "integration.txt" }]
      }
    ],
    { maxConcurrentLoops: 1 }
  );
  const adapter = new ScriptedAdapter({
    foundation: async () => undefined,
    integration: async () => writeFile(join(projectRoot, "integration.txt"), "should-not-run")
  });

  const runtime = new GraphRuntime({ graph, adapter, projectRoot });
  const result = await runtime.run();

  assert.equal(result.status, "completed_with_blocks");
  assert.equal(result.loops.foundation.status, "blocked");
  assert.equal(result.loops.foundation.currentIteration, 2);
  assert.equal(result.loops.integration.status, "blocked");
  assert.deepEqual(adapter.started, ["foundation", "foundation"]);
});

function makeGraph(
  loops: LoopGraph["loops"],
  defaults: LoopGraph["defaults"] = { maxIterations: 3, maxConcurrentLoops: 2 }
): LoopGraph {
  return {
    version: 1,
    name: "test-graph",
    goal: "Exercise LoopGraph.",
    defaults,
    loops
  };
}

class ScriptedAdapter implements HarnessAdapter {
  readonly name = "scripted";
  readonly capabilities = {
    supportsParallelLoops: true,
    supportsSubagents: false,
    supportsResume: false,
    supportsStructuredOutput: true,
    supportsIsolatedWorktrees: false
  };
  readonly started: string[] = [];

  constructor(private readonly scripts: Record<string, (request: LoopExecutionRequest) => Promise<void>>) {}

  async initialize(): Promise<void> {
    return undefined;
  }

  async executeLoop(request: LoopExecutionRequest): Promise<LoopExecutionResult> {
    this.started.push(request.loop.id);
    await mkdir(request.projectRoot, { recursive: true });
    await this.scripts[request.loop.id]?.(request);

    return {
      status: "complete",
      summary: `${request.loop.id} attempted`,
      completedTasks: request.loop.tasks ?? [],
      remainingWork: [],
      changedFiles: [],
      commandsRun: [],
      completionEvidence: [],
      handoff: [`${request.loop.id} handoff`],
      blockedReason: null
    };
  }

  async shutdown(): Promise<void> {
    return undefined;
  }
}
