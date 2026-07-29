# Agent Instructions

## Source of Truth

Read `PROJECT_DOCS.md` before making implementation decisions. It is the durable project brief for LoopGraph and should stay in sync with meaningful architectural or behavior changes.

Keep this file short. Do not duplicate the full project specification here.

## Project Goal

Build LoopGraph: a portable, completion-driven loop graph runtime that coordinates durable workstreams across coding harnesses.

Version 0.1 targets:

- TypeScript core runtime.
- Node.js CLI and NPX package.
- Claude Code adapter and plugin.
- Fake adapter for automated runtime tests.
- Harness-neutral adapter interface for future Codex, Cursor, OpenCode, and other adapters.

## Core Rules

- The graph coordinates loops, not individual agents.
- A loop may use multiple agents, subagents, tools, files, commands, and iterations.
- Public interface stays simple: `run` and `cancel` for CLI, `/loop-graph` and `/cancel-loop-graph` for Claude Code.
- Keep the core harness-neutral. Claude-specific behavior belongs only in the Claude adapter/plugin.
- Durable runtime state belongs in `.loopgraph/`, not in conversation context.
- Do not store mutable runtime state in `.loopgraph/loops.json`.
- Completion requires structured evidence. Do not accept unsupported agent claims.
- Scheduler behavior must be deterministic.
- Use atomic writes for state.
- Respect permissions and never bypass the active harness approval system.
- Do not commit secrets, `.env` content, tokens, credentials, or private keys into docs, logs, state, prompts, or tests.

## Implementation Order

Follow the implementation sequence in `PROJECT_DOCS.md`:

1. Core schema.
2. State and event persistence.
3. Scheduler.
4. Loop runtime.
5. CLI.
6. Claude Code adapter.
7. Graph compilation.
8. Documentation and release.

Prefer a functioning vertical slice over broad scaffolding.

## Engineering Defaults

- Use strict TypeScript.
- Prefer small, typed modules with explicit runtime validation.
- Use dependency injection for adapters and storage.
- Keep pure graph and scheduler logic easy to unit test.
- Use a fake adapter for normal automated tests.
- Avoid paid model calls in unit tests.
- Keep generated context minimal.
- Prefer mature, lightweight libraries only when they reduce risk.

## Documentation Expectations

When behavior, architecture, file layout, CLI usage, or adapter contracts change materially, update `PROJECT_DOCS.md` and later `README.md`.

Do not create a second parallel documentation tree. If future Claude-specific guidance is needed, add a thin `CLAUDE.md` that points back to this file and `PROJECT_DOCS.md`.
