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
        // Client ("use client") React components colocated under app routes —
        // the only non-page/layout .tsx under src/app. Same category as
        // src/components/**: presentational, exercised by the dev-server smoke
        // loop, not vitest (no jsdom/RTL harness here).
        "src/app/**/member-sync-log-modal.tsx",
        "src/app/**/member-admin-menu.tsx",
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
