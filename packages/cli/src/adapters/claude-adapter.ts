import { spawn } from "node:child_process";
import {
  assertValidLoopGraph,
  type AdapterInitializationContext,
  type GraphCompilationInput,
  type HarnessAdapter,
  type LoopExecutionRequest,
  type LoopExecutionResult,
  type LoopGraph
} from "graph-engineering-loop-core";

interface ClaudeJsonResponse {
  structured_output?: unknown;
  result?: unknown;
}

export interface ClaudeHeadlessAdapterOptions {
  claudePath?: string;
  permissionMode?: string;
  maxBudgetUsd?: string;
  model?: string;
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

  constructor(private readonly options: ClaudeHeadlessAdapterOptions = {}) {}

  async initialize(_context: AdapterInitializationContext): Promise<void> {
    return undefined;
  }

  async compileGraph(input: GraphCompilationInput): Promise<LoopGraph> {
    const output = await runClaudeStructured(
      buildGraphCompilerPrompt(input),
      loopGraphSchema,
      this.options,
      new AbortController().signal,
      input.projectRoot
    );

    return assertValidLoopGraph(output);
  }

  async executeLoop(request: LoopExecutionRequest, signal: AbortSignal): Promise<LoopExecutionResult> {
    const output = await runClaudeStructured(
      buildClaudeLoopPrompt(request),
      loopExecutionResultSchema,
      this.options,
      signal,
      request.projectRoot
    );
    return normalizeClaudeResult(output, request);
  }

  async shutdown(): Promise<void> {
    return undefined;
  }
}

function buildGraphCompilerPrompt(input: GraphCompilationInput): string {
  return `Create a LoopGraph version 1 graph from these requirements.

Project root:
${input.projectRoot}

Input kind:
${input.inputKind}

Requirements:
${input.input}

Rules:
1. Return only structured JSON matching the schema.
2. Create 2 to 6 substantial loops by default.
3. Do not create one loop per bullet point.
4. Use deterministic, safe loop ids matching ^[a-z][a-z0-9-]{0,63}$.
5. Include one final verification/integration loop when appropriate.
6. Completion conditions must be concrete and non-empty.
7. Use command conditions only for commands that are likely to exist in the project.
8. Use assertion conditions when deterministic commands are unknown.`;
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

async function runClaudeStructured(
  prompt: string,
  schema: Record<string, unknown>,
  options: ClaudeHeadlessAdapterOptions,
  signal: AbortSignal,
  cwd: string
): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const args = [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(schema),
      "--no-session-persistence"
    ];

    if (options.permissionMode !== undefined) {
      args.push("--permission-mode", options.permissionMode);
    }
    if (options.maxBudgetUsd !== undefined) {
      args.push("--max-budget-usd", options.maxBudgetUsd);
    }
    if (options.model !== undefined) {
      args.push("--model", options.model);
    }

    const child = spawn(options.claudePath ?? "claude", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

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
        reject(new Error(formatClaudeFailure(code, stdout, stderr)));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as ClaudeJsonResponse;
        const output = parsed.structured_output ?? parsed.result ?? parsed;
        resolvePromise(typeof output === "string" ? JSON.parse(output) : output);
      } catch {
        reject(new Error(`Unable to parse claude JSON output: ${stdout.slice(0, 500)}`));
      }
    });
  });
}

function formatClaudeFailure(code: number | null, stdout: string, stderr: string): string {
  const details: string[] = [`claude exited with code ${code ?? "unknown"}`];
  const trimmedStderr = stderr.trim();
  const trimmedStdout = stdout.trim();

  if (trimmedStderr.length > 0) {
    details.push(`stderr: ${trimmedStderr.slice(0, 1_000)}`);
  }

  if (trimmedStdout.length > 0) {
    details.push(`stdout: ${summarizeClaudeStdout(trimmedStdout)}`);
  }

  return details.join("\n");
}

function summarizeClaudeStdout(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout) as { subtype?: string; terminal_reason?: string; errors?: string[]; total_cost_usd?: number };
    return JSON.stringify({
      subtype: parsed.subtype,
      terminal_reason: parsed.terminal_reason,
      errors: parsed.errors,
      total_cost_usd: parsed.total_cost_usd
    });
  } catch {
    return stdout.slice(0, 1_000);
  }
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

const completionConditionSchema: Record<string, unknown> = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { const: "command" },
        command: { type: "string" },
        expectExitCode: { type: "number" }
      },
      required: ["type", "command"]
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { const: "fileExists" },
        path: { type: "string" }
      },
      required: ["type", "path"]
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { const: "fileContains" },
        path: { type: "string" },
        text: { type: "string" }
      },
      required: ["type", "path", "text"]
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { const: "assertion" },
        description: { type: "string" }
      },
      required: ["type", "description"]
    }
  ]
};

const loopGraphSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    $schema: { type: "string" },
    version: { const: 1 },
    name: { type: "string" },
    goal: { type: "string" },
    defaults: {
      type: "object",
      additionalProperties: false,
      properties: {
        maxIterations: { type: "number" },
        maxConcurrentLoops: { type: "number" }
      }
    },
    loops: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          objective: { type: "string" },
          tasks: { type: "array", items: { type: "string" } },
          sources: { type: "array", items: { type: "string" } },
          dependsOn: { type: "array", items: { type: "string" } },
          completionConditions: {
            type: "array",
            minItems: 1,
            items: completionConditionSchema
          },
          maxIterations: { type: "number" },
          metadata: { type: "object" }
        },
        required: ["id", "objective", "dependsOn", "completionConditions"]
      }
    }
  },
  required: ["version", "name", "goal", "loops"]
};

const loopExecutionResultSchema = {
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
        additionalProperties: false,
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
        additionalProperties: false,
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
};
