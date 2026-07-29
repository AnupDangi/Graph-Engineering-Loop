import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
export class InteractiveAdapter {
    name = "interactive";
    capabilities = {
        supportsParallelLoops: false,
        supportsSubagents: true,
        supportsResume: false,
        supportsStructuredOutput: true,
        supportsIsolatedWorktrees: false
    };
    bridgeDir;
    currentPath;
    responsesDir;
    async initialize(context) {
        this.bridgeDir = join(context.projectRoot, ".loopgraph", "bridge");
        this.currentPath = join(this.bridgeDir, "current.json");
        this.responsesDir = join(this.bridgeDir, "responses");
        await mkdir(join(this.bridgeDir, "requests"), { recursive: true });
        await mkdir(this.responsesDir, { recursive: true });
        await rm(this.currentPath, { force: true });
    }
    async executeLoop(request, signal) {
        const bridgeDir = this.requireBridgeDir();
        const currentPath = this.requireCurrentPath();
        const responsesDir = this.requireResponsesDir();
        const requestId = createRequestId(request);
        const packet = {
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
    async shutdown() {
        if (this.currentPath !== undefined) {
            await rm(this.currentPath, { force: true });
        }
    }
    requireBridgeDir() {
        if (this.bridgeDir === undefined) {
            throw new Error("Interactive adapter was not initialized.");
        }
        return this.bridgeDir;
    }
    requireCurrentPath() {
        if (this.currentPath === undefined) {
            throw new Error("Interactive adapter was not initialized.");
        }
        return this.currentPath;
    }
    requireResponsesDir() {
        if (this.responsesDir === undefined) {
            throw new Error("Interactive adapter was not initialized.");
        }
        return this.responsesDir;
    }
}
function createRequestId(request) {
    const suffix = randomBytes(4).toString("hex");
    return `${process.pid}-${request.loop.id}-${request.currentIteration}-${suffix}`;
}
async function waitForResponse(path, signal) {
    while (!signal.aborted) {
        try {
            return JSON.parse(await readFile(path, "utf8"));
        }
        catch (error) {
            if (!isMissingFileError(error)) {
                throw new Error(`Unable to read interactive response ${path}: ${formatError(error)}`);
            }
        }
        await waitForPoll(signal);
    }
    throw new Error("Interactive loop execution was cancelled.");
}
function waitForPoll(signal) {
    return new Promise((resolvePromise) => {
        const timeout = setTimeout(resolvePromise, 200);
        signal.addEventListener("abort", () => {
            clearTimeout(timeout);
            resolvePromise();
        }, { once: true });
    });
}
async function removeCurrentRequest(path, requestId) {
    try {
        const current = JSON.parse(await readFile(path, "utf8"));
        if (current.requestId === requestId) {
            await rm(path, { force: true });
        }
    }
    catch {
        // The bridge runner may already have removed a stale current request.
    }
}
function normalizeInteractiveResult(output, request) {
    if (typeof output !== "object" || output === null) {
        throw new Error("Interactive adapter response must be a JSON object.");
    }
    const record = output;
    const status = normalizeStatus(record.status);
    return {
        status,
        summary: typeof record.summary === "string"
            ? record.summary
            : `Claude Code executed ${request.loop.id}.`,
        completedTasks: stringArray(record.completedTasks),
        remainingWork: stringArray(record.remainingWork),
        changedFiles: stringArray(record.changedFiles),
        commandsRun: Array.isArray(record.commandsRun) ? record.commandsRun : [],
        completionEvidence: Array.isArray(record.completionEvidence) ? record.completionEvidence : [],
        handoff: typeof record.handoff === "string" || Array.isArray(record.handoff)
            ? record.handoff
            : [],
        blockedReason: typeof record.blockedReason === "string" ? record.blockedReason : null
    };
}
function normalizeStatus(status) {
    if (status === "complete" || status === "incomplete" || status === "blocked" || status === "failed") {
        return status;
    }
    return "incomplete";
}
function stringArray(value) {
    return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}
async function atomicWriteJson(path, value) {
    await mkdir(dirname(path), { recursive: true });
    const tmpPath = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    const file = await open(tmpPath, "w");
    try {
        await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
        await file.sync();
    }
    finally {
        await file.close();
    }
    await rename(tmpPath, path);
}
function isMissingFileError(error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
function formatError(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=interactive-adapter.js.map