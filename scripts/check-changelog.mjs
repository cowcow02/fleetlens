#!/usr/bin/env node
// Release-time gate. Given a tag (or read from GITHUB_REF), assert that the
// matching CHANGELOG.md has a `## [<version>]` heading. Used by CI:
//   node scripts/check-changelog.mjs                # reads GITHUB_REF
//   node scripts/check-changelog.mjs v0.6.5         # explicit personal tag
//   node scripts/check-changelog.mjs server-v0.6.4  # explicit team tag
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const arg = process.argv[2] ?? process.env.GITHUB_REF?.replace(/^refs\/tags\//, "");
if (!arg) {
  console.error("usage: check-changelog.mjs <tag>  (or set GITHUB_REF)");
  process.exit(2);
}

let path;
let version;
if (arg.startsWith("server-v")) {
  version = arg.slice("server-v".length);
  path = join(repoRoot, "packages/team-server/CHANGELOG.md");
} else if (arg.startsWith("v")) {
  version = arg.slice(1);
  path = join(repoRoot, "CHANGELOG.md");
} else {
  console.error(`unrecognized tag shape: ${arg}`);
  process.exit(2);
}

const raw = readFileSync(path, "utf8");
const heading = new RegExp(`^##\\s+\\[${version.replace(/[.+\-]/g, "\\$&")}\\]`, "m");
if (!heading.test(raw)) {
  console.error(`::error::No CHANGELOG entry for ${version} in ${path}`);
  console.error(`Add a "## [${version}] — YYYY-MM-DD" section before re-tagging.`);
  process.exit(1);
}

console.log(`✓ ${path} has an entry for ${version}`);
