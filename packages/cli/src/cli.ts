#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import {
  GraphRuntime,
  LoopGraphFiles,
  createRunMetadata,
  isTerminalGraphStatus,
  parseLoopGraphJson,
  type GraphStatus,
  type HarnessAdapter,
  type LoopGraph,
  type LoopStatus,
  type ProjectGraphProvider
} from "graph-engineering-loop-core";
import { ClaudeHeadlessAdapter } from "./adapters/claude-adapter.js";
import { FakeAdapter } from "./adapters/fake-adapter.js";
import { InteractiveAdapter } from "./adapters/interactive-adapter.js";
import { StdioAdapter } from "./adapters/stdio-adapter.js";
import { GraphifyCliProvider } from "./context/graphify-cli-provider.js";

const EXIT_SUCCESS = 0;
const EXIT_RUNTIME_FAILURE = 1;
const EXIT_COMPLETED_WITH_BLOCKS = 2;
const EXIT_CANCELLED = 3;
const EXIT_INVALID_ARGUMENTS = 4;
const CLI_VERSION = readCliVersion();

interface CliOptions {
  command?: string;
  input?: string;
  file?: string;
  adapter: "fake" | "claude" | "interactive" | "stdio";
  adapterCommand?: string;
  claudePath?: string;
  claudePermissionMode?: string;
  claudeMaxBudgetUsd?: string;
  claudeModel?: string;
  projectGraph: "none" | "graphify";
  graphifyPath?: string;
  graphifyGraphPath?: string;
  projectRoot: string;
  maxConcurrency?: number;
  dryRun: boolean;
  json: boolean;
}

async function main(args: string[]): Promise<number> {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp();
    return EXIT_SUCCESS;
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log(`graph-engineering-loop ${CLI_VERSION}`);
    return EXIT_SUCCESS;
  }

  const glued = detectGluedCommand(args[0]);
  if (glued !== null) {
    console.error(glued);
    return EXIT_INVALID_ARGUMENTS;
  }

  const options = parseArgs(args);

  if (options.command === "validate") {
    const inputPath = options.file ?? options.input;
    if (inputPath === undefined) {
      console.error("Usage: loopgraph validate <loops.json>");
      console.error("Example: npx graph-engineering-loop-workspace validate .loopgraph/loops.json");
      return EXIT_INVALID_ARGUMENTS;
    }

    try {
      const path = await resolveExistingInputPath(options, inputPath);
      const graph = parseLoopGraphJson(await readFile(path, "utf8"));
      console.log(`LoopGraph '${graph.name}' is valid (${graph.loops.length} loops).`);
      return EXIT_SUCCESS;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("Input path does not exist:")) {
        console.error(message);
        console.error("");
        console.error("This project has no loops.json yet. Create one first:");
        console.error(`  npx graph-engineering-loop-workspace run "your goal here" --adapter fake`);
        console.error("Then validate:");
        console.error("  npx graph-engineering-loop-workspace validate .loopgraph/loops.json");
        console.error("");
        console.error("Note the space after validate. Do not write: validate.loopgraph/...");
        return EXIT_INVALID_ARGUMENTS;
      }
      throw error;
    }
  }

  if (options.command === "run") {
    return runGraph(options);
  }

  if (options.command === "cancel") {
    return cancelGraph(options);
  }

  console.error("Usage: loopgraph <run|cancel|validate> [input] [--adapter fake|claude|interactive|stdio]");
  return EXIT_INVALID_ARGUMENTS;
}

async function runGraph(options: CliOptions): Promise<number> {
  const adapter = createAdapter(options.adapter, options);
  const projectGraphProvider = createProjectGraphProvider(options);
  const graph = await resolveGraphInput(options, adapter);
  const files = new LoopGraphFiles(options.projectRoot);
  const metadata = createRunMetadata(graph, options.projectRoot);

  if (options.dryRun) {
    printGraphSummary(graph, options);
    return EXIT_SUCCESS;
  }

  await files.ensure();
  await files.createLock(metadata);

  const abortController = new AbortController();
  const stop = (): void => abortController.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    const runtime = new GraphRuntime({
      graph,
      adapter,
      projectRoot: options.projectRoot,
      maxConcurrentLoops: options.maxConcurrency,
      projectGraphProvider,
      hooks: files.hooks(metadata, graph)
    });
    const result = await runtime.run(abortController.signal);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printRunResult(result.status, result.results.length, files.resultsDir, files.statusMarkdownPath);
    }

    return exitCodeForStatus(result.status);
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await files.removeLock();
  }
}

async function cancelGraph(options: CliOptions): Promise<number> {
  const files = new LoopGraphFiles(options.projectRoot);
  const state = await files.readState();

  if (state === null || isTerminalGraphStatus(state.status)) {
    console.log("No active LoopGraph run found.");
    await files.removeLock();
    return EXIT_SUCCESS;
  }

  const lock = await readJson<{ pid: number }>(files.lockPath);
  if (lock !== null) {
    try {
      process.kill(lock.pid, "SIGTERM");
    } catch {
      // Stale locks are cleaned up below.
    }
  }

  for (const loop of Object.values(state.loops)) {
    if (!isTerminalLoopStatus(loop.status)) {
      loop.status = "cancelled";
      loop.waitingFor = [];
    }
  }

  await files.writeRawState({
    ...state,
    status: "cancelled",
    updatedAt: new Date().toISOString()
  });
  await files.appendEvent("graph.cancelled", { runId: state.runId });
  await files.removeLock();
  console.log(`Cancelled LoopGraph run ${state.runId}.`);
  return EXIT_CANCELLED;
}

async function resolveGraphInput(options: CliOptions, adapter: HarnessAdapter): Promise<LoopGraph> {
  const explicitPath = options.file ?? options.input;

  if (explicitPath !== undefined) {
    const path = await resolveOptionalInputPath(options, explicitPath);
    if (path === null && looksLikePath(explicitPath)) {
      throw new Error(`Input path does not exist: ${stripAtPrefix(explicitPath)}`);
    }
    if (path === null) {
      return writeCompiledGraph(options.projectRoot, await compileGraph(options, adapter, explicitPath, "prompt"));
    }

    const content = await readFile(path, "utf8");
    const graph = tryParseGraph(content);
    if (graph !== null) {
      return graph;
    }

    return writeCompiledGraph(options.projectRoot, await compileGraph(options, adapter, content, "file"));
  }

  const projectGraph = resolve(options.projectRoot, ".loopgraph/loops.json");
  if (await fileExists(projectGraph)) {
    return parseLoopGraphJson(await readFile(projectGraph, "utf8"));
  }

  const rootGraph = resolve(options.projectRoot, "loops.json");
  if (await fileExists(rootGraph)) {
    return parseLoopGraphJson(await readFile(rootGraph, "utf8"));
  }

  if (options.input !== undefined) {
    return writeCompiledGraph(options.projectRoot, await compileGraph(options, adapter, options.input, "prompt"));
  }

  throw new Error("No graph or requirements supplied. Provide a prompt, a requirements file, or .loopgraph/loops.json.");
}

async function resolveExistingInputPath(options: CliOptions, input: string): Promise<string> {
  const path = await resolveOptionalInputPath(options, input);
  if (path === null) {
    throw new Error(`Input path does not exist: ${stripAtPrefix(input)}`);
  }

  return path;
}

async function resolveOptionalInputPath(options: CliOptions, input: string): Promise<string | null> {
  const stripped = stripAtPrefix(input);
  if (isAbsolute(stripped)) {
    return (await fileExists(stripped)) ? stripped : null;
  }

  const projectCandidate = resolve(options.projectRoot, stripped);
  const cwdCandidate = resolve(process.cwd(), stripped);
  const projectExists = await fileExists(projectCandidate);
  const cwdExists = await fileExists(cwdCandidate);
  const projectRoot = resolve(options.projectRoot);
  const cwd = resolve(process.cwd());

  // Durable runtime files are project-scoped. Never resolve another cwd's
  // .loopgraph/ artifact when --project-root points elsewhere.
  if (stripped === ".loopgraph/loops.json" || stripped.startsWith(`.loopgraph${sep}`) || stripped.startsWith(".loopgraph/")) {
    if (projectExists) {
      return projectCandidate;
    }
    if (cwdExists && projectRoot === cwd) {
      return cwdCandidate;
    }
    return null;
  }

  // Ordinary relative paths keep cwd-first resolution so callers can pass
  // repo-relative graphs while targeting another --project-root.
  if (cwdExists) {
    return cwdCandidate;
  }
  if (projectExists) {
    return projectCandidate;
  }

  return null;
}

async function compileGraph(
  options: CliOptions,
  adapter: HarnessAdapter,
  input: string,
  inputKind: "prompt" | "file" | "directory"
): Promise<LoopGraph> {
  if (adapter.compileGraph !== undefined) {
    return adapter.compileGraph({
      projectRoot: options.projectRoot,
      input,
      inputKind
    });
  }

  return compileRequirementsToGraph(input, inputKind);
}

function compileRequirementsToGraph(requirements: string, sourceLabel: string): LoopGraph {
  const trimmedGoal = requirements.trim().replace(/\s+/g, " ").slice(0, 240);
  const goal = trimmedGoal.length > 0 ? trimmedGoal : `Implement requirements from ${sourceLabel}.`;

  return {
    $schema: "https://loopgraph.dev/schemas/loops.v1.json",
    version: 1,
    name: "generated-loopgraph",
    goal,
    defaults: {
      maxIterations: 4,
      maxConcurrentLoops: 2
    },
    loops: [
      {
        id: "foundation",
        title: "Foundation and plan",
        objective: "Inspect the project and requirements, then establish the implementation plan and shared contracts.",
        tasks: [
          "Inspect repository structure",
          "Identify implementation boundaries",
          "Document contracts and validation approach"
        ],
        dependsOn: [],
        completionConditions: [
          {
            type: "assertion",
            description: "The project structure, implementation boundaries, and validation approach are understood and represented in durable files."
          }
        ]
      },
      {
        id: "implementation",
        title: "Implementation workstream",
        objective: "Implement the requested behavior while respecting the project architecture.",
        tasks: [
          "Make focused source changes",
          "Add or update tests",
          "Keep generated context minimal"
        ],
        dependsOn: ["foundation"],
        completionConditions: [
          {
            type: "assertion",
            description: "The requested implementation is present in source files with appropriate tests or verification."
          }
        ]
      },
      {
        id: "verification",
        title: "Final verification",
        objective: "Run validation, fix defects, and produce a concise handoff.",
        tasks: [
          "Run relevant checks",
          "Fix validation failures",
          "Write final handoff"
        ],
        dependsOn: ["implementation"],
        completionConditions: [
          {
            type: "assertion",
            description: "The requested goal is verified and remaining limitations are documented."
          }
        ],
        maxIterations: 5
      }
    ]
  };
}

async function writeCompiledGraph(projectRoot: string, graph: LoopGraph): Promise<LoopGraph> {
  const graphPath = resolve(projectRoot, ".loopgraph/loops.json");
  await mkdir(dirname(graphPath), { recursive: true });
  await writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
  return graph;
}

function createAdapter(name: CliOptions["adapter"], options: CliOptions): HarnessAdapter {
  if (name === "claude") {
    return new ClaudeHeadlessAdapter({
      claudePath: options.claudePath,
      permissionMode: options.claudePermissionMode,
      maxBudgetUsd: options.claudeMaxBudgetUsd,
      model: options.claudeModel
    });
  }

  if (name === "stdio") {
    if (options.adapterCommand === undefined) {
      throw new Error("--adapter-command is required when --adapter stdio is used");
    }

    return new StdioAdapter({ command: options.adapterCommand });
  }

  if (name === "interactive") {
    return new InteractiveAdapter();
  }

  return new FakeAdapter();
}

function createProjectGraphProvider(options: CliOptions): ProjectGraphProvider | undefined {
  if (options.projectGraph === "graphify") {
    return new GraphifyCliProvider({
      graphifyPath: options.graphifyPath,
      graphPath: options.graphifyGraphPath
    });
  }

  return undefined;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    adapter: "fake",
    projectGraph: "none",
    projectRoot: process.cwd(),
    dryRun: false,
    json: false
  };

  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case "--file":
        options.file = requireValue(args, ++index, "--file");
        break;
      case "--adapter": {
        const adapter = requireValue(args, ++index, "--adapter");
        if (adapter !== "fake" && adapter !== "claude" && adapter !== "interactive" && adapter !== "stdio") {
          throw new Error("--adapter must be 'fake', 'claude', 'interactive', or 'stdio'");
        }
        options.adapter = adapter;
        break;
      }
      case "--adapter-command":
        options.adapterCommand = requireValue(args, ++index, "--adapter-command");
        break;
      case "--claude-path":
        options.claudePath = requireValue(args, ++index, "--claude-path");
        break;
      case "--claude-permission-mode":
        options.claudePermissionMode = requireValue(args, ++index, "--claude-permission-mode");
        break;
      case "--claude-max-budget-usd":
        options.claudeMaxBudgetUsd = requireValue(args, ++index, "--claude-max-budget-usd");
        break;
      case "--claude-model":
        options.claudeModel = requireValue(args, ++index, "--claude-model");
        break;
      case "--project-graph": {
        const projectGraph = requireValue(args, ++index, "--project-graph");
        if (projectGraph !== "none" && projectGraph !== "graphify") {
          throw new Error("--project-graph must be 'none' or 'graphify'");
        }
        options.projectGraph = projectGraph;
        break;
      }
      case "--graphify-path":
        options.graphifyPath = requireValue(args, ++index, "--graphify-path");
        break;
      case "--graphify-graph":
        options.graphifyGraphPath = requireValue(args, ++index, "--graphify-graph");
        break;
      case "--project-root":
        options.projectRoot = resolve(requireValue(args, ++index, "--project-root"));
        break;
      case "--max-concurrency":
        options.maxConcurrency = parsePositiveInteger(requireValue(args, ++index, "--max-concurrency"), "--max-concurrency");
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--json":
        options.json = true;
        break;
      default:
        positional.push(arg);
    }
  }

  options.command = positional[0];
  options.input = positional.slice(1).join(" ") || undefined;
  return options;
}

function detectGluedCommand(arg: string | undefined): string | null {
  if (arg === undefined) {
    return null;
  }

  for (const command of ["validate", "run", "cancel"] as const) {
    if (arg === command) {
      return null;
    }
    if (arg.startsWith(`${command}.`) || arg.startsWith(`${command}/`)) {
      const rest = arg.slice(command.length);
      return [
        `Missing space after '${command}'.`,
        `You wrote: ${arg}`,
        `Use:      ${command} ${rest}`,
        "",
        "Examples:",
        "  npx graph-engineering-loop-workspace validate .loopgraph/loops.json",
        "  npx graph-engineering-loop-workspace run \"Build auth and a dashboard\" --adapter fake"
      ].join("\n");
    }
  }

  return null;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }

  return parsed;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function tryParseGraph(content: string): LoopGraph | null {
  try {
    return parseLoopGraphJson(content);
  } catch {
    return null;
  }
}

function stripAtPrefix(input: string): string {
  return input.startsWith("@") ? input.slice(1) : input;
}

function looksLikePath(input: string): boolean {
  const stripped = stripAtPrefix(input).trim();
  if (stripped.length === 0) {
    return false;
  }

  // Sentence-like prompts that merely mention a file extension are not paths.
  if (/\s/.test(stripped) && !stripped.startsWith(".") && !stripped.startsWith("/") && !stripped.includes("/") && !stripped.includes(sep)) {
    return false;
  }

  return (
    input.startsWith("@") ||
    stripped.startsWith(".") ||
    stripped.startsWith("/") ||
    stripped.includes("/") ||
    stripped.includes(sep) ||
    /\.(json|md|markdown|txt|yaml|yml)$/i.test(stripped)
  );
}

function printGraphSummary(graph: LoopGraph, options: CliOptions): void {
  console.log(`LoopGraph: ${graph.name}`);
  for (const loop of graph.loops) {
    const dependencyText = loop.dependsOn.length > 0 ? ` depends on ${loop.dependsOn.join(", ")}` : "";
    console.log(`- ${loop.id}${dependencyText}`);
  }
  console.log(`Adapter: ${options.adapter}`);
  console.log(`Concurrency: ${options.maxConcurrency ?? graph.defaults?.maxConcurrentLoops ?? 2}`);
}

function printHelp(): void {
  console.log(`Graph Engineering Loop ${CLI_VERSION}

Usage:
  graph-engineering-loop run <prompt-or-path> [options]
  graph-engineering-loop validate <loops.json> [--project-root <path>]
  graph-engineering-loop cancel [--project-root <path>]

Commands:
  run       Compile or execute a completion-driven loop graph
  validate  Validate a loops.json graph without executing it
  cancel    Cancel the active run for a project

Run options:
  --adapter <fake|claude|interactive|stdio>
  --adapter-command <command>       Required for the stdio adapter
  --project-root <path>             Defaults to the current directory
  --max-concurrency <number>
  --claude-path <path>
  --claude-permission-mode <mode>
  --claude-max-budget-usd <amount>
  --claude-model <model>
  --project-graph <none|graphify>   Enrich loops with project-graph context
  --graphify-path <path>            Defaults to graphify on PATH
  --graphify-graph <path>           Query an existing project-local graph snapshot
  --dry-run
  --json

Global:
  -h, --help
  -v, --version`);
}

function readCliVersion(): string {
  try {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as { version?: string };
    return packageJson.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function printRunResult(
  status: GraphStatus,
  resultCount: number,
  resultsDir: string,
  statusMarkdownPath: string
): void {
  if (status === "completed") {
    console.log(`LoopGraph completed (${resultCount} loops).`);
  } else {
    console.log(`LoopGraph finished with status '${status}' (${resultCount} loops).`);
  }
  console.log(`Status: ${statusMarkdownPath}`);
  console.log(`Results: ${resultsDir}`);
}

function exitCodeForStatus(status: GraphStatus): number {
  if (status === "completed") {
    return EXIT_SUCCESS;
  }
  if (status === "completed_with_blocks") {
    return EXIT_COMPLETED_WITH_BLOCKS;
  }
  if (status === "cancelled") {
    return EXIT_CANCELLED;
  }
  return EXIT_RUNTIME_FAILURE;
}

function isTerminalLoopStatus(status: LoopStatus): boolean {
  return status === "completed" || status === "blocked" || status === "failed" || status === "cancelled";
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = EXIT_RUNTIME_FAILURE;
  });
