# Graph Engineering Loop Claude Code Plugin

This plugin exposes Graph Engineering Loop to Claude Code as namespaced skills:

```text
/graph-engineering-loop:loop-graph <prompt-or-path>
/graph-engineering-loop:cancel-loop-graph
```

For local testing:

```bash
npm run build
claude --plugin-dir ./claude-plugin
```

The skills invoke the npm CLI. Install the CLI first for reliable offline use:

```bash
npm install -g graph-engineering-loop
```

The plugin layout follows the current Claude Code plugin model: `.claude-plugin/plugin.json` contains metadata, and skills live under `skills/<name>/SKILL.md`.

The bundled `bin/loopgraph` is local-first: inside this repository it runs `packages/cli/dist/cli.js`, and after publication it falls back to a globally installed or NPX package.
