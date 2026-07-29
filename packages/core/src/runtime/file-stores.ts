import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import type { GraphRunResult, GraphRunSnapshot, GraphRuntimeHooks, LoopCompletedEvent } from "./graph-runtime.js";
import type { GraphStatus, LoopGraph, LoopResult } from "../schema/types.js";

export interface RunMetadata {
  runId: string;
  graphName: string;
  graphHash: string;
  projectRoot: string;
  startedAt: string;
}

export interface StateFile {
  version: 1;
  runId: string;
  graphName: string;
  graphHash: string;
  status: GraphStatus;
  startedAt: string;
  updatedAt: string;
  loops: GraphRunSnapshot["loops"];
}

export interface LockFile {
  runId: string;
  pid: number;
  startedAt: string;
  projectRoot: string;
}

export class LoopGraphFiles {
  readonly loopgraphDir: string;
  readonly resultsDir: string;
  readonly statePath: string;
  readonly lockPath: string;
  readonly eventsPath: string;

  constructor(readonly projectRoot: string) {
    this.loopgraphDir = join(projectRoot, ".loopgraph");
    this.resultsDir = join(this.loopgraphDir, "results");
    this.statePath = join(this.loopgraphDir, "state.json");
    this.lockPath = join(this.loopgraphDir, "lock.json");
    this.eventsPath = join(this.loopgraphDir, "events.jsonl");
  }

  async ensure(): Promise<void> {
    await mkdir(this.resultsDir, { recursive: true });
  }

  async writeState(metadata: RunMetadata, snapshot: GraphRunSnapshot | GraphRunResult): Promise<void> {
    const state: StateFile = {
      version: 1,
      runId: metadata.runId,
      graphName: metadata.graphName,
      graphHash: metadata.graphHash,
      status: snapshot.status,
      startedAt: metadata.startedAt,
      updatedAt: new Date().toISOString(),
      loops: snapshot.loops
    };

    await atomicWriteJson(this.statePath, state);
  }

  async writeRawState(state: StateFile): Promise<void> {
    await atomicWriteJson(this.statePath, state);
  }

  async createLock(metadata: RunMetadata): Promise<void> {
    await this.ensure();

    if (existsSync(this.lockPath)) {
      const existing = await readJson<LockFile>(this.lockPath);
      if (existing !== null && processExists(existing.pid)) {
        throw new Error(`LoopGraph is already running for this project (pid ${existing.pid}).`);
      }
    }

    const lock: LockFile = {
      runId: metadata.runId,
      pid: process.pid,
      startedAt: metadata.startedAt,
      projectRoot: metadata.projectRoot
    };

    await atomicWriteJson(this.lockPath, lock);
  }

  async removeLock(): Promise<void> {
    await rm(this.lockPath, { force: true });
  }

  async appendEvent(type: string, payload: Record<string, unknown>): Promise<void> {
    await this.ensure();
    await writeFile(
      this.eventsPath,
      `${JSON.stringify({ type, timestamp: new Date().toISOString(), ...payload })}\n`,
      { flag: "a" }
    );
  }

  async writeLoopResult(result: LoopResult): Promise<void> {
    await this.ensure();
    await atomicWriteJson(join(this.resultsDir, `${result.loopId}.json`), result);
    await atomicWriteText(join(this.resultsDir, `${result.loopId}.md`), formatLoopResultMarkdown(result));
  }

  async readState(): Promise<StateFile | null> {
    return readJson<StateFile>(this.statePath);
  }

  hooks(metadata: RunMetadata): GraphRuntimeHooks {
    return {
      onGraphStarted: async (snapshot) => {
        await this.appendEvent("graph.started", { runId: metadata.runId });
        await this.writeState(metadata, snapshot);
      },
      onLoopStarted: async (event) => {
        await this.appendEvent("loop.started", {
          runId: metadata.runId,
          loopId: event.loopId,
          iteration: event.iteration
        });
      },
      onConditionChecked: async (event) => {
        await this.appendEvent("condition.checked", {
          runId: metadata.runId,
          loopId: event.loopId,
          iteration: event.iteration,
          passed: event.passed
        });
      },
      onLoopCompleted: async (event) => {
        await this.persistLoopEvent(metadata, "loop.completed", event);
      },
      onLoopBlocked: async (event) => {
        await this.persistLoopEvent(metadata, "loop.blocked", event);
      },
      onGraphFinished: async (result) => {
        await this.appendEvent("graph.finished", {
          runId: metadata.runId,
          status: result.status
        });
        await this.writeState(metadata, result);
      }
    };
  }

  private async persistLoopEvent(metadata: RunMetadata, type: string, event: LoopCompletedEvent): Promise<void> {
    await this.writeLoopResult(event.result);
    await this.appendEvent(type, {
      runId: metadata.runId,
      loopId: event.loopId,
      status: event.result.status,
      iterationsUsed: event.result.iterationsUsed
    });
  }
}

export function createRunMetadata(graph: LoopGraph, projectRoot: string): RunMetadata {
  return {
    runId: `run_${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}_${randomBytes(3).toString("hex")}`,
    graphName: graph.name,
    graphHash: hashGraph(graph),
    projectRoot,
    startedAt: new Date().toISOString()
  };
}

export function hashGraph(graph: LoopGraph): string {
  return createHash("sha256").update(JSON.stringify(graph)).digest("hex");
}

export function isTerminalGraphStatus(status: GraphStatus): boolean {
  return status === "completed" || status === "completed_with_blocks" || status === "failed" || status === "cancelled";
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await atomicWriteText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function atomicWriteText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  const file = await open(tmpPath, "w");

  try {
    await file.writeFile(value, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }

  await rename(tmpPath, path);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function formatLoopResultMarkdown(result: LoopResult): string {
  const handoff = result.handoff.length > 0
    ? result.handoff.map((entry) => `- ${entry}`).join("\n")
    : "- No handoff notes.";

  return `# ${result.loopId}\n\nStatus: ${result.status}\nIterations used: ${result.iterationsUsed}\n\n## Summary\n\n${result.summary}\n\n## Handoff\n\n${handoff}\n`;
}
