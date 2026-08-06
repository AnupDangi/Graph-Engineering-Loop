#!/usr/bin/env node

import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const tempRoot = await mkdtemp(join(tmpdir(), "loopgraph-plugin-claude-"));
const pluginRoot = join(tempRoot, "plugin");
const projectRoot = join(tempRoot, "project");
const graphPath = join(projectRoot, ".loopgraph", "loops.json");

await run("npm", ["run", "build:plugin"], repoRoot);
await cp(join(repoRoot, "claude-plugin"), pluginRoot, { recursive: true });
await mkdir(join(projectRoot, ".loopgraph"), { recursive: true });
await writeFile(
  graphPath,
  `${JSON.stringify(
    {
      version: 1,
      name: "claude-plugin-smoke",
      goal: "Verify the installed Claude Code plugin through its namespaced skill.",
      defaults: {
        maxIterations: 1,
        maxConcurrentLoops: 1
      },
      loops: [
        {
          id: "write-plugin-smoke",
          title: "Write plugin smoke file",
          objective: "Create claude-plugin-smoke.txt containing exactly 'claude plugin smoke ok'.",
          tasks: ["Create claude-plugin-smoke.txt with the required content."],
          dependsOn: [],
          completionConditions: [
            {
              type: "fileContains",
              path: "claude-plugin-smoke.txt",
              text: "claude plugin smoke ok"
            }
          ]
        }
      ]
    },
    null,
    2
  )}\n`
);

await run(
  "claude",
  [
    "--plugin-dir",
    pluginRoot,
    "-p",
    `/graph-engineering-loop:loop-graph ${graphPath}`,
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    "Bash,Read,Write,Edit,Glob,Grep",
    "--max-budget-usd",
    "2.00",
    "--effort",
    "low",
    "--output-format",
    "json",
    "--no-session-persistence"
  ],
  projectRoot
);

const smokeFile = await readFile(join(projectRoot, "claude-plugin-smoke.txt"), "utf8");
if (smokeFile.trim() !== "claude plugin smoke ok") {
  throw new Error("Claude plugin smoke file did not contain the expected text.");
}

const state = JSON.parse(await readFile(join(projectRoot, ".loopgraph", "state.json"), "utf8"));
if (state.status !== "completed") {
  throw new Error(`Claude plugin smoke state was ${state.status}`);
}

console.log(`Real Claude plugin smoke passed: ${tempRoot}`);

function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}
