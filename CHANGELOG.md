# Changelog

## 0.2.1

- Added an opt-in, harness-neutral project graph provider boundary.
- Added a Graphify CLI provider with code-only preflight, incremental updates, scoped loop queries, cancellation, path containment, and disabled query logging.
- Added durable per-loop graph context packets under `.loopgraph/context/`.
- Added bounded graph-derived file/node/community scope to headless Claude prompts while omitting raw query output.
- Repaired the npm release after `0.2.0` accidentally published the monorepo root without a CLI executable.
- Restored a private, non-publishable workspace root.
- Added production `--help` and `--version` CLI entry points.
- Added clean-directory registry installation checks to the release workflow.
- Publish `graph-engineering-loop-core` before the dependent `graph-engineering-loop` CLI.

## 0.2.0

- Fixed package naming: only `graph-engineering-loop` / `graph-engineering-loop-core` publish; monorepo root is private and never published.
- Added GitHub Actions CI and tag-triggered npm + Claude plugin release workflow.
- Made the Claude Code plugin self-contained with a vendored CLI/core runtime.
- Added a file-backed interactive adapter so the active Claude Code session executes loops without nested `claude -p` processes.
- Added the plugin bridge contract for starting runs, receiving work packets, submitting structured evidence, and reading status.
- Updated plugin skills to use `${CLAUDE_PLUGIN_ROOT}` and an explicit project root.
- Added `SessionStart` and guarded `Stop` hooks for active-run recovery.
- Added isolated plugin smoke coverage for validation, execution, hooks, persistence, and cancellation.
- Added an optional real namespaced-skill smoke with a `$2.00` budget cap.

## 0.1.0

- Initial LoopGraph runtime package.
- Added version 1 `loops.json` validation.
- Added deterministic dependency scheduler.
- Added completion checks for commands, file existence, file contents, assertions, and aggregate `all` conditions.
- Added `.loopgraph/` state, lock, event, and result persistence.
- Added CLI commands: `run`, `cancel`, and `validate`.
- Added fake adapter for local and automated testing.
- Added Claude Code headless adapter using `claude -p`.
- Added Claude-backed prompt-to-graph compilation for `--adapter claude`.
- Added fresh-temp-project real Claude smoke runner and `npm run smoke:claude`.
- Made Claude plugin bin local-first before npm fallback.
- Added generic stdio adapter for custom harness wrappers.
- Added Claude Code plugin and marketplace skeleton.
- Added GitHub Packages setup notes and safe scoped registry mapping.
