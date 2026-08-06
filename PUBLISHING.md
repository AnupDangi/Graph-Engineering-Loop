# Publishing

## Install target

```bash
npm install -g graph-engineering-loop-workspace
```

After install you get these commands:

```bash
graph-engineering-loop-workspace --version
graph-engineering-loop --version
loopgraph --version
```

Published packages:

- `graph-engineering-loop-workspace` — the real CLI (this is the package already on npm; we keep and fix it)
- `graph-engineering-loop-core` — runtime dependency

The monorepo root is `gel-monorepo` with `private: true` and is **never** published.  
Do not run bare `npm publish` at the repo root.

## Tag publish

```text
git tag v0.2.3
git push origin v0.2.3
```

That triggers `.github/workflows/release.yml`, which:

1. Verifies the tag matches package + plugin versions
2. Builds, tests, and runs `smoke:plugin` + `smoke:pack`
3. Publishes `graph-engineering-loop-core` then `graph-engineering-loop-workspace`
4. Installs the published CLI with NPX in a clean temp directory
5. Creates a GitHub Release

## Local publish (if you prefer not to wait on Actions)

```bash
npm run build
npm test
npm run smoke:pack
npm publish --workspace ./packages/core --access public
npm publish --workspace ./packages/cli --access public
npx --yes graph-engineering-loop-workspace@0.2.3 --version
```

## One-time: npm auth

For GitHub Actions, set `NPM_TOKEN` (granular token with **Bypass 2FA** / Automation token):

```bash
gh secret set NPM_TOKEN -R AnupDangi/Graph-Engineering-Loop
```

For local publish:

```bash
npm login
npm whoami
```

## Version checklist

Bump together to the same version:

- `package.json` (gel-monorepo, private)
- `packages/core/package.json`
- `packages/cli/package.json` (including `dependencies.graph-engineering-loop-core`)
- `claude-plugin/.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `CHANGELOG.md`

Then:

```bash
npm run build:plugin
npm run verify:release -- v0.2.3
```
