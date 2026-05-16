import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // server-only throws at import time in Next.js Server Components to
    // prevent client-side usage. The CLI is always Node — mock it away.
    alias: { "server-only": new URL("./test/__mocks__/server-only.ts", import.meta.url).pathname },
  },
  // Mirror esbuild's build-time define so updater.ts can be unit-tested
  // without going through the bundler.
  define: { CLI_VERSION: JSON.stringify("0.0.0-test") },
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      // Team edition scope only. Older solo-edition modules (usage/, server,
      // table, updater) have their own tests and are out of this PR's scope.
      include: ["src/team/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
