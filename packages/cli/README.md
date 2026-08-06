# graph-engineering-loop-workspace

CLI for Graph Engineering Loop. Install the package that already exists on npm:

```bash
npm install -g graph-engineering-loop-workspace
```

Commands after install:

```bash
graph-engineering-loop-workspace --help
graph-engineering-loop --help
loopgraph --help
```

```bash
npx graph-engineering-loop-workspace --help
npx graph-engineering-loop-workspace validate .loopgraph/loops.json
npx graph-engineering-loop-workspace run .loopgraph/loops.json --adapter claude --claude-permission-mode acceptEdits
npx graph-engineering-loop-workspace run .loopgraph/loops.json --adapter stdio --adapter-command "node /absolute/path/to/adapter.mjs"
npx graph-engineering-loop-workspace run .loopgraph/loops.json --adapter stdio --adapter-command "node /absolute/path/to/adapter.mjs" --project-graph graphify
npx graph-engineering-loop-workspace cancel
```

The graph path is resolved from the current directory. The package does not
install repository examples into your project, so supply your own graph or run
the examples from a clone of the repository.

Every real run generates `.loopgraph/status.md` and `.loopgraph/status.json`.
Open the Markdown file while the process runs to see the live dependency graph,
active objective/tasks, current iterations, and waiting or blocked loops. Normal
CLI completion output prints its path.

## Graphify project context

Install the optional Graphify CLI, then select it explicitly:

```bash
uv tool install graphifyy
npx graph-engineering-loop-workspace run .loopgraph/loops.json \
  --adapter claude \
  --claude-permission-mode acceptEdits \
  --project-graph graphify \
  --project-root "$PWD"
```

The first run performs local code-only extraction; later runs use Graphify's
incremental update command. Full packets are stored in
`.loopgraph/context/<loop-id>.json`. The built-in Claude prompt receives bounded
file/node/community scope and omits raw query content. Graphify query logging is
disabled for subprocesses launched by LoopGraph.

Options:

- `--graphify-path <path>` selects a non-default Graphify executable.
- `--graphify-graph <path>` queries an existing project-local snapshot without refreshing it.

Run `--dry-run` to validate and preview scheduling; Graphify preflight starts
only on a real run. Review `graphify-out/` before committing it.

Real Claude smoke test from the repo:

```bash
npm run smoke:claude
```

This creates a fresh temp project, invokes Claude Code with a `$1.00` max budget, and verifies that the adapter creates `tmp/claude-smoke.txt`.

The `interactive` adapter is the file-backed bridge used by the Claude Code
plugin. It waits for structured responses under `.loopgraph/bridge/`; normal
standalone users should select `fake`, `stdio`, or `claude`.

In the plugin, the current interactive packet repeats as a guarded Ralph-style
loop until runtime evidence passes or `maxIterations` is exhausted. The graph
scheduler alone advances to dependency-ready work; no additional public command
is introduced.

See the repository README for Claude Code plugin usage and `loops.json` details.
