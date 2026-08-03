import test from "node:test";
import assert from "node:assert/strict";
import { buildClaudeLoopPrompt } from "../packages/cli/src/adapters/claude-adapter.ts";
import type { LoopExecutionRequest, LoopGraph } from "../packages/core/src/index.ts";

test("Claude prompt receives bounded graph scope without raw Graphify content", () => {
  const graph: LoopGraph = {
    version: 1,
    name: "prompt-test",
    goal: "Use safe graph scope.",
    loops: [
      {
        id: "runtime",
        objective: "Update the runtime.",
        dependsOn: [],
        completionConditions: [{ type: "assertion", description: "Runtime is updated." }]
      }
    ]
  };
  const request: LoopExecutionRequest = {
    graph,
    loop: graph.loops[0],
    dependencyResults: [],
    currentIteration: 1,
    maxIterations: 3,
    projectRoot: "/project",
    projectGraphContext: {
      provider: "graphify-cli",
      query: "sensitive query text",
      generatedAt: "2026-08-03T00:00:00.000Z",
      content: "RAW_CONTEXT_MUST_NOT_LEAVE_THE_PACKET",
      communities: ["runtime"],
      entryNodes: ["GraphRuntime"],
      relevantFiles: ["packages/core/src/runtime/graph-runtime.ts"],
      estimatedWriteFiles: []
    }
  };

  const prompt = buildClaudeLoopPrompt(request);

  assert.match(prompt, /packages\/core\/src\/runtime\/graph-runtime\.ts/);
  assert.match(prompt, /GraphRuntime/);
  assert.match(prompt, /rawContextOmitted/);
  assert.doesNotMatch(prompt, /RAW_CONTEXT_MUST_NOT_LEAVE_THE_PACKET/);
  assert.doesNotMatch(prompt, /sensitive query text/);
});
