# Loop Graph

Run Graph Engineering Loop for the current project without nested Claude workers.

## When to use

Use this when the user wants `/loop-graph`, multi-loop durable agent work, or
dependency-aware completion-driven coding across a repo.

## Steps

1. Prefer the published CLI when available:

```bash
npx --yes graph-engineering-loop-workspace@latest --version
```

2. If working inside the Graph-Loop source repo, build the plugin runtime first:

```bash
npm run build:plugin
```

3. Resolve input from `$ARGUMENTS`:
   - If it is a `loops.json` path, use it.
   - If it is a prompt/requirements text, compile a graph with:

```bash
npx --yes graph-engineering-loop-workspace run "$ARGUMENTS" --adapter fake --dry-run
```

     then write a real `.loopgraph/loops.json` via a non-dry run, or author it
     manually as 2–6 substantial loops with deterministic completion checks.
   - If empty, require an existing `.loopgraph/loops.json`.

4. Validate (note the space after `validate`):

```bash
npx --yes graph-engineering-loop-workspace validate .loopgraph/loops.json
```

5. Execute:
   - Local deterministic test: `--adapter fake`
   - Headless Claude: `--adapter claude --claude-permission-mode acceptEdits`
   - In-session Claude Code plugin: use `claude-plugin/bin/loopgraph-session` with
     `--adapter interactive` (see `claude-plugin/skills/loop-graph/SKILL.md`)

```bash
npx --yes graph-engineering-loop-workspace run .loopgraph/loops.json --adapter fake
```

6. Report `.loopgraph/status.md` and `.loopgraph/results/`.

## Common mistakes

- `validate.loopgraph/loops.json` is wrong — needs a space: `validate .loopgraph/loops.json`
- New projects have no `.loopgraph/loops.json` until the first `run` compiles one
- Do not reimplement the scheduler in chat; the CLI owns progression
