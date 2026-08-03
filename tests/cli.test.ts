import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

const repoRoot = resolve(import.meta.dirname, "..");
const cliPath = join(repoRoot, "packages/cli/src/cli.ts");
const examplePath = join(repoRoot, "examples/fake/loops.json");
const stdioAdapterPath = join(repoRoot, "examples/stdio-adapter.mjs");

test("CLI exposes production help and version entry points", async () => {
  const help = await runCli(["--help"]);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /Usage:/);
  assert.match(help.stdout, /graph-engineering-loop run/);

  const version = await runCli(["--version"]);
  assert.equal(version.code, 0, version.stderr);
  assert.match(version.stdout, /graph-engineering-loop 0\.2\.2/);
});

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
  assert.match(run.stdout, /Status: .*\.loopgraph\/status\.md/);

  const state = JSON.parse(await readFile(join(projectRoot, ".loopgraph/state.json"), "utf8")) as {
    status: string;
    loops: Record<string, { status: string }>;
  };
  assert.equal(state.status, "completed");
  assert.equal(state.loops.integration.status, "completed");

  const status = JSON.parse(await readFile(join(projectRoot, ".loopgraph/status.json"), "utf8")) as {
    graphStatus: string;
    completedLoops: number;
    totalLoops: number;
  };
  assert.equal(status.graphStatus, "completed");
  assert.equal(status.completedLoops, status.totalLoops);
  const statusMarkdown = await readFile(join(projectRoot, ".loopgraph/status.md"), "utf8");
  assert.match(statusMarkdown, /flowchart LR/);
  assert.match(statusMarkdown, /integration/);

  const integrationResult = JSON.parse(
    await readFile(join(projectRoot, ".loopgraph/results/integration.json"), "utf8")
  ) as { status: string };
  assert.equal(integrationResult.status, "completed");
});

test("CLI resolves relative graph paths from the invoking directory even with a different project root", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-path-root-"));

  const validate = await runCli([
    "validate",
    "examples/fake/loops.json",
    "--project-root",
    projectRoot
  ]);
  assert.equal(validate.code, 0, validate.stderr);
  assert.match(validate.stdout, /fake-vertical-slice/);
});

test("CLI rejects missing path-like inputs instead of compiling them as prompts", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-missing-path-"));

  const run = await runCli([
    "run",
    "missing/loops.json",
    "--adapter",
    "fake",
    "--project-root",
    projectRoot
  ]);
  assert.equal(run.code, 1);
  assert.match(run.stderr, /Input path does not exist/);
});

test("CLI runs the fake example through the generic stdio adapter", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-stdio-"));
  const graphPath = join(projectRoot, "loops.json");
  await cp(examplePath, graphPath);

  const run = await runCli([
    "run",
    graphPath,
    "--adapter",
    "stdio",
    "--adapter-command",
    `${process.execPath} ${stdioAdapterPath}`,
    "--project-root",
    projectRoot
  ]);
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /LoopGraph completed/);

  const integrationResult = JSON.parse(
    await readFile(join(projectRoot, ".loopgraph/results/integration.json"), "utf8")
  ) as { summary: string; status: string };
  assert.equal(integrationResult.status, "completed");
  assert.match(integrationResult.summary, /stdio example adapter/);
});

test("CLI runs a graph through the file-backed interactive adapter", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-interactive-"));
  const graphPath = join(projectRoot, "loops.json");
  await writeFile(graphPath, JSON.stringify({
    version: 1,
    name: "interactive-test",
    goal: "Prove current-session execution.",
    defaults: { maxIterations: 2, maxConcurrentLoops: 1 },
    loops: [
      {
        id: "worker",
        objective: "Create the interactive completion file.",
        dependsOn: [],
        completionConditions: [
          { type: "fileExists", path: "interactive.txt" }
        ]
      }
    ]
  }));

  const child = spawn(process.execPath, [
    "--conditions",
    "development",
    "--import",
    "tsx",
    cliPath,
    "run",
    graphPath,
    "--adapter",
    "interactive",
    "--project-root",
    projectRoot
  ], {
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

  const currentPath = join(projectRoot, ".loopgraph/bridge/current.json");
  const packet = await waitForJson<{ requestId: string }>(currentPath);
  await writeFile(join(projectRoot, "interactive.txt"), "interactive ok\n");
  await writeFile(
    join(projectRoot, `.loopgraph/bridge/responses/${packet.requestId}.json`),
    JSON.stringify({
      status: "complete",
      summary: "Created and verified interactive.txt.",
      completedTasks: [],
      remainingWork: [],
      changedFiles: ["interactive.txt"],
      commandsRun: [],
      completionEvidence: [],
      handoff: [],
      blockedReason: null
    })
  );

  const code = await new Promise<number>((resolvePromise) => {
    child.on("close", (exitCode) => resolvePromise(exitCode ?? 1));
  });
  assert.equal(code, 0, stderr);
  assert.match(stdout, /LoopGraph completed/);

  const state = JSON.parse(await readFile(join(projectRoot, ".loopgraph/state.json"), "utf8")) as {
    status: string;
  };
  assert.equal(state.status, "completed");
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

async function waitForJson<T>(path: string): Promise<T> {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
  }

  throw new Error(`Timed out waiting for ${path}`);
}
