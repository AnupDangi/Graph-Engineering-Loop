#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const cliPackage = JSON.parse(await readFile(join(repoRoot, "packages", "cli", "package.json"), "utf8"));
const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-npx-project-"));
const cacheRoot = await mkdtemp(join(tmpdir(), "loopgraph-npx-cache-"));
const packageSpec = `${cliPackage.name}@${cliPackage.version}`;
const graphPath = join(repoRoot, "examples", "fake", "loops.json");

await runNpx(["--version"]);
await runNpx(["validate", graphPath, "--project-root", projectRoot]);
await runNpx(["run", graphPath, "--adapter", "fake", "--project-root", projectRoot]);

const state = JSON.parse(await readFile(join(projectRoot, ".loopgraph", "state.json"), "utf8"));
if (state.status !== "completed") {
  throw new Error(`Registry NPX smoke ended with state ${state.status}`);
}

console.log(`Registry NPX smoke passed for ${packageSpec}`);

function runNpx(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("npx", ["--yes", "--cache", cacheRoot, packageSpec, ...args], {
      cwd: projectRoot,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`npx ${packageSpec} ${args.join(" ")} exited with code ${code}`));
    });
  });
}
