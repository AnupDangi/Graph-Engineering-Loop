export type CompletionCondition =
  | CommandCondition
  | FileExistsCondition
  | FileContainsCondition
  | AssertionCondition
  | AllCondition;

export interface CommandCondition {
  type: "command";
  command: string;
  expectExitCode?: number;
}

export interface FileExistsCondition {
  type: "fileExists";
  path: string;
}

export interface FileContainsCondition {
  type: "fileContains";
  path: string;
  text: string;
}

export interface AssertionCondition {
  type: "assertion";
  description: string;
}

export interface AllCondition {
  type: "all";
  conditions: CompletionCondition[];
}

export interface LoopGraphDefaults {
  maxIterations?: number;
  maxConcurrentLoops?: number;
}

export interface LoopDefinition {
  id: string;
  title?: string;
  objective: string;
  tasks?: string[];
  sources?: string[];
  dependsOn: string[];
  completionConditions: CompletionCondition[];
  maxIterations?: number;
  metadata?: Record<string, unknown>;
}

export interface LoopGraph {
  $schema?: string;
  version: 1;
  name: string;
  goal: string;
  defaults?: LoopGraphDefaults;
  loops: LoopDefinition[];
}

export type LoopStatus =
  | "waiting"
  | "ready"
  | "running"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled";

export type GraphStatus =
  | "pending"
  | "running"
  | "completed"
  | "completed_with_blocks"
  | "failed"
  | "cancelled";

export interface ConditionEvidence {
  conditionIndex: number;
  passed: boolean;
  checkedAt: string;
  evidence: Record<string, unknown>;
}

export interface HarnessCapabilities {
  supportsParallelLoops: boolean;
  supportsSubagents: boolean;
  supportsResume: boolean;
  supportsStructuredOutput: boolean;
  supportsIsolatedWorktrees: boolean;
}

export interface AdapterInitializationContext {
  projectRoot: string;
  graph: LoopGraph;
}

export interface GraphCompilationInput {
  projectRoot: string;
  input: string;
  inputKind: "prompt" | "file" | "directory";
}

export interface LoopExecutionRequest {
  graph: LoopGraph;
  loop: LoopDefinition;
  dependencyResults: LoopResult[];
  currentIteration: number;
  maxIterations: number;
  previousResult?: LoopExecutionResult;
  projectRoot: string;
  projectGraphContext?: import("../context/project-graph-provider.js").ProjectGraphContext;
}

export type AdapterLoopStatus = "complete" | "incomplete" | "blocked" | "failed";

export interface CommandResult {
  command: string;
  exitCode: number;
  outputSummary?: string;
}

export interface LoopExecutionResult {
  status: AdapterLoopStatus;
  summary: string;
  completedTasks: string[];
  remainingWork: string[];
  changedFiles: string[];
  commandsRun: CommandResult[];
  completionEvidence: ConditionEvidence[];
  handoff: string | string[];
  blockedReason: string | null;
}

export interface HarnessAdapter {
  readonly name: string;
  readonly capabilities: HarnessCapabilities;

  initialize(context: AdapterInitializationContext): Promise<void>;

  compileGraph?(input: GraphCompilationInput): Promise<LoopGraph>;

  executeLoop(
    request: LoopExecutionRequest,
    signal: AbortSignal
  ): Promise<LoopExecutionResult>;

  cancelLoop?(loopId: string): Promise<void>;

  shutdown(): Promise<void>;
}

export interface LoopResult {
  loopId: string;
  status: LoopStatus;
  iterationsUsed: number;
  summary: string;
  changedFiles: string[];
  verification: ConditionEvidence[];
  handoff: string[];
  blockedReason?: string;
}
