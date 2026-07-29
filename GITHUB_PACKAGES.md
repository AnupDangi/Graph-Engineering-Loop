# GitHub Packages Setup

GitHub Packages can host npm packages for this repo, but it has one important npm-specific rule:

```text
Package names must be scoped.
```

For this project, the GitHub Packages names should be:

```text
@anupdangi/graph-engineering-loop-core
@anupdangi/graph-engineering-loop
```

This can coexist with npmjs publication in either of two ways.

## Option A: Use Scoped Names Everywhere

Rename the workspace packages to:

```json
{
  "name": "@anupdangi/graph-engineering-loop-core"
}
```

```json
{
  "name": "@anupdangi/graph-engineering-loop",
  "dependencies": {
    "@anupdangi/graph-engineering-loop-core": "0.1.0"
  }
}
```

Then publish the same scoped packages to npmjs and GitHub Packages.

npmjs:

```bash
npm publish --workspace @anupdangi/graph-engineering-loop-core --access public
npm publish --workspace @anupdangi/graph-engineering-loop --access public
```

GitHub Packages:

```bash
npm publish --workspace @anupdangi/graph-engineering-loop-core --registry=https://npm.pkg.github.com
npm publish --workspace @anupdangi/graph-engineering-loop --registry=https://npm.pkg.github.com
```

This is the cleanest long-term option if you are comfortable with scoped package install commands:

```bash
npm install -g @anupdangi/graph-engineering-loop
```

## Option B: Keep npmjs Unscoped, Use Scoped Names Only For GitHub Packages

Keep npmjs packages as:

```text
graph-engineering-loop-core
graph-engineering-loop
```

Before publishing to GitHub Packages, temporarily package a scoped variant or maintain separate package manifests.

This keeps the shortest npmjs install command:

```bash
npm install -g graph-engineering-loop
```

But it adds release complexity because GitHub Packages cannot publish those unscoped names.

## Required GitHub Auth

GitHub Packages requires a personal access token classic.

Create a token with:

```text
write:packages
read:packages
repo
```

Then login:

```bash
npm login --scope=@anupdangi --auth-type=legacy --registry=https://npm.pkg.github.com
```

Prompt values:

```text
Username: AnupDangi
Password: <classic personal access token>
Email: <your public or account email>
```

Do not commit tokens or user-level `.npmrc` files.

## Project Registry Mapping

This repo may include a safe project `.npmrc` with only registry mapping:

```ini
@anupdangi:registry=https://npm.pkg.github.com
```

That file does not contain secrets. Authentication belongs in your user-level `~/.npmrc`.

## GitHub Repo Release Commands

After `gh auth login -h github.com` succeeds:

```bash
gh repo create AnupDangi/Graph-Engineering-Loop --public --source=. --remote=origin --push
git push origin v0.1.0
```

## Current Default

npmjs unscoped publish is wired in `.github/workflows/release.yml` (see [PUBLISHING.md](./PUBLISHING.md)).

GitHub Packages is **not** automatic yet because it requires scoped package names. Decide before enabling it:

1. Rename packages to `@anupdangi/graph-engineering-loop(-core)` everywhere (Option A), or
2. Keep npmjs unscoped and maintain a separate scoped publish path (Option B).
