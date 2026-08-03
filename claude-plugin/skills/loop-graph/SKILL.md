---
description: Start a Graph Engineering Loop run from a prompt, requirements file, or loops.json graph.
---

# Loop Graph

Run Graph Engineering Loop for `$ARGUMENTS` in the current Claude Code session.

The CLI owns scheduling, state, iteration limits, completion checks, and dependency
unlocking. Do not reproduce those responsibilities in this skill.

Each graph loop behaves like a bounded Ralph-style loop inside the current
session: the same loop contract is continued when Claude tries to stop, files and
Git history carry progress forward, and `maxIterations` is the safety limit. The
runtime's structured completion conditions replace Ralph's textual completion
promise. Never advance to another graph node yourself.

1. Set the project root to `${CLAUDE_PROJECT_DIR}`.
2. Resolve the graph:
   - If `$ARGUMENTS` identifies a valid `loops.json`, copy its content to
     `${CLAUDE_PROJECT_DIR}/.loopgraph/loops.json`.
   - If it identifies requirements or contains a prompt, inspect the project and
     compile 2 to 6 substantial workstream loops into that file.
   - If it is empty, use the existing `.loopgraph/loops.json`; if none exists,
     stop with a clear input error.
   - Prefer deterministic `command`, `fileExists`, and `fileContains` completion
     conditions. Use `assertion` only when a deterministic check cannot express
     the condition.
3. Validate the canonical graph:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/loopgraph" validate "${CLAUDE_PROJECT_DIR}/.loopgraph/loops.json" --project-root "${CLAUDE_PROJECT_DIR}"
```

4. Start the current-session bridge:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/loopgraph-session" start --project-root "${CLAUDE_PROJECT_DIR}" --input "${CLAUDE_PROJECT_DIR}/.loopgraph/loops.json"
```

5. The bridge returns either a terminal status or a `work_required` packet.
   For each work packet:
   - Show the user the current view from
     `${CLAUDE_PROJECT_DIR}/.loopgraph/status.md` and identify the active loop and
     iteration.
   - Inspect the repository before editing.
   - Execute only the packet's loop objective. Use subagents when useful.
   - Run relevant validation and collect concrete evidence.
   - Write `${CLAUDE_PROJECT_DIR}/.loopgraph/bridge/submission.json` with this
     complete `LoopExecutionResult` shape:

```json
{
  "status": "complete",
  "summary": "What was implemented and verified.",
  "completedTasks": [],
  "remainingWork": [],
  "changedFiles": [],
  "commandsRun": [],
  "completionEvidence": [],
  "handoff": [],
  "blockedReason": null
}
```

For assertion conditions, include a passing `completionEvidence` entry with the
matching zero-based `conditionIndex`, a timestamp, and concrete evidence. Never
claim unsupported completion.

6. Submit the result:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/loopgraph-session" submit --project-root "${CLAUDE_PROJECT_DIR}" --file "${CLAUDE_PROJECT_DIR}/.loopgraph/bridge/submission.json"
```

Repeat from step 5 while the bridge returns `work_required`. Do not invoke
`claude -p`; the active Claude Code session is the worker. On failure, inspect
`.loopgraph/session.log` and the last entries in `.loopgraph/events.jsonl`.

The plugin Stop hook is a guardrail like Anthropic's Ralph Wiggum plugin. If the
session tries to stop while a packet is still active, it blocks the stop and
feeds back the same loop contract. It does not replay the whole graph. Once the
runtime verifies completion, the scheduler unlocks the next dependency-ready
loop and the bridge returns its packet.

Report the final graph status, the visual status file at
`${CLAUDE_PROJECT_DIR}/.loopgraph/status.md`, and
`${CLAUDE_PROJECT_DIR}/.loopgraph/results/`.
