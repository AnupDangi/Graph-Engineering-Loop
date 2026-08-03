import type { ProjectGraphContext, ProjectGraphProvider, ProjectGraphQuery, ProjectGraphRefreshOptions, ProjectGraphSnapshot } from "graph-engineering-loop-core";
export interface GraphifyCommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}
export interface GraphifyCommandOptions {
    signal?: AbortSignal;
    env: NodeJS.ProcessEnv;
}
export type GraphifyCommandRunner = (command: string, args: string[], cwd: string, options: GraphifyCommandOptions) => Promise<GraphifyCommandResult>;
export interface GraphifyCliProviderOptions {
    graphifyPath?: string;
    graphPath?: string;
    tokenBudget?: number;
    commandRunner?: GraphifyCommandRunner;
}
export declare class GraphifyCliProvider implements ProjectGraphProvider {
    private readonly options;
    readonly name = "graphify-cli";
    private projectRoot?;
    private graphPath?;
    private readonly commandRunner;
    constructor(options?: GraphifyCliProviderOptions);
    initialize(projectRoot: string): Promise<void>;
    ensureCurrent(options?: ProjectGraphRefreshOptions): Promise<ProjectGraphSnapshot>;
    query(request: ProjectGraphQuery, signal?: AbortSignal): Promise<ProjectGraphContext>;
    shutdown(): Promise<void>;
    private runGraphify;
    private requireProjectRoot;
    private requireGraphPath;
}
