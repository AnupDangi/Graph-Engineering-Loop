# Loop Graph

Run Graph Engineering Loop for the current project without spawning nested
Claude Code workers.

Read and follow `claude-plugin/skills/loop-graph/SKILL.md`. In its commands,
replace `${CLAUDE_PLUGIN_ROOT}` with `${CLAUDE_PROJECT_DIR}/claude-plugin`.
Build the bundled runtime first:

```bash
npm run build:plugin
```

Use `$ARGUMENTS` as the prompt, requirements path, or graph input described by
the skill.
