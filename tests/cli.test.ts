import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

const repoRoot = resolve(import.meta.dirname, "..");
const cliPath = join(repoRoot, "packages/cli/src/cli.ts");
const examplePath = join(repoRoot, "examples/fake/loops.json");

test("CLI validates and runs the fake example with durable results", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-cli-"));
  const graphPath = join(projectRoot, "loops.json");
  await cp(examplePath, graphPath);

  const validate = await runCli(["validate", graphPath, "--project-root", projectRoot]);
  assert.equal(validate.code, 0);
  assert.match(validate.stdout, /is valid/);

  const run = await runCli(["run", graphPath, "--adapter", "fake", "--project-root", projectRoot]);
  assert.equal(run.code, 0);
  assert.match(run.stdout, /LoopGraph completed/);

  const state = JSON.parse(await readFile(join(projectRoot, ".loopgraph/state.json"), "utf8")) as {
    status: string;
    loops: Record<string, { status: string }>;
  };
  assert.equal(state.status, "completed");
  assert.equal(state.loops.integration.status, "completed");

  const integrationResult = JSON.parse(
    await readFile(join(projectRoot, ".loopgraph/results/integration.json"), "utf8")
  ) as { status: string };
  assert.equal(integrationResult.status, "completed");
});

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, ["--conditions", "development", "--import", "tsx", cliPath, ...args], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}
