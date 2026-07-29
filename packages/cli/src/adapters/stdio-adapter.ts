import { spawn } from "node:child_process";
import type {
  AdapterInitializationContext,
  HarnessAdapter,
  LoopExecutionRequest,
  LoopExecutionResult
} from "graph-engineering-loop-core";

export interface StdioAdapterOptions {
  command: string;
}

export class StdioAdapter implements HarnessAdapter {
  readonly name = "stdio";
  readonly capabilities = {
    supportsParallelLoops: false,
    supportsSubagents: true,
    supportsResume: false,
    supportsStructuredOutput: true,
    supportsIsolatedWorktrees: false
  };

  private context?: AdapterInitializationContext;

  constructor(private readonly options: StdioAdapterOptions) {}

  async initialize(context: AdapterInitializationContext): Promise<void> {
    this.context = context;
  }

  async executeLoop(request: LoopExecutionRequest, signal: AbortSignal): Promise<LoopExecutionResult> {
    const output = await runCommand(this.options.command, {
      type: "loop.execute",
      adapterContext: this.context,
      request
    }, signal, request.projectRoot);

    return normalizeStdioResult(output, request);
  }

  async shutdown(): Promise<void> {
    return undefined;
  }
}

function runCommand(
  command: string,
  payload: unknown,
  signal: AbortSignal,
  cwd: string
): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    signal.addEventListener("abort", () => child.kill("SIGTERM"));
    child.stdin.write(`${JSON.stringify(payload)}\n`);
    child.stdin.end();
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`stdio adapter command exited with code ${code}: ${stderr.trim()}`));
        return;
      }

      try {
        resolvePromise(JSON.parse(stdout));
      } catch {
        reject(new Error(`stdio adapter command did not return JSON: ${stdout.slice(0, 500)}`));
      }
    });
  });
}

function normalizeStdioResult(output: unknown, request: LoopExecutionRequest): LoopExecutionResult {
  if (typeof output !== "object" || output === null) {
    throw new Error("stdio adapter result must be a JSON object");
  }

  const record = output as Partial<LoopExecutionResult>;

  return {
    status: record.status ?? "incomplete",
    summary: record.summary ?? `stdio adapter executed ${request.loop.id}.`,
    completedTasks: Array.isArray(record.completedTasks) ? record.completedTasks : [],
    remainingWork: Array.isArray(record.remainingWork) ? record.remainingWork : [],
    changedFiles: Array.isArray(record.changedFiles) ? record.changedFiles : [],
    commandsRun: Array.isArray(record.commandsRun) ? record.commandsRun : [],
    completionEvidence: Array.isArray(record.completionEvidence) ? record.completionEvidence : [],
    handoff: record.handoff ?? [],
    blockedReason: record.blockedReason ?? null
  };
}
