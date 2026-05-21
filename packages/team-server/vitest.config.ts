import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globals: false,
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/app/**/page.tsx",
        "src/app/**/layout.tsx",
        "src/components/**",
        "src/proxy.ts",
        "src/db/schema.ts",
        // Pure type-definition module backing the v7 mock report — no runtime.
        "src/app/team/**/insights/types.ts",
        // Playwright-driven server-side PDF render — requires a real Chromium;
        // covered by the dev-server smoke loop, not vitest.
        "src/app/api/team/**/insights/pdf/route.ts",
      ],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
