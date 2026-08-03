import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  GraphRuntime,
  GraphValidationError,
  LoopGraphFiles,
  assertValidLoopGraph,
  createRunMetadata,
  type HarnessAdapter,
  type LoopExecutionRequest,
  type LoopExecutionResult,
  type LoopGraph,
  type ProjectGraphProvider
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

test("prepares and persists project graph context for each loop", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-context-"));
  const graph = makeGraph([
    {
      id: "foundation",
      objective: "Create a foundation file.",
      dependsOn: [],
      completionConditions: [{ type: "fileExists", path: "foundation.txt" }]
    }
  ]);
  const adapter = new ScriptedAdapter({
    foundation: async (request) => {
      assert.equal(request.projectGraphContext?.provider, "test-graph-provider");
      assert.deepEqual(request.projectGraphContext?.relevantFiles, ["packages/core/src/index.ts"]);
      await writeFile(join(projectRoot, "foundation.txt"), "ok");
    }
  });
  const calls: string[] = [];
  const projectGraphProvider: ProjectGraphProvider = {
    name: "test-graph-provider",
    async initialize(root) {
      assert.equal(root, projectRoot);
      calls.push("initialize");
    },
    async ensureCurrent() {
      calls.push("ensureCurrent");
      return {
        provider: this.name,
        generatedAt: "2026-08-03T00:00:00.000Z"
      };
    },
    async query(request) {
      calls.push(`query:${request.loop.id}`);
      return {
        provider: this.name,
        query: request.loop.objective,
        generatedAt: "2026-08-03T00:00:00.000Z",
        content: "foundation context",
        communities: ["core"],
        entryNodes: ["GraphRuntime"],
        relevantFiles: ["packages/core/src/index.ts"],
        estimatedWriteFiles: []
      };
    },
    async shutdown() {
      calls.push("shutdown");
    }
  };
  const files = new LoopGraphFiles(projectRoot);
  const runtime = new GraphRuntime({
    graph,
    adapter,
    projectRoot,
    projectGraphProvider,
    hooks: files.hooks(createRunMetadata(graph, projectRoot))
  });

  const result = await runtime.run();

  assert.equal(result.status, "completed");
  assert.deepEqual(calls, ["initialize", "ensureCurrent", "query:foundation", "shutdown"]);
  const persisted = JSON.parse(
    await readFile(join(projectRoot, ".loopgraph/context/foundation.json"), "utf8")
  ) as { provider: string; relevantFiles: string[] };
  assert.equal(persisted.provider, "test-graph-provider");
  assert.deepEqual(persisted.relevantFiles, ["packages/core/src/index.ts"]);
});

test("does not shut down an adapter that never initialized", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-provider-failure-"));
  const graph = makeGraph([
    {
      id: "foundation",
      objective: "Create a foundation file.",
      dependsOn: [],
      completionConditions: [{ type: "fileExists", path: "foundation.txt" }]
    }
  ]);
  const adapter = new ScriptedAdapter({});
  let providerShutdowns = 0;
  const projectGraphProvider: ProjectGraphProvider = {
    name: "failing-provider",
    async initialize() {
      return undefined;
    },
    async ensureCurrent() {
      throw new Error("preflight failed");
    },
    async query() {
      throw new Error("query should not run");
    },
    async shutdown() {
      providerShutdowns += 1;
    }
  };
  const runtime = new GraphRuntime({ graph, adapter, projectRoot, projectGraphProvider });

  await assert.rejects(runtime.run(), /preflight failed/);

  assert.equal(adapter.initializeCalls, 0);
  assert.equal(adapter.shutdownCalls, 0);
  assert.equal(providerShutdowns, 1);
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
  initializeCalls = 0;
  shutdownCalls = 0;

  constructor(private readonly scripts: Record<string, (request: LoopExecutionRequest) => Promise<void>>) {}

  async initialize(): Promise<void> {
    this.initializeCalls += 1;
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
    this.shutdownCalls += 1;
    return undefined;
  }
}
