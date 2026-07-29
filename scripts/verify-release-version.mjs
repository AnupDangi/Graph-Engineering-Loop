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
const coreDep = cli.dependencies?.["graph-engineering-loop-core"];
if (coreDep !== expected) {
  throw new Error(`CLI depends on graph-engineering-loop-core@${coreDep}, expected ${expected}`);
}

console.log(`Release version ${expected} matches package and plugin manifests.`);
