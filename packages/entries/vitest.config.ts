import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    reporters: "default",
    // Force tests to run in a consistent timezone so date-splitting fixtures
    // behave identically in CI (UTC) and on developer machines.
    env: {
      TZ: "UTC",
    },
    // `credentials.ts` imports "server-only" (a Next.js guard that throws
    // outside a server component). Under vitest the module just needs to be
    // a no-op so we can unit-test the fetch/validate logic in Node.
    alias: {
      "server-only": new URL("./test/server-only-mock.js", import.meta.url).pathname,
    },
  },
});
