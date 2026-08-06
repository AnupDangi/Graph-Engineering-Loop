import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

const execFileAsync = promisify(execFile);

export interface WorktreeInfo {
  loopId: string;
  branch: string;
  path: string;
  createdAt: string;
}

export interface WorktreeManagerOptions {
  gitPath?: string;
}

export class WorktreeManager {
  readonly projectRoot: string;
  readonly workspacesDir: string;
  private readonly git: string;

  constructor(projectRoot: string, options: WorktreeManagerOptions = {}) {
    this.projectRoot = resolve(projectRoot);
    this.workspacesDir = join(this.projectRoot, ".loopgraph", "workspaces");
    this.git = options.gitPath ?? "git";
  }

  async create(loopId: string): Promise<WorktreeInfo> {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(loopId)) {
      throw new Error(`Invalid loop id for isolated worktree: ${loopId}`);
    }

    const existing = await this.readInfo(loopId);
    if (existing !== null) {
      return existing;
    }

    await this.ensureGitRepo();
    const branch = `loop/${loopId}`;
    const worktreePath = join(this.workspacesDir, loopId);

    await execFileAsync(this.git, ["branch", "-D", branch], { cwd: this.projectRoot }).catch(() => undefined);
    await execFileAsync(this.git, ["worktree", "add", "-b", branch, worktreePath, "HEAD"], {
      cwd: this.projectRoot
    });

    const info: WorktreeInfo = {
      loopId,
      branch,
      path: worktreePath,
      createdAt: new Date().toISOString()
    };

    await this.writeInfo(info);
    return info;
  }

  async list(): Promise<WorktreeInfo[]> {
    await mkdir(this.workspacesDir, { recursive: true });
    const entries = await this.readDir();

    const infos: WorktreeInfo[] = [];
    for (const name of entries) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const info = await this.readInfo(name.slice(0, -".json".length));
      if (info !== null) {
        infos.push(info);
      }
    }

    return infos.sort((a, b) => a.loopId.localeCompare(b.loopId));
  }

  async remove(loopId: string): Promise<void> {
    const info = await this.readInfo(loopId);
    if (info === null) {
      return;
    }

    await execFileAsync(this.git, ["worktree", "remove", "--force", info.path], {
      cwd: this.projectRoot
    });
    await execFileAsync(this.git, ["branch", "-D", info.branch], { cwd: this.projectRoot }).catch(
      () => undefined
    );
    await rm(join(this.workspacesDir, `${loopId}.json`), { force: true });
  }

  async removeAll(): Promise<void> {
    for (const info of await this.list()) {
      await this.remove(info.loopId);
    }
  }

  async readInfo(loopId: string): Promise<WorktreeInfo | null> {
    try {
      return JSON.parse(await readFile(join(this.workspacesDir, `${loopId}.json`), "utf8")) as WorktreeInfo;
    } catch {
      return null;
    }
  }

  private async writeInfo(info: WorktreeInfo): Promise<void> {
    await mkdir(this.workspacesDir, { recursive: true });
    const path = join(this.workspacesDir, `${info.loopId}.json`);
    const tmpPath = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(info, null, 2)}\n`, "utf8");
    await rename(tmpPath, path);
  }

  private async readDir(): Promise<string[]> {
    try {
      return await readdir(this.workspacesDir);
    } catch {
      return [];
    }
  }

  private async ensureGitRepo(): Promise<void> {
    try {
      await execFileAsync(this.git, ["rev-parse", "--is-inside-work-tree"], { cwd: this.projectRoot });
    } catch {
      throw new Error(`Isolated worktrees require a Git repository at ${this.projectRoot}.`);
    }
  }
}

export function isGitRepository(projectRoot: string, gitPath = "git"): Promise<boolean> {
  return execFileAsync(gitPath, ["rev-parse", "--is-inside-work-tree"], { cwd: projectRoot })
    .then(({ stdout }) => stdout.trim() === "true")
    .catch(() => false);
}

export function currentBranch(projectRoot: string, gitPath = "git"): Promise<string> {
  return execFileAsync(gitPath, ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectRoot }).then(
    ({ stdout }) => stdout.trim()
  );
}
