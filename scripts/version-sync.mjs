import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = rootPkg.version;

const targets = [
  "packages/cli/package.json",
  "packages/parser/package.json",
  "apps/web/package.json",
];

for (const rel of targets) {
  const abs = join(root, rel);
  try {
    const pkg = JSON.parse(readFileSync(abs, "utf8"));
    pkg.version = version;
    writeFileSync(abs, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`  synced ${rel} → ${version}`);
  } catch {
    // Package may not exist yet
  }
}
