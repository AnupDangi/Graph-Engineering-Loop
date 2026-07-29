import { type AdapterInitializationContext, type GraphCompilationInput, type HarnessAdapter, type LoopExecutionRequest, type LoopExecutionResult, type LoopGraph } from "graph-engineering-loop-core";
export interface ClaudeHeadlessAdapterOptions {
    claudePath?: string;
    permissionMode?: string;
    maxBudgetUsd?: string;
    model?: string;
}
export declare class ClaudeHeadlessAdapter implements HarnessAdapter {
    private readonly options;
    readonly name = "claude";
    readonly capabilities: {
        supportsParallelLoops: boolean;
        supportsSubagents: boolean;
        supportsResume: boolean;
        supportsStructuredOutput: boolean;
        supportsIsolatedWorktrees: boolean;
    };
    constructor(options?: ClaudeHeadlessAdapterOptions);
    initialize(_context: AdapterInitializationContext): Promise<void>;
    compileGraph(input: GraphCompilationInput): Promise<LoopGraph>;
    executeLoop(request: LoopExecutionRequest, signal: AbortSignal): Promise<LoopExecutionResult>;
    shutdown(): Promise<void>;
}
