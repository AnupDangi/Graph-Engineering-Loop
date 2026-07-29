---
description: Start a Graph Engineering Loop run from a prompt, requirements file, or loops.json graph.
---

# Loop Graph

Run Graph Engineering Loop for `$ARGUMENTS`.

Use the Bash tool to execute:

```bash
loopgraph run "$ARGUMENTS" --adapter claude --claude-permission-mode acceptEdits
```

If `$ARGUMENTS` is empty, run:

```bash
loopgraph run --adapter claude --claude-permission-mode acceptEdits
```

Report the graph summary, status, and `.loopgraph/results/` path. Do not duplicate the scheduler in this skill; the CLI owns graph progression.
