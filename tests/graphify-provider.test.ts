import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { GraphifyCliProvider } from "../packages/cli/src/context/graphify-cli-provider.ts";
import type { LoopGraph } from "../packages/core/src/index.ts";

test("Graphify CLI provider builds, updates, and queries scoped context", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-graphify-"));
  const canonicalProjectRoot = await realpath(projectRoot);
  const graphPath = join(projectRoot, "graphify-out/graph.json");
  const calls: string[][] = [];
  const queryLogSettings: Array<string | undefined> = [];
  const provider = new GraphifyCliProvider({
    graphifyPath: "/tools/graphify",
    commandRunner: async (command, args, cwd, options) => {
      assert.equal(command, "/tools/graphify");
      assert.equal(cwd, canonicalProjectRoot);
      calls.push(args);
      queryLogSettings.push(options.env.GRAPHIFY_QUERY_LOG_DISABLE);

      if (args[0] === "extract" || args[0] === "update") {
        await mkdir(join(projectRoot, "graphify-out"), { recursive: true });
        await writeFile(graphPath, "{}\n");
        return { exitCode: 0, stdout: "graph built", stderr: "" };
      }

      return {
        exitCode: 0,
        stdout: "GraphRuntime → packages/core/src/runtime/graph-runtime.ts:69 [EXTRACTED]\n../outside.ts:1",
        stderr: ""
      };
    }
  });
  const graph: LoopGraph = {
    version: 1,
    name: "graphify-test",
    goal: "Use graph context.",
    loops: [
      {
        id: "runtime",
        objective: "Add graph-aware runtime context.",
        dependsOn: [],
        completionConditions: [{ type: "assertion", description: "Context is available." }]
      }
    ]
  };

  await provider.initialize(projectRoot);
  const initial = await provider.ensureCurrent({ incremental: true });
  const updated = await provider.ensureCurrent({ incremental: true });
  const context = await provider.query({
    graph,
    loop: graph.loops[0],
    dependencyResults: []
  });

  assert.equal(initial.provider, "graphify-cli");
  assert.equal(updated.metadata?.incremental, true);
  assert.deepEqual(calls[0], ["extract", ".", "--out", ".", "--code-only"]);
  assert.deepEqual(calls[1], ["update", "."]);
  assert.equal(calls[2][0], "query");
  assert.match(calls[2][1], /graph-aware runtime context/);
  assert.deepEqual(context.relevantFiles, ["packages/core/src/runtime/graph-runtime.ts"]);
  assert.match(context.content, /GraphRuntime/);
  assert.deepEqual(queryLogSettings, ["1", "1", "1"]);
});

test("Graphify CLI provider surfaces command failures", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-graphify-error-"));
  const provider = new GraphifyCliProvider({
    commandRunner: async () => ({ exitCode: 2, stdout: "", stderr: "graph unavailable" })
  });

  await provider.initialize(projectRoot);

  await assert.rejects(
    provider.ensureCurrent(),
    /Graphify could not build or update the project graph: graph unavailable/
  );
});

test("Graphify CLI provider rejects graph paths outside the project", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-graphify-path-"));
  const provider = new GraphifyCliProvider({ graphPath: "../outside.json" });

  await assert.rejects(
    provider.initialize(projectRoot),
    /Graphify graph path must stay inside the project root/
  );
});

test("Graphify CLI provider rejects graph symlinks outside the project", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-graphify-symlink-"));
  const outsideRoot = await mkdtemp(join(tmpdir(), "loopgraph-graphify-outside-"));
  await mkdir(join(projectRoot, "graphify-out"), { recursive: true });
  const outsideGraph = join(outsideRoot, "graph.json");
  await writeFile(outsideGraph, "{}\n");
  await symlink(outsideGraph, join(projectRoot, "graphify-out/graph.json"));
  const provider = new GraphifyCliProvider();

  await provider.initialize(projectRoot);

  await assert.rejects(provider.ensureCurrent(), /Graphify graph path resolves outside the project root/);
});

test("Graphify CLI provider forwards cancellation to command execution", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-graphify-cancel-"));
  const provider = new GraphifyCliProvider({
    commandRunner: async (_command, _args, _cwd, options) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new Error("cancelled by test")), {
          once: true
        });
      })
  });
  const abortController = new AbortController();

  await provider.initialize(projectRoot);
  const preflight = provider.ensureCurrent({ signal: abortController.signal });
  abortController.abort();

  await assert.rejects(preflight, /cancelled/);
});
