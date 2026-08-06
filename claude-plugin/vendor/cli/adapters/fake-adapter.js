import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
export class FakeAdapter {
    name = "fake";
    capabilities = {
        supportsParallelLoops: true,
        supportsSubagents: false,
        supportsResume: false,
        supportsStructuredOutput: true,
        supportsIsolatedWorktrees: true
    };
    async initialize(_context) {
        return undefined;
    }
    async executeLoop(request) {
        const fakeWrites = Array.isArray(request.loop.metadata?.fakeWrites)
            ? request.loop.metadata.fakeWrites
            : [];
        const changedFiles = [];
        for (const entry of fakeWrites) {
            if (!isFakeWrite(entry)) {
                continue;
            }
            const absolutePath = join(request.projectRoot, entry.path);
            await mkdir(dirname(absolutePath), { recursive: true });
            await writeFile(absolutePath, entry.content ?? `${request.loop.id}\n`, "utf8");
            changedFiles.push(entry.path);
        }
        return {
            status: "complete",
            summary: `Fake adapter executed loop '${request.loop.id}'.`,
            completedTasks: request.loop.tasks ?? [],
            remainingWork: [],
            changedFiles,
            commandsRun: [],
            completionEvidence: request.loop.completionConditions.map((condition, conditionIndex) => ({
                conditionIndex,
                passed: condition.type === "assertion",
                checkedAt: new Date().toISOString(),
                evidence: {
                    adapter: "fake",
                    loopId: request.loop.id,
                    conditionType: condition.type
                }
            })),
            handoff: [`${request.loop.id} completed by fake adapter.`],
            blockedReason: null
        };
    }
    async shutdown() {
        return undefined;
    }
}
function isFakeWrite(value) {
    return (typeof value === "object" &&
        value !== null &&
        "path" in value &&
        typeof value.path === "string" &&
        (!("content" in value) || typeof value.content === "string"));
}
//# sourceMappingURL=fake-adapter.js.map