#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tag = process.env.GITHUB_REF_NAME ?? process.argv[2];

if (tag === undefined || tag.length === 0) {
  console.error("Usage: verify-release-version.mjs <vX.Y.Z> (or set GITHUB_REF_NAME)");
  process.exit(1);
}

if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
  console.error(`Tag must look like v0.2.0, got: ${tag}`);
  process.exit(1);
}

const expected = tag.slice(1);
const paths = [
  "package.json",
  "packages/core/package.json",
  "packages/cli/package.json",
  "claude-plugin/.claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json"
];

for (const relativePath of paths) {
  const absolutePath = resolve(root, relativePath);
  const raw = JSON.parse(await readFile(absolutePath, "utf8"));

  if (relativePath.endsWith("marketplace.json")) {
    if (raw.version !== expected) {
      throw new Error(`${relativePath} version ${raw.version} !== ${expected}`);
    }
    const plugin = raw.plugins?.[0];
    if (plugin?.version !== expected) {
      throw new Error(`${relativePath} plugins[0].version ${plugin?.version} !== ${expected}`);
    }
    continue;
  }

  if (raw.version !== expected) {
    throw new Error(`${relativePath} version ${raw.version} !== ${expected}`);
  }
}

const cli = JSON.parse(await readFile(resolve(root, "packages/cli/package.json"), "utf8"));
const rootPkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));

if (rootPkg.private !== true) {
  throw new Error("Root package.json must be private:true so the monorepo is never published.");
}

if (rootPkg.name === "graph-engineering-loop" || rootPkg.name === "graph-engineering-loop-repo") {
  throw new Error(
    `Root package name '${rootPkg.name}' collides with a publishable package. Keep the monorepo private and named differently.`
  );
}

if (cli.name !== "graph-engineering-loop") {
  throw new Error(`CLI package must be named graph-engineering-loop, got ${cli.name}`);
}

const coreDep = cli.dependencies?.["graph-engineering-loop-core"];
if (coreDep !== expected) {
  throw new Error(`CLI depends on graph-engineering-loop-core@${coreDep}, expected ${expected}`);
}

console.log(`Release version ${expected} matches package and plugin manifests.`);
console.log(`Install target: npm i -g graph-engineering-loop`);
