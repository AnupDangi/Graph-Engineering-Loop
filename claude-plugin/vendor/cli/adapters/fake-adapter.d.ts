import type { AdapterInitializationContext, HarnessAdapter, LoopExecutionRequest, LoopExecutionResult } from "graph-engineering-loop-core";
export declare class FakeAdapter implements HarnessAdapter {
    readonly name = "fake";
    readonly capabilities: {
        supportsParallelLoops: boolean;
        supportsSubagents: boolean;
        supportsResume: boolean;
        supportsStructuredOutput: boolean;
        supportsIsolatedWorktrees: boolean;
    };
    initialize(_context: AdapterInitializationContext): Promise<void>;
    executeLoop(request: LoopExecutionRequest): Promise<LoopExecutionResult>;
    shutdown(): Promise<void>;
}
