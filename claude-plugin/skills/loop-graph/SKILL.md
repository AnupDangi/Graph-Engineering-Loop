---
description: Start a Graph Engineering Loop run from a prompt, requirements file, or loops.json graph.
---

# Loop Graph

Run Graph Engineering Loop for `$ARGUMENTS`.

Use the Bash tool to execute:

```bash
npx graph-engineering-loop run "$ARGUMENTS" --adapter claude
```

If `$ARGUMENTS` is empty, run:

```bash
npx graph-engineering-loop run --adapter claude
```

Report the graph summary, status, and `.loopgraph/results/` path. Do not duplicate the scheduler in this skill; the CLI owns graph progression.
