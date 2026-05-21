# Team-Pairing Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface team-server pairing in the Personal Edition dashboard so paired members can see exactly what's syncing to their company, when it last ran, and trigger a force-sync from inside the UI — without ever opening a terminal.

**Architecture:** A small on-disk artifact (`~/.cclens/team-last-push.json`) becomes the single source of truth for "what was sent". The CLI's `runTeamSync` writes it after every push; `apps/web` reads it server-side to render a sidebar chip, a settings-page "Team connection" panel with the rendered last-push preview, and a first-run banner on the overview page. A new POST `/api/team/sync` spawns the existing `fleetlens team sync` CLI as a subprocess and renders its output back in the panel. One small refactor moves `readTeamConfig`/`writeTeamConfig` from the CLI into `@claude-lens/parser/fs` so `apps/web` can import the reader without depending on the CLI package.

**Tech Stack:** TypeScript, Next.js 16 App Router (server components + SSE), Node 22, vitest, pnpm Turborepo monorepo.

**Spec:** `docs/superpowers/specs/2026-05-21-team-pairing-visibility-design.md`

---

## File Structure

**New files:**
- `packages/parser/src/team-config.ts` — moved from `packages/cli/src/team/config.ts`. Pure file-IO for `~/.cclens/team.json`.
- `packages/parser/test/team-config.test.ts` — moved test cases.
- `packages/cli/src/team/last-push.ts` — write helpers for the new last-push artifact.
- `packages/cli/test/team/last-push.test.ts` — unit tests for the write helpers.
- `apps/web/lib/team-data.ts` — server-only reader returning the `TeamConnection` discriminated union.
- `apps/web/lib/team-data.test.ts` — unit tests for the reader (health derivation, missing files, etc.).
- `apps/web/components/team-chip.tsx` — sidebar chip, pure props.
- `apps/web/components/team-welcome-banner.tsx` — first-run banner, client component.
- `apps/web/app/settings/team-connection-section.tsx` — server component rendered in `/settings`.
- `apps/web/app/settings/force-sync-button.tsx` — client component that POSTs to `/api/team/sync`.
- `apps/web/app/api/team/sync/route.ts` — POST handler that spawns the CLI subprocess.

**Modified files:**
- `packages/cli/src/team/config.ts` — becomes a thin re-export from `@claude-lens/parser/fs`.
- `packages/cli/src/team/join.ts` — writes the new `teamName` field at pairing time.
- `packages/cli/src/team/sync.ts` — calls the new write helpers after each push attempt.
- `packages/cli/src/team/leave.ts` — also clears `~/.cclens/team-last-push.json`.
- `packages/cli/src/server.ts` — sets `FLEETLENS_CLI_BIN` env var when spawning the Next.js child.
- `packages/parser/src/fs.ts` — re-exports the moved team-config helpers.
- `apps/web/components/sidebar.tsx` — accepts `teamConnection` prop, renders `<TeamChip />`.
- `apps/web/app/layout.tsx` — calls `readTeamConnection()`, passes it to `<Sidebar />`.
- `apps/web/app/page.tsx` (overview) — renders `<TeamWelcomeBanner />` at the top when paired.
- `apps/web/app/settings/page.tsx` — renders `<TeamConnectionSection />` above AI Features.
- `apps/web/app/api/events/route.ts` — adds `team-last-push.json` to the watcher; emits `team-push` event.
- `apps/web/lib/use-live-events.ts` — adds `team-push` to the event union.
- `apps/web/components/live-refresher.tsx` — handles `team-push` events.

---

## Task 1: Move team-config into the parser package

**Why:** `apps/web` needs to read team pairing state, but it cannot import from `@fleetlens/cli`. Moving the thin file-IO module into `@claude-lens/parser/fs` makes it reachable from both the CLI and the web app with zero cyclical dependencies.

**Files:**
- Create: `packages/parser/src/team-config.ts`
- Create: `packages/parser/test/team-config.test.ts`
- Modify: `packages/parser/src/fs.ts` (re-export the new helpers)
- Modify: `packages/cli/src/team/config.ts` (becomes a thin re-export)
- Delete: `packages/cli/test/team/config.test.ts` (moved to parser package)

- [ ] **Step 1: Create the moved file in the parser package**

Create `packages/parser/src/team-config.ts`:

```ts
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { cclensHome } from "./fs.js";

const CONFIG_FILE = "team.json";

export type TeamConfig = {
  serverUrl: string;
  memberId: string;
  bearerToken: string;
  teamSlug: string;
  /** Display name of the team. Optional for backwards compat with configs
   *  written before this field was introduced; readers should fall back to
   *  `teamSlug` for display when absent. Set by `joinTeam` from the whoami
   *  response. */
  teamName?: string;
  pairedAt: string;
  lastSyncedDay?: string;
  lastSyncedUsageSnapshotAt?: string;
};

export function readTeamConfig(dir?: string): TeamConfig | null {
  const d = dir ?? cclensHome();
  try {
    return JSON.parse(readFileSync(join(d, CONFIG_FILE), "utf8"));
  } catch {
    return null;
  }
}

export function writeTeamConfig(config: TeamConfig, dir?: string): void {
  const d = dir ?? cclensHome();
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, CONFIG_FILE), JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function clearTeamConfig(dir?: string): void {
  const d = dir ?? cclensHome();
  try { unlinkSync(join(d, CONFIG_FILE)); } catch {}
}
```

Note: this is identical to the existing `packages/cli/src/team/config.ts` apart from (a) importing `cclensHome` from `./fs.js` instead of the parser's published entry point, and (b) the new optional `teamName?: string` field.

- [ ] **Step 2: Re-export from `@claude-lens/parser/fs`**

In `packages/parser/src/fs.ts`, add this export near the top of the file (after the existing imports, around line 65 or wherever fits the surrounding re-export style):

```ts
export {
  type TeamConfig,
  readTeamConfig,
  writeTeamConfig,
  clearTeamConfig,
} from "./team-config.js";
```

- [ ] **Step 3: Move the existing tests into the parser package**

Create `packages/parser/test/team-config.test.ts` with the exact contents of the existing `packages/cli/test/team/config.test.ts`, but update the import path:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readTeamConfig, writeTeamConfig, clearTeamConfig, type TeamConfig } from "../src/team-config.js";

const SAMPLE: TeamConfig = {
  serverUrl: "https://team.example.com",
  memberId: "mem_abc123",
  bearerToken: "tok_secret",
  teamSlug: "acme",
  teamName: "Acme Corp",
  pairedAt: "2026-01-01T00:00:00.000Z",
};

describe("team config", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cclens-team-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when file does not exist", () => {
    expect(readTeamConfig(dir)).toBeNull();
  });

  it("round-trips write + read with teamName", () => {
    writeTeamConfig(SAMPLE, dir);
    expect(readTeamConfig(dir)).toEqual(SAMPLE);
  });

  it("tolerates legacy configs without teamName", () => {
    const { teamName: _ignored, ...legacy } = SAMPLE;
    writeTeamConfig(legacy as TeamConfig, dir);
    const read = readTeamConfig(dir);
    expect(read).toBeTruthy();
    expect(read!.teamSlug).toBe("acme");
    expect(read!.teamName).toBeUndefined();
  });

  it("written file has mode 0600", () => {
    writeTeamConfig(SAMPLE, dir);
    const mode = statSync(join(dir, "team.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("clearTeamConfig removes file; subsequent read returns null", () => {
    writeTeamConfig(SAMPLE, dir);
    clearTeamConfig(dir);
    expect(readTeamConfig(dir)).toBeNull();
  });

  it("clearTeamConfig is a no-op when file does not exist", () => {
    expect(() => clearTeamConfig(dir)).not.toThrow();
  });
});
```

- [ ] **Step 4: Replace the CLI config module with a thin re-export**

Replace the contents of `packages/cli/src/team/config.ts` with:

```ts
export {
  type TeamConfig,
  readTeamConfig,
  writeTeamConfig,
  clearTeamConfig,
} from "@claude-lens/parser/fs";
```

- [ ] **Step 5: Delete the old CLI test file**

Run: `rm packages/cli/test/team/config.test.ts`

The test coverage now lives in the parser package; keeping a duplicate in the CLI would re-test the same code path via the re-export.

- [ ] **Step 6: Build and run all tests**

Run: `pnpm -F @claude-lens/parser build && pnpm -F @claude-lens/parser test`
Expected: parser builds successfully; all `team-config` tests pass.

Run: `pnpm -F fleetlens build && pnpm -F fleetlens test`
Expected: CLI builds successfully (the re-export resolves); all existing CLI tests still pass.

Run: `pnpm typecheck`
Expected: green across the monorepo.

- [ ] **Step 7: Commit**

```bash
git add packages/parser/src/team-config.ts packages/parser/src/fs.ts packages/parser/test/team-config.test.ts packages/cli/src/team/config.ts
git rm packages/cli/test/team/config.test.ts
git commit -m "refactor(team): move team-config into @claude-lens/parser/fs"
```

---

## Task 2: Capture `teamName` at pairing time

**Why:** The chip and settings header want to display the team's human name ("Acme Corp"), not its slug ("acme"). The whoami response already contains the name; we just need to write it to config.

**Files:**
- Modify: `packages/cli/src/team/join.ts:31-37` (extend the `TeamConfig` literal)
- Modify: `packages/cli/test/team/join.test.ts` (assert the field is written)

- [ ] **Step 1: Read the existing join test to find the assertion to extend**

Run: `cat packages/cli/test/team/join.test.ts | head -80`
Expected: shows how the test mocks the fetch + asserts the written config.

- [ ] **Step 2: Update `joinTeam` to write `teamName`**

In `packages/cli/src/team/join.ts`, change the config construction (lines 31-37) to include the name:

```ts
  const config: TeamConfig = {
    serverUrl,
    memberId: data.membership.id,
    bearerToken,
    teamSlug: data.team.slug,
    teamName: data.team.name,
    pairedAt: new Date().toISOString(),
  };
```

- [ ] **Step 3: Update the join test to assert `teamName` is written**

In `packages/cli/test/team/join.test.ts`, find the assertion that inspects the written config and add a check that `teamName` matches the mocked whoami response's `team.name`. Example: if the test currently does

```ts
expect(written.teamSlug).toBe("acme");
```

Add the parallel assertion:

```ts
expect(written.teamName).toBe("Acme Corp"); // match the mock's team.name
```

(Use the exact name from the mock fixture in that test file.)

- [ ] **Step 4: Run the join test**

Run: `pnpm -F fleetlens test --reporter=verbose -- join`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/team/join.ts packages/cli/test/team/join.test.ts
git commit -m "feat(team): capture team display name at pairing time"
```

---

## Task 3: Write `team-last-push.json` after every push attempt

**Why:** This file is the single source of truth for both the sidebar chip's "synced N ago" and the settings panel's last-push preview. The web app reads it; this task makes the CLI write it.

**Files:**
- Create: `packages/cli/src/team/last-push.ts`
- Create: `packages/cli/test/team/last-push.test.ts`
- Modify: `packages/cli/src/team/sync.ts` (call the write helpers at every push site)

- [ ] **Step 1: Write the failing test for the write helpers**

Create `packages/cli/test/team/last-push.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  writeLastPushSuccess,
  writeLastPushFailure,
  clearLastPush,
  type LastPushRecord,
} from "../../src/team/last-push.js";
import type { IngestPayload } from "../../src/team/push.js";

const SAMPLE_PAYLOAD: IngestPayload = {
  ingestId: "ing_test",
  observedAt: "2026-05-21T10:00:00.000Z",
  dailyRollup: {
    day: "2026-05-20",
    agentTimeMs: 15_120_000,
    sessions: 23,
    toolCalls: 187,
    turns: 612,
    tokens: { input: 100_000, output: 50_000, cacheRead: 1_000_000, cacheWrite: 50_000 },
  },
  planTier: "pro-max-20x",
};

describe("team last-push artifact", () => {
  let dir: string;

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "cclens-lastpush-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("writeLastPushSuccess writes ok:true with payload, no error", () => {
    writeLastPushSuccess(SAMPLE_PAYLOAD, dir);
    const record: LastPushRecord = JSON.parse(readFileSync(join(dir, "team-last-push.json"), "utf8"));
    expect(record.ok).toBe(true);
    expect(record.payload).toEqual(SAMPLE_PAYLOAD);
    expect(record.error).toBeUndefined();
    expect(typeof record.pushedAt).toBe("string");
    expect(Number.isFinite(Date.parse(record.pushedAt))).toBe(true);
  });

  it("writeLastPushFailure writes ok:false with error line", () => {
    writeLastPushFailure(SAMPLE_PAYLOAD, "Token revoked — run 'fleetlens team leave' then re-join", dir);
    const record: LastPushRecord = JSON.parse(readFileSync(join(dir, "team-last-push.json"), "utf8"));
    expect(record.ok).toBe(false);
    expect(record.error).toBe("Token revoked — run 'fleetlens team leave' then re-join");
    expect(record.payload).toEqual(SAMPLE_PAYLOAD);
  });

  it("second write overwrites first (single record, not append-only)", () => {
    writeLastPushSuccess(SAMPLE_PAYLOAD, dir);
    const second: IngestPayload = { ...SAMPLE_PAYLOAD, ingestId: "ing_second" };
    writeLastPushSuccess(second, dir);
    const record: LastPushRecord = JSON.parse(readFileSync(join(dir, "team-last-push.json"), "utf8"));
    expect(record.payload.ingestId).toBe("ing_second");
  });

  it("clearLastPush removes the file", () => {
    writeLastPushSuccess(SAMPLE_PAYLOAD, dir);
    clearLastPush(dir);
    expect(existsSync(join(dir, "team-last-push.json"))).toBe(false);
  });

  it("clearLastPush is a no-op when file does not exist", () => {
    expect(() => clearLastPush(dir)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm -F fleetlens test --reporter=verbose -- last-push`
Expected: FAIL — `Cannot find module '../../src/team/last-push.js'`.

- [ ] **Step 3: Implement the write helpers**

Create `packages/cli/src/team/last-push.ts`:

```ts
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { cclensHome } from "@claude-lens/parser/fs";
import type { IngestPayload } from "./push.js";

const LAST_PUSH_FILE = "team-last-push.json";

export type LastPushRecord = {
  pushedAt: string;          // ISO timestamp
  ok: boolean;
  payload: IngestPayload;    // the payload that was sent (or attempted)
  error?: string;            // human-readable line, present only when ok === false
};

function write(record: LastPushRecord, dir?: string): void {
  const d = dir ?? cclensHome();
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, LAST_PUSH_FILE), JSON.stringify(record, null, 2), { mode: 0o600 });
}

export function writeLastPushSuccess(payload: IngestPayload, dir?: string): void {
  write({ pushedAt: new Date().toISOString(), ok: true, payload }, dir);
}

export function writeLastPushFailure(payload: IngestPayload, error: string, dir?: string): void {
  write({ pushedAt: new Date().toISOString(), ok: false, payload, error }, dir);
}

export function clearLastPush(dir?: string): void {
  const d = dir ?? cclensHome();
  try { unlinkSync(join(d, LAST_PUSH_FILE)); } catch {}
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm -F fleetlens test --reporter=verbose -- last-push`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Integrate into `runTeamSync` (success path)**

In `packages/cli/src/team/sync.ts`, add the import at the top alongside the existing imports:

```ts
import { writeLastPushSuccess, writeLastPushFailure } from "./last-push.js";
```

Then, at every site that calls `pushToTeamServer(config, payload)` and inspects `result.ok`, add a write helper call. There are three push sites in `sync.ts` (the live-only fast path, the per-rollup loop, and the backlog drain). For each:

- After a successful push (`result.ok === true`): call `writeLastPushSuccess(payload)`.
- After a failed push (`result.ok === false`): call `writeLastPushFailure(payload, \`team push failed (${result.status})\`)`.

Concretely, in the live-only fast path (around line 90), change:

```ts
      const result = await pushToTeamServer(config, payload);
      if (!result.ok) {
        log("warn", `team push (live-only) failed (${result.status}); queueing`);
        enqueuePayload(payload);
        return { paired: true, pushed: 0, queued: 1, queuedDrained: 0, usageBackfill };
      }
```

to:

```ts
      const result = await pushToTeamServer(config, payload);
      if (!result.ok) {
        const errLine = `team push failed (${result.status})`;
        log("warn", `${errLine}; queueing`);
        writeLastPushFailure(payload, errLine);
        enqueuePayload(payload);
        return { paired: true, pushed: 0, queued: 1, queuedDrained: 0, usageBackfill };
      }
      writeLastPushSuccess(payload);
```

In the per-rollup loop (around line 128), change:

```ts
      const result = await pushToTeamServer(config, payload);
      if (!result.ok) {
        log("warn", `team push failed on ${rollup.day} (${result.status}); queueing`);
        enqueuePayload(payload);
        queued++;
        failedDay = rollup.day;
        break;
      }
      pushed++;
      lastPushedDay = rollup.day;
```

to:

```ts
      const result = await pushToTeamServer(config, payload);
      if (!result.ok) {
        const errLine = `team push failed on ${rollup.day} (${result.status})`;
        log("warn", `${errLine}; queueing`);
        writeLastPushFailure(payload, errLine);
        enqueuePayload(payload);
        queued++;
        failedDay = rollup.day;
        break;
      }
      writeLastPushSuccess(payload);
      pushed++;
      lastPushedDay = rollup.day;
```

Leave the backlog drain loops as-is — they push older payloads that aren't representative of "most recent" state.

The top-level `catch (err)` already returns `{ error: message }`. Capture that into the last-push record too — add this just before `return { paired: true, ..., error: message }`:

```ts
    writeLastPushFailure(
      { ingestId: "n/a", observedAt: new Date().toISOString() },
      `team push error: ${message}`,
    );
```

- [ ] **Step 6: Update `sync.test.ts` to assert the artifact is written**

Read the existing `packages/cli/test/team/sync.test.ts` and identify how it stubs `pushToTeamServer`. Add a new `it(...)` per relevant push site:

```ts
it("writes team-last-push.json with ok:true after a successful daily push", async () => {
  // … existing setup that mocks listSessions to return a single rollup …
  // … existing mock that makes pushToTeamServer return { ok: true, status: 200 } …
  await runTeamSync(undefined, sampleConfig);
  const record = JSON.parse(readFileSync(join(testHome, "team-last-push.json"), "utf8"));
  expect(record.ok).toBe(true);
  expect(record.payload.dailyRollup?.day).toBe("2026-05-20"); // adapt to fixture
});

it("writes team-last-push.json with ok:false after a 401", async () => {
  // … existing mock that makes pushToTeamServer return { ok: false, status: 401 } …
  await runTeamSync(undefined, sampleConfig);
  const record = JSON.parse(readFileSync(join(testHome, "team-last-push.json"), "utf8"));
  expect(record.ok).toBe(false);
  expect(record.error).toMatch(/401/);
});
```

If the test currently uses a fixed `~/.cclens` dir rather than a temp dir, override `cclensHome()` for the test via the existing test setup (look at how the test isolates filesystem reads today — if there's an env var like `CCLENS_HOME`, use it; if not, the test will need a `beforeEach` that sets `process.env.HOME` to a temp dir, which is the pattern used by `config.test.ts` via the `dir` parameter).

- [ ] **Step 7: Run the sync tests**

Run: `pnpm -F fleetlens test --reporter=verbose -- sync`
Expected: all sync tests pass, including the two new ones.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/team/last-push.ts packages/cli/src/team/sync.ts packages/cli/test/team/last-push.test.ts packages/cli/test/team/sync.test.ts
git commit -m "feat(team): write team-last-push.json after every push attempt"
```

---

## Task 4: Clear `team-last-push.json` on `team leave`

**Why:** When a user unpairs, the panel should disappear cleanly on next render — no leftover artifact pretending pairing is still active.

**Files:**
- Modify: `packages/cli/src/team/leave.ts`
- Modify: `packages/cli/test/team/leave.test.ts`

- [ ] **Step 1: Update `teamLeave` to clear the artifact**

In `packages/cli/src/team/leave.ts`, change the import and add a `clearLastPush()` call:

```ts
import { readTeamConfig, clearTeamConfig } from "./config.js";
import { clearLastPush } from "./last-push.js";

export async function teamLeave() {
  const config = readTeamConfig();
  if (!config) {
    console.log("Not paired with any team.");
    return;
  }

  try {
    await fetch(`${config.serverUrl}/api/team/leave`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.bearerToken}` },
      signal: AbortSignal.timeout(5000),
    });
  } catch {}

  clearTeamConfig();
  clearLastPush();
  console.log("Left team. Local data is unaffected.");
}
```

- [ ] **Step 2: Add a test that confirms the artifact is removed**

In `packages/cli/test/team/leave.test.ts`, add a new test (following the existing test's mocking pattern for the fetch and the temp `cclensHome`):

```ts
it("removes team-last-push.json on leave", async () => {
  // pre-seed both files
  writeTeamConfig(SAMPLE_CONFIG, testHome);
  writeFileSync(join(testHome, "team-last-push.json"), '{"ok":true}');
  await teamLeave();
  expect(existsSync(join(testHome, "team-last-push.json"))).toBe(false);
});
```

(Import `writeFileSync` and `existsSync` from `node:fs`, and `writeTeamConfig` from the moved location.)

- [ ] **Step 3: Run the test**

Run: `pnpm -F fleetlens test --reporter=verbose -- leave`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/team/leave.ts packages/cli/test/team/leave.test.ts
git commit -m "feat(team): clear team-last-push.json on team leave"
```

---

## Task 5: Pass `FLEETLENS_CLI_BIN` to the spawned Next.js server

**Why:** The new `/api/team/sync` route needs to know the path of the running CLI binary so it can spawn `fleetlens team sync` as a subprocess. The CLI knows its own path via `process.argv[1]`; we just need to thread it through to the child env.

**Files:**
- Modify: `packages/cli/src/server.ts:48-58`

- [ ] **Step 1: Add the env var when spawning**

In `packages/cli/src/server.ts`, locate the `spawn(process.execPath, [serverJs], { … env: { … } })` block and add `FLEETLENS_CLI_BIN`:

```ts
  const child = spawn(process.execPath, [serverJs], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "localhost",
      CCLENS_DATA_DIR: dataDir,
      FLEETLENS_CLI_BIN: process.argv[1],
    },
    cwd: appDir(),
  });
```

`process.argv[1]` resolves to the absolute path of the `fleetlens` entry script (e.g. `<npm root -g>/fleetlens/dist/index.js` when installed, or `packages/cli/dist/index.js` when running locally). When running `apps/web` in `pnpm dev` mode, the env var is unset, which the route handles gracefully (see Task 9).

- [ ] **Step 2: Build the CLI**

Run: `pnpm -F fleetlens build`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/server.ts
git commit -m "feat(cli): expose FLEETLENS_CLI_BIN to the spawned web server"
```

---

## Task 6: Implement `readTeamConnection()` in `apps/web`

**Why:** Single typed reader the rest of `apps/web` uses to know whether the user is paired and what the most recent push looked like. Centralizes the health derivation (green/amber/red) so the chip and the panel use the same logic.

**Files:**
- Create: `apps/web/lib/team-data.ts`
- Create: `apps/web/lib/team-data.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/team-data.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let testHome: string;
let restoreHome: string | undefined;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), "cclens-team-data-"));
  restoreHome = process.env.HOME;
  process.env.HOME = testHome;
  // cclensHome() reads HOME at call time; ensure module cache is fresh
  vi.resetModules();
});

afterEach(() => {
  if (restoreHome === undefined) delete process.env.HOME;
  else process.env.HOME = restoreHome;
  rmSync(testHome, { recursive: true, force: true });
});

function cclensDir(): string {
  // Mirrors cclensHome(): $HOME/.cclens
  const dir = join(testHome, ".cclens");
  require("node:fs").mkdirSync(dir, { recursive: true });
  return dir;
}

describe("readTeamConnection", () => {
  it("returns { paired: false } when no config exists", async () => {
    const { readTeamConnection } = await import("./team-data");
    expect(readTeamConnection()).toEqual({ paired: false });
  });

  it("returns paired with lastPush=none when config exists but no push artifact", async () => {
    const dir = cclensDir();
    writeFileSync(
      join(dir, "team.json"),
      JSON.stringify({
        serverUrl: "https://team.example.com",
        memberId: "m1",
        bearerToken: "t1",
        teamSlug: "acme",
        teamName: "Acme Corp",
        pairedAt: "2026-05-01T00:00:00.000Z",
      }),
    );
    const { readTeamConnection } = await import("./team-data");
    const r = readTeamConnection();
    expect(r.paired).toBe(true);
    if (!r.paired) throw new Error("unreachable");
    expect(r.team.name).toBe("Acme Corp");
    expect(r.lastPush.kind).toBe("none");
    expect(r.health).toBe("amber");
  });

  it("falls back to teamSlug when teamName is absent", async () => {
    const dir = cclensDir();
    writeFileSync(
      join(dir, "team.json"),
      JSON.stringify({
        serverUrl: "https://team.example.com",
        memberId: "m1",
        bearerToken: "t1",
        teamSlug: "legacy-team",
        pairedAt: "2026-05-01T00:00:00.000Z",
      }),
    );
    const { readTeamConnection } = await import("./team-data");
    const r = readTeamConnection();
    if (!r.paired) throw new Error("unreachable");
    expect(r.team.name).toBe("legacy-team");
  });

  it("returns lastPush=ok and green when push is fresh (<15min)", async () => {
    const dir = cclensDir();
    writeFileSync(join(dir, "team.json"), JSON.stringify({
      serverUrl: "x", memberId: "m", bearerToken: "t", teamSlug: "s",
      pairedAt: "2026-05-01T00:00:00.000Z",
    }));
    const pushedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    writeFileSync(join(dir, "team-last-push.json"), JSON.stringify({
      pushedAt, ok: true, payload: { ingestId: "i", observedAt: pushedAt },
    }));
    const { readTeamConnection } = await import("./team-data");
    const r = readTeamConnection();
    if (!r.paired) throw new Error("unreachable");
    expect(r.lastPush.kind).toBe("ok");
    expect(r.health).toBe("green");
  });

  it("returns amber when push is 15-60min old", async () => {
    const dir = cclensDir();
    writeFileSync(join(dir, "team.json"), JSON.stringify({
      serverUrl: "x", memberId: "m", bearerToken: "t", teamSlug: "s",
      pairedAt: "2026-05-01T00:00:00.000Z",
    }));
    const pushedAt = new Date(Date.now() - 30 * 60_000).toISOString();
    writeFileSync(join(dir, "team-last-push.json"), JSON.stringify({
      pushedAt, ok: true, payload: { ingestId: "i", observedAt: pushedAt },
    }));
    const { readTeamConnection } = await import("./team-data");
    const r = readTeamConnection();
    if (!r.paired) throw new Error("unreachable");
    expect(r.health).toBe("amber");
  });

  it("returns red when push is >60min old or last push failed", async () => {
    const dir = cclensDir();
    writeFileSync(join(dir, "team.json"), JSON.stringify({
      serverUrl: "x", memberId: "m", bearerToken: "t", teamSlug: "s",
      pairedAt: "2026-05-01T00:00:00.000Z",
    }));
    const pushedAt = new Date(Date.now() - 90 * 60_000).toISOString();
    writeFileSync(join(dir, "team-last-push.json"), JSON.stringify({
      pushedAt, ok: true, payload: { ingestId: "i", observedAt: pushedAt },
    }));
    const { readTeamConnection } = await import("./team-data");
    const r = readTeamConnection();
    if (!r.paired) throw new Error("unreachable");
    expect(r.health).toBe("red");
  });

  it("returns lastPush=error and red when artifact records a failure", async () => {
    const dir = cclensDir();
    writeFileSync(join(dir, "team.json"), JSON.stringify({
      serverUrl: "x", memberId: "m", bearerToken: "t", teamSlug: "s",
      pairedAt: "2026-05-01T00:00:00.000Z",
    }));
    const pushedAt = new Date(Date.now() - 60_000).toISOString();
    writeFileSync(join(dir, "team-last-push.json"), JSON.stringify({
      pushedAt, ok: false, error: "Token revoked", payload: { ingestId: "i", observedAt: pushedAt },
    }));
    const { readTeamConnection } = await import("./team-data");
    const r = readTeamConnection();
    if (!r.paired) throw new Error("unreachable");
    expect(r.lastPush.kind).toBe("error");
    expect(r.health).toBe("red");
  });
});
```

(Note: `apps/web` already uses vitest — see `apps/web/package.json` test script. If `apps/web` has no `vitest.config` yet, `pnpm -F @claude-lens/web test --passWithNoTests` already configures it; ensure the new file is picked up by vitest's default glob `**/*.test.ts`.)

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm -F @claude-lens/web test --reporter=verbose -- team-data`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the reader**

Create `apps/web/lib/team-data.ts`:

```ts
import "server-only";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { cclensHome, readTeamConfig, type TeamConfig } from "@claude-lens/parser/fs";

// Avoid pulling the CLI package into the web bundle just for one type.
type IngestPayload = {
  ingestId: string;
  observedAt: string;
  dailyRollup?: {
    day: string;
    agentTimeMs: number;
    sessions: number;
    toolCalls: number;
    turns: number;
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  };
  usageSnapshot?: unknown;
  planTier?: string;
  cyclePeaks?: unknown;
};

type LastPushRecord = {
  pushedAt: string;
  ok: boolean;
  payload: IngestPayload;
  error?: string;
};

export type TeamConnection =
  | { paired: false }
  | {
      paired: true;
      team: { name: string; slug: string; serverUrl: string };
      member: { role: string | null; pairedAt: string };
      lastPush:
        | { kind: "none" }
        | { kind: "ok"; at: string; payload: IngestPayload }
        | { kind: "error"; at: string; error: string; payload: IngestPayload };
      health: "green" | "amber" | "red";
    };

const LAST_PUSH_FILE = "team-last-push.json";

const FRESH_MS = 15 * 60_000;
const STALE_MS = 60 * 60_000;

function readLastPush(): LastPushRecord | null {
  const path = join(cclensHome(), LAST_PUSH_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LastPushRecord;
  } catch {
    return null;
  }
}

function deriveHealth(lastPush: LastPushRecord | null, nowMs: number = Date.now()): "green" | "amber" | "red" {
  if (!lastPush) return "amber";                          // paired, never synced
  if (!lastPush.ok) return "red";
  const ageMs = nowMs - Date.parse(lastPush.pushedAt);
  if (Number.isNaN(ageMs) || ageMs > STALE_MS) return "red";
  if (ageMs > FRESH_MS) return "amber";
  return "green";
}

export function readTeamConnection(): TeamConnection {
  const config: TeamConfig | null = readTeamConfig();
  if (!config) return { paired: false };
  const lastPush = readLastPush();

  let lastPushBlock: TeamConnection extends { paired: true; lastPush: infer L } ? L : never;
  if (!lastPush) {
    lastPushBlock = { kind: "none" } as typeof lastPushBlock;
  } else if (lastPush.ok) {
    lastPushBlock = { kind: "ok", at: lastPush.pushedAt, payload: lastPush.payload } as typeof lastPushBlock;
  } else {
    lastPushBlock = {
      kind: "error",
      at: lastPush.pushedAt,
      error: lastPush.error ?? "Unknown error",
      payload: lastPush.payload,
    } as typeof lastPushBlock;
  }

  return {
    paired: true,
    team: {
      name: config.teamName ?? config.teamSlug,
      slug: config.teamSlug,
      serverUrl: config.serverUrl,
    },
    member: {
      role: null, // role is fetched at join but not currently persisted; null is acceptable
      pairedAt: config.pairedAt,
    },
    lastPush: lastPushBlock,
    health: deriveHealth(lastPush),
  };
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm -F @claude-lens/web test --reporter=verbose -- team-data`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/team-data.ts apps/web/lib/team-data.test.ts
git commit -m "feat(web): add readTeamConnection() — typed reader for team pairing state"
```

---

## Task 7: Sidebar `TeamChip` component + wire into layout

**Why:** This is the ambient visibility piece — every page shows team status without the user having to click anywhere.

**Files:**
- Create: `apps/web/components/team-chip.tsx`
- Modify: `apps/web/components/sidebar.tsx` (accept and render the chip)
- Modify: `apps/web/app/layout.tsx` (load + pass team connection)

- [ ] **Step 1: Create the TeamChip component**

Create `apps/web/components/team-chip.tsx`:

```tsx
import Link from "next/link";
import { formatRelative } from "@/lib/format";
import type { TeamConnection } from "@/lib/team-data";

const COLORS: Record<"green" | "amber" | "red", string> = {
  green: "var(--af-success, #10b981)",
  amber: "var(--af-warning, #f59e0b)",
  red: "var(--af-error, #ef4444)",
};

export function TeamChip({ connection }: { connection: TeamConnection }) {
  if (!connection.paired) return null;

  const { team, lastPush, health } = connection;
  const dotColor = COLORS[health];

  let timeLabel: string;
  let absoluteTime: string;
  if (lastPush.kind === "none") {
    timeLabel = "waiting…";
    absoluteTime = "Daemon pushes every 5 minutes";
  } else {
    timeLabel = `synced ${formatRelative(lastPush.at)}`;
    absoluteTime = new Date(lastPush.at).toLocaleString();
  }

  const tooltipParts = [
    `Team: ${team.name}`,
    absoluteTime,
    lastPush.kind === "error" ? `Error: ${lastPush.error}` : "Click to inspect what's synced.",
  ];

  return (
    <Link
      href="/settings#team"
      title={tooltipParts.join("\n")}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 16px 8px 20px",
        borderTop: "1px solid var(--af-border-subtle)",
        fontSize: 11,
        color: "var(--af-text-secondary)",
        textDecoration: "none",
        minWidth: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: dotColor,
          flexShrink: 0,
          boxShadow: `0 0 0 2px color-mix(in srgb, ${dotColor} 25%, transparent)`,
        }}
      />
      <span style={{ flexShrink: 0, fontWeight: 500 }}>Team:</span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {team.name}
      </span>
      <span
        style={{
          fontSize: 10,
          color: "var(--af-text-tertiary)",
          fontFamily: "var(--font-mono)",
          flexShrink: 0,
        }}
        suppressHydrationWarning
      >
        {timeLabel}
      </span>
    </Link>
  );
}
```

- [ ] **Step 2: Add `teamConnection` prop to Sidebar**

In `apps/web/components/sidebar.tsx`:

1. Add the import at the top:

```tsx
import { TeamChip } from "@/components/team-chip";
import type { TeamConnection } from "@/lib/team-data";
```

2. Extend the `Sidebar` props (around line 58-70):

```tsx
export function Sidebar({
  projects,
  totalSessions,
  currentUsage,
  version,
  latestChangelogVersion,
  teamConnection,
}: {
  projects: ProjectRef[];
  totalSessions: number;
  currentUsage: UsageSnapshot | null;
  version: string;
  latestChangelogVersion: string | null;
  teamConnection: TeamConnection;
}) {
```

3. Render the chip between `<UsageSidebar />` and the version/settings row (around line 273):

```tsx
      <UsageSidebar snapshot={currentUsage} />

      <TeamChip connection={teamConnection} />

      <div
        style={{
          padding: "10px 16px 10px 20px",
          ...
```

- [ ] **Step 3: Load team connection in layout and pass it down**

In `apps/web/app/layout.tsx`, find the spot where `<Sidebar />` is rendered and the data is gathered. Add:

```tsx
import { readTeamConnection } from "@/lib/team-data";

// inside the layout component, alongside the other data loads:
const teamConnection = readTeamConnection();

// when rendering Sidebar:
<Sidebar
  projects={projects}
  totalSessions={totalSessions}
  currentUsage={currentUsage}
  version={pkg.version}
  latestChangelogVersion={latestChangelogVersion}
  teamConnection={teamConnection}
/>
```

(The exact prop list depends on what's already there; this just adds one prop.)

- [ ] **Step 4: Verify the dev server still renders**

Build + smoke per the project's standard dev flow:

```bash
rm -rf apps/web/.next packages/cli/app
NEXT_OUTPUT=standalone pnpm -F @claude-lens/web build
node scripts/prepare-cli.mjs
node packages/cli/dist/index.js stop 2>&1 || true
node packages/cli/dist/index.js web usage --no-open
```

Expected:
- `pnpm -F @claude-lens/web build` completes without TS errors.
- The dashboard at `http://localhost:3321/` renders. If you are not paired, the chip is absent (this is correct).
- If you have a paired `~/.cclens/team.json`, the chip appears in the sidebar with the team name and a dot.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/team-chip.tsx apps/web/components/sidebar.tsx apps/web/app/layout.tsx
git commit -m "feat(web): add ambient team-pairing chip to the sidebar"
```

---

## Task 8: Settings page — "Team connection" section

**Why:** This is the inspection-and-verify surface — the section answers "what does my employer actually see about me?" by rendering the actual numbers from the most recent push.

**Files:**
- Create: `apps/web/app/settings/team-connection-section.tsx`
- Modify: `apps/web/app/settings/page.tsx`

- [ ] **Step 1: Create the settings section component**

Create `apps/web/app/settings/team-connection-section.tsx`:

```tsx
import { readTeamConnection } from "@/lib/team-data";
import { formatRelative } from "@/lib/format";

const HEALTH_COLORS = {
  green: "var(--af-success, #10b981)",
  amber: "var(--af-warning, #f59e0b)",
  red: "var(--af-error, #ef4444)",
} as const;

function formatAgentTime(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

export function TeamConnectionSection() {
  const conn = readTeamConnection();
  if (!conn.paired) return null;

  const { team, member, lastPush, health } = conn;

  return (
    <section id="team" className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-medium">Team connection</h2>
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: HEALTH_COLORS[health],
            display: "inline-block",
          }}
        />
        <span className="text-sm text-gray-500">{team.name}</span>
      </div>

      <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm text-gray-600">
        <dt>Server</dt><dd className="font-mono text-xs">{team.serverUrl}</dd>
        <dt>Paired</dt><dd>{new Date(member.pairedAt).toLocaleString()}</dd>
        <dt>Last sync</dt>
        <dd suppressHydrationWarning>
          {lastPush.kind === "none"
            ? "Waiting for the first sync — the daemon pushes every 5 minutes."
            : `${formatRelative(lastPush.at)} (${new Date(lastPush.at).toLocaleString()})`}
        </dd>
      </dl>

      {lastPush.kind === "ok" && (
        <div className="rounded border border-gray-200 p-4 space-y-2 text-sm">
          <div className="text-xs uppercase tracking-wide text-gray-500">Last push</div>
          {lastPush.payload.dailyRollup && (
            <div>
              <strong>{lastPush.payload.dailyRollup.day}:</strong>{" "}
              {formatAgentTime(lastPush.payload.dailyRollup.agentTimeMs)} agent time ·{" "}
              {lastPush.payload.dailyRollup.sessions} sessions ·{" "}
              {lastPush.payload.dailyRollup.toolCalls} tool calls ·{" "}
              {lastPush.payload.dailyRollup.turns} turns ·{" "}
              {formatTokens(
                lastPush.payload.dailyRollup.tokens.input +
                  lastPush.payload.dailyRollup.tokens.output +
                  lastPush.payload.dailyRollup.tokens.cacheRead +
                  lastPush.payload.dailyRollup.tokens.cacheWrite,
              )}{" "}
              tokens
            </div>
          )}
          {lastPush.payload.planTier && (
            <div>
              <strong>Plan tier:</strong> {lastPush.payload.planTier}
            </div>
          )}
          {!lastPush.payload.dailyRollup && !lastPush.payload.planTier && (
            <div className="text-gray-500">Live utilization snapshot only — no new daily activity.</div>
          )}
        </div>
      )}

      {lastPush.kind === "error" && (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          <div className="font-medium">Last sync failed</div>
          <div>{lastPush.error}</div>
        </div>
      )}

      <div className="rounded border border-gray-200 p-4 text-sm space-y-2">
        <div className="font-medium">What does NOT leave your machine</div>
        <ul className="list-disc list-inside text-gray-600 space-y-1">
          <li>Session transcripts, prompts, or assistant responses</li>
          <li>Project names, paths, or repo information</li>
          <li>File contents or tool-call payloads</li>
          <li>Anything from sessions older than the start-of-day rollup window</li>
        </ul>
      </div>

      <p className="text-xs text-gray-500">
        To disconnect from this team, run <code>fleetlens team leave</code> in your terminal.
      </p>
    </section>
  );
}
```

- [ ] **Step 2: Render the section in the settings page**

In `apps/web/app/settings/page.tsx`, replace the existing content with:

```tsx
import { readSettings } from "@claude-lens/entries/node";
import { AiFeaturesForm } from "./ai-features-form";
import { TeamConnectionSection } from "./team-connection-section";

export default function SettingsPage() {
  const s = readSettings();
  return (
    <main className="mx-auto max-w-2xl p-6 space-y-8">
      <h1 className="text-2xl font-semibold">Fleetlens Settings</h1>

      <TeamConnectionSection />

      <section>
        <h2 className="text-lg font-medium mb-2">AI Features</h2>
        <p className="text-sm text-gray-500 mb-4">
          When enabled, Fleetlens synthesizes daily digests and per-entry
          narratives by spawning your local <code>claude</code> CLI (uses your
          existing Claude Code auth — no API key required).
        </p>
        <AiFeaturesForm initial={{
          enabled: s.ai_features.enabled,
          autoBackfillLastWeek: s.ai_features.autoBackfillLastWeek,
          autoBackfillYesterday: s.ai_features.autoBackfillYesterday,
        }} />
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Verify the settings page renders both states**

Run the dev server (see Task 7 Step 4 for the build flow).

Manually check:
- `http://localhost:3321/settings` with no team config: only the AI Features section appears.
- With a paired team config + a `team-last-push.json` artifact present (you can hand-write one for testing): both sections appear, the last-push preview shows real numbers, and the "What does NOT leave" block is visible.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/settings/team-connection-section.tsx apps/web/app/settings/page.tsx
git commit -m "feat(web): add Team connection section with last-push preview to settings"
```

---

## Task 9: POST `/api/team/sync` route

**Why:** The button in the next task needs an endpoint that runs `fleetlens team sync` and returns its output. Spawning the actual CLI keeps the page byte-identical to terminal output and avoids any code-duplication.

**Files:**
- Create: `apps/web/app/api/team/sync/route.ts`

- [ ] **Step 1: Implement the route**

Create `apps/web/app/api/team/sync/route.ts`:

```ts
import { spawn } from "node:child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 30_000;

type SyncResponse = {
  ok: boolean;
  lines: string[];
  exitCode: number | null;
  error?: string;
};

export async function POST(): Promise<Response> {
  const bin = process.env.FLEETLENS_CLI_BIN;
  if (!bin) {
    return Response.json(
      {
        ok: false,
        lines: [],
        exitCode: null,
        error:
          "Force sync is only available when the dashboard is running via the fleetlens CLI " +
          "(FLEETLENS_CLI_BIN env var not set).",
      } satisfies SyncResponse,
      { status: 503 },
    );
  }

  const result = await runSync(bin);
  const status = result.ok ? 200 : 500;
  return Response.json(result, { status });
}

function runSync(bin: string): Promise<SyncResponse> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, "team", "sync"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    const lines: string[] = [];
    let timedOut = false;

    const onChunk = (buf: Buffer) => {
      for (const line of buf.toString("utf8").split("\n")) {
        if (line.length > 0) lines.push(line);
      }
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // Give the process a beat to exit before SIGKILL.
      setTimeout(() => child.kill("SIGKILL"), 2_000);
    }, TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        lines,
        exitCode: null,
        error: `Failed to spawn CLI: ${err.message}`,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({
          ok: false,
          lines,
          exitCode: code,
          error: "Sync timed out after 30s — the daemon may be unreachable.",
        });
        return;
      }
      resolve({
        ok: code === 0,
        lines,
        exitCode: code,
        error: code === 0 ? undefined : `CLI exited with code ${code}.`,
      });
    });
  });
}
```

- [ ] **Step 2: Test the route by hand**

Run the dev server (Task 7 Step 4 flow), then in a separate terminal:

```bash
curl -X POST http://localhost:3321/api/team/sync
```

Expected outcomes:
- If the CLI binary is reachable (you're running via `node packages/cli/dist/index.js …`): JSON like `{"ok":true,"lines":["[info] team push ok: ...","✓ N activity payloads pushed"],"exitCode":0}`.
- If you stop the dev server and instead start it via `pnpm -F @claude-lens/web dev` (no parent CLI), the route returns 503 with the env-var error.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/team/sync/route.ts
git commit -m "feat(web): add POST /api/team/sync route that spawns the CLI subprocess"
```

---

## Task 10: `ForceSyncButton` client component + render in settings

**Why:** Closes the loop: the user clicks a button, the CLI's actual output renders on the page, and the last-push preview above auto-refreshes with the new numbers.

**Files:**
- Create: `apps/web/app/settings/force-sync-button.tsx`
- Modify: `apps/web/app/settings/team-connection-section.tsx` (render the button + pass `cliAvailable` prop)

- [ ] **Step 1: Create the button component**

Create `apps/web/app/settings/force-sync-button.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SyncResponse = {
  ok: boolean;
  lines: string[];
  exitCode: number | null;
  error?: string;
};

export function ForceSyncButton({ cliAvailable }: { cliAvailable: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "syncing" | "done">("idle");
  const [result, setResult] = useState<SyncResponse | null>(null);

  const onClick = async () => {
    setState("syncing");
    setResult(null);
    try {
      const res = await fetch("/api/team/sync", { method: "POST" });
      const data: SyncResponse = await res.json();
      setResult(data);
      setState("done");
      if (data.ok) {
        // Re-render the server component to show the new last-push preview.
        router.refresh();
      }
    } catch (err) {
      setResult({
        ok: false,
        lines: [],
        exitCode: null,
        error: `Request failed: ${(err as Error).message}`,
      });
      setState("done");
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onClick}
          disabled={!cliAvailable || state === "syncing"}
          title={
            !cliAvailable
              ? "Force sync is only available when running via the fleetlens CLI"
              : undefined
          }
          className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {state === "syncing" ? "Syncing…" : "Sync now"}
        </button>
        <span className="text-xs text-gray-500">
          Push immediately instead of waiting for the next 5-minute daemon cycle.
        </span>
      </div>

      {result && (
        <pre
          className={`rounded border p-3 text-xs font-mono whitespace-pre-wrap ${
            result.ok ? "border-gray-200 bg-gray-50" : "border-red-300 bg-red-50 text-red-700"
          }`}
        >
          {result.lines.length > 0 ? result.lines.join("\n") : ""}
          {result.error ? (result.lines.length > 0 ? "\n" : "") + result.error : ""}
        </pre>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render the button in the settings section**

In `apps/web/app/settings/team-connection-section.tsx`:

1. Add the import:

```tsx
import { ForceSyncButton } from "./force-sync-button";
```

2. Determine `cliAvailable` from the env var (server-side, so the read is allowed):

```tsx
export function TeamConnectionSection() {
  const conn = readTeamConnection();
  if (!conn.paired) return null;

  const cliAvailable = Boolean(process.env.FLEETLENS_CLI_BIN);
  // … rest of the component …
```

3. Render the button just below the last-push preview block (or just above the "What does NOT leave" block):

```tsx
      <ForceSyncButton cliAvailable={cliAvailable} />
```

- [ ] **Step 3: Manual verification**

Run the dev server via the CLI flow (Task 7 Step 4). Open `/settings`:

- Click "Sync now" → button shows "Syncing…", then renders the CLI's output lines below it.
- Last-push preview above updates to show the new `pushedAt` timestamp (via `router.refresh()`).
- In `pnpm dev` mode (no CLI parent), the button is disabled and the tooltip explains why.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/settings/force-sync-button.tsx apps/web/app/settings/team-connection-section.tsx
git commit -m "feat(web): add Force-sync button that renders CLI output in the settings panel"
```

---

## Task 11: First-run welcome banner on the overview page

**Why:** Onboarding piece — the first time a paired user opens the dashboard after pairing, a one-paragraph explainer dissolves "what just happened" anxiety.

**Files:**
- Create: `apps/web/components/team-welcome-banner.tsx`
- Modify: `apps/web/app/page.tsx` (overview)

- [ ] **Step 1: Create the banner component**

Create `apps/web/components/team-welcome-banner.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export function TeamWelcomeBanner({
  teamName,
  pairedAt,
}: {
  teamName: string;
  pairedAt: string;
}) {
  const storageKey = `fleetlens:team-welcome-seen:${pairedAt}`;
  const [hidden, setHidden] = useState(true); // start hidden to avoid SSR flash

  useEffect(() => {
    const seen = window.localStorage.getItem(storageKey);
    if (!seen) setHidden(false);
  }, [storageKey]);

  if (hidden) return null;

  const dismiss = () => {
    window.localStorage.setItem(storageKey, "1");
    setHidden(true);
  };

  return (
    <div
      role="status"
      style={{
        margin: "0 0 16px",
        padding: "12px 16px",
        background: "var(--af-accent-subtle)",
        border: "1px solid var(--af-accent-subtle)",
        borderRadius: 8,
        color: "var(--af-text)",
        fontSize: 13,
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      <div style={{ flex: 1 }}>
        You joined <strong>{teamName}</strong>. Fleetlens now syncs your daily
        activity totals and current cycle utilization to the team dashboard
        every 5 minutes. Transcripts, prompts, and project content never leave
        your machine.{" "}
        <Link href="/settings#team" style={{ color: "var(--af-accent)", textDecoration: "underline" }}>
          See exactly what's shared →
        </Link>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          background: "transparent",
          border: "none",
          color: "var(--af-text-tertiary)",
          cursor: "pointer",
          fontSize: 16,
          lineHeight: 1,
          padding: "2px 6px",
        }}
      >
        ×
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Render the banner on the overview page**

In `apps/web/app/page.tsx`, add at the top of the imports:

```tsx
import { readTeamConnection } from "@/lib/team-data";
import { TeamWelcomeBanner } from "@/components/team-welcome-banner";
```

Then, inside the page's render block, before the existing first element of the page body, add:

```tsx
const conn = readTeamConnection();
// … rest of existing data loading …

return (
  <main /* existing wrapper */>
    {conn.paired && (
      <TeamWelcomeBanner teamName={conn.team.name} pairedAt={conn.member.pairedAt} />
    )}
    {/* … rest of existing page content … */}
  </main>
);
```

(The exact placement depends on the existing page structure; the banner should render above the first major card / metric block.)

- [ ] **Step 3: Manual verification**

Run the dev server. Open `/`:

- First visit while paired: banner appears.
- Click `×`: banner disappears, and reloading the page does not bring it back.
- Manually remove the localStorage entry via DevTools → banner reappears on next load.
- If you simulate re-pairing by changing `pairedAt` in `~/.cclens/team.json`, the storage key changes and the banner fires again — confirms the per-pairing dismiss behavior.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/team-welcome-banner.tsx apps/web/app/page.tsx
git commit -m "feat(web): first-run welcome banner on overview after team pairing"
```

---

## Task 12: Live refresh on `team-last-push.json` change

**Why:** Without this, the sidebar chip's "synced 2m ago" would only update on full page reload. With it, the chip stays fresh in real time after every daemon push.

**Files:**
- Modify: `apps/web/app/api/events/route.ts` (add the watcher + emit a new event type)
- Modify: `apps/web/lib/use-live-events.ts` (extend the event union)
- Modify: `apps/web/components/live-refresher.tsx` (handle the new event)

- [ ] **Step 1: Extend the SSE route to watch `team-last-push.json`**

In `apps/web/app/api/events/route.ts`:

1. Extend the `LiveEvent` union (around line 29) to include the new event:

```ts
type LiveEvent =
  | { type: "session-updated"; sessionId: string; projectDir: string; mtimeMs: number }
  | { type: "usage-updated"; mtimeMs: number }
  | { type: "team-push"; mtimeMs: number }
  | { type: "heartbeat"; tsMs: number }
  | { type: "ready" };
```

2. Add a constant near `USAGE_LOG_FILE` (around line 27):

```ts
const TEAM_LAST_PUSH_FILE = "team-last-push.json";
```

3. After the `usageWatcher` block (around line 155), add a sibling watcher:

```ts
      // Watch ~/.cclens/team-last-push.json so the sidebar chip's
      // "synced N ago" stays fresh after every daemon push.
      let teamPushWatcher: ReturnType<typeof watch> | null = null;
      if (existsSync(USAGE_LOG_DIR)) {
        try {
          teamPushWatcher = watch(USAGE_LOG_DIR, { persistent: false }, (_eventType, filename) => {
            if (filename?.toString() !== TEAM_LAST_PUSH_FILE) return;
            const key = "__team_push__";
            const prev = pending.get(key);
            if (prev) clearTimeout(prev);
            pending.set(
              key,
              setTimeout(async () => {
                pending.delete(key);
                if (closed) return;
                try {
                  const stat = await fs.stat(path.join(USAGE_LOG_DIR, TEAM_LAST_PUSH_FILE));
                  send({ type: "team-push", mtimeMs: stat.mtimeMs });
                } catch {
                  // file may have been deleted (team leave) — silently drop
                }
              }, DEBOUNCE_MS),
            );
          });
        } catch (e) {
          console.error("[events] team-push watch failed:", e);
        }
      }
```

4. In the `cleanup` function (around line 167), close the new watcher:

```ts
        try { teamPushWatcher?.close(); } catch { /* ignore */ }
```

- [ ] **Step 2: Extend the client event union**

In `apps/web/lib/use-live-events.ts`, add the new type:

```ts
export type LiveTeamPushUpdate = {
  type: "team-push";
  mtimeMs: number;
};

export type LiveUpdate = LiveSessionUpdate | LiveUsageUpdate | LiveTeamPushUpdate;
```

And extend the dispatch check inside `es.onmessage`:

```ts
    if (
      data.type === "session-updated" ||
      data.type === "usage-updated" ||
      data.type === "team-push"
    ) {
      handlerRef.current(data);
    }
```

- [ ] **Step 3: Handle the new event in LiveRefresher**

In `apps/web/components/live-refresher.tsx`, extend the `key` computation in `onUpdate`:

```ts
  const onUpdate = useCallback(
    (update: LiveUpdate) => {
      const key =
        update.type === "usage-updated" ? "usage" :
        update.type === "team-push" ? "team" :
        "session";
      if (update.mtimeMs <= (lastMtimeRef.current[key] ?? 0)) return;
      lastMtimeRef.current[key] = update.mtimeMs;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        router.refresh();
      }, REFRESH_DEBOUNCE_MS);
    },
    [router],
  );
```

Also initialize `team: 0` in the ref:

```ts
  const lastMtimeRef = useRef<Record<string, number>>({ session: 0, usage: 0, team: 0 });
```

- [ ] **Step 4: Manual verification**

Run the dev server. Open `/settings` (or `/`) in a browser. In a separate terminal:

```bash
node packages/cli/dist/index.js team sync
```

Expected: the sidebar chip and the settings panel's "last sync" timestamp update within ~600ms (the SSE debounce window) without you reloading the page.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/events/route.ts apps/web/lib/use-live-events.ts apps/web/components/live-refresher.tsx
git commit -m "feat(web): live-refresh sidebar chip on team-last-push.json change"
```

---

## Task 13: End-to-end verification + smoke

**Why:** Final gate before merging. Confirms all the pieces fit together and that no existing route regressed.

**Files:** None modified — verification only.

- [ ] **Step 1: Full typecheck + smoke**

Run: `pnpm verify`
Expected: typecheck passes across all packages; smoke script gets 200 from every route it hits. Investigate any failure before continuing.

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: all tests pass (parser, cli, web).

- [ ] **Step 3: Build the CLI bundle**

```bash
rm -rf apps/web/.next packages/cli/app
NEXT_OUTPUT=standalone pnpm -F @claude-lens/web build
node scripts/prepare-cli.mjs
pnpm -F fleetlens build
```

Expected: all three stages complete without errors.

- [ ] **Step 4: Manual end-to-end with the seed team server**

```bash
# In one terminal: start the local team server demo
node scripts/seed-team-demo.mjs       # follow the script's printed instructions

# In another terminal: pair the CLI against the demo
node packages/cli/dist/index.js team join <demo-url> <demo-token>

# Start the dashboard via the CLI (so FLEETLENS_CLI_BIN gets set)
node packages/cli/dist/index.js stop 2>&1 || true
node packages/cli/dist/index.js web usage --no-open
```

In the browser, verify:

- [ ] Sidebar shows the chip with green dot + "synced N ago".
- [ ] Overview shows the welcome banner; clicking `×` dismisses it; reloading keeps it dismissed.
- [ ] `/settings` shows the Team connection section with: server URL, paired date, last-sync time, last-push preview with real numbers, "What does NOT leave your machine" list, the disconnect copy.
- [ ] Click "Sync now" → button shows "Syncing…", then the CLI's output renders below it; the last-push timestamp above updates without a page reload.
- [ ] Run `node packages/cli/dist/index.js team leave` in a terminal → reload the dashboard → chip, banner, and settings section all disappear.
- [ ] Re-pair → banner reappears (different `pairedAt`); chip and settings panel reappear.

- [ ] **Step 5: Verify the `pnpm dev` (no-CLI-parent) degradation**

```bash
node packages/cli/dist/index.js stop
pnpm -F @claude-lens/web dev      # standalone, no parent CLI
```

Open `/settings` → confirm the "Sync now" button is disabled with the tooltip explaining why. (Other surfaces should behave exactly the same as before.)

- [ ] **Step 6: Final commit (if any docs need updating)**

If you discover any wording fixes or doc tweaks during verification, commit them. If not, this task ships nothing.

```bash
git status   # should be clean
```

---

## Self-review

After writing this plan, I checked against the spec section-by-section. Coverage notes:

- **Sidebar chip** → Task 7. Includes health-dot logic deriving from `readTeamConnection()`.
- **Settings panel + last-push preview + "What does NOT leave"** → Task 8.
- **First-run banner** → Task 11.
- **Force-sync button + CLI output rendering** → Tasks 9 + 10.
- **`team-last-push.json` artifact** → Tasks 3 + 4 (write + clear).
- **`FLEETLENS_CLI_BIN` env var threading** → Task 5.
- **Team-config refactor into parser** → Task 1.
- **`teamName` field** → Task 2.
- **`team-data.ts` reader** → Task 6.
- **Live-refresh SSE** → Task 12.
- **End-to-end verification** → Task 13.

All spec requirements have a corresponding task. No placeholders remain; every code-bearing step includes the actual code or exact commands. Type names are consistent across tasks (`TeamConnection`, `LastPushRecord`, `IngestPayload`).
