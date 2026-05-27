import { build, context } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  external: ["fsevents"],
  define: { CLI_VERSION: JSON.stringify(pkg.version) },
  // server-only throws unconditionally — harmless guard in Next.js but fatal
  // in the CLI bundle. Redirect to a no-op stub so @claude-lens/entries/node
  // can be dynamically imported without crashing.
  alias: { "server-only": "./src/server-only-stub.js" },
};

// Hyperswarm pulls native modules (sodium-native, udx-native) and CJS-only
// deps that esbuild cannot meaningfully bundle. Leave them external — npm
// resolves them at runtime from node_modules adjacent to dist/.
const fleetWorkerExternals = [
  "hyperswarm",
  "hyperdht",
  "dht-rpc",
  "b4a",
  "sodium-native",
  "sodium-universal",
  "udx-native",
  "hypercore-crypto",
  "streamx",
  "bare-events",
  "safety-catch",
  "shuffled-priority-queue",
  "unslab",
  "compact-encoding",
  "xache",
];

const entries = [
  {
    ...shared,
    entryPoints: ["src/index.ts"],
    outfile: "dist/index.js",
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    ...shared,
    entryPoints: ["src/daemon-worker.ts"],
    outfile: "dist/daemon-worker.js",
  },
  {
    ...shared,
    entryPoints: ["src/fleet-worker.ts"],
    outfile: "dist/fleet-worker.js",
    external: [...shared.external, ...fleetWorkerExternals],
  },
];

if (process.argv.includes("--watch")) {
  const contexts = await Promise.all(entries.map((opts) => context(opts)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log("Watching for changes...");
} else {
  await Promise.all(entries.map((opts) => build(opts)));
}
