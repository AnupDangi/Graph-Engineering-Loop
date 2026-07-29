#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve, join } from "node:path";
import {
  GraphRuntime,
  LoopGraphFiles,
  createRunMetadata,
  isTerminalGraphStatus,
  parseLoopGraphJson,
  type GraphStatus,
  type HarnessAdapter,
  type LoopGraph,
  type LoopStatus
} from "graph-engineering-loop-core";
import { ClaudeHeadlessAdapter } from "./adapters/claude-adapter.js";
import { FakeAdapter } from "./adapters/fake-adapter.js";
import { StdioAdapter } from "./adapters/stdio-adapter.js";

const EXIT_SUCCESS = 0;
const EXIT_RUNTIME_FAILURE = 1;
const EXIT_COMPLETED_WITH_BLOCKS = 2;
const EXIT_CANCELLED = 3;
const EXIT_INVALID_ARGUMENTS = 4;

interface CliOptions {
  command?: string;
  input?: string;
  file?: string;
  adapter: "fake" | "claude" | "stdio";
  adapterCommand?: string;
  projectRoot: string;
  maxConcurrency?: number;
  dryRun: boolean;
  json: boolean;
}

async function main(args: string[]): Promise<number> {
  const options = parseArgs(args);

  if (options.command === "validate") {
    const inputPath = options.file ?? options.input;
    if (inputPath === undefined) {
      console.error("Usage: loopgraph validate <loops.json>");
      return EXIT_INVALID_ARGUMENTS;
    }

    const graph = parseLoopGraphJson(await readFile(resolve(options.projectRoot, inputPath), "utf8"));
    console.log(`LoopGraph '${graph.name}' is valid (${graph.loops.length} loops).`);
    return EXIT_SUCCESS;
  }

  if (options.command === "run") {
    return runGraph(options);
  }

  if (options.command === "cancel") {
    return cancelGraph(options);
  }

  console.error("Usage: loopgraph <run|cancel|validate> [input] [--adapter fake|claude|stdio]");
  return EXIT_INVALID_ARGUMENTS;
}

async function runGraph(options: CliOptions): Promise<number> {
  const graph = await resolveGraphInput(options);
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
    const adapter = createAdapter(options.adapter, options);
    const runtime = new GraphRuntime({
      graph,
      adapter,
      projectRoot: options.projectRoot,
      maxConcurrentLoops: options.maxConcurrency,
      hooks: files.hooks(metadata)
    });
    const result = await runtime.run(abortController.signal);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printRunResult(result.status, result.results.length, files.resultsDir);
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

async function resolveGraphInput(options: CliOptions): Promise<LoopGraph> {
  const explicitPath = options.file ?? options.input;

  if (explicitPath !== undefined && await fileExists(resolve(options.projectRoot, stripAtPrefix(explicitPath)))) {
    const path = resolve(options.projectRoot, stripAtPrefix(explicitPath));
    const content = await readFile(path, "utf8");
    const graph = tryParseGraph(content);
    if (graph !== null) {
      return graph;
    }

    return writeCompiledGraph(options.projectRoot, compileRequirementsToGraph(content, path));
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
    return writeCompiledGraph(options.projectRoot, compileRequirementsToGraph(options.input, "prompt"));
  }

  throw new Error("No graph or requirements supplied. Provide a prompt, a requirements file, or .loopgraph/loops.json.");
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
    return new ClaudeHeadlessAdapter();
  }

  if (name === "stdio") {
    if (options.adapterCommand === undefined) {
      throw new Error("--adapter-command is required when --adapter stdio is used");
    }

    return new StdioAdapter({ command: options.adapterCommand });
  }

  return new FakeAdapter();
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    adapter: "fake",
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
        if (adapter !== "fake" && adapter !== "claude" && adapter !== "stdio") {
          throw new Error("--adapter must be 'fake', 'claude', or 'stdio'");
        }
        options.adapter = adapter;
        break;
      }
      case "--adapter-command":
        options.adapterCommand = requireValue(args, ++index, "--adapter-command");
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

function printGraphSummary(graph: LoopGraph, options: CliOptions): void {
  console.log(`LoopGraph: ${graph.name}`);
  for (const loop of graph.loops) {
    const dependencyText = loop.dependsOn.length > 0 ? ` depends on ${loop.dependsOn.join(", ")}` : "";
    console.log(`- ${loop.id}${dependencyText}`);
  }
  console.log(`Adapter: ${options.adapter}`);
  console.log(`Concurrency: ${options.maxConcurrency ?? graph.defaults?.maxConcurrentLoops ?? 2}`);
}

function printRunResult(status: GraphStatus, resultCount: number, resultsDir: string): void {
  if (status === "completed") {
    console.log(`LoopGraph completed (${resultCount} loops).`);
  } else {
    console.log(`LoopGraph finished with status '${status}' (${resultCount} loops).`);
  }
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
