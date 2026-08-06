import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

import { compileRequirementsWithGraph } from "../packages/cli/src/compiler.js";
import type {
  ProjectGraphContext,
  ProjectGraphProvider,
  ProjectGraphQuery,
  ProjectGraphSnapshot
} from "../packages/core/src/index.js";

const execFileAsync = promisify(execFile);

const repoRoot = resolve(import.meta.dirname, "..");
const cliPath = join(repoRoot, "packages/cli/src/cli.ts");
const examplePath = join(repoRoot, "examples/fake/loops.json");
const stdioAdapterPath = join(repoRoot, "examples/stdio-adapter.mjs");
const cliVersion = JSON.parse(await readFile(join(repoRoot, "packages/cli/package.json"), "utf8")).version as string;

test("CLI exposes production help and version entry points", async () => {
  const help = await runCli(["--help"]);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /Usage:/);
  assert.match(help.stdout, /graph-engineering-loop run/);

  const version = await runCli(["--version"]);
  assert.equal(version.code, 0, version.stderr);
  assert.match(version.stdout, new RegExp(`graph-engineering-loop ${cliVersion}`));
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

  const validate = await runCli(["validate", "examples/fake/loops.json", "--project-root", projectRoot]);
  assert.equal(validate.code, 0, validate.stderr);
  assert.match(validate.stdout, /fake-vertical-slice/);
});

test("CLI rejects missing path-like inputs instead of compiling them as prompts", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-missing-path-"));

  const run = await runCli(["run", "missing/loops.json", "--adapter", "fake", "--project-root", projectRoot]);
  assert.equal(run.code, 1);
  assert.match(run.stderr, /Input path does not exist/);
});

test("CLI compiles sentence prompts that mention file extensions", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-prompt-txt-"));

  const run = await runCli([
    "run",
    "Prove agent usability with a tiny hello.txt",
    "--adapter",
    "fake",
    "--project-root",
    projectRoot
  ]);
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /LoopGraph completed/);

  const graph = JSON.parse(await readFile(join(projectRoot, ".loopgraph/loops.json"), "utf8")) as {
    name: string;
  };
  assert.equal(graph.name, "generated-loopgraph");
});

test("CLI explains glued validate.loopgraph typos", async () => {
  const result = await runCli(["validate.loopgraph/loops.json"]);
  assert.equal(result.code, 4);
  assert.match(result.stderr, /Missing space after 'validate'/);
  assert.match(result.stderr, /validate \.loopgraph\/loops\.json/);
});

test("CLI does not validate another cwd loops.json when project-root is empty", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-empty-root-"));
  const result = await runCli(["validate", ".loopgraph/loops.json", "--project-root", projectRoot]);
  assert.equal(result.code, 4);
  assert.match(result.stderr, /Input path does not exist/);
  assert.match(result.stderr, /no loops\.json yet/i);
});

test("CLI status shows the live graph with loops as nodes", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-status-"));
  const graphPath = join(projectRoot, "loops.json");
  await cp(examplePath, graphPath);

  const run = await runCli(["run", graphPath, "--adapter", "fake", "--project-root", projectRoot]);
  assert.equal(run.code, 0, run.stderr);

  const status = await runCli(["status", "--project-root", projectRoot]);
  assert.equal(status.code, 0, status.stderr);
  assert.match(status.stdout, /fake-vertical-slice/);
  assert.match(status.stdout, /completed/);
  assert.match(status.stdout, /foundation/);
  assert.match(status.stdout, /integration/);
  assert.match(status.stdout, /\.loopgraph\/status\.json/);

  const jsonStatus = await runCli(["status", "--json", "--project-root", projectRoot]);
  assert.equal(jsonStatus.code, 0, jsonStatus.stderr);
  const parsed = JSON.parse(jsonStatus.stdout) as { graphStatus: string; loops: { id: string }[] };
  assert.equal(parsed.graphStatus, "completed");
  assert.equal(parsed.loops.length, 4);
});

test("CLI status --watch exits when the graph is already terminal", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-status-watch-"));
  const graphPath = join(projectRoot, "loops.json");
  await cp(examplePath, graphPath);

  const run = await runCli(["run", graphPath, "--adapter", "fake", "--project-root", projectRoot]);
  assert.equal(run.code, 0, run.stderr);

  const status = await runCli(["status", "--watch", "--project-root", projectRoot]);
  assert.equal(status.code, 0, status.stderr);
  assert.match(status.stdout, /completed/);
});

test("CLI status reports a missing run clearly", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-status-missing-"));
  const result = await runCli(["status", "--project-root", projectRoot]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /No LoopGraph status found/);
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
  await writeFile(
    graphPath,
    JSON.stringify({
      version: 1,
      name: "interactive-test",
      goal: "Prove current-session execution.",
      defaults: { maxIterations: 2, maxConcurrentLoops: 1 },
      loops: [
        {
          id: "worker",
          objective: "Create the interactive completion file.",
          dependsOn: [],
          completionConditions: [{ type: "fileExists", path: "interactive.txt" }]
        }
      ]
    })
  );

  const child = spawn(
    process.execPath,
    [
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
    ],
    {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
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

test("graph-aware compilation maps project communities to loops and adds an integration loop", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-compile-graph-"));
  const provider = new FakeGraphProvider();

  const graph = await compileRequirementsWithGraph(
    provider,
    projectRoot,
    "Add a dashboard and an API",
    "prompt"
  );

  assert.ok(graph !== null);
  const ids = graph.loops.map((loop) => loop.id);
  assert.ok(ids.includes("api"));
  assert.ok(ids.includes("dashboard-ui"));
  assert.ok(ids.includes("integration"));
  const integration = graph.loops.find((loop) => loop.id === "integration")!;
  assert.ok(integration.dependsOn.includes("api"));
  assert.ok(integration.dependsOn.includes("dashboard-ui"));
  const apiLoop = graph.loops.find((loop) => loop.id === "api")!;
  assert.ok((apiLoop.sources ?? []).includes("src/api/index.ts"));
  assert.ok(provider.queries >= 3);
});

test("graph-aware compilation falls back to null with fewer than two communities", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-compile-fallback-"));
  const provider = new FakeGraphProvider({ communities: ["only"] });

  const graph = await compileRequirementsWithGraph(provider, projectRoot, "Small task", "prompt");
  assert.equal(graph, null);
});

test("CLI --isolated runs a graph in worktrees and integrates branches before verification", async () => {
  const projectRoot = await initTempGitRepo();
  const graphPath = join(projectRoot, "loops.json");
  await writeFile(
    graphPath,
    JSON.stringify({
      version: 1,
      name: "isolated-cli",
      goal: "Prove CLI worktree isolation.",
      defaults: { maxConcurrentLoops: 2 },
      loops: [
        {
          id: "worker-a",
          objective: "Write a.txt.",
          dependsOn: [],
          metadata: { isolated: true, fakeWrites: [{ path: "a.txt", content: "a\n" }] },
          completionConditions: [{ type: "fileExists", path: "a.txt" }]
        },
        {
          id: "worker-b",
          objective: "Write b.txt.",
          dependsOn: [],
          metadata: { isolated: true, fakeWrites: [{ path: "b.txt", content: "b\n" }] },
          completionConditions: [{ type: "fileExists", path: "b.txt" }]
        },
        {
          id: "integration",
          objective: "Verify merged files.",
          dependsOn: ["worker-a", "worker-b"],
          metadata: { integration: true },
          completionConditions: [
            { type: "fileExists", path: "a.txt" },
            { type: "fileExists", path: "b.txt" }
          ]
        }
      ]
    })
  );

  const run = await runCli([
    "run",
    graphPath,
    "--adapter",
    "fake",
    "--isolated",
    "--project-root",
    projectRoot
  ]);
  assert.equal(run.code, 0, run.stderr);

  const aText = await readFile(join(projectRoot, "a.txt"), "utf8");
  assert.equal(aText.trim(), "a");
  const { stdout: branches } = await execFileAsync("git", ["branch", "--list", "loop/*"], {
    cwd: projectRoot
  });
  assert.equal(branches.trim(), "");

  await rm(projectRoot, { recursive: true, force: true });
});

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      ["--conditions", "development", "--import", "tsx", cliPath, ...args],
      {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

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

class FakeGraphProvider implements ProjectGraphProvider {
  readonly name = "fake-graph";
  queries = 0;
  private readonly communities: string[];

  constructor(options: { communities?: string[] } = {}) {
    this.communities = options.communities ?? ["API", "Dashboard UI", "Shared models"];
  }

  async initialize(_projectRoot: string): Promise<void> {
    return undefined;
  }

  async ensureCurrent(_options?: {
    incremental?: boolean;
    signal?: AbortSignal;
  }): Promise<ProjectGraphSnapshot> {
    return { provider: this.name, generatedAt: new Date().toISOString() };
  }

  async query(request: ProjectGraphQuery, _signal?: AbortSignal): Promise<ProjectGraphContext> {
    this.queries += 1;
    const isCommunityQuery = request.loop.id !== "goal";
    return {
      provider: this.name,
      query: request.loop.objective,
      generatedAt: new Date().toISOString(),
      content: "",
      communities: isCommunityQuery ? [] : this.communities,
      entryNodes: [],
      relevantFiles: isCommunityQuery
        ? [`src/${request.loop.id}/index.ts`, `src/${request.loop.id}/types.ts`]
        : ["src/api/routes.ts", "src/ui/App.tsx"]
    };
  }

  async shutdown(): Promise<void> {
    return undefined;
  }
}

async function initTempGitRepo(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "loopgraph-cli-git-"));
  await execFileAsync("git", ["init"], { cwd: projectRoot });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: projectRoot });
  await execFileAsync("git", ["config", "user.name", "LoopGraph Test"], { cwd: projectRoot });
  await writeFile(join(projectRoot, "README.md"), "# test\n");
  await execFileAsync("git", ["add", "-A"], { cwd: projectRoot });
  await execFileAsync("git", ["commit", "-m", "base"], { cwd: projectRoot });
  return projectRoot;
}
