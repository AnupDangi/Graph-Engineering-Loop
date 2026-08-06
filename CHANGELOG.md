# Changelog

## 0.2.4

- Clearer CLI errors for missing spaces (`validate.loopgraph/...`) and missing `.loopgraph/loops.json`.
- Treat sentence prompts that mention `.txt`/`.md` as prompts, not missing paths.
- Keep `.loopgraph/` path resolution scoped to `--project-root`.
- Added Cursor `/loop-graph` command docs.


## 0.2.3

- Made the existing npm package `graph-engineering-loop-workspace` the real CLI (with `bin` entry points).
- Renamed the private monorepo root to `gel-monorepo` so it never collides with the published CLI name.
- Kept companion commands `graph-engineering-loop` and `loopgraph` on the same package.
- Publish order remains `graph-engineering-loop-core` then `graph-engineering-loop-workspace`.

## 0.2.2

- Added an opt-in, harness-neutral project graph provider boundary.
- Added a Graphify CLI provider with code-only preflight, incremental updates, scoped loop queries, cancellation, path containment, and disabled query logging.
- Added durable per-loop graph context packets under `.loopgraph/context/`.
- Added bounded graph-derived file/node/community scope to headless Claude prompts while omitting raw query output.
- Made every interactive Claude graph node a guarded, bounded Ralph-style continuation loop while keeping dependency advancement in the runtime.
- Added atomic `.loopgraph/status.json` and visual `.loopgraph/status.md` projections with live loop, iteration, progress, and Mermaid DAG state.
- Expanded isolated plugin smoke coverage for repeated Stop-hook contracts, recursion guards, incomplete iterations, graph-controlled transitions, status visuals, and cancellation.
- Added an npm publisher authentication preflight and provenance attestations to release publishing.

## 0.2.1

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
