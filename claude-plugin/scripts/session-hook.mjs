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
        `Use the graph-engineering-loop skills; durable state is in ${loopgraphDir}.`
    }
  });
}

if (eventName === "Stop" && input?.stop_hook_active !== true && request !== null) {
  printJson({
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext:
        `LoopGraph run ${state.runId} still has work waiting. ` +
        `Continue loop ${request.request?.loop?.id ?? "unknown"} from ` +
        `${join(loopgraphDir, "bridge", "current.json")}, submit its structured result, ` +
        `or use /graph-engineering-loop:cancel-loop-graph if the user asked to stop.`
    }
  });
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
