import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const tempRoot = await mkdtemp(join(tmpdir(), "loopgraph-plugin-smoke-"));
const pluginRoot = join(tempRoot, "plugin");
const projectRoot = join(tempRoot, "project");
const graphPath = join(projectRoot, ".loopgraph", "loops.json");
const submissionPath = join(projectRoot, ".loopgraph", "bridge", "submission.json");

await cp(join(repoRoot, "claude-plugin"), pluginRoot, { recursive: true });
await mkdir(join(projectRoot, ".loopgraph"), { recursive: true });
await writeFile(
  graphPath,
  `${JSON.stringify(
    {
      version: 1,
      name: "isolated-plugin-smoke",
      goal: "Prove the installed plugin is self-contained.",
      defaults: {
        maxIterations: 3,
        maxConcurrentLoops: 1
      },
      loops: [
        {
          id: "plugin-worker",
          objective: "Create plugin-smoke.txt.",
          dependsOn: [],
          completionConditions: [
            {
              type: "fileContains",
              path: "plugin-smoke.txt",
              text: "plugin smoke ok"
            }
          ]
        },
        {
          id: "verification-worker",
          objective: "Verify the plugin worker and create verified.txt.",
          dependsOn: ["plugin-worker"],
          completionConditions: [
            {
              type: "fileContains",
              path: "verified.txt",
              text: "graph transition ok"
            }
          ]
        }
      ]
    },
    null,
    2
  )}\n`
);

if (await commandExists("claude")) {
  const validate = await execFileAsync("claude", ["plugin", "validate", pluginRoot], {
    cwd: projectRoot
  });
  if (!validate.stdout.includes("Validation passed")) {
    throw new Error(`Claude plugin validation did not pass:\n${validate.stdout}\n${validate.stderr}`);
  }
} else {
  console.log("Claude CLI not installed; skipped native plugin manifest validation.");
}

await execFileAsync(
  join(pluginRoot, "bin", "loopgraph"),
  ["validate", graphPath, "--project-root", projectRoot],
  { cwd: projectRoot }
);

const start = await execFileAsync(
  join(pluginRoot, "bin", "loopgraph-session"),
  ["start", "--project-root", projectRoot, "--input", graphPath],
  { cwd: projectRoot }
);
const startResult = JSON.parse(start.stdout);
if (startResult.status !== "work_required") {
  throw new Error(`Expected work_required, received ${start.stdout}`);
}
if (startResult.packet?.request?.loop?.id !== "plugin-worker") {
  throw new Error(`Expected plugin-worker first, received ${start.stdout}`);
}
if (!startResult.statusMarkdownPath?.endsWith(".loopgraph/status.md")) {
  throw new Error(`Work response did not expose live status paths:\n${start.stdout}`);
}
const runningStatus = await readFile(startResult.statusMarkdownPath, "utf8");
if (!runningStatus.includes("🔄 running") || !runningStatus.includes("flowchart LR")) {
  throw new Error(`Live status did not show the running dependency graph:\n${runningStatus}`);
}

const sessionHook = await runWithInput(
  process.execPath,
  [join(pluginRoot, "scripts", "session-hook.mjs")],
  projectRoot,
  JSON.stringify({
    hook_event_name: "SessionStart",
    cwd: projectRoot
  })
);
const sessionHookOutput = JSON.parse(sessionHook.stdout);
if (
  !sessionHookOutput.hookSpecificOutput?.additionalContext?.includes("plugin-worker") ||
  !sessionHookOutput.hookSpecificOutput?.additionalContext?.includes("status.md")
) {
  throw new Error(`SessionStart hook did not restore the active loop:\n${sessionHook.stdout}`);
}

const stopHook = await runWithInput(
  process.execPath,
  [join(pluginRoot, "scripts", "session-hook.mjs")],
  projectRoot,
  JSON.stringify({
    hook_event_name: "Stop",
    cwd: projectRoot,
    stop_hook_active: false
  })
);
const stopHookOutput = JSON.parse(stopHook.stdout);
if (
  stopHookOutput.decision !== "block" ||
  !stopHookOutput.reason?.includes("SAME active LoopGraph workstream") ||
  !stopHookOutput.reason?.includes("plugin-worker") ||
  !stopHookOutput.reason?.includes("Completion conditions")
) {
  throw new Error(`Stop hook did not issue a Ralph-style continuation:\n${stopHook.stdout}`);
}

const repeatedStopHook = await runWithInput(
  process.execPath,
  [join(pluginRoot, "scripts", "session-hook.mjs")],
  projectRoot,
  JSON.stringify({
    hook_event_name: "Stop",
    cwd: projectRoot,
    stop_hook_active: false
  })
);
if (JSON.parse(repeatedStopHook.stdout).reason !== stopHookOutput.reason) {
  throw new Error("Stop hook did not repeat the same active-loop contract.");
}

const guardedStopHook = await runWithInput(
  process.execPath,
  [join(pluginRoot, "scripts", "session-hook.mjs")],
  projectRoot,
  JSON.stringify({
    hook_event_name: "Stop",
    cwd: projectRoot,
    stop_hook_active: true
  })
);
if (guardedStopHook.stdout.trim() !== "") {
  throw new Error(`Recursive Stop hook was not guarded:\n${guardedStopHook.stdout}`);
}

await writeSubmission({
  status: "incomplete",
  summary: "The first bounded iteration did not yet satisfy its evidence.",
  completedTasks: [],
  remainingWork: ["Create plugin-smoke.txt."],
  changedFiles: []
});
const repeat = await submitWork();
if (
  repeat.status !== "work_required" ||
  repeat.packet?.request?.loop?.id !== "plugin-worker" ||
  repeat.packet?.request?.currentIteration !== 2 ||
  repeat.packet?.request?.previousResult?.status !== "incomplete"
) {
  throw new Error(`Expected a second bounded plugin-worker iteration, received ${JSON.stringify(repeat)}`);
}

await writeFile(join(projectRoot, "plugin-smoke.txt"), "plugin smoke ok\n");
await writeSubmission({
  status: "complete",
  summary: "Created plugin-smoke.txt through the isolated plugin bridge.",
  completedTasks: ["Created the smoke artifact."],
  remainingWork: [],
  changedFiles: ["plugin-smoke.txt"]
});
const transition = await submitWork();
if (
  transition.status !== "work_required" ||
  transition.packet?.request?.loop?.id !== "verification-worker" ||
  transition.packet?.request?.currentIteration !== 1
) {
  throw new Error(`Graph did not control the dependency transition: ${JSON.stringify(transition)}`);
}

await writeFile(join(projectRoot, "verified.txt"), "graph transition ok\n");
await writeSubmission({
  status: "complete",
  summary: "Verified the graph-controlled transition.",
  completedTasks: ["Verified the dependent loop."],
  remainingWork: [],
  changedFiles: ["verified.txt"]
});
const submitResult = await submitWork();
if (submitResult.status !== "completed") {
  throw new Error(`Expected completed, received ${JSON.stringify(submitResult)}`);
}

const state = JSON.parse(await readFile(join(projectRoot, ".loopgraph", "state.json"), "utf8"));
if (state.status !== "completed") {
  throw new Error(`Isolated plugin state was ${state.status}`);
}
const finalStatus = JSON.parse(await readFile(join(projectRoot, ".loopgraph", "status.json"), "utf8"));
if (finalStatus.completedLoops !== 2 || finalStatus.totalLoops !== 2) {
  throw new Error(`Live status did not record both completed loops: ${JSON.stringify(finalStatus)}`);
}
const finalMarkdown = await readFile(join(projectRoot, ".loopgraph", "status.md"), "utf8");
if (!finalMarkdown.includes("n0 --> n1") || !finalMarkdown.includes("[████████████] 2/2")) {
  throw new Error(`Final graph visualization was incomplete:\n${finalMarkdown}`);
}

const cancelProjectRoot = join(tempRoot, "cancel-project");
const cancelGraphPath = join(cancelProjectRoot, ".loopgraph", "loops.json");
await mkdir(join(cancelProjectRoot, ".loopgraph"), { recursive: true });
await writeFile(
  cancelGraphPath,
  `${JSON.stringify(
    {
      version: 1,
      name: "plugin-cancel-smoke",
      goal: "Prove a waiting plugin run can be cancelled.",
      defaults: {
        maxIterations: 2,
        maxConcurrentLoops: 1
      },
      loops: [
        {
          id: "waiting-worker",
          objective: "Wait for an interactive response.",
          dependsOn: [],
          completionConditions: [
            {
              type: "assertion",
              description: "The interactive worker has responded."
            }
          ]
        }
      ]
    },
    null,
    2
  )}\n`
);

const cancelStart = await execFileAsync(
  join(pluginRoot, "bin", "loopgraph-session"),
  ["start", "--project-root", cancelProjectRoot, "--input", cancelGraphPath],
  { cwd: cancelProjectRoot }
);
if (JSON.parse(cancelStart.stdout).status !== "work_required") {
  throw new Error(`Cancel smoke did not start:\n${cancelStart.stdout}`);
}

const cancel = await runWithInput(
  join(pluginRoot, "bin", "loopgraph"),
  ["cancel", "--project-root", cancelProjectRoot],
  cancelProjectRoot
);
if (cancel.code !== 3 || !cancel.stdout.includes("Cancelled LoopGraph run")) {
  throw new Error(`Cancel command failed (${cancel.code}):\n${cancel.stdout}\n${cancel.stderr}`);
}

const cancelledState = await waitForState(cancelProjectRoot, "cancelled");
if (cancelledState.status !== "cancelled") {
  throw new Error(`Cancel smoke state was ${cancelledState.status}`);
}
const cancelledStatus = await readFile(join(cancelProjectRoot, ".loopgraph", "status.md"), "utf8");
if (
  !cancelledStatus.includes("Graph cancelled by the operator") ||
  !cancelledStatus.includes("🛑 cancelled")
) {
  throw new Error(`Cancelled status view was not updated:\n${cancelledStatus}`);
}

console.log(`Isolated plugin smoke passed: ${tempRoot}`);

async function writeSubmission(value) {
  await writeFile(
    submissionPath,
    `${JSON.stringify(
      {
        ...value,
        commandsRun: [],
        completionEvidence: [],
        handoff: [],
        blockedReason: null
      },
      null,
      2
    )}\n`
  );
}

async function submitWork() {
  const result = await execFileAsync(
    join(pluginRoot, "bin", "loopgraph-session"),
    ["submit", "--project-root", projectRoot, "--file", submissionPath],
    { cwd: projectRoot }
  );
  return JSON.parse(result.stdout);
}

async function commandExists(command) {
  try {
    await execFileAsync(command, ["--version"]);
    return true;
  } catch (error) {
    if (error !== null && typeof error === "object" && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function runWithInput(command, args, cwd, input = "") {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

async function waitForState(root, expectedStatus) {
  const statePath = join(root, ".loopgraph", "state.json");
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    try {
      const value = JSON.parse(await readFile(statePath, "utf8"));
      if (value.status === expectedStatus) {
        return value;
      }
    } catch {
      // The state file may be between atomic writes.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }

  throw new Error(`Timed out waiting for state ${expectedStatus} at ${statePath}`);
}
