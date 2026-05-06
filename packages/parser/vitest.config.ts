import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.ts"],
      // fs.ts and the per-agent adapters (claude-code.ts, codex.ts) are
      // node:fs wrappers integration-tested via the CLI smoke, not unit
      // tests. types.ts / index.ts are re-exports only.
      exclude: [
        "src/**/*.d.ts",
        "src/fs.ts",
        "src/claude-code.ts",
        "src/types.ts",
        "src/index.ts",
      ],
      thresholds: {
        lines: 70,
        branches: 65,
        functions: 80,
        statements: 70,
      },
    },
  },
});
