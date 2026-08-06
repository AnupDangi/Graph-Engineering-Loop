# Graph Engineering Loop

Graph Engineering Loop is a portable runtime for dependency-aware, completion-driven software workstreams.
<img width="1536" height="1024" alt="image" src="https://github.com/user-attachments/assets/5d1d6201-ba51-48f8-9eb3-88c77ecff075" />

It turns a `loops.json` graph, requirements file, or prompt into durable loop execution state under `.loopgraph/`. Each loop is a substantial workstream that can use a harness adapter, run commands, touch multiple files, iterate, and complete only when its completion conditions are verified.

The core format and runtime are harness-neutral. The first real harness target is Claude Code, with a deterministic fake adapter for local testing.

## Status

This is an early `0.2.3` implementation. It includes:

- Version 1 graph validation.
- Deterministic dependency scheduling.
- Completion evaluators for commands, file existence, file contents, assertions, and aggregate `all`.
- Atomic `.loopgraph/state.json` writes.
- `.loopgraph/lock.json`, `.loopgraph/events.jsonl`, and `.loopgraph/results/`.
- Generated live `.loopgraph/status.md` graph visualization and `.loopgraph/status.json` status API.
- CLI commands: `run`, `cancel`, and `validate`.
- Deterministic fake adapter for trying the runtime locally.
- Claude Code headless adapter using `claude -p`.
- Claude Code interactive adapter that delegates loop work to the active session without nested Claude processes.
- Generic stdio adapter for any harness wrapper that can read JSON from stdin and write JSON to stdout.
- Self-contained Claude Code plugin with a vendored runtime, lifecycle hooks, and marketplace metadata.
- Optional project-graph context providers with durable per-loop context packets.

## Run from source

```bash
git clone https://github.com/AnupDangi/Graph-Engineering-Loop.git
cd Graph-Engineering-Loop
npm ci
npm run build
npm run loopgraph -- --version
npm run loopgraph -- run examples/fake/loops.json --adapter fake
```

## Install from npm

```bash
npm install -g graph-engineering-loop-workspace
graph-engineering-loop-workspace --version
loopgraph run examples/fake/loops.json --adapter fake
```

Or:

```bash
npx graph-engineering-loop-workspace --version
```

## Quick Start

Validate a graph:

```bash
npm run loopgraph -- validate examples/fake/loops.json
```

Run the fake vertical slice:

```bash
npm run loopgraph -- run examples/fake/loops.json --adapter fake
```

Run with Claude Code headless:

```bash
npm run loopgraph -- run .loopgraph/loops.json --adapter claude --claude-permission-mode acceptEdits
```

Run with a generic external harness command:

```bash
npm run loopgraph -- run examples/fake/loops.json \
  --adapter stdio \
  --adapter-command "node examples/stdio-adapter.mjs"
```

Install Graphify and confirm the CLI is available:

```bash
uv tool install graphifyy
graphify --version
```

Run headless Claude with local Graphify context enrichment:

```bash
npm run loopgraph -- run .loopgraph/loops.json \
  --adapter claude \
  --claude-permission-mode acceptEdits \
  --project-graph graphify
```

Or pass the full context packet to an explicitly managed stdio adapter:

```bash
npm run loopgraph -- run .loopgraph/loops.json \
  --adapter stdio \
  --adapter-command "node /absolute/path/to/adapter.mjs" \
  --project-graph graphify
```

The provider performs an on-device, code-only initial build or incremental
update of `graphify-out/graph.json`, queries scoped context for each loop, and
writes the full packet to `.loopgraph/context/<loop-id>.json`. Headless Claude
receives only bounded file, node, and community scope—not raw Graphify query
output. Stdio and interactive adapters receive the complete structured request,
so enable Graphify only for adapters you trust with repository-derived context.

LoopGraph disables Graphify's persistent query log for provider subprocesses.
Review `graphify-out/` before committing it; it is a source-derived project map.

### Test Graphify on a real project

From the target project's root:

```bash
# 1. Build LoopGraph from this repository and install Graphify.
npm ci
npm run build
uv tool install graphifyy

# 2. Confirm the project graph and LoopGraph input are valid.
graphify --version
npm run loopgraph -- validate .loopgraph/loops.json --project-root "$PWD"

# 3. Preview scheduling without executing workers or Graphify.
npm run loopgraph -- run .loopgraph/loops.json \
  --project-root "$PWD" \
  --adapter claude \
  --project-graph graphify \
  --dry-run

# 4. Run for real. This builds graphify-out/ on the first run and updates it later.
npm run loopgraph -- run .loopgraph/loops.json \
  --project-root "$PWD" \
  --adapter claude \
  --claude-permission-mode acceptEdits \
  --project-graph graphify
```

After the run, verify:

```bash
test -f graphify-out/graph.json
ls .loopgraph/context/*.json
node -e 'const s=require("./.loopgraph/state.json"); console.log(s.status)'
```

Expected results are a Graphify graph, one context packet per started loop,
normal loop results under `.loopgraph/results/`, and a terminal state. Use
`npm run loopgraph -- cancel --project-root "$PWD"` to test cancellation.

Cancel the active project run:

```bash
npm run loopgraph -- cancel
```

## Claude Code Plugin

The repository includes project-local Claude commands:

```text
/loop-graph <prompt-or-path>
/cancel-loop-graph
```

Load the plugin directly from the cloned repository:

```bash
npm run build:plugin
claude --plugin-dir ./claude-plugin
```

Then use:

```text
/graph-engineering-loop:loop-graph <prompt-or-path>
/graph-engineering-loop:cancel-loop-graph
```

Or install it through the Claude Code marketplace:

```text
/plugin marketplace add AnupDangi/Graph-Engineering-Loop
/plugin install graph-engineering-loop@graph-engineering-loop-marketplace
```

Claude Code plugins are namespaced by plugin name, so the skills are intentionally exposed as `/graph-engineering-loop:loop-graph` and `/graph-engineering-loop:cancel-loop-graph`.

The installed skill uses the active Claude Code session as the loop worker. A
background supervisor writes one request at a time under
`.loopgraph/bridge/`; the skill submits structured evidence back to the runtime.
This avoids recursive Claude Code launches. Direct CLI and CI usage can still
select `--adapter claude` to use headless `claude -p` workers.

Each graph node runs as a bounded Ralph-style loop in that session. When Claude
tries to stop while work is pending, the guarded Stop hook returns the same
active loop contract. The model keeps working from the current repository state;
the runtime verifies completion evidence and alone decides when dependencies
unlock the next loop. There is no new command and no text-only completion
promise. `maxIterations` remains the safety limit. This design follows the
[official Ralph Wiggum plugin](https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum),
but scopes repetition to one graph node at a time.

During any run, open `.loopgraph/status.md` to see the Mermaid dependency graph,
progress, active objective and tasks, current iteration, and blocked/waiting
loops. CLI completion output prints this path, and plugin work packets expose
both the Markdown view and `.loopgraph/status.json`.

## Generic Harness Adapter

Use `--adapter stdio` to connect any harness or custom script without changing the core runtime.

The adapter command receives one JSON object on stdin containing `type`, `adapterContext`, and the `LoopExecutionRequest`. It must write a `LoopExecutionResult` JSON object to stdout:

```json
{
  "status": "complete",
  "summary": "Implemented the loop objective.",
  "completedTasks": [],
  "remainingWork": [],
  "changedFiles": [],
  "commandsRun": [],
  "completionEvidence": [],
  "handoff": [],
  "blockedReason": null
}
```

See [examples/stdio-adapter.mjs](./examples/stdio-adapter.mjs).

The adapter command runs with `cwd` set to the target project root. Use an absolute path for the wrapper script when invoking a script outside that project.

## `loops.json`

Example:

```json
{
  "$schema": "https://loopgraph.dev/schemas/loops.v1.json",
  "version": 1,
  "name": "fake-vertical-slice",
  "goal": "Demonstrate dependency-aware loop scheduling.",
  "defaults": {
    "maxIterations": 3,
    "maxConcurrentLoops": 2
  },
  "loops": [
    {
      "id": "foundation",
      "objective": "Create the foundation artifact.",
      "dependsOn": [],
      "completionConditions": [
        {
          "type": "fileExists",
          "path": "tmp/foundation.txt"
        }
      ]
    }
  ]
}
```

Required graph fields:

- `version`
- `name`
- `goal`
- `loops`

Required loop fields:

- `id`
- `objective`
- `dependsOn`
- `completionConditions`

## Completion Conditions

Supported in version 1:

- `command`
- `fileExists`
- `fileContains`
- `assertion`
- `all`

The core independently evaluates deterministic conditions. Assertion conditions require concrete adapter evidence.

## Durable State

Runtime files:

```text
.loopgraph/
  loops.json
  context/
    <loop-id>.json
  state.json
  status.json
  status.md
  lock.json
  events.jsonl
  results/
    <loop-id>.json
    <loop-id>.md
```

Commit `.loopgraph/loops.json` when it represents shared project intent. Do not commit mutable runtime files.
Treat `graphify-out/` as source-derived data and review it before deciding to commit it.

## Current Limitations

- Resume invalidation is minimal.
- A killed interactive supervisor does not yet rehydrate an interrupted loop; durable state and the outstanding bridge packet remain for diagnosis.
- The headless Claude adapter runs loops sequentially for safety.
- The stdio adapter runs loops sequentially because arbitrary harness commands may not be repository-concurrency safe.
- Prompt-to-graph compilation is Claude-backed only when `--adapter claude` is selected; fake/stdio keep a deterministic fallback template.
- No automatic Git worktree isolation or merge handling yet.
- No supported npm/NPX package is currently available; run the CLI from this repository.

## References

- [Claude Code plugin docs](https://code.claude.com/docs/en/plugins)
- [Claude Code headless docs](https://code.claude.com/docs/en/headless)
- [Claude Code plugin marketplace docs](https://code.claude.com/docs/en/plugin-marketplaces)
