# LoopGraph Project Docs

## Mission

LoopGraph is a lightweight, harness-neutral runtime for coordinating complex software-development work as a dependency graph of completion-driven loops.

The runtime converts a user goal, requirements document, planning file, or existing `loops.json` into a graph of substantial workstreams. Each loop can use one or more agents, subagents, tools, commands, edits, tests, and iterations. The graph coordinates loops, not individual agents.

Hierarchy:

```text
Loop graph
  -> Loop
      -> One or more agents
          -> Subagents, tools, commands and implementation steps
```

Do not equate one agent with one loop. A loop is a durable workstream that stops only when its completion conditions are verified or its iteration limit is reached.

## Product Principles

### Simple Externally

The first public interface should expose only two main operations:

```text
start a loop graph
cancel a loop graph
```

Claude Code interface:

```text
/loop-graph <prompt-or-path>
/cancel-loop-graph
```

Standalone CLI:

```bash
loopgraph run <prompt-or-path>
loopgraph cancel
```

Avoid exposing internal graph commands such as `add-node`, `connect-node`, `retry-node`, `start-node`, `pause-node`, `compile-node`, or `verify-node` as primary public operations.

### Powerful Internally

The runtime should internally:

1. Resolve configuration scope.
2. Read the project and supplied requirements.
3. Create or load `loops.json`.
4. Validate the dependency graph.
5. Identify runnable loops.
6. Run independent loops concurrently.
7. Persist progress.
8. Evaluate completion conditions.
9. Repeat incomplete loops.
10. Unlock dependent loops.
11. Finish when the full graph reaches a terminal state.

### Harness-Neutral Core

The core runtime must not directly depend on:

- Claude-specific agent APIs.
- Codex-specific prompts.
- Cursor-specific rules.
- Model names.
- One vendor's session format.
- One vendor's completion syntax.

Harness-specific behavior belongs behind adapters.

### Files Are Durable State

Do not rely on conversation context as the system of record. Runtime state must survive context compaction, process restart, model switching, terminal closure, agent replacement, and another harness resuming the work.

Minimum persistent runtime structure:

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

Only `.loopgraph/loops.json` should normally be authored or reviewed by users.

## Initial Target

Build version 0.1 as:

1. A reusable TypeScript core.
2. A Node.js CLI and NPX package.
3. A Claude Code plugin adapter.
4. A clean adapter interface for future Codex, Cursor, OpenCode, and other harness adapters.

Do not implement every adapter in the MVP. Claude Code is the first supported adapter.

Current package names:

- CLI package: `graph-engineering-loop`
- Core package: `graph-engineering-loop-core`

The CLI also exposes a compatibility binary named `loopgraph`.

## Recommended Repository Structure

Use a TypeScript monorepo or a clean single repository with equivalent boundaries:

```text
loopgraph/
  package.json
  tsconfig.json
  README.md
  LICENSE
  CHANGELOG.md
  packages/
    core/
      package.json
      src/
        schema/
        config/
        graph/
        runtime/
        compiler/
        adapters/
        errors/
        index.ts
    cli/
      package.json
      src/
        cli.ts
        commands/
        output/
    adapter-claude-code/
      package.json
      src/
        claude-adapter.ts
        prompt-builder.ts
        process-runner.ts
        result-parser.ts
        session-manager.ts
  claude-plugin/
    .claude-plugin/
      plugin.json
    skills/
      loop-graph/
        SKILL.md
      cancel-loop-graph/
        SKILL.md
    hooks/
      hooks.json
    bin/
      loopgraph
    scripts/
  examples/
  tests/
```

A simpler structure is acceptable if the architectural boundaries remain clear.

## Configuration Scopes

Supported scopes:

- Project graph: `<project-root>/.loopgraph/loops.json`
- Project defaults: `<project-root>/.loopgraph/config.json`
- Local project overrides: `<project-root>/.loopgraph/config.local.json`
- User/global config: `~/.loopgraph/config.json`
- User/global templates: `~/.loopgraph/templates/`
- Package defaults: `packages/core/defaults/config.json`

Configuration precedence, highest to lowest:

```text
CLI flags
-> local project configuration
-> project configuration
-> user/global configuration
-> package defaults
```

For `loops.json`, prefer an explicitly supplied path over automatic discovery.

Project-root detection should walk upward from the current working directory and check for markers such as `.git/`, `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, and `.loopgraph/`. Prefer the nearest Git root when one exists.

When the user runs `loopgraph run`, discover graph input in this order:

1. Explicit `--file`.
2. `<project-root>/.loopgraph/loops.json`.
3. `<project-root>/loops.json`.
4. Supplied prompt.
5. Supplied planning or requirements file.
6. Otherwise return a clear input error.

Never silently invent a graph when no requirements were supplied.

## `loops.json` Version 1

Required graph fields:

```text
version
name
goal
loops
```

Required loop fields:

```text
id
objective
dependsOn
completionConditions
```

Optional loop fields:

```text
title
tasks
sources
maxIterations
metadata
```

Minimal example:

```json
{
  "$schema": "https://loopgraph.dev/schemas/loops.v1.json",
  "version": 1,
  "name": "auth-dashboard",
  "goal": "Add secure authentication and an administration dashboard.",
  "defaults": {
    "maxIterations": 4,
    "maxConcurrentLoops": 2
  },
  "loops": [
    {
      "id": "foundation",
      "title": "Architecture and contracts",
      "objective": "Inspect the project and establish shared contracts.",
      "tasks": [
        "Inspect the existing architecture",
        "Define shared user and session types"
      ],
      "sources": [
        "README.md",
        "package.json"
      ],
      "dependsOn": [],
      "completionConditions": [
        {
          "type": "command",
          "command": "npm run typecheck",
          "expectExitCode": 0
        },
        {
          "type": "assertion",
          "description": "Shared contracts are clearly represented in project files."
        }
      ],
      "maxIterations": 3
    }
  ]
}
```

Tasks are advisory. Scheduling and completion are based on loops and completion conditions, not task strings.

Iteration semantics:

```text
Run until completion.
Stop early when completion is verified.
Never exceed maxIterations.
```

`maxIterations` fallback:

```text
loop.maxIterations
-> graph.defaults.maxIterations
-> package default of 4
```

`maxConcurrentLoops` fallback:

```text
CLI override
-> graph default
-> project configuration
-> user configuration
-> package default of 2
```

## Completion Conditions

Version 1 condition types:

```json
{ "type": "command", "command": "npm test", "expectExitCode": 0 }
```

```json
{ "type": "fileExists", "path": "src/auth/session.ts" }
```

```json
{ "type": "fileContains", "path": "README.md", "text": "Authentication" }
```

```json
{ "type": "assertion", "description": "The login flow works end to end." }
```

```json
{
  "type": "all",
  "conditions": [
    { "type": "command", "command": "npm run typecheck", "expectExitCode": 0 },
    { "type": "command", "command": "npm test", "expectExitCode": 0 }
  ]
}
```

The top-level completion list may be treated as implicit `all`.

Every completion condition must produce evidence. Do not trust a plain agent claim such as "everything works." Assertion evidence must include concrete files, commands, observed behavior, or verifier output.

## Runtime State

Mutable runtime fields must not be stored in `loops.json`.

Store state in `.loopgraph/state.json` with graph-level status, run ID, graph hash, timestamps, and per-loop state.

Loop statuses:

```text
waiting
ready
running
completed
blocked
failed
cancelled
```

Graph statuses:

```text
pending
running
completed
completed_with_blocks
failed
cancelled
```

All state writes must be atomic:

1. Write to a temporary file.
2. Flush.
3. Rename over the existing file.

Append structured runtime events to `.loopgraph/events.jsonl` for debugging, recovery, audits, scheduler tracing, and future visualizations.

## Graph Validation

Before execution, validate:

1. JSON parses successfully.
2. Schema version is supported.
3. Every loop ID is unique.
4. IDs match `^[a-z][a-z0-9-]{0,63}$`.
5. Every dependency references an existing loop.
6. A loop cannot depend on itself.
7. The dependency graph is acyclic.
8. At least one root loop exists.
9. At least one terminal loop exists.
10. `maxIterations` is a positive integer.
11. `maxConcurrentLoops` is a positive integer.
12. Completion conditions are not empty.
13. Referenced source paths remain inside allowed project boundaries by default.
14. Commands are strings and are not executed during validation.

Use deterministic DAG cycle detection and return useful errors, including the cycle path when possible.

## Scheduler

Readiness rule:

```text
ready: all dependsOn loops are completed
waiting: one or more dependencies are pending, ready, or running
blocked: a required dependency is blocked, failed, or cancelled
```

Scheduling must be deterministic:

```ts
while (!graphIsTerminal()) {
  refreshLoopStatuses();
  const readyLoops = getReadyLoops();
  const capacity = maxConcurrentLoops - runningLoopCount();

  for (const loop of stableSort(readyLoops).slice(0, capacity)) {
    startLoop(loop);
  }

  await nextRuntimeEvent();
}
```

Use stable ordering based on order in `loops.json`. Do not use random scheduling.

Independent loops may run simultaneously up to `maxConcurrentLoops`. Version 1 does not require automatic Git merging or mandatory worktrees. Add an adapter capability flag for future isolation:

```ts
supportsIsolatedWorktrees: boolean;
```

## Loop Runtime

One loop iteration means:

```text
Load loop contract
-> load dependency results
-> inspect current project state
-> plan remaining work
-> use agents and subagents as needed
-> implement and test
-> evaluate completion conditions
-> write iteration result
-> complete or continue
```

An iteration is not one task, one file change, one command, one agent call, or one conversation response.

Each adapter must provide the harness with:

- Graph goal.
- Loop objective.
- Loop tasks.
- Source files.
- Dependency outputs.
- Current iteration and maximum iterations.
- Previous iteration result.
- Completion conditions.
- Project root.
- Rules for completion evidence.

The adapter output contract should include:

- `status`: `complete`, `incomplete`, `blocked`, or `failed`.
- Summary.
- Completed tasks.
- Remaining work.
- Changed files.
- Commands run.
- Completion evidence.
- Handoff.
- Blocked reason.

The core runtime must independently evaluate deterministic completion conditions before accepting a loop as complete.

When maximum iterations are exhausted and completion is not verified, mark the loop `blocked` by default and preserve failed conditions, attempts, and remaining work.

## Dependency Handoff

When a loop completes, write:

```text
.loopgraph/results/<loop-id>.json
.loopgraph/results/<loop-id>.md
```

Pass only relevant summaries, contracts, artifact paths, completion evidence, and handoff notes to dependent loops. Do not inject full transcripts from dependency loops.

## Source Input and Graph Compilation

The user may provide:

- Natural-language prompt.
- Markdown plan.
- JSON file.
- PRD.
- Phases file.
- Task file.
- Directory of specifications.
- Existing `loops.json`.

If input parses as valid LoopGraph JSON, validate and run it. If input is requirements, compile it into a graph.

The graph compiler should create:

- 2 to 6 substantial loops by default.
- Coherent workstream boundaries.
- Dependency relationships.
- Explicit completion conditions.
- Sensible iteration limits.
- One final verification/integration loop when appropriate.

Do not create one loop per bullet point. Do not create loops too broad to verify.

Generated graphs must be saved to `.loopgraph/loops.json` unless the user explicitly requests a different output path.

The core runtime must not require an LLM. Graph compilation from unstructured requirements may use the active harness through an adapter method.

## Adapter Interface

Core adapter contract:

```ts
export interface HarnessAdapter {
  readonly name: string;
  readonly capabilities: HarnessCapabilities;

  initialize(context: AdapterInitializationContext): Promise<void>;

  compileGraph?(
    input: GraphCompilationInput
  ): Promise<LoopGraph>;

  executeLoop(
    request: LoopExecutionRequest,
    signal: AbortSignal
  ): Promise<LoopExecutionResult>;

  cancelLoop?(loopId: string): Promise<void>;

  shutdown(): Promise<void>;
}
```

Capabilities:

```ts
export interface HarnessCapabilities {
  supportsParallelLoops: boolean;
  supportsSubagents: boolean;
  supportsResume: boolean;
  supportsStructuredOutput: boolean;
  supportsIsolatedWorktrees: boolean;
}
```

The scheduler must adapt to capabilities. If `supportsParallelLoops` is false, run ready loops sequentially without changing graph semantics.

## Claude Code Adapter

For project-local development, `.claude/commands/` should provide short commands:

```text
/loop-graph
/cancel-loop-graph
```

For installed Claude Code plugins, skills are namespaced by plugin name and should provide:

```text
/graph-engineering-loop:loop-graph
/graph-engineering-loop:cancel-loop-graph
```

The plugin skill should invoke the bundled `loopgraph` executable. It must not reimplement the scheduler in Markdown.

Use this layout:

```text
claude-plugin/
  .claude-plugin/
    plugin.json
  skills/
    loop-graph/
      SKILL.md
    cancel-loop-graph/
      SKILL.md
  hooks/
    hooks.json
  bin/
    loopgraph
  scripts/
```

Do not attach a global Stop hook that blindly repeats the whole graph prompt. The runtime owns graph progression. Hooks may preserve state, add small resume context, or handle cancellation, but only after checking whether an active run exists.

The first implementation should use the simplest reliable Claude Code execution mechanism available:

- One LoopGraph supervisor process.
- One execution request per active loop.
- Parallel execution only where the environment safely supports it.
- Persisted loop output after every iteration.

Do not build a distributed daemon in version 0.1.

## CLI and Exit Codes

Package target:

```bash
npx graph-engineering-loop run @PLAN.md
npx graph-engineering-loop run "Build authentication and a dashboard"
npx graph-engineering-loop run .loopgraph/loops.json
npx graph-engineering-loop cancel
npx graph-engineering-loop validate .loopgraph/loops.json
```

Primary public operations are `run` and `cancel`. `validate` and `inspect` may exist as supporting utilities.

Practical flags:

```text
--file <path>
--max-concurrency <number>
--adapter <name>
--project-root <path>
--dry-run
--json
```

Exit codes:

```text
0 graph completed
1 validation or runtime failure
2 graph completed with blocked loops
3 cancelled
4 invalid arguments
```

## Locking, Cancellation, and Resume

Use `.loopgraph/lock.json` to prevent two supervisors from controlling the same project at once.

Cancellation must:

1. Load the active run.
2. Send cancellation through `AbortController`.
3. Call adapter cancellation when supported.
4. Mark active loops cancelled.
5. Mark the graph cancelled.
6. Preserve partial results.
7. Remove the active lock safely.

Cancellation must be idempotent.

Resume behavior:

- If `run` finds non-terminal state, no live lock, and matching graph hash, resume incomplete loops.
- Do not rerun completed loops unless the graph or dependency results changed materially.
- If `loops.json` changed, compare graph hashes and explain what was invalidated.
- A simpler full reset is acceptable early if clearly documented, but state must never silently mismatch the graph.

## Security

Path safety:

- Resolve source, result, and condition paths against the project root.
- Reject traversal outside the project unless explicitly allowed by configuration.

Command execution:

- Display commands in interactive mode.
- Respect the active harness permission system.
- Never bypass permissions.
- Capture output safely.
- Apply output-size limits.
- Prefer process arguments over concatenated shell strings.

Secrets:

- Do not copy `.env`, credentials, API keys, tokens, or private keys into logs, state, results, or prompts.
- Add redaction for common secret patterns.

Recommended `.gitignore` entries:

```gitignore
.loopgraph/state.json
.loopgraph/lock.json
.loopgraph/events.jsonl
.loopgraph/results/
```

Users may commit:

```text
.loopgraph/loops.json
.loopgraph/config.json
```

## Tests

Required coverage:

- Schema validation, duplicate IDs, invalid IDs, missing dependencies, self-dependencies, cycles, invalid iterations, invalid completion conditions, and empty graphs.
- Scheduler chains, parallel roots, diamond dependencies, concurrency limits, dependency blocking, cancellation, and iteration exhaustion.
- Atomic writes, corrupted state recovery, stale locks, resume, graph hash mismatch, and idempotent cancellation.
- Fake adapter tests for the full runtime without invoking Claude Code.
- Integration test where one loop creates a file, a command verifies it, and a dependent loop unlocks.
- Optional Claude adapter smoke test for plugin discovery, `/loop-graph`, graph generation, dependency unlock, cancellation, and persisted results.

Do not require paid model calls for normal unit tests.

## Version 0.1 Non-Goals

Do not implement:

- Graphical graph editor.
- Web dashboard.
- Distributed workers.
- Cloud execution.
- Automatic Git merging.
- Mandatory Git worktrees.
- Model routing.
- Token-budget optimization.
- Custom agent framework.
- Complex workflow language.
- Priorities and dynamic edge rewriting.
- Arbitrary conditional branches.
- Retries beyond loop iterations.
- Remote databases.
- Dozens of slash commands.

Keep the MVP focused.

## Acceptance Criteria

The MVP is complete when:

1. A valid `loops.json` can be loaded and validated.
2. Cyclic and missing dependencies are rejected clearly.
3. Independent loops are scheduled concurrently up to the configured limit.
4. Dependent loops wait for prerequisites.
5. Each loop can execute multiple iterations.
6. A loop finishes early when all completion conditions pass.
7. A loop becomes blocked when its iteration limit is exhausted.
8. Dependency results are passed to downstream loops.
9. Runtime state survives interruption.
10. A stale run can be resumed safely.
11. Cancellation preserves partial work.
12. Project and user configuration scopes resolve correctly.
13. The core runs using a fake adapter without Claude Code.
14. Claude Code can invoke the runtime through `/loop-graph`.
15. Claude Code can cancel it through `/cancel-loop-graph`.
16. The package can run through NPX.
17. Unit and integration tests pass.
18. Documentation contains a complete working example.

## Implementation Sequence

### Phase 1: Core Schema

- Define TypeScript types.
- Define JSON Schema.
- Implement parsing and validation.
- Implement cycle detection.
- Add unit tests.

### Phase 2: State and Event Persistence

- Implement project-root discovery.
- Implement scope resolution.
- Implement atomic state storage.
- Implement lock management.
- Implement append-only events.
- Add recovery tests.

### Phase 3: Scheduler

- Implement loop readiness.
- Implement concurrency limits.
- Implement dependency blocking.
- Implement terminal graph evaluation.
- Test with a fake adapter.

### Phase 4: Loop Runtime

- Implement iteration lifecycle.
- Implement completion evaluators.
- Implement result persistence.
- Implement iteration exhaustion.
- Add integration tests.

### Phase 5: CLI

- Implement `run`.
- Implement `cancel`.
- Add supporting `validate` and `inspect`.
- Add human and JSON output.
- Configure NPX executable.

### Phase 6: Claude Code Adapter

- Implement prompt generation.
- Implement loop execution.
- Implement structured result parsing.
- Add plugin skills.
- Add only necessary lifecycle hooks.
- Test project and user installation scopes.

### Phase 7: Graph Compilation

- Accept plain prompts and requirement files.
- Ask the Claude adapter to create `loops.json`.
- Validate generated output.
- Repair invalid generated graphs once.
- Save the final graph.
- Run it.

### Phase 8: Documentation and Release

- Write README.
- Add examples.
- Add migration/version notes.
- Add MIT license.
- Publish version `0.1.0`.
- Test installation in a clean sample repository.

## Engineering Quality Requirements

Use:

- Strict TypeScript.
- Explicit runtime validation.
- Typed errors.
- Dependency injection for adapters and storage.
- No hidden global mutable state.
- Atomic filesystem writes.
- Abort signals for cancellation.
- Deterministic scheduler behavior.
- Testable pure functions where possible.
- Clear logging boundaries.
- No swallowed exceptions.
- Cross-platform path handling.
- Windows, macOS, and Linux compatibility.

Prefer mature, lightweight libraries only where they clearly reduce risk:

```text
zod or ajv for schema validation
commander or cac for CLI parsing
execa for safe process execution
vitest for tests
p-limit for bounded concurrency
```

Do not add a heavy workflow framework.

## Final Delivery Expectations

At the end of implementation, provide:

1. Completed repository.
2. Final directory tree.
3. Architectural summary.
4. Local development commands.
5. Test commands.
6. Claude Code plugin installation instructions.
7. NPX usage instructions.
8. One working example.
9. Known limitations.
10. Next recommended milestone.

Do not stop after scaffolding. Implement a functioning vertical slice where this graph shape runs through the fake adapter in automated tests and through the Claude Code adapter in a documented smoke test:

```text
foundation
  -> backend
  -> frontend
      -> integration
```
