#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { GraphRuntime, LoopGraphFiles, createRunMetadata, isTerminalGraphStatus, parseLoopGraphJson } from "graph-engineering-loop-core";
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
async function main(args) {
    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
        printHelp();
        return EXIT_SUCCESS;
    }
    if (args.includes("--version") || args.includes("-v")) {
        console.log(`graph-engineering-loop ${CLI_VERSION}`);
        return EXIT_SUCCESS;
    }
    const options = parseArgs(args);
    if (options.command === "validate") {
        const inputPath = options.file ?? options.input;
        if (inputPath === undefined) {
            console.error("Usage: loopgraph validate <loops.json>");
            return EXIT_INVALID_ARGUMENTS;
        }
        const path = await resolveExistingInputPath(options, inputPath);
        const graph = parseLoopGraphJson(await readFile(path, "utf8"));
        console.log(`LoopGraph '${graph.name}' is valid (${graph.loops.length} loops).`);
        return EXIT_SUCCESS;
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
async function runGraph(options) {
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
    const stop = () => abortController.abort();
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
        }
        else {
            printRunResult(result.status, result.results.length, files.resultsDir, files.statusMarkdownPath);
        }
        return exitCodeForStatus(result.status);
    }
    finally {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        await files.removeLock();
    }
}
async function cancelGraph(options) {
    const files = new LoopGraphFiles(options.projectRoot);
    const state = await files.readState();
    if (state === null || isTerminalGraphStatus(state.status)) {
        console.log("No active LoopGraph run found.");
        await files.removeLock();
        return EXIT_SUCCESS;
    }
    const lock = await readJson(files.lockPath);
    if (lock !== null) {
        try {
            process.kill(lock.pid, "SIGTERM");
        }
        catch {
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
async function resolveGraphInput(options, adapter) {
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
async function resolveExistingInputPath(options, input) {
    const path = await resolveOptionalInputPath(options, input);
    if (path === null) {
        throw new Error(`Input path does not exist: ${stripAtPrefix(input)}`);
    }
    return path;
}
async function resolveOptionalInputPath(options, input) {
    const stripped = stripAtPrefix(input);
    const candidates = isAbsolute(stripped)
        ? [stripped]
        : [resolve(process.cwd(), stripped), resolve(options.projectRoot, stripped)];
    for (const candidate of candidates) {
        if (await fileExists(candidate)) {
            return candidate;
        }
    }
    return null;
}
async function compileGraph(options, adapter, input, inputKind) {
    if (adapter.compileGraph !== undefined) {
        return adapter.compileGraph({
            projectRoot: options.projectRoot,
            input,
            inputKind
        });
    }
    return compileRequirementsToGraph(input, inputKind);
}
function compileRequirementsToGraph(requirements, sourceLabel) {
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
async function writeCompiledGraph(projectRoot, graph) {
    const graphPath = resolve(projectRoot, ".loopgraph/loops.json");
    await mkdir(dirname(graphPath), { recursive: true });
    await writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
    return graph;
}
function createAdapter(name, options) {
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
function createProjectGraphProvider(options) {
    if (options.projectGraph === "graphify") {
        return new GraphifyCliProvider({
            graphifyPath: options.graphifyPath,
            graphPath: options.graphifyGraphPath
        });
    }
    return undefined;
}
function parseArgs(args) {
    const options = {
        adapter: "fake",
        projectGraph: "none",
        projectRoot: process.cwd(),
        dryRun: false,
        json: false
    };
    const positional = [];
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
function requireValue(args, index, flag) {
    const value = args[index];
    if (value === undefined) {
        throw new Error(`${flag} requires a value`);
    }
    return value;
}
function parsePositiveInteger(value, flag) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${flag} must be a positive integer`);
    }
    return parsed;
}
async function fileExists(path) {
    try {
        await access(path, constants.F_OK);
        return true;
    }
    catch {
        return false;
    }
}
function tryParseGraph(content) {
    try {
        return parseLoopGraphJson(content);
    }
    catch {
        return null;
    }
}
function stripAtPrefix(input) {
    return input.startsWith("@") ? input.slice(1) : input;
}
function looksLikePath(input) {
    const stripped = stripAtPrefix(input);
    return (input.startsWith("@") ||
        stripped.includes("/") ||
        stripped.includes(sep) ||
        /\.(json|md|markdown|txt|yaml|yml)$/i.test(stripped));
}
function printGraphSummary(graph, options) {
    console.log(`LoopGraph: ${graph.name}`);
    for (const loop of graph.loops) {
        const dependencyText = loop.dependsOn.length > 0 ? ` depends on ${loop.dependsOn.join(", ")}` : "";
        console.log(`- ${loop.id}${dependencyText}`);
    }
    console.log(`Adapter: ${options.adapter}`);
    console.log(`Concurrency: ${options.maxConcurrency ?? graph.defaults?.maxConcurrentLoops ?? 2}`);
}
function printHelp() {
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
function readCliVersion() {
    try {
        const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
        return packageJson.version ?? "unknown";
    }
    catch {
        return "unknown";
    }
}
function printRunResult(status, resultCount, resultsDir, statusMarkdownPath) {
    if (status === "completed") {
        console.log(`LoopGraph completed (${resultCount} loops).`);
    }
    else {
        console.log(`LoopGraph finished with status '${status}' (${resultCount} loops).`);
    }
    console.log(`Status: ${statusMarkdownPath}`);
    console.log(`Results: ${resultsDir}`);
}
function exitCodeForStatus(status) {
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
function isTerminalLoopStatus(status) {
    return status === "completed" || status === "blocked" || status === "failed" || status === "cancelled";
}
async function readJson(path) {
    try {
        return JSON.parse(await readFile(path, "utf8"));
    }
    catch {
        return null;
    }
}
main(process.argv.slice(2))
    .then((code) => {
    process.exitCode = code;
})
    .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = EXIT_RUNTIME_FAILURE;
});
//# sourceMappingURL=cli.js.map