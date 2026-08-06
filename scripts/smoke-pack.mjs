#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const artifactRoot = await mkdtemp(join(tmpdir(), "loopgraph-pack-artifacts-"));
const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-pack-project-"));
const cacheRoot = await mkdtemp(join(tmpdir(), "loopgraph-pack-cache-"));
const graphPath = join(repoRoot, "examples", "fake", "loops.json");

const coreTarball = await pack("./packages/core");
const cliTarball = await pack("./packages/cli");

await writeFile(
  join(projectRoot, "package.json"),
  `${JSON.stringify({ name: "loopgraph-pack-smoke", private: true }, null, 2)}\n`,
  "utf8"
);
await run(
  "npm",
  [
    "install",
    "--cache",
    cacheRoot,
    "--offline",
    "--no-audit",
    "--no-fund",
    "--ignore-scripts",
    join(artifactRoot, coreTarball),
    join(artifactRoot, cliTarball)
  ],
  projectRoot
);

const binary = join(projectRoot, "node_modules", ".bin", "graph-engineering-loop");
await run(binary, ["--version"], projectRoot);
await run(binary, ["validate", graphPath, "--project-root", projectRoot], projectRoot);
await run(binary, ["run", graphPath, "--adapter", "fake", "--project-root", projectRoot], projectRoot);

const state = JSON.parse(await readFile(join(projectRoot, ".loopgraph", "state.json"), "utf8"));
if (state.status !== "completed") {
  throw new Error(`Packed install smoke ended with state ${state.status}`);
}

console.log(`Packed install smoke passed: ${cliTarball}`);

async function pack(workspace) {
  const output = await capture(
    "npm",
    ["pack", "--cache", cacheRoot, "--workspace", workspace, "--pack-destination", artifactRoot, "--json"],
    repoRoot
  );
  const details = JSON.parse(output);
  const results = Array.isArray(details) ? details : Object.values(details);
  const filename = results?.[0]?.filename;
  if (typeof filename !== "string") {
    throw new Error(`npm pack did not return a filename for ${workspace}: ${output}`);
  }
  return filename;
}

function capture(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "inherit"]
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

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
