import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

import {
  GraphRuntime,
  IntegrationSupervisor,
  WorktreeManager,
  assessOverlap,
  planExecutionWaves,
  type LoopGraph,
  type LoopResult
} from "../packages/core/src/index.js";
import { FakeAdapter } from "../packages/cli/src/adapters/fake-adapter.js";

const execFileAsync = promisify(execFile);

function plan(loopId: string, files: string[]) {
  return { loopId, files };
}

test("conflict scoring serializes overlapping write sets deterministically", () => {
  const a = plan("frontend", ["src/ui/App.tsx", "src/ui/button.ts"]);
  const b = plan("backend", ["src/api/routes.ts"]);

  const disjoint = assessOverlap(a, b);
  assert.equal(disjoint.serialized, false);
  assert.deepEqual(disjoint.sharedFiles, []);

  const overlap = assessOverlap(a, plan("refactor", ["src/ui/App.tsx", "src/ui/icon.ts"]), 0.25);
  assert.equal(overlap.serialized, true);
  assert.deepEqual(overlap.sharedFiles, ["src/ui/App.tsx"]);
});

test("wave planning respects concurrency and conflict thresholds", () => {
  const plans = [
    plan("a", ["src/shared.ts"]),
    plan("b", ["src/shared.ts", "src/b.ts"]),
    plan("c", ["src/c.ts"])
  ];

  const { waves, serializations } = planExecutionWaves(plans, 2, 0.25);
  assert.equal(waves.length, 2);
  assert.ok(waves[0]!.includes("a") || waves[0]!.includes("b"));
  assert.equal(serializations.length, 1);
  assert.deepEqual(serializations[0], {
    loopA: "b",
    loopB: "a",
    sharedFiles: ["src/shared.ts"],
    overlapRatio: 0.5,
    serialized: true
  });
});

test("wave planning is deterministic across identical inputs", () => {
  const plans = [plan("z", ["x.ts"]), plan("a", ["x.ts"]), plan("m", ["y.ts"])];
  const first = planExecutionWaves(plans, 2);
  const second = planExecutionWaves(plans, 2);
  assert.deepEqual(first, second);
});

test("worktree manager creates, lists, and removes isolated worktrees", async () => {
  const projectRoot = await initGitRepo();
  const manager = new WorktreeManager(projectRoot);

  const info = await manager.create("loop-one");
  assert.equal(info.branch, "loop/loop-one");
  assert.equal(resolve(info.path), join(resolve(projectRoot), ".loopgraph", "workspaces", "loop-one"));

  const listed = await manager.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.loopId, "loop-one");

  await manager.remove("loop-one");
  assert.equal((await manager.list()).length, 0);

  await rm(projectRoot, { recursive: true, force: true });
});

test("worktree manager rejects invalid loop ids", async () => {
  const projectRoot = await initGitRepo();
  const manager = new WorktreeManager(projectRoot);

  await assert.rejects(() => manager.create("Bad Loop!"), /Invalid loop id/);
  await rm(projectRoot, { recursive: true, force: true });
});

test("integration supervisor builds a dependency-ordered merge plan", async () => {
  const projectRoot = await initGitRepo();
  const manager = new WorktreeManager(projectRoot);
  const supervisor = new IntegrationSupervisor(manager);

  await manager.create("foundation");
  await manager.create("backend");

  const graph: LoopGraph = {
    version: 1,
    name: "iso-test",
    goal: "Test isolation.",
    loops: [
      { id: "foundation", objective: "f", dependsOn: [], completionConditions: [] },
      { id: "backend", objective: "b", dependsOn: ["foundation"], completionConditions: [] }
    ]
  };
  const results: LoopResult[] = [
    {
      loopId: "foundation",
      status: "completed",
      iterationsUsed: 1,
      summary: "",
      changedFiles: [],
      verification: [],
      handoff: []
    },
    {
      loopId: "backend",
      status: "failed",
      iterationsUsed: 1,
      summary: "",
      changedFiles: [],
      verification: [],
      handoff: []
    }
  ];

  const plan = await supervisor.buildPlan(graph, results, await manager.list());
  assert.deepEqual(
    plan.steps.map((step) => step.loopId),
    ["foundation", "backend"]
  );
  assert.equal(plan.steps[0]!.status, "pending");
  assert.equal(plan.steps[1]!.status, "skipped");

  await rm(projectRoot, { recursive: true, force: true });
});

test("runtime isolates independent loops into worktrees and merges through an integration loop", async () => {
  const projectRoot = await initGitRepo();
  const manager = new WorktreeManager(projectRoot);
  const supervisor = new IntegrationSupervisor(manager);

  const graph: LoopGraph = {
    version: 1,
    name: "iso-runtime",
    goal: "Isolate workers, integrate once.",
    defaults: { maxConcurrentLoops: 2 },
    loops: [
      {
        id: "worker-a",
        objective: "Write file a.txt.",
        dependsOn: [],
        metadata: { isolated: true, fakeWrites: [{ path: "a.txt", content: "a\n" }] },
        completionConditions: [{ type: "fileExists", path: "a.txt" }]
      },
      {
        id: "worker-b",
        objective: "Write file b.txt.",
        dependsOn: [],
        metadata: { isolated: true, fakeWrites: [{ path: "b.txt", content: "b\n" }] },
        completionConditions: [{ type: "fileExists", path: "b.txt" }]
      },
      {
        id: "integration",
        objective: "Verify merged files.",
        dependsOn: ["worker-a", "worker-b"],
        metadata: { integration: true },
        completionConditions: [
          { type: "fileExists", path: "a.txt" },
          { type: "fileExists", path: "b.txt" }
        ]
      }
    ]
  };

  const runtime = new GraphRuntime({
    graph,
    adapter: new FakeAdapter(),
    projectRoot,
    worktreeManager: manager,
    integrationSupervisor: supervisor,
    isolatedLoopIds: ["worker-a", "worker-b"]
  });

  const result = await runtime.run();
  assert.equal(result.status, "completed");

  const worktrees = await manager.list();
  assert.equal(worktrees.length, 2);

  const aText = await readFile(join(projectRoot, "a.txt"), "utf8");
  assert.equal(aText.trim(), "a");
  const bText = await readFile(join(projectRoot, "b.txt"), "utf8");
  assert.equal(bText.trim(), "b");

  await supervisor.finalize(graph, result.results);
  assert.equal((await manager.list()).length, 0);

  const { stdout: branchList } = await execFileAsync("git", ["branch", "--list", "loop/*"], {
    cwd: projectRoot
  });
  assert.equal(branchList.trim(), "");

  await rm(projectRoot, { recursive: true, force: true });
});

test("runtime serializes overlapping ready loops when conflict planning is enabled", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-conflict-"));
  const active = new Set<string>();

  const trackingAdapter = new (class extends FakeAdapter {
    override name = "tracking";
    override async executeLoop(
      request: Parameters<FakeAdapter["executeLoop"]>[0]
    ): Promise<ReturnType<FakeAdapter["executeLoop"]>> {
      active.add(request.loop.id);
      assert.equal(active.size, 1, `loop ${request.loop.id} ran while another loop was active`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
      active.delete(request.loop.id);
      return super.executeLoop(request);
    }
  })();

  const graph: LoopGraph = {
    version: 1,
    name: "conflict-schedule",
    goal: "Prove overlap serialization.",
    defaults: { maxConcurrentLoops: 2 },
    loops: [
      {
        id: "alpha",
        objective: "a",
        dependsOn: [],
        sources: ["src/shared.ts"],
        completionConditions: [{ type: "assertion", description: "a" }]
      },
      {
        id: "beta",
        objective: "b",
        dependsOn: [],
        sources: ["src/shared.ts"],
        completionConditions: [{ type: "assertion", description: "b" }]
      }
    ]
  };

  const runtime = new GraphRuntime({
    graph,
    adapter: trackingAdapter,
    projectRoot,
    maxOverlapRatio: 0.25
  });

  const result = await runtime.run();
  assert.equal(result.status, "completed");

  await rm(projectRoot, { recursive: true, force: true });
});

async function initGitRepo(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-git-"));
  await execFileAsync("git", ["init"], { cwd: projectRoot });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: projectRoot });
  await execFileAsync("git", ["config", "user.name", "LoopGraph Test"], { cwd: projectRoot });
  await writeFile(join(projectRoot, "README.md"), "# test\n");
  await execFileAsync("git", ["add", "-A"], { cwd: projectRoot });
  await execFileAsync("git", ["commit", "-m", "base"], { cwd: projectRoot });
  return projectRoot;
}
