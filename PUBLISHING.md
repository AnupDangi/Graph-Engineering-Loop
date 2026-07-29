# Publishing

## Install target

```bash
npm install -g graph-engineering-loop
```

Only `graph-engineering-loop` and `graph-engineering-loop-core` are published.  
The repo root (`graph-engineering-loop-workspace`) is `private: true` and is never published.  
`graph-engineering-loop-repo` was a mistaken publish and has been unpublished — do not install it.

## Tag publish

This repo publishes on **version tag push**:

```text
git push origin v0.2.0
```

That triggers `.github/workflows/release.yml`, which:

1. Verifies the tag matches package + plugin versions
2. Builds, tests, and runs `smoke:plugin`
3. Publishes `graph-engineering-loop-core` then `graph-engineering-loop` to **npmjs**
4. Creates a **GitHub Release** with npm + Claude plugin install notes

CI on every `main` push/PR is `.github/workflows/ci.yml` (no publish).

## One-time: npm token secret

1. Create an npm Automation token at https://www.npmjs.com/settings/~/tokens  
   (or classic Publish token). Logged-in npm user here was `anupdangi69`.
2. Add it to the GitHub repo:

```bash
gh secret set NPM_TOKEN -R AnupDangi/Graph-Engineering-Loop
```

Paste the token when prompted. Do not commit the token.

Without `NPM_TOKEN`, the release workflow will fail at the publish step.

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
git tag v0.2.0
git push origin v0.2.0
```

5. Confirm:
   - Actions → Release workflow is green
   - `npm view graph-engineering-loop version`
   - GitHub Releases shows the new tag
   - Claude marketplace install from the release notes works

## Local dry run

```bash
npm run pack:dry
node scripts/verify-release-version.mjs v0.2.0
```

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
