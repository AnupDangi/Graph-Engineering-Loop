import type { LoopGraph, ProjectGraphProvider } from "graph-engineering-loop-core";
export declare function compileRequirementsWithGraph(provider: ProjectGraphProvider, projectRoot: string, input: string, inputKind: "prompt" | "file" | "directory"): Promise<LoopGraph | null>;
export declare function compileRequirementsToGraph(requirements: string, sourceLabel: string): LoopGraph;
export declare function communityLoopId(community: string, index: number): string;
