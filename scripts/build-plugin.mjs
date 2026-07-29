import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const pluginRoot = join(repoRoot, "claude-plugin");
const vendorRoot = join(pluginRoot, "vendor");
const cliSource = join(repoRoot, "packages", "cli", "dist");
const coreSource = join(repoRoot, "packages", "core", "dist");
const coreVendorRoot = join(vendorRoot, "node_modules", "graph-engineering-loop-core");
const corePackage = JSON.parse(
  await readFile(join(repoRoot, "packages", "core", "package.json"), "utf8")
);
const cliPackage = JSON.parse(
  await readFile(join(repoRoot, "packages", "cli", "package.json"), "utf8")
);

await rm(vendorRoot, { recursive: true, force: true });
await mkdir(coreVendorRoot, { recursive: true });
await cp(cliSource, join(vendorRoot, "cli"), { recursive: true });
await cp(coreSource, join(coreVendorRoot, "dist"), { recursive: true });
await cp(join(repoRoot, "packages", "core", "LICENSE"), join(coreVendorRoot, "LICENSE"));
await writeFile(
  join(vendorRoot, "package.json"),
  `${JSON.stringify({
    name: `${cliPackage.name}-plugin-runtime`,
    version: cliPackage.version,
    private: true,
    type: "module"
  }, null, 2)}\n`,
  "utf8"
);
await writeFile(
  join(coreVendorRoot, "package.json"),
  `${JSON.stringify({
    name: corePackage.name,
    version: corePackage.version,
    type: "module",
    main: "./dist/index.js",
    exports: {
      ".": "./dist/index.js"
    }
  }, null, 2)}\n`,
  "utf8"
);

await chmod(join(pluginRoot, "bin", "loopgraph"), 0o755);
await chmod(join(pluginRoot, "bin", "loopgraph-session"), 0o755);

console.log(`Built self-contained Claude Code plugin runtime at ${vendorRoot}`);
