import { defineConfig } from "vitest/config";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    reporters: "default",
    // Force tests to run in a consistent timezone so date-splitting fixtures
    // behave identically in CI (UTC) and on developer machines.
    env: {
      TZ: "UTC",
      // Several modules resolve paths under cclensHome() at import time
      // (llm-runner, settings, digest-fs) and credentials.test.ts deletes
      // usage.jsonl outright. Without this, `pnpm test` destroys the
      // developer's real ~/.cclens usage history. Guarded by
      // test/cclens-home-isolation.test.ts.
      CCLENS_HOME: join(tmpdir(), `fleetlens-entries-test-${process.pid}`),
    },
    // `credentials.ts` imports "server-only" (a Next.js guard that throws
    // outside a server component). Under vitest the module just needs to be
    // a no-op so we can unit-test the fetch/validate logic in Node.
    alias: {
      "server-only": new URL("./test/server-only-mock.js", import.meta.url).pathname,
    },
  },
});
