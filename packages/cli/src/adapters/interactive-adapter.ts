import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import type {
  AdapterInitializationContext,
  AdapterLoopStatus,
  HarnessAdapter,
  LoopExecutionRequest,
  LoopExecutionResult
} from "graph-engineering-loop-core";

export interface InteractiveBridgeRequest {
  version: 1;
  type: "loop.execute";
  requestId: string;
  createdAt: string;
  request: LoopExecutionRequest;
}

export class InteractiveAdapter implements HarnessAdapter {
  readonly name = "interactive";
  readonly capabilities = {
    supportsParallelLoops: false,
    supportsSubagents: true,
    supportsResume: false,
    supportsStructuredOutput: true,
    supportsIsolatedWorktrees: false
  };

  private bridgeDir?: string;
  private currentPath?: string;
  private responsesDir?: string;

  async initialize(context: AdapterInitializationContext): Promise<void> {
    this.bridgeDir = join(context.projectRoot, ".loopgraph", "bridge");
    this.currentPath = join(this.bridgeDir, "current.json");
    this.responsesDir = join(this.bridgeDir, "responses");

    await mkdir(join(this.bridgeDir, "requests"), { recursive: true });
    await mkdir(this.responsesDir, { recursive: true });
    await rm(this.currentPath, { force: true });
  }

  async executeLoop(request: LoopExecutionRequest, signal: AbortSignal): Promise<LoopExecutionResult> {
    const bridgeDir = this.requireBridgeDir();
    const currentPath = this.requireCurrentPath();
    const responsesDir = this.requireResponsesDir();
    const requestId = createRequestId(request);
    const packet: InteractiveBridgeRequest = {
      version: 1,
      type: "loop.execute",
      requestId,
      createdAt: new Date().toISOString(),
      request
    };
    const requestPath = join(bridgeDir, "requests", `${requestId}.json`);
    const responsePath = join(responsesDir, `${requestId}.json`);

    await atomicWriteJson(requestPath, packet);
    await atomicWriteJson(currentPath, packet);

    const response = await waitForResponse(responsePath, signal);
    await removeCurrentRequest(currentPath, requestId);
    return normalizeInteractiveResult(response, request);
  }

  async shutdown(): Promise<void> {
    if (this.currentPath !== undefined) {
      await rm(this.currentPath, { force: true });
    }
  }

  private requireBridgeDir(): string {
    if (this.bridgeDir === undefined) {
      throw new Error("Interactive adapter was not initialized.");
    }
    return this.bridgeDir;
  }

  private requireCurrentPath(): string {
    if (this.currentPath === undefined) {
      throw new Error("Interactive adapter was not initialized.");
    }
    return this.currentPath;
  }

  private requireResponsesDir(): string {
    if (this.responsesDir === undefined) {
      throw new Error("Interactive adapter was not initialized.");
    }
    return this.responsesDir;
  }
}

function createRequestId(request: LoopExecutionRequest): string {
  const suffix = randomBytes(4).toString("hex");
  return `${process.pid}-${request.loop.id}-${request.currentIteration}-${suffix}`;
}

async function waitForResponse(path: string, signal: AbortSignal): Promise<unknown> {
  while (!signal.aborted) {
    try {
      return JSON.parse(await readFile(path, "utf8")) as unknown;
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw new Error(`Unable to read interactive response ${path}: ${formatError(error)}`, {
          cause: error
        });
      }
    }

    await waitForPoll(signal);
  }

  throw new Error("Interactive loop execution was cancelled.");
}

function waitForPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolvePromise) => {
    const timeout = setTimeout(resolvePromise, 200);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolvePromise();
      },
      { once: true }
    );
  });
}

async function removeCurrentRequest(path: string, requestId: string): Promise<void> {
  try {
    const current = JSON.parse(await readFile(path, "utf8")) as { requestId?: string };
    if (current.requestId === requestId) {
      await rm(path, { force: true });
    }
  } catch {
    // The bridge runner may already have removed a stale current request.
  }
}

function normalizeInteractiveResult(output: unknown, request: LoopExecutionRequest): LoopExecutionResult {
  if (typeof output !== "object" || output === null) {
    throw new Error("Interactive adapter response must be a JSON object.");
  }

  const record = output as Partial<LoopExecutionResult>;
  const status = normalizeStatus(record.status);

  return {
    status,
    summary: typeof record.summary === "string" ? record.summary : `Claude Code executed ${request.loop.id}.`,
    completedTasks: stringArray(record.completedTasks),
    remainingWork: stringArray(record.remainingWork),
    changedFiles: stringArray(record.changedFiles),
    commandsRun: Array.isArray(record.commandsRun) ? record.commandsRun : [],
    completionEvidence: Array.isArray(record.completionEvidence) ? record.completionEvidence : [],
    handoff: typeof record.handoff === "string" || Array.isArray(record.handoff) ? record.handoff : [],
    blockedReason: typeof record.blockedReason === "string" ? record.blockedReason : null
  };
}

function normalizeStatus(status: unknown): AdapterLoopStatus {
  if (status === "complete" || status === "incomplete" || status === "blocked" || status === "failed") {
    return status;
  }
  return "incomplete";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  const file = await open(tmpPath, "w");

  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }

  await rename(tmpPath, path);
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
