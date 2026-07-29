#!/usr/bin/env node

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "..");
const projectRoot = await mkdtemp(join(tmpdir(), "gel-claude-smoke-"));
const graphPath = join(projectRoot, "loops.json");

await writeFile(graphPath, JSON.stringify({
  $schema: "https://loopgraph.dev/schemas/loops.v1.json",
  version: 1,
  name: "claude-smoke",
  goal: "Verify that the Claude adapter can perform a tiny real file edit and return structured evidence.",
  defaults: {
    maxIterations: 1,
    maxConcurrentLoops: 1
  },
  loops: [
    {
      id: "write-smoke-file",
      title: "Write smoke file",
      objective: "Create tmp/claude-smoke.txt containing the text 'claude smoke ok'.",
      tasks: [
        "Create tmp/claude-smoke.txt",
        "Ensure the file contains the verification text"
      ],
      dependsOn: [],
      completionConditions: [
        {
          type: "fileContains",
          path: "tmp/claude-smoke.txt",
          text: "claude smoke ok"
        }
      ]
    }
  ]
}, null, 2), "utf8");

await run("npm", ["run", "build"], repoRoot);
await run(process.execPath, [
  join(repoRoot, "packages/cli/dist/cli.js"),
  "run",
  graphPath,
  "--adapter",
  "claude",
  "--claude-permission-mode",
  "acceptEdits",
  "--claude-max-budget-usd",
  "1.00",
  "--project-root",
  projectRoot
], repoRoot);

const smokeFile = await readFile(join(projectRoot, "tmp/claude-smoke.txt"), "utf8");
if (!smokeFile.includes("claude smoke ok")) {
  throw new Error("Claude smoke file did not contain expected text.");
}

console.log(`Claude smoke project: ${projectRoot}`);

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

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}
