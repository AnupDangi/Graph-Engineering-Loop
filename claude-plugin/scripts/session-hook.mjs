#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const input = await readStdinJson();
const eventName = input?.hook_event_name;
const projectRoot = resolve(input?.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
const loopgraphDir = join(projectRoot, ".loopgraph");
const state = await readJson(join(loopgraphDir, "state.json"));
const lock = await readJson(join(loopgraphDir, "lock.json"));
const request = await readJson(join(loopgraphDir, "bridge", "current.json"));
const statusPath = join(loopgraphDir, "status.md");

if (!isActive(state, lock)) {
  process.exit(0);
}

if (eventName === "SessionStart") {
  const activeLoop = describeActiveLoop(request);
  printJson({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext:
        `LoopGraph run ${state.runId} is active (${state.status}). ${activeLoop} ` +
        `Use the graph-engineering-loop skills; live status is ${statusPath} and durable state is in ${loopgraphDir}.`
    }
  });
}

if (eventName === "Stop" && input?.stop_hook_active !== true && request !== null) {
  const loopId = request.request?.loop?.id ?? "unknown";
  const iteration = request.request?.currentIteration ?? "unknown";
  const maxIterations = request.request?.maxIterations ?? "unknown";
  printJson({
    decision: "block",
    reason: buildContinuationReason(request, loopgraphDir, statusPath),
    systemMessage:
      `🔄 LoopGraph ${state.runId} | loop ${loopId} | iteration ${iteration}/${maxIterations}. ` +
      `The graph advances only after verified completion; use cancel only when the user asks to stop.`
  });
}

function buildContinuationReason(requestValue, loopgraphDir, liveStatusPath) {
  const execution = requestValue.request ?? {};
  const loop = execution.loop ?? {};
  const tasks = Array.isArray(loop.tasks) ? loop.tasks.slice(0, 30) : [];
  const conditions = Array.isArray(loop.completionConditions)
    ? loop.completionConditions.slice(0, 30)
    : [];

  return `Continue the SAME active LoopGraph workstream. This is a bounded Ralph-style iteration controlled by the graph runtime, not a new task.\n\n` +
    `Graph goal:\n${truncate(execution.graph?.goal ?? "Unknown graph goal")}\n\n` +
    `Loop ${loop.id ?? "unknown"}:\n${truncate(loop.objective ?? "Unknown loop objective")}\n\n` +
    `Iteration: ${execution.currentIteration ?? "unknown"} of ${execution.maxIterations ?? "unknown"}\n\n` +
    `Tasks:\n${JSON.stringify(tasks, null, 2)}\n\n` +
    `Completion conditions:\n${JSON.stringify(conditions, null, 2)}\n\n` +
    `Resume from the current repository state and the durable packet at ${join(loopgraphDir, "bridge", "current.json")}. ` +
    `Inspect ${liveStatusPath} for the graph view. Work only on this loop, run validation, and submit a complete structured result through the existing loop-graph skill. ` +
    `Do not claim completion without evidence and do not move to another loop yourself. ` +
    `If the user explicitly asked to stop, use /graph-engineering-loop:cancel-loop-graph.`;
}

function truncate(value) {
  return String(value).slice(0, 2_000);
}

function isActive(stateValue, lockValue) {
  if (
    stateValue === null ||
    lockValue === null ||
    !["pending", "running"].includes(stateValue.status) ||
    !Number.isInteger(lockValue.pid)
  ) {
    return false;
  }

  try {
    process.kill(lockValue.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function describeActiveLoop(requestValue) {
  const loopId = requestValue?.request?.loop?.id;
  const iteration = requestValue?.request?.currentIteration;
  return loopId === undefined
    ? "The runtime is preparing the next loop."
    : `Loop ${loopId}, iteration ${iteration ?? "unknown"}, is waiting for the current session.`;
}

async function readStdinJson() {
  let inputText = "";
  for await (const chunk of process.stdin) {
    inputText += chunk;
  }

  try {
    return JSON.parse(inputText);
  } catch {
    return null;
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
