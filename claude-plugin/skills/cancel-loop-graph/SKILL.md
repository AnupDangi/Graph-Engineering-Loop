---
description: Cancel the active Graph Engineering Loop run in the current project.
---

# Cancel Loop Graph

Use the Bash tool to execute:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/loopgraph" cancel --project-root "${CLAUDE_PROJECT_DIR}"
```

Report whether the runtime process was signalled and the durable state was marked
cancelled, or no active run was found.
