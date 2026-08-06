# Publishing

Ship path is **tag → GitHub Actions → npm**. No manual `npm publish` from a laptop.

```bash
git tag v0.2.4
git push origin v0.2.4
```

## Install target (users)

```bash
npm install -g graph-engineering-loop-workspace
```

Bins: `graph-engineering-loop-workspace`, `graph-engineering-loop`, `loopgraph`.

Published packages:

- `graph-engineering-loop-workspace` — CLI
- `graph-engineering-loop-core` — runtime dependency

Root `gel-monorepo` is private and never published.

## Required once: npm Trusted Publishing

`v0.2.4` failed because the stored `NPM_TOKEN` can authenticate (`anupdangi22`) but gets **403** writing `graph-engineering-loop-core`. Automated shipping should use **OIDC Trusted Publishing**, not a weak granular token.

For **each** package on npmjs.com:

1. Open:
   - https://www.npmjs.com/package/graph-engineering-loop-core/access
   - https://www.npmjs.com/package/graph-engineering-loop-workspace/access
2. **Trusted Publisher** → GitHub Actions
3. Set exactly:
   - Organization or user: `AnupDangi`
   - Repository: `Graph-Engineering-Loop`
   - Workflow filename: `release.yml` (filename only)
   - Allowed action: `npm publish`
4. Save

Docs: https://docs.npmjs.com/trusted-publishers/

After both packages are configured, re-run the failed release:

```bash
gh run rerun 31084020720 -R AnupDangi/Graph-Engineering-Loop --failed
```

Or push a new tag after the workflow fix is on `main`.

## What the Release workflow does

`.github/workflows/release.yml` on `v*`:

1. Verify tag == package/plugin versions
2. Build, test, `smoke:fake`, `smoke:plugin`, `smoke:pack`
3. Publish with OIDC + provenance (no `NODE_AUTH_TOKEN` on publish)
4. `smoke:npx` against the registry
5. Create GitHub Release notes (npm + Claude plugin install)

## Optional token fallback

`NPM_TOKEN` is **not** required once Trusted Publishing works.

If you keep a token for emergencies, it must be a granular token with:

- Read and write on **both** `graph-engineering-loop-core` and `graph-engineering-loop-workspace` (or All packages)
- **Bypass two-factor authentication** enabled

A token that only covers the workspace package will 403 on core — that is the failure you hit.

## Version checklist before tagging

Bump together:

- `package.json`
- `packages/core/package.json`
- `packages/cli/package.json` (and core dependency)
- `claude-plugin/.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `CHANGELOG.md`

Then:

```bash
npm run build:plugin
npm run verify:release -- vX.Y.Z
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```
