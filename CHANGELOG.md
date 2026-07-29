# Changelog

## 0.1.0

- Initial LoopGraph runtime package.
- Added version 1 `loops.json` validation.
- Added deterministic dependency scheduler.
- Added completion checks for commands, file existence, file contents, assertions, and aggregate `all` conditions.
- Added `.loopgraph/` state, lock, event, and result persistence.
- Added CLI commands: `run`, `cancel`, and `validate`.
- Added fake adapter for local and automated testing.
- Added Claude Code headless adapter using `claude -p`.
- Added generic stdio adapter for custom harness wrappers.
- Added Claude Code plugin and marketplace skeleton.
