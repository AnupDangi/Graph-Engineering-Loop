# Graph Engineering Loop Claude Code Plugin

This plugin exposes Graph Engineering Loop to Claude Code as namespaced skills:

```text
/graph-engineering-loop:loop-graph <prompt-or-path>
/graph-engineering-loop:cancel-loop-graph
```

The plugin is self-contained. Its `vendor/` directory contains the built CLI and
core runtime, so marketplace installation does not require npm publication or a
global `loopgraph` binary.

For local testing:

```bash
npm run build:plugin
claude --plugin-dir ./claude-plugin
```

The loop skill uses the current Claude Code session as the worker:

1. It creates or loads `.loopgraph/loops.json`.
2. The bundled supervisor starts with `--adapter interactive`.
3. The runtime publishes one work packet under `.loopgraph/bridge/`.
4. The active session implements the loop and submits structured evidence.
5. The runtime evaluates completion, persists results, and unlocks dependencies.

No nested `claude -p` process is started by the plugin. The separate headless
adapter remains available for direct CLI and CI use.

Graphify context is currently a standalone CLI opt-in. The plugin's simple
`/loop-graph` interface does not automatically install or enable Graphify. To
test Graphify with Claude headless, run the packaged CLI directly with
`--adapter claude --project-graph graphify`; see the repository README for the
full project test flow. This keeps plugin execution free of unexpected external
tool installation and indexing.

Lifecycle hooks add concise active-run context on session start and give Claude
one guarded continuation when it tries to stop with a work packet still pending.
They never restart or replay the graph.

Verification:

```bash
npm run smoke:plugin
npm run smoke:plugin:claude
```

`smoke:plugin` validates and runs an isolated copy, including hooks and
cancellation. `smoke:plugin:claude` invokes the real namespaced skill, requires
Claude Code authentication, may use credits, and is capped at `$2.00`.
