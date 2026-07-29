# Graph Engineering Loop

Graph Engineering Loop is a portable runtime for dependency-aware, completion-driven software workstreams.
<img width="1536" height="1024" alt="image" src="https://github.com/user-attachments/assets/5d1d6201-ba51-48f8-9eb3-88c77ecff075" />

It turns a `loops.json` graph, requirements file, or prompt into durable loop execution state under `.loopgraph/`. Each loop is a substantial workstream that can use a harness adapter, run commands, touch multiple files, iterate, and complete only when its completion conditions are verified.

The core format and runtime are harness-neutral. The first real harness target is Claude Code, with a deterministic fake adapter for local testing.

## Status

This is an early `0.1.0` implementation. It includes:

- Version 1 graph validation.
- Deterministic dependency scheduling.
- Completion evaluators for commands, file existence, file contents, assertions, and aggregate `all`.
- Atomic `.loopgraph/state.json` writes.
- `.loopgraph/lock.json`, `.loopgraph/events.jsonl`, and `.loopgraph/results/`.
- CLI commands: `run`, `cancel`, and `validate`.
- Fake adapter for real local smoke tests.
- Claude Code headless adapter using `claude -p`.
- Generic stdio adapter for any harness wrapper that can read JSON from stdin and write JSON to stdout.
- Claude Code plugin and marketplace skeleton.

Readiness today:

- Core runtime, fake adapter, and stdio adapter are covered by automated tests.
- Claude adapter is locally smoke-verified with `npm run smoke:claude`.
- Claude plugin installation is local-first until the npm package is published.
- Marketplace/npm installation is not production-ready until a package is published and install is tested from the registry.

## Install

After npm publication:

```bash
npm install -g graph-engineering-loop
```

Or run through NPX:

```bash
npx graph-engineering-loop run examples/fake/loops.json --adapter fake
```

During local development:

```bash
npm install
npm test
npm run typecheck
npm run build
npm run smoke:fake
```

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
npm run build
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
  state.json
  lock.json
  events.jsonl
  results/
    <loop-id>.json
    <loop-id>.md
```

Commit `.loopgraph/loops.json` when it represents shared project intent. Do not commit mutable runtime files.

## Package Names

The initial intended npm packages are:

- `graph-engineering-loop`
- `graph-engineering-loop-core`

The CLI package depends on the core package, so most users install only `graph-engineering-loop`.

Confirm these package names before publishing if you prefer scoped names.

GitHub Packages requires scoped npm package names. See [GITHUB_PACKAGES.md](./GITHUB_PACKAGES.md) before publishing there.

## Current Limitations

- Resume invalidation is minimal.
- The Claude adapter uses headless CLI execution and runs loops sequentially for safety.
- The stdio adapter runs loops sequentially because arbitrary harness commands may not be repository-concurrency safe.
- Prompt-to-graph compilation is Claude-backed only when `--adapter claude` is selected; fake/stdio keep a deterministic fallback template.
- No automatic Git worktree isolation or merge handling yet.
- Registry install is unverified until `graph-engineering-loop` and `graph-engineering-loop-core` are published.

## References

- [Claude Code plugin docs](https://code.claude.com/docs/en/plugins)
- [Claude Code headless docs](https://code.claude.com/docs/en/headless)
- [Claude Code plugin marketplace docs](https://code.claude.com/docs/en/plugin-marketplaces)
