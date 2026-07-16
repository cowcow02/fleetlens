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
        // Next.js boot wiring (log capture, migrations, scheduler start) —
        // runs at server startup, same category as proxy.ts.
        "src/instrumentation.ts",
        "src/db/schema.ts",
        // Pure type-definition module backing the insight report — no runtime.
        "src/app/team/**/insights/types.ts",
        // Static data tables consumed only by excluded presentational
        // components (explain badges, plan block copy) — no logic to test.
        "src/lib/metric-provenance.ts",
        "src/lib/advisory-tone.ts",
        // Playwright-driven server-side PDF render — requires a real Chromium;
        // covered by the dev-server smoke loop, not vitest.
        "src/app/api/team/**/insights/pdf/route.ts",
      ],
      // Lines/statements re-based 80 → 75 when the ~3.4k-line fully-covered
      // mock insight fixtures were deleted for 1.0 — they padded the
      // aggregate; real-code coverage sits at ~77% (biggest gaps:
      // plan-queries, linear, github, integrations). Ratchet back up as
      // those grow tests.
      thresholds: {
        lines: 75,
        branches: 80,
        functions: 80,
        statements: 75,
      },
    },
  },
});
