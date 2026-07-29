# graph-engineering-loop

CLI for Graph Engineering Loop.

```bash
npx graph-engineering-loop validate examples/fake/loops.json
npx graph-engineering-loop run examples/fake/loops.json --adapter fake
npx graph-engineering-loop run .loopgraph/loops.json --adapter claude --claude-permission-mode acceptEdits
npx graph-engineering-loop run examples/fake/loops.json --adapter stdio --adapter-command "node examples/stdio-adapter.mjs"
npx graph-engineering-loop cancel
```

Real Claude smoke test from the repo:

```bash
npm run smoke:claude
```

This creates a fresh temp project, invokes Claude Code with a `$1.00` max budget, and verifies that the adapter creates `tmp/claude-smoke.txt`.

See the repository README for Claude Code plugin usage and `loops.json` details.
