# Publishing

## Install target

```bash
npm install -g graph-engineering-loop
```

Only `graph-engineering-loop` and `graph-engineering-loop-core` are published.  
The repo root (`graph-engineering-loop-workspace`) is `private: true` and is never published.  
`graph-engineering-loop@0.2.0` accidentally published the monorepo root without a
binary. It is deprecated. The failed `v0.2.1` release tag points to an older
commit and must not be reused; `0.2.2` is the next publishable release.
As of the `0.2.2` preparation, `graph-engineering-loop-core` is not yet present
on npm and must publish successfully before the CLI package.

## Tag publish

This repo publishes on **version tag push**:

```text
git push origin v0.2.2
```

That triggers `.github/workflows/release.yml`, which:

1. Verifies the tag matches package + plugin versions
2. Builds, tests, and runs `smoke:plugin`
3. Publishes `graph-engineering-loop-core` then `graph-engineering-loop` to **npmjs**
4. Installs the exact published CLI with NPX in a clean temporary directory
5. Creates a **GitHub Release** with npm + Claude plugin install notes

CI on every `main` push/PR is `.github/workflows/ci.yml` (no publish).

## One-time: npm token secret

1. Create a granular npm token at https://www.npmjs.com/settings/~/tokens with:
   - Packages and scopes: **Read and write**, **All packages**
   - **Bypass two-factor authentication** enabled for CI publishing
   - A short expiration appropriate for the release process
2. Add it to the GitHub repo:

```bash
gh secret set NPM_TOKEN -R AnupDangi/Graph-Engineering-Loop
```

Paste the token when prompted. Do not commit the token.

Without a valid write token, the release workflow's npm authentication preflight
will fail before publishing. Never paste or commit the token in repository files.

## Release checklist

1. Bump versions together in:
   - `package.json`
   - `packages/core/package.json`
   - `packages/cli/package.json` (including `dependencies.graph-engineering-loop-core`)
   - `claude-plugin/.claude-plugin/plugin.json`
   - `.claude-plugin/marketplace.json` (marketplace + plugin entry)
   - `CHANGELOG.md`
2. Rebuild the plugin vendor artifact:

```bash
npm run build:plugin
```

3. Commit and push to `main`.
4. Tag and push the tag (this is the publish trigger):

```bash
git tag v0.2.2
git push origin v0.2.2
```

5. Confirm:
   - Actions → Release workflow is green
   - `npm view graph-engineering-loop version`
   - `npm run smoke:npx`
   - GitHub Releases shows the new tag
   - Claude marketplace install from the release notes works

## Local dry run

```bash
npm run pack:dry
npm run smoke:pack
node scripts/verify-release-version.mjs v0.2.2
npm audit
npm view graph-engineering-loop version
npm view graph-engineering-loop-core version || true
```

Before committing the release, also confirm `git status` contains no `.env`,
credential, npm debug log, `.loopgraph/context/`, or unintended `graphify-out/`
artifacts.

## Claude plugin “push”

The plugin lives in this GitHub repo (`claude-plugin/` + marketplace manifest).  
Tagging a release is what makes a versioned plugin install point for:

```text
/plugin marketplace add AnupDangi/Graph-Engineering-Loop
/plugin install graph-engineering-loop@graph-engineering-loop-marketplace
```

There is no separate Claude registry publish step. Keep `claude-plugin/vendor/` in git so marketplace consumers get a self-contained plugin.

## GitHub Packages (optional, later)

GitHub Packages requires scoped names (`@anupdangi/...`).  
Current publish path is **npmjs unscoped only**. See [GITHUB_PACKAGES.md](./GITHUB_PACKAGES.md) if you want a scoped dual-registry setup next.
