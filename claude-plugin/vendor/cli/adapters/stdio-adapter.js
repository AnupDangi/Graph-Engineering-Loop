import { spawn } from "node:child_process";
export class StdioAdapter {
    options;
    name = "stdio";
    capabilities = {
        supportsParallelLoops: false,
        supportsSubagents: true,
        supportsResume: false,
        supportsStructuredOutput: true,
        supportsIsolatedWorktrees: false
    };
    context;
    constructor(options) {
        this.options = options;
    }
    async initialize(context) {
        this.context = context;
    }
    async executeLoop(request, signal) {
        const output = await runCommand(this.options.command, {
            type: "loop.execute",
            adapterContext: this.context,
            request
        }, signal, request.projectRoot);
        return normalizeStdioResult(output, request);
    }
    async shutdown() {
        return undefined;
    }
}
function runCommand(command, payload, signal, cwd) {
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
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk) => {
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
            }
            catch {
                reject(new Error(`stdio adapter command did not return JSON: ${stdout.slice(0, 500)}`));
            }
        });
    });
}
function normalizeStdioResult(output, request) {
    if (typeof output !== "object" || output === null) {
        throw new Error("stdio adapter result must be a JSON object");
    }
    const record = output;
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
//# sourceMappingURL=stdio-adapter.js.map