import { spawn } from "node:child_process";
import type {
  AdapterInitializationContext,
  HarnessAdapter,
  LoopExecutionRequest,
  LoopExecutionResult
} from "graph-engineering-loop-core";

interface ClaudeJsonResponse {
  structured_output?: unknown;
  result?: string;
}

export class ClaudeHeadlessAdapter implements HarnessAdapter {
  readonly name = "claude";
  readonly capabilities = {
    supportsParallelLoops: false,
    supportsSubagents: true,
    supportsResume: true,
    supportsStructuredOutput: true,
    supportsIsolatedWorktrees: false
  };

  async initialize(_context: AdapterInitializationContext): Promise<void> {
    return undefined;
  }

  async executeLoop(request: LoopExecutionRequest, signal: AbortSignal): Promise<LoopExecutionResult> {
    const prompt = buildClaudeLoopPrompt(request);
    const output = await runClaude(prompt, signal);
    return normalizeClaudeResult(output, request);
  }

  async shutdown(): Promise<void> {
    return undefined;
  }
}

function buildClaudeLoopPrompt(request: LoopExecutionRequest): string {
  return `You are executing one LoopGraph workstream.

A loop is a completion-driven workstream, not a single agent task.
You may use multiple agents, subagents, tools and implementation steps.

Graph goal:
${request.graph.goal}

Loop:
${request.loop.title ?? request.loop.id}

Objective:
${request.loop.objective}

Tasks:
${JSON.stringify(request.loop.tasks ?? [], null, 2)}

Relevant sources:
${JSON.stringify(request.loop.sources ?? [], null, 2)}

Completed dependency outputs:
${JSON.stringify(request.dependencyResults, null, 2)}

Iteration:
${request.currentIteration} of ${request.maxIterations}

Completion conditions:
${JSON.stringify(request.loop.completionConditions, null, 2)}

Project root:
${request.projectRoot}

Requirements:
1. Inspect the current repository state before changing files.
2. Work only toward this loop's objective.
3. Use subagents when useful.
4. Run relevant validation.
5. Do not claim completion without evidence.
6. Return structured output matching the required JSON schema.
7. When incomplete, clearly describe remaining work.
8. When blocked, clearly describe the blocker.`;
}

async function runClaude(prompt: string, signal: AbortSignal): Promise<unknown> {
  const schema = JSON.stringify({
    type: "object",
    additionalProperties: false,
    properties: {
      status: { enum: ["complete", "incomplete", "blocked", "failed"] },
      summary: { type: "string" },
      completedTasks: { type: "array", items: { type: "string" } },
      remainingWork: { type: "array", items: { type: "string" } },
      changedFiles: { type: "array", items: { type: "string" } },
      commandsRun: {
        type: "array",
        items: {
          type: "object",
          properties: {
            command: { type: "string" },
            exitCode: { type: "number" },
            outputSummary: { type: "string" }
          },
          required: ["command", "exitCode"]
        }
      },
      completionEvidence: {
        type: "array",
        items: {
          type: "object",
          properties: {
            conditionIndex: { type: "number" },
            passed: { type: "boolean" },
            checkedAt: { type: "string" },
            evidence: { type: "object" }
          },
          required: ["conditionIndex", "passed", "checkedAt", "evidence"]
        }
      },
      handoff: {
        anyOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } }
        ]
      },
      blockedReason: {
        anyOf: [{ type: "string" }, { type: "null" }]
      }
    },
    required: [
      "status",
      "summary",
      "completedTasks",
      "remainingWork",
      "changedFiles",
      "commandsRun",
      "completionEvidence",
      "handoff",
      "blockedReason"
    ]
  });

  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      "claude",
      ["-p", prompt, "--output-format", "json", "--json-schema", schema],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    let stdout = "";
    let stderr = "";

    signal.addEventListener("abort", () => child.kill("SIGTERM"));
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}: ${stderr.trim()}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as ClaudeJsonResponse;
        resolvePromise(parsed.structured_output ?? parsed.result ?? parsed);
      } catch {
        reject(new Error(`Unable to parse claude JSON output: ${stdout.slice(0, 500)}`));
      }
    });
  });
}

function normalizeClaudeResult(output: unknown, request: LoopExecutionRequest): LoopExecutionResult {
  if (typeof output === "object" && output !== null) {
    const record = output as Partial<LoopExecutionResult>;
    return {
      status: record.status ?? "incomplete",
      summary: record.summary ?? `Claude executed ${request.loop.id}.`,
      completedTasks: Array.isArray(record.completedTasks) ? record.completedTasks : [],
      remainingWork: Array.isArray(record.remainingWork) ? record.remainingWork : [],
      changedFiles: Array.isArray(record.changedFiles) ? record.changedFiles : [],
      commandsRun: Array.isArray(record.commandsRun) ? record.commandsRun : [],
      completionEvidence: Array.isArray(record.completionEvidence) ? record.completionEvidence : [],
      handoff: record.handoff ?? [],
      blockedReason: record.blockedReason ?? null
    };
  }

  return {
    status: "incomplete",
    summary: String(output),
    completedTasks: [],
    remainingWork: ["Claude did not return structured output."],
    changedFiles: [],
    commandsRun: [],
    completionEvidence: [],
    handoff: [],
    blockedReason: null
  };
}
