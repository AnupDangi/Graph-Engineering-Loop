#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

const command = process.argv[2];
const options = parseOptions(process.argv.slice(3));
const projectRoot = resolve(options.projectRoot ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
const loopgraphDir = join(projectRoot, ".loopgraph");
const bridgeDir = join(loopgraphDir, "bridge");
const currentPath = join(bridgeDir, "current.json");
const statePath = join(loopgraphDir, "state.json");
const lockPath = join(loopgraphDir, "lock.json");
const logPath = join(loopgraphDir, "session.log");
const statusJsonPath = join(loopgraphDir, "status.json");
const statusMarkdownPath = join(loopgraphDir, "status.md");
const loopgraphBin = resolve(import.meta.dirname, "..", "bin", "loopgraph");

try {
  switch (command) {
    case "start":
      await start();
      break;
    case "next":
      printJson(await waitForWork());
      break;
    case "submit":
      await submit();
      break;
    case "status":
      printJson(readStatus());
      break;
    default:
      throw new Error("Usage: loopgraph-session <start|next|submit|status> --project-root <path>");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function start() {
  const activeLock = readActiveLock();
  if (activeLock !== null) {
    const status = await waitForWork();
    printJson({ ...status, runnerPid: activeLock.pid, reused: true });
    return;
  }

  mkdirSync(bridgeDir, { recursive: true });
  rmSync(currentPath, { force: true });

  const input = options.input ?? join(loopgraphDir, "loops.json");
  if (!existsSync(input)) {
    throw new Error(`LoopGraph input does not exist: ${input}`);
  }

  const logFd = openSync(logPath, "a");
  const child = spawn(loopgraphBin, [
    "run",
    input,
    "--adapter",
    "interactive",
    "--project-root",
    projectRoot,
    "--json"
  ], {
    cwd: projectRoot,
    detached: true,
    stdio: ["ignore", logFd, logFd]
  });
  child.unref();
  closeSync(logFd);

  const status = await waitForWork(Date.now());
  printJson({ ...status, runnerPid: child.pid, reused: false });
}

async function submit() {
  const file = options.file;
  if (file === undefined) {
    throw new Error("submit requires --file <LoopExecutionResult.json>");
  }

  const packet = readJson(currentPath);
  if (packet === null || typeof packet.requestId !== "string") {
    throw new Error("No interactive LoopGraph request is waiting for a response.");
  }

  const result = readJson(resolve(file));
  validateResult(result);
  const submittedAt = Date.now();
  const responsePath = join(bridgeDir, "responses", `${packet.requestId}.json`);
  atomicWriteJson(responsePath, result);

  const status = await waitForWork(submittedAt, packet.requestId);
  printJson(status);
}

async function waitForWork(notBefore = 0, previousRequestId) {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const packet = readJson(currentPath);
    if (
      packet !== null &&
      typeof packet.requestId === "string" &&
      packet.requestId !== previousRequestId
    ) {
      return {
        status: "work_required",
        projectRoot,
        resultsDir: join(loopgraphDir, "results"),
        statusJsonPath,
        statusMarkdownPath,
        packet
      };
    }

    const state = readJson(statePath);
    if (
      state !== null &&
      isTerminalStatus(state.status) &&
      Date.parse(state.updatedAt ?? "") >= notBefore
    ) {
      return {
        status: state.status,
        projectRoot,
        resultsDir: join(loopgraphDir, "results"),
        statusJsonPath,
        statusMarkdownPath,
        state
      };
    }

    await delay(200);
  }

  throw new Error(`Timed out waiting for LoopGraph work. Inspect ${logPath}`);
}

function readStatus() {
  return {
    projectRoot,
    resultsDir: join(loopgraphDir, "results"),
    statusJsonPath,
    statusMarkdownPath,
    state: readJson(statePath),
    activeRequest: readJson(currentPath),
    lock: readActiveLock(),
    logPath
  };
}

function readActiveLock() {
  const lock = readJson(lockPath);
  if (lock === null || !Number.isInteger(lock.pid)) {
    return null;
  }

  try {
    process.kill(lock.pid, 0);
    return lock;
  } catch {
    return null;
  }
}

function validateResult(result) {
  if (result === null || typeof result !== "object") {
    throw new Error("Interactive result must be a JSON object.");
  }

  if (!["complete", "incomplete", "blocked", "failed"].includes(result.status)) {
    throw new Error("Interactive result status must be complete, incomplete, blocked, or failed.");
  }
  if (typeof result.summary !== "string" || result.summary.trim().length === 0) {
    throw new Error("Interactive result summary must be a non-empty string.");
  }

  for (const field of [
    "completedTasks",
    "remainingWork",
    "changedFiles"
  ]) {
    if (!Array.isArray(result[field]) || !result[field].every((entry) => typeof entry === "string")) {
      throw new Error(`Interactive result ${field} must be a string array.`);
    }
  }

  if (
    !Array.isArray(result.commandsRun) ||
    !result.commandsRun.every((entry) =>
      entry !== null &&
      typeof entry === "object" &&
      typeof entry.command === "string" &&
      Number.isInteger(entry.exitCode) &&
      (entry.outputSummary === undefined || typeof entry.outputSummary === "string")
    )
  ) {
    throw new Error("Interactive result commandsRun entries must contain command and integer exitCode.");
  }

  if (
    !Array.isArray(result.completionEvidence) ||
    !result.completionEvidence.every((entry) =>
      entry !== null &&
      typeof entry === "object" &&
      Number.isInteger(entry.conditionIndex) &&
      entry.conditionIndex >= 0 &&
      typeof entry.passed === "boolean" &&
      typeof entry.checkedAt === "string" &&
      entry.evidence !== null &&
      typeof entry.evidence === "object" &&
      !Array.isArray(entry.evidence)
    )
  ) {
    throw new Error(
      "Interactive result completionEvidence entries must contain conditionIndex, passed, checkedAt, and evidence."
    );
  }

  if (
    !(
      typeof result.handoff === "string" ||
      (
        Array.isArray(result.handoff) &&
        result.handoff.every((entry) => typeof entry === "string")
      )
    )
  ) {
    throw new Error("Interactive result handoff must be a string or string array.");
  }
  if (!(result.blockedReason === null || typeof result.blockedReason === "string")) {
    throw new Error("Interactive result blockedReason must be a string or null.");
  }
}

function parseOptions(args) {
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--project-root") {
      parsed.projectRoot = requiredValue(args, ++index, arg);
    } else if (arg === "--input") {
      parsed.input = resolve(requiredValue(args, ++index, arg));
    } else if (arg === "--file") {
      parsed.file = requiredValue(args, ++index, arg);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

function requiredValue(args, index, flag) {
  if (args[index] === undefined) {
    throw new Error(`${flag} requires a value`);
  }
  return args[index];
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmpPath, path);
}

function isTerminalStatus(status) {
  return ["completed", "completed_with_blocks", "failed", "cancelled"].includes(status);
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
