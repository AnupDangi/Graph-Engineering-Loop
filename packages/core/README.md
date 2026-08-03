# graph-engineering-loop-core

Harness-neutral core runtime for Graph Engineering Loop.

This package contains graph validation, completion evaluation, deterministic scheduling, and durable `.loopgraph/` file persistence.

Persistence hooks atomically project every runtime transition to
`.loopgraph/status.json` and a human-readable `.loopgraph/status.md` containing
a Mermaid dependency graph, progress, active work, and iteration state.

It also exports the optional `ProjectGraphProvider` boundary. A provider can
perform project-graph preflight and return bounded `ProjectGraphContext` for a
loop. `GraphRuntime` passes that context to the harness adapter and persistence
hooks can store it under `.loopgraph/context/`. The core does not depend on
Graphify or any other graph implementation.

Provider refresh and query calls receive the run's `AbortSignal`; implementations
should stop subprocesses promptly and keep `shutdown()` safe after successful
initialization.

Most users should install the CLI package:

```bash
npm install -g graph-engineering-loop
```
