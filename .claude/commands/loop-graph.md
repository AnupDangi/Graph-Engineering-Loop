# Loop Graph

Run Graph Engineering Loop for the current project.

```bash
npm run build
node packages/cli/dist/cli.js run "$ARGUMENTS" --adapter claude
```

If `$ARGUMENTS` is empty, run:

```bash
npm run build
node packages/cli/dist/cli.js run --adapter claude
```

Report the graph summary, status, and `.loopgraph/results/` path.
