#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const input = await readStdin();
const message = JSON.parse(input);
const request = message.request;
const loop = request.loop;
const changedFiles = [];
const fakeWrites = Array.isArray(loop.metadata?.fakeWrites) ? loop.metadata.fakeWrites : [];

for (const entry of fakeWrites) {
  if (entry && typeof entry.path === "string") {
    const absolutePath = join(request.projectRoot, entry.path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, entry.content ?? `${loop.id}\n`, "utf8");
    changedFiles.push(entry.path);
  }
}

process.stdout.write(JSON.stringify({
  status: "complete",
  summary: `stdio example adapter executed loop '${loop.id}'.`,
  completedTasks: loop.tasks ?? [],
  remainingWork: [],
  changedFiles,
  commandsRun: [],
  completionEvidence: loop.completionConditions.map((condition, conditionIndex) => ({
    conditionIndex,
    passed: condition.type === "assertion",
    checkedAt: new Date().toISOString(),
    evidence: {
      adapter: "stdio-example",
      loopId: loop.id,
      conditionType: condition.type
    }
  })),
  handoff: [`${loop.id} completed by stdio example adapter.`],
  blockedReason: null
}));

async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) {
    data += chunk.toString("utf8");
  }
  return data;
}
