# graph-engineering-loop

CLI for Graph Engineering Loop.

```bash
npx graph-engineering-loop validate examples/fake/loops.json
npx graph-engineering-loop run examples/fake/loops.json --adapter fake
npx graph-engineering-loop run .loopgraph/loops.json --adapter claude --claude-permission-mode acceptEdits
npx graph-engineering-loop run .loopgraph/loops.json --adapter interactive
npx graph-engineering-loop run examples/fake/loops.json --adapter stdio --adapter-command "node examples/stdio-adapter.mjs"
npx graph-engineering-loop run .loopgraph/loops.json --adapter stdio --adapter-command "node /absolute/path/to/adapter.mjs" --project-graph graphify
npx graph-engineering-loop cancel
```

## Graphify project context

Install the optional Graphify CLI, then select it explicitly:

```bash
uv tool install graphifyy
npx graph-engineering-loop run .loopgraph/loops.json \
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

See the repository README for Claude Code plugin usage and `loops.json` details.
