# Graph Engineering Loop

Graph Engineering Loop is a portable runtime for dependency-aware, completion-driven software workstreams.
<img width="1536" height="1024" alt="image" src="https://github.com/user-attachments/assets/5d1d6201-ba51-48f8-9eb3-88c77ecff075" />

It turns a `loops.json` graph, requirements file, or prompt into durable loop execution state under `.loopgraph/`. Each loop is a substantial workstream that can use a harness adapter, run commands, touch multiple files, iterate, and complete only when its completion conditions are verified.

The core format and runtime are harness-neutral. The first real harness target is Claude Code, with a deterministic fake adapter for local testing.

## Status

This is an early `0.2.2` implementation. It includes:

- Version 1 graph validation.
- Deterministic dependency scheduling.
- Completion evaluators for commands, file existence, file contents, assertions, and aggregate `all`.
- Atomic `.loopgraph/state.json` writes.
- `.loopgraph/lock.json`, `.loopgraph/events.jsonl`, and `.loopgraph/results/`.
- Generated live `.loopgraph/status.md` graph visualization and `.loopgraph/status.json` status API.
- CLI commands: `run`, `cancel`, and `validate`.
- Fake adapter for real local smoke tests.
- Claude Code headless adapter using `claude -p`.
- Claude Code interactive adapter that delegates loop work to the active session without nested Claude processes.
- Generic stdio adapter for any harness wrapper that can read JSON from stdin and write JSON to stdout.
- Self-contained Claude Code plugin with a vendored runtime, lifecycle hooks, and marketplace metadata.
- Optional project-graph context providers with durable per-loop context packets.

Readiness today:

- Core runtime, fake adapter, and stdio adapter are covered by automated tests.
- Claude adapter is locally smoke-verified with `npm run smoke:claude`.
- The plugin artifact is tested from an isolated temp copy with `npm run smoke:plugin`; it does not require an npm package or global `loopgraph`.
- The optional real namespaced-skill check is `npm run smoke:plugin:claude` and requires Claude Code authentication.
- npm/NPX releases are verified from a clean temporary directory with `npm run smoke:npx`.

## Install

```bash
npm install -g graph-engineering-loop
```

Or run through NPX:

```bash
npx graph-engineering-loop run examples/fake/loops.json --adapter fake
```

Do not install `graph-engineering-loop-repo` or the monorepo workspace name. Those are not the CLI.

During local development:

```bash
npm install
npm test
npm run typecheck
npm run build
npm run smoke:fake
npm run smoke:plugin
```

## Publishing

Pushes to `main` run CI only. Publishing happens when you push a version tag:

```bash
git tag v0.2.2
git push origin v0.2.2
```

That publishes `graph-engineering-loop-core` then `graph-engineering-loop` to npmjs, and creates a GitHub Release with Claude plugin install notes.  
One-time setup: add an `NPM_TOKEN` repo secret. Full checklist: [PUBLISHING.md](./PUBLISHING.md).

To test the real Claude adapter locally:

```bash
npm run smoke:claude
```

This creates a fresh temp project, invokes Claude Code headless mode, may use Claude API credits, is capped at `$1.00`, and verifies that Claude creates `tmp/claude-smoke.txt`.

## Quick Start

Validate a graph:

```bash
npx graph-engineering-loop validate examples/fake/loops.json
```

Run the fake vertical slice:

```bash
npx graph-engineering-loop run examples/fake/loops.json --adapter fake
```

Run with Claude Code headless:

```bash
npx graph-engineering-loop run .loopgraph/loops.json --adapter claude --claude-permission-mode acceptEdits
```

Run with a generic external harness command:

```bash
npx graph-engineering-loop run examples/fake/loops.json \
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
npx graph-engineering-loop run .loopgraph/loops.json \
  --adapter claude \
  --claude-permission-mode acceptEdits \
  --project-graph graphify
```

Or pass the full context packet to an explicitly managed stdio adapter:

```bash
npx graph-engineering-loop run .loopgraph/loops.json \
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
# 1. Install both CLIs.
npm install -g graph-engineering-loop
uv tool install graphifyy

# 2. Confirm the project graph and LoopGraph input are valid.
graphify --version
graph-engineering-loop validate .loopgraph/loops.json --project-root "$PWD"

# 3. Preview scheduling without executing workers or Graphify.
graph-engineering-loop run .loopgraph/loops.json \
  --project-root "$PWD" \
  --adapter claude \
  --project-graph graphify \
  --dry-run

# 4. Run for real. This builds graphify-out/ on the first run and updates it later.
graph-engineering-loop run .loopgraph/loops.json \
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
`graph-engineering-loop cancel --project-root "$PWD"` to test cancellation.

Cancel the active project run:

```bash
npx graph-engineering-loop cancel
```

## Claude Code Plugin

This repo also includes project-local Claude commands for development:

```text
/loop-graph <prompt-or-path>
/cancel-loop-graph
```

For local plugin testing:

```bash
npm run build:plugin
claude --plugin-dir ./claude-plugin
```

Then use:

```text
/graph-engineering-loop:loop-graph <prompt-or-path>
/graph-engineering-loop:cancel-loop-graph
```

For GitHub marketplace installation after this repository is pushed:

```text
/plugin marketplace add AnupDangi/Graph-Engineering-Loop
/plugin install graph-engineering-loop@graph-engineering-loop-marketplace
```

Claude Code plugins are namespaced by plugin name, so the skills are intentionally exposed as `/graph-engineering-loop:loop-graph` and `/graph-engineering-loop:cancel-loop-graph`.

The installed skill uses the active Claude Code session as the loop worker. A
background supervisor publishes one request at a time under
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

Release checks:

```bash
npm run smoke:plugin
npm run smoke:plugin:claude
```

The first command is deterministic and verifies an isolated, self-contained
plugin plus hooks and cancellation. The second invokes the real namespaced skill,
may use Claude credits, and is capped at `$2.00`.

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

## Package Names

The initial intended npm packages are:

- `graph-engineering-loop`
- `graph-engineering-loop-core`

The CLI package depends on the core package, so most users install only `graph-engineering-loop`.

Confirm these package names before publishing if you prefer scoped names.

GitHub Packages requires scoped npm package names. See [GITHUB_PACKAGES.md](./GITHUB_PACKAGES.md) before publishing there.

## Current Limitations

- Resume invalidation is minimal.
- A killed interactive supervisor does not yet rehydrate an interrupted loop; durable state and the outstanding bridge packet remain for diagnosis.
- The headless Claude adapter runs loops sequentially for safety.
- The stdio adapter runs loops sequentially because arbitrary harness commands may not be repository-concurrency safe.
- Prompt-to-graph compilation is Claude-backed only when `--adapter claude` is selected; fake/stdio keep a deterministic fallback template.
- No automatic Git worktree isolation or merge handling yet.
- Registry install remains unverified until the first `v*` tag Release workflow publishes successfully with `NPM_TOKEN` configured.

## References

- [Claude Code plugin docs](https://code.claude.com/docs/en/plugins)
- [Claude Code headless docs](https://code.claude.com/docs/en/headless)
- [Claude Code plugin marketplace docs](https://code.claude.com/docs/en/plugin-marketplaces)
