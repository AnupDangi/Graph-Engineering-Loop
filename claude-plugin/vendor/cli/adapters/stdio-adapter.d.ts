import type { AdapterInitializationContext, HarnessAdapter, LoopExecutionRequest, LoopExecutionResult } from "graph-engineering-loop-core";
export interface StdioAdapterOptions {
    command: string;
}
export declare class StdioAdapter implements HarnessAdapter {
    private readonly options;
    readonly name = "stdio";
    readonly capabilities: {
        supportsParallelLoops: boolean;
        supportsSubagents: boolean;
        supportsResume: boolean;
        supportsStructuredOutput: boolean;
        supportsIsolatedWorktrees: boolean;
    };
    private context?;
    constructor(options: StdioAdapterOptions);
    initialize(context: AdapterInitializationContext): Promise<void>;
    executeLoop(request: LoopExecutionRequest, signal: AbortSignal): Promise<LoopExecutionResult>;
    shutdown(): Promise<void>;
}
