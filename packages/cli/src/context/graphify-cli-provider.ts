import { access, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type {
  ProjectGraphContext,
  ProjectGraphProvider,
  ProjectGraphQuery,
  ProjectGraphRefreshOptions,
  ProjectGraphSnapshot
} from "graph-engineering-loop-core";

const DEFAULT_OUTPUT_LIMIT = 1_000_000;
const SOURCE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "go",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "md",
  "mjs",
  "mts",
  "php",
  "py",
  "rb",
  "rs",
  "sh",
  "sql",
  "svelte",
  "swift",
  "ts",
  "tsx",
  "vue",
  "yaml",
  "yml",
  "zig"
]);

export interface GraphifyCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface GraphifyCommandOptions {
  signal?: AbortSignal;
  env: NodeJS.ProcessEnv;
}

export type GraphifyCommandRunner = (
  command: string,
  args: string[],
  cwd: string,
  options: GraphifyCommandOptions
) => Promise<GraphifyCommandResult>;

export interface GraphifyCliProviderOptions {
  graphifyPath?: string;
  graphPath?: string;
  tokenBudget?: number;
  commandRunner?: GraphifyCommandRunner;
}

export class GraphifyCliProvider implements ProjectGraphProvider {
  readonly name = "graphify-cli";
  private projectRoot?: string;
  private graphPath?: string;
  private readonly commandRunner: GraphifyCommandRunner;

  constructor(private readonly options: GraphifyCliProviderOptions = {}) {
    this.commandRunner = options.commandRunner ?? runCommand;
  }

  async initialize(projectRoot: string): Promise<void> {
    this.projectRoot = await realpath(resolve(projectRoot));
    this.graphPath = resolveInsideProject(
      this.projectRoot,
      this.options.graphPath ?? "graphify-out/graph.json"
    );
  }

  async ensureCurrent(options: ProjectGraphRefreshOptions = {}): Promise<ProjectGraphSnapshot> {
    const projectRoot = this.requireProjectRoot();
    const graphPath = this.requireGraphPath();
    const graphExists = await fileExists(graphPath);
    const defaultGraphPath = resolve(projectRoot, "graphify-out/graph.json");
    await assertPathTargetInsideProject(projectRoot, graphPath);

    if (graphPath !== defaultGraphPath) {
      if (!graphExists) {
        throw new Error(`Configured Graphify graph does not exist: ${graphPath}`);
      }
      return snapshotForGraph(this.name, graphPath, false, true);
    }

    const incremental = graphExists && options.incremental !== false;
    const args = incremental ? ["update", "."] : ["extract", ".", "--out", ".", "--code-only"];
    await this.runGraphify(args, projectRoot, "build or update the project graph", options.signal);

    return snapshotForGraph(this.name, graphPath, incremental, false);
  }

  async query(request: ProjectGraphQuery, signal?: AbortSignal): Promise<ProjectGraphContext> {
    const projectRoot = this.requireProjectRoot();
    const graphPath = this.requireGraphPath();
    await assertPathTargetInsideProject(projectRoot, graphPath);
    const question = buildLoopQuestion(request);
    const result = await this.runGraphify(
      ["query", question, "--graph", graphPath, "--budget", String(this.options.tokenBudget ?? 2_000)],
      projectRoot,
      `query context for loop '${request.loop.id}'`,
      signal
    );

    return {
      provider: this.name,
      query: question,
      generatedAt: new Date().toISOString(),
      content: result.stdout.trim(),
      communities: [],
      entryNodes: [],
      relevantFiles: extractRelevantFiles(result.stdout, projectRoot),
      estimatedWriteFiles: [],
      metadata: {
        graphPath,
        tokenBudget: this.options.tokenBudget ?? 2_000
      }
    };
  }

  async shutdown(): Promise<void> {
    return undefined;
  }

  private async runGraphify(
    args: string[],
    cwd: string,
    operation: string,
    signal?: AbortSignal
  ): Promise<GraphifyCommandResult> {
    const command = this.options.graphifyPath ?? "graphify";
    if (signal?.aborted) {
      throw new Error(`Graphify could not ${operation}: command was cancelled.`);
    }
    let result: GraphifyCommandResult;
    try {
      result = await this.commandRunner(command, args, cwd, {
        signal,
        env: {
          ...process.env,
          GRAPHIFY_QUERY_LOG_DISABLE: "1"
        }
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Graphify could not ${operation}: ${detail}`, { cause: error });
    }
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
      throw new Error(`Graphify could not ${operation}: ${detail}`);
    }
    return result;
  }

  private requireProjectRoot(): string {
    if (this.projectRoot === undefined) {
      throw new Error("GraphifyCliProvider must be initialized before use.");
    }
    return this.projectRoot;
  }

  private requireGraphPath(): string {
    if (this.graphPath === undefined) {
      throw new Error("GraphifyCliProvider must be initialized before use.");
    }
    return this.graphPath;
  }
}

function buildLoopQuestion(request: ProjectGraphQuery): string {
  const tasks = request.loop.tasks?.length ? ` Tasks: ${request.loop.tasks.join("; ")}.` : "";
  const sources = request.loop.sources?.length ? ` Known sources: ${request.loop.sources.join(", ")}.` : "";
  const dependencyFiles = request.dependencyResults.flatMap((result) => result.changedFiles);
  const dependencies = dependencyFiles.length
    ? ` Completed dependencies changed: ${dependencyFiles.join(", ")}.`
    : "";

  return `For the workstream '${request.loop.objective}', identify the most relevant code nodes, dependency paths, communities, and source files.${tasks}${sources}${dependencies}`;
}

function extractRelevantFiles(output: string, projectRoot: string): string[] {
  const candidates = output.match(/[A-Za-z0-9_@./+-]+\.[A-Za-z0-9]+(?::\d+)?/g) ?? [];
  const files = new Set<string>();

  for (const candidate of candidates) {
    const withoutLine = candidate.replace(/:\d+$/, "");
    const extension = withoutLine.split(".").pop()?.toLowerCase();
    if (extension === undefined || !SOURCE_EXTENSIONS.has(extension)) {
      continue;
    }
    const absolutePath = isAbsolute(withoutLine) ? resolve(withoutLine) : resolve(projectRoot, withoutLine);
    const relativePath = relative(projectRoot, absolutePath);

    if (relativePath !== "" && relativePath !== ".." && !relativePath.startsWith(`..${sep}`)) {
      files.add(relativePath);
    }
  }

  return [...files].sort();
}

function resolveInsideProject(projectRoot: string, path: string): string {
  const absolutePath = resolve(projectRoot, path);
  const relativePath = relative(projectRoot, absolutePath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    throw new Error(`Graphify graph path must stay inside the project root: ${path}`);
  }
  return absolutePath;
}

async function assertPathTargetInsideProject(projectRoot: string, path: string): Promise<void> {
  let existingPath = path;
  while (!(await fileExists(existingPath))) {
    const parent = dirname(existingPath);
    if (parent === existingPath) {
      throw new Error(`Unable to resolve Graphify graph path: ${path}`);
    }
    existingPath = parent;
  }

  const realExistingPath = await realpath(existingPath);
  const relativePath = relative(projectRoot, realExistingPath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    throw new Error(`Graphify graph path resolves outside the project root: ${path}`);
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function snapshotForGraph(
  provider: string,
  graphPath: string,
  incremental: boolean,
  prebuilt: boolean
): Promise<ProjectGraphSnapshot> {
  const graphStat = await stat(graphPath);
  return {
    provider,
    graphPath,
    generatedAt: graphStat.mtime.toISOString(),
    metadata: {
      incremental,
      prebuilt,
      sizeBytes: graphStat.size
    }
  };
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  options: GraphifyCommandOptions
): Promise<GraphifyCommandResult> {
  if (options.signal?.aborted) {
    return Promise.reject(new Error("Graphify command was cancelled."));
  }

  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const cleanup = (): void => {
      options.signal?.removeEventListener("abort", onAbort);
    };
    const rejectOnce = (error: Error): void => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(error);
      }
    };
    const onAbort = (): void => {
      child.kill("SIGTERM");
      rejectOnce(new Error("Graphify command was cancelled."));
    };

    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk.toString("utf8"));
    });
    child.on("error", (error) => rejectOnce(error));
    child.on("close", (exitCode) => {
      if (!settled) {
        settled = true;
        cleanup();
        resolvePromise({ exitCode: exitCode ?? 1, stdout, stderr });
      }
    });
  });
}

function appendLimited(current: string, chunk: string): string {
  if (current.length >= DEFAULT_OUTPUT_LIMIT) {
    return current;
  }
  return `${current}${chunk}`.slice(0, DEFAULT_OUTPUT_LIMIT);
}
