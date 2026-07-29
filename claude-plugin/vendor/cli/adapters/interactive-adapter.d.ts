import type { AdapterInitializationContext, HarnessAdapter, LoopExecutionRequest, LoopExecutionResult } from "graph-engineering-loop-core";
export interface InteractiveBridgeRequest {
    version: 1;
    type: "loop.execute";
    requestId: string;
    createdAt: string;
    request: LoopExecutionRequest;
}
export declare class InteractiveAdapter implements HarnessAdapter {
    readonly name = "interactive";
    readonly capabilities: {
        supportsParallelLoops: boolean;
        supportsSubagents: boolean;
        supportsResume: boolean;
        supportsStructuredOutput: boolean;
        supportsIsolatedWorktrees: boolean;
    };
    private bridgeDir?;
    private currentPath?;
    private responsesDir?;
    initialize(context: AdapterInitializationContext): Promise<void>;
    executeLoop(request: LoopExecutionRequest, signal: AbortSignal): Promise<LoopExecutionResult>;
    shutdown(): Promise<void>;
    private requireBridgeDir;
    private requireCurrentPath;
    private requireResponsesDir;
}
