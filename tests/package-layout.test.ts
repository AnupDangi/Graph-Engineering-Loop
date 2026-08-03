import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");

async function readPackage(relativePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(resolve(repoRoot, relativePath), "utf8")) as Record<string, unknown>;
}

test("the monorepo root cannot be published as an npm package", async () => {
  const rootPackage = await readPackage("package.json");
  const scripts = rootPackage.scripts as Record<string, string>;

  assert.equal(rootPackage.name, "graph-engineering-loop-workspace");
  assert.equal(rootPackage.private, true);
  assert.equal(rootPackage.bin, undefined);
  assert.equal(scripts.prepublishOnly, "node scripts/reject-root-publish.mjs");
});

test("only the CLI workspace exposes the supported executables", async () => {
  const cliPackage = await readPackage("packages/cli/package.json");
  const bin = cliPackage.bin as Record<string, string>;

  assert.equal(cliPackage.name, "graph-engineering-loop");
  assert.equal(bin["graph-engineering-loop"], "./dist/cli.js");
  assert.equal(bin.loopgraph, "./dist/cli.js");
});
