# Team Onboarding Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `fleetlens team join` opens a local browser wizard that explains what syncs, lets the user pick which projects share metrics with the team, and streams first-sync progress live; the selection is editable later in Settings.

**Architecture:** The CLI writes `team.json` with a `setupPending` gate and (new) `syncProjects` selection; the daemon hot-reads that file every 5-min cycle, so the sync gate and the session-level project filter live in the CLI sync path. The local Next.js app hosts the wizard (`/team/onboarding`) and two routes: a GET/PUT for the selection and an SSE POST that spawns `fleetlens team sync --progress-json` and relays NDJSON progress as SSE frames.

**Tech Stack:** TypeScript, vitest, Next.js 16 App Router, zod (already in apps/web), Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-08-team-onboarding-wizard-design.md` (approved 2026-07-08).

## Global Constraints

- Work in the worktree: **every** shell command starts with `cd /Users/cowcow02/Repo/claude-lens/.worktrees/onboard` (the harness resets cwd to the primary tree between calls).
- Comments only for WHY (invariants, incidents, workarounds) — never WHAT. Match surrounding brevity.
- No feature flags, no back-compat shims beyond what the spec names (`setupPending`/`syncProjects` absent ⇒ old behavior).
- The bearer token must never reach the DOM — server components pass only masked/derived views (existing `toTeamConfigView` pattern).
- Project keys everywhere are `projectRepoName(canonicalProjectName(...))` values (the parser computes this; UI and filter must use the same key).
- Machine-level payload blocks (`usageSnapshot`, `cyclePeaks`, `planTier`, `snapshotHistory`, `syncLog`) are NOT project-filtered.
- End commit messages with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Track A = Tasks 1–4 (parser + CLI). Track B = Tasks 5–8 (apps/web). The tracks touch disjoint files and may run in parallel; within a track, tasks are strictly sequential. If `git commit` hits a transient `index.lock` conflict (parallel track committing), wait 2s and retry once.

---

### Task 1: TeamConfig schema + `shouldSyncProject` predicate (parser)

**Files:**
- Modify: `packages/parser/src/team-config.ts`
- Modify: `packages/parser/src/fs.ts` (re-export)
- Test: `packages/parser/test/team-config.test.ts` (exists — extend)

**Interfaces:**
- Produces: `type SyncProjects = { autoIncludeNew: boolean; included: string[]; excluded: string[] }`, `TeamConfig.setupPending?: boolean`, `TeamConfig.syncProjects?: SyncProjects`, `shouldSyncProject(repoName: string, sp?: SyncProjects): boolean` — all exported from `@claude-lens/parser/fs`. Tasks 2–4 consume these.

- [ ] **Step 1: Write the failing tests.** Read `packages/parser/test/team-config.test.ts` first to match its imports/tmp-dir idiom, then append:

```ts
describe("shouldSyncProject", () => {
  const sp = { autoIncludeNew: true, included: ["work-repo"], excluded: ["personal-blog"] };
  it("syncs everything when syncProjects is absent", () => {
    expect(shouldSyncProject("anything", undefined)).toBe(true);
  });
  it("drops excluded projects", () => {
    expect(shouldSyncProject("personal-blog", sp)).toBe(false);
  });
  it("keeps included projects", () => {
    expect(shouldSyncProject("work-repo", sp)).toBe(true);
  });
  it("routes unknown projects by autoIncludeNew", () => {
    expect(shouldSyncProject("brand-new", sp)).toBe(true);
    expect(shouldSyncProject("brand-new", { ...sp, autoIncludeNew: false })).toBe(false);
  });
  it("excluded wins over included on a conflicting entry", () => {
    expect(shouldSyncProject("both", { autoIncludeNew: true, included: ["both"], excluded: ["both"] })).toBe(false);
  });
});

describe("TeamConfig round-trip with onboarding fields", () => {
  it("preserves setupPending and syncProjects", () => {
    const dir = mkdtempSync(join(tmpdir(), "cclens-test-"));
    const config: TeamConfig = {
      serverUrl: "http://x", memberId: "m", bearerToken: "t", teamSlug: "s",
      pairedAt: "2026-07-08T00:00:00Z",
      setupPending: true,
      syncProjects: { autoIncludeNew: false, included: ["a"], excluded: ["b"] },
    };
    writeTeamConfig(config, dir);
    expect(readTeamConfig(dir)).toEqual(config);
  });
});
```

- [ ] **Step 2: Run to verify failure.** `cd /Users/cowcow02/Repo/claude-lens/.worktrees/onboard && pnpm -F @claude-lens/parser test -- team-config` — expect FAIL (`shouldSyncProject` not exported).

- [ ] **Step 3: Implement.** In `packages/parser/src/team-config.ts` add after the `TeamConfig` type:

```ts
/** Member-side project selection for team sync. `included`/`excluded` capture
 *  the explicit wizard checkboxes; projects that appear AFTER selection fall
 *  through to `autoIncludeNew`. Absent syncProjects = sync everything. */
export type SyncProjects = {
  autoIncludeNew: boolean;
  included: string[];
  excluded: string[];
};

export function shouldSyncProject(repoName: string, sp?: SyncProjects): boolean {
  if (!sp) return true;
  if (sp.excluded.includes(repoName)) return false;
  if (sp.included.includes(repoName)) return true;
  return sp.autoIncludeNew;
}
```

and add to `TeamConfig` (after `droppedDays`):

```ts
  /** Written by `team join`; nothing syncs while set. Cleared by the wizard's
   *  "Start syncing". Absent on configs from before the wizard ⇒ not gated. */
  setupPending?: boolean;
  syncProjects?: SyncProjects;
```

In `packages/parser/src/fs.ts`, find the existing `team-config.js` re-export line and add `shouldSyncProject` and `type SyncProjects` to it.

- [ ] **Step 4: Run tests.** `pnpm -F @claude-lens/parser test -- team-config` → PASS. Then `pnpm -F @claude-lens/parser typecheck` if the package has one, else `pnpm typecheck`.

- [ ] **Step 5: Commit.** `git add packages/parser && git commit -m "feat(parser): syncProjects selection + setupPending gate on TeamConfig"` (+ trailer).

---

### Task 2: Sync gate + session filter (CLI)

**Files:**
- Modify: `packages/cli/src/team/push.ts` (new `filterSyncedSessions`)
- Modify: `packages/cli/src/team/sync.ts` (gate at top of `runTeamSync`; filter at the `listSessions` call, currently line ~337)
- Modify: `packages/cli/src/commands/team.ts` (`sync` case hint)
- Test: `packages/cli/test/team/sync-filter.test.ts` (new), `packages/cli/test/team/sync-gate.test.ts` (new)

**Interfaces:**
- Consumes: `shouldSyncProject`, `SyncProjects` from Task 1 (via `@claude-lens/parser/fs` — push.ts already imports from the parser).
- Produces: `filterSyncedSessions(sessions: SessionMeta[], syncProjects?: SyncProjects): SessionMeta[]` exported from `push.ts`; `SyncOutcome.setupPending?: boolean`.

- [ ] **Step 1: Failing test — filter.** `packages/cli/test/team/sync-filter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { filterSyncedSessions } from "../../src/team/push.js";
import type { SessionMeta } from "@claude-lens/parser";

const session = (projectName: string) => ({ projectName }) as SessionMeta;

describe("filterSyncedSessions", () => {
  const sp = { autoIncludeNew: false, included: ["work"], excluded: ["personal"] };
  it("passes everything through without a selection", () => {
    expect(filterSyncedSessions([session("/u/x/Repo/personal")], undefined)).toHaveLength(1);
  });
  it("filters by repo name, worktree paths collapse to the parent repo", () => {
    const kept = filterSyncedSessions(
      [
        session("/u/x/Repo/work"),
        session("/u/x/Repo/work/.worktrees/feat-1"), // canonicalizes to …/work
        session("/u/x/Repo/personal"),
        session("/u/x/Repo/unknown"),
      ],
      sp,
    );
    expect(kept.map((s) => s.projectName)).toEqual([
      "/u/x/Repo/work",
      "/u/x/Repo/work/.worktrees/feat-1",
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure.** `pnpm -F fleetlens test -- sync-filter` → FAIL (no export).

- [ ] **Step 3: Implement filter.** In `push.ts` (it already imports `projectRepoName`; add `shouldSyncProject`/`SyncProjects` to the parser import):

```ts
// Session-level choke point for the member's project selection. Applied ONCE
// where sessions enter payload building so excluded projects vanish from the
// daily totals too — a per-project-rows-only filter would leak the excluded
// share as (total − sum of rows).
export function filterSyncedSessions(
  sessions: SessionMeta[],
  syncProjects?: SyncProjects,
): SessionMeta[] {
  if (!syncProjects) return sessions;
  return sessions.filter((s) => shouldSyncProject(projectRepoName(s.projectName), syncProjects));
}
```

- [ ] **Step 4: Failing test — gate.** `packages/cli/test/team/sync-gate.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runTeamSync } from "../../src/team/sync.js";

describe("runTeamSync setupPending gate", () => {
  it("bails idle before any IO when setup is pending", async () => {
    const log = vi.fn();
    const outcome = await runTeamSync(log, {
      serverUrl: "http://127.0.0.1:9", // unreachable on purpose — must never be dialed
      memberId: "m", bearerToken: "t", teamSlug: "s", pairedAt: "2026-07-08T00:00:00Z",
      setupPending: true,
    });
    expect(outcome).toMatchObject({ paired: true, pushed: 0, queued: 0, setupPending: true });
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]![1]).toContain("setup pending");
  });
});
```

- [ ] **Step 5: Implement gate + filter wiring.** In `sync.ts`, immediately after `if (!config) return { paired: false, … };` (before anything else touches disk or network):

```ts
  // Wizard gate: the join wrote config but the member hasn't confirmed the
  // project selection yet. Nothing may leave the machine until they do.
  if (config.setupPending) {
    log(
      "info",
      buildSyncLine(
        "idle",
        options.trigger ?? "auto",
        {
          pushedDays: [], droppedDays: [], queued: 0, queuedDrained: 0, usageSnapshots: 0,
          idleReason: "setup pending — finish onboarding in the dashboard (/team/onboarding)",
        },
        0,
        options.nextSyncMs,
      ),
    );
    return { paired: true, pushed: 0, queued: 0, queuedDrained: 0, setupPending: true };
  }
```

Add `setupPending?: boolean;` to `SyncOutcome`. Change the sessions line (~337) to:

```ts
    const sessions = filterSyncedSessions(await listSessions({ limit: 10_000 }), config.syncProjects);
```

(import `filterSyncedSessions` in the existing `./push.js` import block). In `commands/team.ts` `sync` case, after the `!outcome.paired` check:

```ts
      if (outcome.setupPending) {
        console.error("Setup pending — nothing synced. Finish onboarding in the dashboard (/team/onboarding) or re-run 'fleetlens team join'.");
        process.exit(1);
      }
```

- [ ] **Step 6: Run tests.** `pnpm -F fleetlens test -- sync` → both new files PASS; existing suite green. `pnpm typecheck`.

- [ ] **Step 7: Commit.** `git add packages/cli && git commit -m "feat(cli): setupPending sync gate + syncProjects session filter"` (+ trailer).

---

### Task 3: Sync progress events + `team sync --progress-json`

**Files:**
- Modify: `packages/cli/src/team/sync.ts`
- Modify: `packages/cli/src/commands/team.ts`
- Test: `packages/cli/test/team/sync-progress.test.ts` (new)

**Interfaces:**
- Produces: `SyncProgressEvent` (exported from `sync.ts`), `TeamSyncOptions.onProgress?: (ev: SyncProgressEvent) => void`, CLI flag `fleetlens team sync --progress-json` printing one JSON event per stdout line. Task 6's route consumes the NDJSON; Task 7's UI consumes the event shapes.

- [ ] **Step 1: Failing test.** `packages/cli/test/team/sync-progress.test.ts` — mock every IO module `sync.ts` imports, drive one 2-day run, assert event order:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/team/push.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/team/push.js")>();
  return {
    ...real,
    pushToTeamServer: vi.fn(async () => ({ ok: true, status: 200, body: null })),
    buildRollupsForRange: vi.fn(() => [
      { day: "2026-07-06", agentTimeMs: 1, sessions: 1, toolCalls: 0, turns: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, uniqueSessions: 1 },
      { day: "2026-07-07", agentTimeMs: 1, sessions: 1, toolCalls: 0, turns: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, uniqueSessions: 1 },
    ]),
    buildRichBlocksForDay: vi.fn(() => null),
    readLatestUsageSnapshotForWire: vi.fn(() => null),
    resetEnsuredSessions: vi.fn(),
    sessionTouchesDay: vi.fn(() => false),
    buildIngestPayload: vi.fn((x: object) => ({ ingestId: "i", observedAt: "now", ...x })),
  };
});
vi.mock("../../src/team/backfill.js", () => ({
  runTeamBackfill: vi.fn(async () => ({ sentSnapshots: 3, insertedSnapshots: 3, skippedSnapshots: 0 })),
}));
vi.mock("../../src/team/queue.js", () => ({ enqueuePayload: vi.fn(), dequeuePayloads: vi.fn(() => []) }));
vi.mock("../../src/team/sync-log.js", () => ({ readPendingSyncLog: vi.fn(() => ({ lines: [], watermark: null })) }));
vi.mock("../../src/team/last-push.js", () => ({ writeLastPushSuccess: vi.fn(), writeLastPushFailure: vi.fn() }));
vi.mock("../../src/team/commands.js", () => ({ dispatchCommand: vi.fn() }));
vi.mock("../../src/team/git-remote.js", () => ({ createRepoResolver: vi.fn(() => () => null) }));
vi.mock("../../src/usage/profile.js", () => ({ getPlanTier: vi.fn(async () => null) }));
vi.mock("../../src/perception/file-probe.js", () => ({ probeArtifactSignals: vi.fn(() => null) }));
vi.mock("@claude-lens/parser/fs", async (importOriginal) => {
  const real = await importOriginal<object>();
  return {
    ...real,
    listSessions: vi.fn(async () => []),
    loadCalibrationCurve: vi.fn(async () => null),
  };
});
// team.json writes: point CCLENS_HOME at a tmp dir (config module resolves per call)
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.CCLENS_HOME = mkdtempSync(join(tmpdir(), "cclens-progress-"));

import { runTeamSync, type SyncProgressEvent } from "../../src/team/sync.js";

describe("runTeamSync onProgress", () => {
  it("emits phase → usage → phase(activity) → day×2 → done, in order", async () => {
    const events: SyncProgressEvent[] = [];
    const outcome = await runTeamSync(
      () => {},
      { serverUrl: "http://mocked", memberId: "m", bearerToken: "t", teamSlug: "s", pairedAt: "x" },
      { onProgress: (ev) => events.push(ev) },
    );
    expect(outcome.pushed).toBe(2);
    expect(events.map((e) => e.type)).toEqual(["phase", "usage", "phase", "day", "day", "done"]);
    const days = events.filter((e): e is Extract<SyncProgressEvent, { type: "day" }> => e.type === "day");
    expect(days[0]).toMatchObject({ day: "2026-07-06", index: 1, total: 2, outcome: "pushed" });
    expect(days[1]).toMatchObject({ day: "2026-07-07", index: 2, total: 2, outcome: "pushed" });
    const done = events.at(-1) as Extract<SyncProgressEvent, { type: "done" }>;
    expect(done).toMatchObject({ pushed: 2, queued: 0 });
  });
});
```

If `vi.mock` of `@claude-lens/parser/fs` collides with the dynamic `import()` inside `runTeamSync`, keep the mock — vitest intercepts dynamic imports of mocked modules too. Adjust mock fields only if the run surfaces a missing export (add it to the spread).

- [ ] **Step 2: Run to verify failure.** `pnpm -F fleetlens test -- sync-progress` → FAIL (no `onProgress` emissions).

- [ ] **Step 3: Implement.** In `sync.ts` add near `TeamSyncOptions`:

```ts
export type SyncProgressEvent =
  | { type: "phase"; phase: "usage-backfill" | "activity"; totalDays?: number }
  | { type: "usage"; inserted: number; alreadyKnown: number }
  | { type: "day"; day: string; index: number; total: number; outcome: "pushed" | "queued" | "dropped" }
  | { type: "done"; pushed: number; queued: number; pushedDays: string[] }
  | { type: "error"; message: string };
```

Add `onProgress?: (ev: SyncProgressEvent) => void;` to `TeamSyncOptions`. Inside `runTeamSync` (after the summary/finish setup): `const emit = options.onProgress ?? (() => {});` then:
- before `runTeamBackfill`: `emit({ type: "phase", phase: "usage-backfill" });`
- after it: `emit({ type: "usage", inserted: usageBackfill.insertedSnapshots ?? 0, alreadyKnown: usageBackfill.skippedSnapshots ?? 0 });`
- after `rollups` computed: `emit({ type: "phase", phase: "activity", totalDays: rollups.length });`
- in the day loop: on success `emit({ type: "day", day: rollup.day, index: i + 1, total: rollups.length, outcome: "pushed" });`; in the validation-poison branch `outcome: "dropped"`; in the transient branch `outcome: "queued"` (before `break`).
- in the live-only (`rollups.length === 0`) path and the main path, right before each `return`: `emit({ type: "done", pushed, queued, pushedDays: summary.pushedDays });` (use the literal values each return already has).
- in the `catch`: `emit({ type: "error", message });`

In `commands/team.ts` `sync` case:

```ts
    case "sync": {
      const progressJson = args.includes("--progress-json");
      const { runTeamSync } = await import("../team/sync.js");
      const { appendDaemonLogLine } = await import("../daemon-log.js");
      const outcome = await runTeamSync(
        (level, msg) => {
          if (!progressJson) console.log(`[${level}] ${msg}`);
          appendDaemonLogLine(level, msg);
        },
        undefined,
        {
          trigger: "manual",
          onProgress: progressJson ? (ev) => console.log(JSON.stringify(ev)) : undefined,
        },
      );
```

Keep the existing outcome handling, but wrap the final human `console.log(…✓…)` in `if (!progressJson)`, and in the `setupPending` branch print `JSON.stringify({ type: "error", message: "setup pending — selection not saved yet" })` instead of prose when `progressJson`.

- [ ] **Step 4: Run tests.** `pnpm -F fleetlens test` → green. `pnpm typecheck`.

- [ ] **Step 5: Commit.** `git add packages/cli && git commit -m "feat(cli): sync progress events + team sync --progress-json"` (+ trailer).

---

### Task 4: `team join` opens the wizard

**Files:**
- Modify: `packages/cli/src/team/join.ts`
- Modify: `packages/cli/src/commands/team.ts` (usage text), `packages/cli/src/index.ts` (help line ~99–104)
- Test: `packages/cli/test/team/join-config.test.ts` (new)

**Interfaces:**
- Consumes: `ensureCurrentServer`, `openBrowser` from `../server.js`; `startDaemonSilent` from `../commands/daemon.js`; Task 1 types.
- Produces: exported pure helper `carryOverSyncProjects(existing: TeamConfig | null, serverUrl: string, teamSlug: string): SyncProjects | undefined` in `join.ts`.

- [ ] **Step 1: Failing test.** `packages/cli/test/team/join-config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { carryOverSyncProjects } from "../../src/team/join.js";
import type { TeamConfig } from "../../src/team/config.js";

const existing: TeamConfig = {
  serverUrl: "http://a", memberId: "m", bearerToken: "t", teamSlug: "team-a",
  pairedAt: "x", syncProjects: { autoIncludeNew: true, included: ["w"], excluded: ["p"] },
};

describe("carryOverSyncProjects", () => {
  it("carries the selection on a re-join to the same server+team", () => {
    expect(carryOverSyncProjects(existing, "http://a", "team-a")).toEqual(existing.syncProjects);
  });
  it("drops it for a different team or server, or no prior config", () => {
    expect(carryOverSyncProjects(existing, "http://a", "team-b")).toBeUndefined();
    expect(carryOverSyncProjects(existing, "http://b", "team-a")).toBeUndefined();
    expect(carryOverSyncProjects(null, "http://a", "team-a")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**, then **Step 3: Implement.** In `join.ts`:

```ts
import { readTeamConfig, writeTeamConfig, type TeamConfig, type SyncProjects } from "./config.js";
import { ensureCurrentServer, openBrowser } from "../server.js";
import { startDaemonSilent } from "../commands/daemon.js";

export function carryOverSyncProjects(
  existing: TeamConfig | null,
  serverUrl: string,
  teamSlug: string,
): SyncProjects | undefined {
  if (existing && existing.serverUrl === serverUrl && existing.teamSlug === teamSlug) {
    return existing.syncProjects;
  }
  return undefined;
}
```

(`./config.js` re-exports from `@claude-lens/parser/fs`; add `SyncProjects` to that shim's re-export list.) Rework `joinTeam`:

```ts
export async function joinTeam(args: string[]) {
  const noBrowser = args.includes("--no-browser");
  const [serverUrl, bearerToken] = args.filter((a) => !a.startsWith("--"));
  if (!serverUrl || !bearerToken) {
    console.error("Usage: fleetlens team join <server-url> <device-token> [--no-browser]");
    // …keep the two existing hint lines…
    process.exit(1);
  }
  // …whoami fetch + error handling exactly as today…

  const existing = readTeamConfig();
  const config: TeamConfig = {
    serverUrl,
    memberId: data.membership.id,
    bearerToken,
    teamSlug: data.team.slug,
    teamName: data.team.name,
    pairedAt: new Date().toISOString(),
    // (keep the existing lastSyncedLogAt fence comment + line)
    lastSyncedLogAt: new Date().toISOString(),
    syncProjects: carryOverSyncProjects(existing, serverUrl, data.team.slug),
    // Browser path: gate the daemon until the wizard's "Start syncing".
    ...(noBrowser ? {} : { setupPending: true }),
  };
  writeTeamConfig(config);

  console.log(`Paired with "${data.team.name}" as ${data.user.displayName || data.user.email}`);
  console.log(`  role: ${data.membership.role}`);

  if (noBrowser) {
    // Legacy headless path: sync everything immediately.
    // …keep the ENTIRE existing "Syncing local history…" block through the
    //  final "Daemon polls every 5 minutes" line, unchanged…
    return;
  }

  console.log("  Opening your browser to finish setup…");
  let url: string;
  try {
    const server = await ensureCurrentServer({});
    url = `http://localhost:${server.port}/team/onboarding`;
    const daemon = startDaemonSilent();
    if (!daemon.started && !daemon.alreadyRunning) {
      console.warn(`  ⚠ Daemon failed to start — ${daemon.error}`);
    }
  } catch (err) {
    console.error(`  ⚠ Could not start the dashboard: ${(err as Error).message}`);
    console.error("  Re-run 'fleetlens team join' after fixing it, or use --no-browser to sync everything from the terminal.");
    process.exit(1);
  }
  openBrowser(url);
  console.log(`  Continue in your browser: ${url}`);
  console.log("  Nothing syncs until you finish setup there.");
}
```

Update `commands/team.ts` usage line to `join <url> <device-token> [--no-browser]   Pair with a team server (opens browser setup; --no-browser syncs everything immediately)` and the matching `index.ts` help line (~99–104) to `team join <url> <token>   Pair with a team server (browser setup)`.

- [ ] **Step 4: Run tests + typecheck.** `pnpm -F fleetlens test && pnpm typecheck` → green.

- [ ] **Step 5: Commit.** `git add packages/cli && git commit -m "feat(cli): team join launches the onboarding wizard (--no-browser for legacy inline sync)"` (+ trailer).

---

### Task 5: Web config mirror + `/api/team/sync-projects` + shared data helper

**Files:**
- Modify: `apps/web/lib/team-config.ts`
- Create: `apps/web/lib/sync-projects-data.ts`
- Create: `apps/web/app/api/team/sync-projects/route.ts`

**Interfaces:**
- Produces (consumed by Tasks 6–8):
  - `SyncProjects` type + `TeamConfig.{teamName?, setupPending?, syncProjects?}` in `apps/web/lib/team-config.ts` (deliberate mirror of the parser type — keep the existing "kept in sync intentionally" comment accurate).
  - `SyncProjectsSchema` (zod) exported from `apps/web/lib/sync-projects-data.ts`.
  - `listSyncProjectRows(): Promise<SyncProjectRow[]>` with `type SyncProjectRow = { name: string; sessions: number; agentTimeMs: number; lastActiveMs: number | null; worktreeCount: number }`.
  - `GET /api/team/sync-projects` → `{ paired: boolean; setupPending: boolean; projects: SyncProjectRow[]; syncProjects: SyncProjects | null }`; `PUT` body = `SyncProjects` → `{ ok: true }`.

- [ ] **Step 1: Extend the mirror type.** Add to `apps/web/lib/team-config.ts`'s `TeamConfig`: `teamName?: string; setupPending?: boolean; syncProjects?: SyncProjects;` plus the `SyncProjects` type (same shape/comment as Task 1). **PUT must never drop unknown fields:** `readTeamConfig` parses the whole JSON, so spread the parsed object when writing (`writeTeamConfig({ ...config, syncProjects })`) — never reconstruct field-by-field.

- [ ] **Step 2: Data helper.** `apps/web/lib/sync-projects-data.ts`:

```ts
import "server-only";
import { z } from "zod";
import { listSessions } from "@/lib/data";
import { groupByProject } from "@claude-lens/parser";

export const SyncProjectsSchema = z.object({
  autoIncludeNew: z.boolean(),
  included: z.array(z.string().min(1)).max(5000),
  excluded: z.array(z.string().min(1)).max(5000),
});

export type SyncProjectRow = {
  name: string;
  sessions: number;
  agentTimeMs: number;
  lastActiveMs: number | null;
  worktreeCount: number;
};

export async function listSyncProjectRows(): Promise<SyncProjectRow[]> {
  return groupByProject(await listSessions()).map((p) => ({
    name: p.projectName,
    sessions: p.sessions.length,
    agentTimeMs: p.metrics.totalAirTimeMs,
    lastActiveMs: p.lastActiveMs ?? null,
    worktreeCount: p.worktreeCount,
  }));
}
```

**Verify the agent-time field name** on `HighLevelMetrics` in `packages/parser/src/analytics.ts` before using `totalAirTimeMs` — use whatever field `apps/web/app/projects/page.tsx` reads for its agent-time column; they must match.

- [ ] **Step 3: Route.** `apps/web/app/api/team/sync-projects/route.ts`:

```ts
import { readTeamConfig, writeTeamConfig } from "@/lib/team-config";
import { SyncProjectsSchema, listSyncProjectRows } from "@/lib/sync-projects-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const config = readTeamConfig();
  if (!config) return Response.json({ paired: false, setupPending: false, projects: [], syncProjects: null });
  return Response.json({
    paired: true,
    setupPending: config.setupPending ?? false,
    projects: await listSyncProjectRows(),
    syncProjects: config.syncProjects ?? null,
  });
}

export async function PUT(req: Request): Promise<Response> {
  const config = readTeamConfig();
  if (!config) return Response.json({ error: "Not paired with a team." }, { status: 409 });
  const parsed = SyncProjectsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  writeTeamConfig({ ...config, syncProjects: parsed.data });
  return Response.json({ ok: true });
}
```

- [ ] **Step 4: Verify.** `pnpm typecheck` → green (web has no vitest; route smoke lands in Task 9).

- [ ] **Step 5: Commit.** `git add apps/web && git commit -m "feat(web): syncProjects config mirror + sync-projects API"` (+ trailer).

---

### Task 6: Onboarding start route (SSE relay)

**Files:**
- Create: `apps/web/app/api/team/onboarding/start/route.ts`

**Interfaces:**
- Consumes: `SyncProjectsSchema` (Task 5), `FLEETLENS_CLI_BIN` env (set by the CLI's server spawn), CLI `--progress-json` NDJSON (Task 3).
- Produces: `POST` body = `SyncProjects` → SSE stream of `event: progress` frames (each `data:` is one `SyncProgressEvent`) + terminal `event: done` frame `{ exitCode }`. Writing the config here also **clears `setupPending`** — deliberately before the spawn, so if the stream dies mid-run the daemon finishes the job on its next 5-min tick with the saved selection.

- [ ] **Step 1: Implement** (full file):

```ts
import { spawn } from "node:child_process";
import { readTeamConfig, writeTeamConfig } from "@/lib/team-config";
import { SyncProjectsSchema } from "@/lib/sync-projects-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A full-history first sync can legitimately run for minutes; kill only on
// silence, not on total duration.
const IDLE_TIMEOUT_MS = 180_000;

export async function POST(req: Request): Promise<Response> {
  const bin = process.env.FLEETLENS_CLI_BIN;
  if (!bin) {
    return Response.json(
      { error: "Onboarding sync requires the dashboard to be running via the fleetlens CLI. Run 'fleetlens team sync' in your terminal instead." },
      { status: 503 },
    );
  }
  const config = readTeamConfig();
  if (!config) return Response.json({ error: "Not paired with a team." }, { status: 409 });
  const parsed = SyncProjectsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  // Persist selection + clear the gate BEFORE spawning: if the browser
  // disconnects mid-sync the daemon completes the push on its next tick.
  const { setupPending: _cleared, ...rest } = config;
  writeTeamConfig({ ...rest, syncProjects: parsed.data });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream already closed by the client — child keeps running on purpose.
        }
      };
      const child = spawn(process.execPath, [bin, "team", "sync", "--progress-json"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
      let buffer = "";
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => child.kill("SIGKILL"), IDLE_TIMEOUT_MS);
      };
      resetIdle();
      child.stdout.on("data", (buf: Buffer) => {
        resetIdle();
        buffer += buf.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            send("progress", JSON.parse(line));
          } catch {
            send("progress", { type: "log", line });
          }
        }
      });
      child.stderr.on("data", () => resetIdle());
      child.on("close", (code) => {
        if (idleTimer) clearTimeout(idleTimer);
        send("done", { exitCode: code });
        try { controller.close(); } catch {}
      });
      child.on("error", (err) => {
        if (idleTimer) clearTimeout(idleTimer);
        send("progress", { type: "error", message: `Failed to spawn CLI: ${err.message}` });
        send("done", { exitCode: null });
        try { controller.close(); } catch {}
      });
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
```

Note: unlike `/api/team/sync`, the client aborting does NOT kill the child — the sync should finish and the daemon/`team-last-push.json` reflect it.

- [ ] **Step 2: Verify.** `pnpm typecheck` → green.
- [ ] **Step 3: Commit.** `git add apps/web && git commit -m "feat(web): onboarding start route — SSE relay over team sync --progress-json"` (+ trailer).

---

### Task 7: Wizard UI (`/team/onboarding`)

**Files:**
- Create: `apps/web/components/project-sync-picker.tsx`
- Create: `apps/web/app/team/onboarding/page.tsx`
- Create: `apps/web/app/team/onboarding/onboarding-wizard.tsx`

**Interfaces:**
- Consumes: `listSyncProjectRows`, `SyncProjectRow`, `SyncProjects` (Task 5); `POST /api/team/onboarding/start` SSE (Task 6); `SyncProgressEvent` shapes (Task 3 — mirror the union locally in the wizard file, they arrive as JSON).
- Produces: `<ProjectSyncPicker projects value onChange />` — reused verbatim by Task 8.

- [ ] **Step 1: Picker component.** `apps/web/components/project-sync-picker.tsx` (`"use client"`). Props `{ projects: SyncProjectRow[]; value: SyncProjects; onChange: (v: SyncProjects) => void }`. Behavior:
  - `checked(name)` = `value.excluded.includes(name) ? false : value.included.includes(name) ? true : value.autoIncludeNew`.
  - Toggling a row moves `name` into exactly one of `included`/`excluded` (remove from the other).
  - Search input filters rows by substring (case-insensitive); show `sessions`, agent time (`Math.round(agentTimeMs / 3_600_000 * 10) / 10`h or `m` under 1h), relative last-active, `×N worktrees` badge when `worktreeCount > 1`.
  - Footer toggle checkbox bound to `value.autoIncludeNew`, label "Automatically sync projects that appear later"; sub-copy "Unchecked projects never leave this machine."
  - "Select all" / "Deselect all" links operating on the filtered rows.
  - Style: match `apps/web/app/settings` idiom (plain Tailwind, `text-sm`, `border rounded-lg`, no new deps).

- [ ] **Step 2: Server page.** `apps/web/app/team/onboarding/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { readTeamConfig } from "@/lib/team-config";
import { listSyncProjectRows } from "@/lib/sync-projects-data";
import { OnboardingWizard } from "./onboarding-wizard";

export const dynamic = "force-dynamic";

export default async function TeamOnboardingPage() {
  const config = readTeamConfig();
  if (!config) redirect("/team");
  const projects = await listSyncProjectRows();
  return (
    <OnboardingWizard
      teamName={config.teamName ?? config.teamSlug}
      teamUrl={`${config.serverUrl.replace(/\/$/, "")}/team/${config.teamSlug}`}
      serverHost={new URL(config.serverUrl).host}
      projects={projects}
      initial={
        config.syncProjects ?? {
          autoIncludeNew: true,
          included: projects.map((p) => p.name),
          excluded: [],
        }
      }
      setupPending={config.setupPending ?? false}
    />
  );
}
```

- [ ] **Step 3: Wizard client component.** `apps/web/app/team/onboarding/onboarding-wizard.tsx` (`"use client"`). Three-step state machine (`step: 1 | 2 | 3`), progress dots header ("1 What happens · 2 Choose projects · 3 Sync").
  - **Step 1 copy (verbatim):** heading `You're pairing with “{teamName}”`. Two lists:
    - "Shared with {serverHost} every 5 minutes:" → `Daily aggregate metrics (agent time, sessions, tool calls, turns, tokens)`, `Per-project totals — project name, agent time, session count`, `Plan-utilization percentages and sync health logs`.
    - "Never leaves this machine:" → `Transcripts, prompts, and code`, `File contents and absolute paths`, `Anything from projects you exclude in the next step`.
    - Footnote: `Plan utilization is account-level and isn't affected by project selection.`
  - **Step 2:** `<ProjectSyncPicker>` with local `SyncProjects` state seeded from `initial`; counter line `Syncing N of M projects`.
  - **Step 3:** button `Start syncing` → `fetch("/api/team/onboarding/start", { method: "POST", body: JSON.stringify(selection), headers: { "Content-Type": "application/json" } })`, then read `res.body.getReader()`, decode, split frames on `"\n\n"`, take the line starting `data: `, `JSON.parse` (same consumption pattern as `apps/web/components/week-digest-view.tsx` — read it first). Render events as an appending list:
    - `phase usage-backfill` → `Uploading usage history…`; `usage` → `✓ Usage history: {inserted} new snapshots ({alreadyKnown} already on server)`;
    - `phase activity` → `Pushing {totalDays} days of activity…`; each `day` → row `“{day} ✓”` (or `⚠ queued for retry` / `✗ rejected` for `queued`/`dropped`);
    - `done` frame (`event: done`) → summary panel `All synced — {pushed} days pushed` with two links: `Open your team dashboard →` (`teamUrl`, `target="_blank"`) and `Go to your local dashboard` (`href="/"`); non-zero `exitCode` or an `error` event → red panel with the message and a `Retry` button (re-runs the POST).
  - Handle the 503 (dev-mode) JSON response by showing its `error` text and the fallback `fleetlens team sync` hint.
  - Navigation: Continue/Back buttons; step 3's Start button disabled while streaming.

- [ ] **Step 4: Verify.** `pnpm typecheck` → green.
- [ ] **Step 5: Commit.** `git add apps/web && git commit -m "feat(web): three-step team onboarding wizard with live sync progress"` (+ trailer).

---

### Task 8: Settings section + `/team` page banner/copy

**Files:**
- Create: `apps/web/app/settings/synced-projects-section.tsx` (server) + `apps/web/app/settings/synced-projects-form.tsx` (client)
- Modify: `apps/web/app/settings/page.tsx` (insert `<SyncedProjectsSection />` after `<TeamConnectionSection />`)
- Modify: `apps/web/app/team/page.tsx` (banner + stale copy)

**Interfaces:**
- Consumes: `ProjectSyncPicker` (Task 7), `listSyncProjectRows` + `SyncProjectsSchema` route (Task 5).

- [ ] **Step 1: Server section.** `synced-projects-section.tsx`: read `readTeamConfig()`; return `null` when unpaired. When `setupPending`, render a short note linking to `/team/onboarding` instead of the editor. Else `const projects = await listSyncProjectRows()` and render `<SyncedProjectsForm projects={projects} initial={config.syncProjects ?? { autoIncludeNew: true, included: [], excluded: [] }} />` inside a `<section>` titled `Synced projects` with sub-copy: `Choose which projects share metrics with your team. Changes apply within ~5 minutes; already-synced history stays on the server.`

- [ ] **Step 2: Client form.** `synced-projects-form.tsx`: `useState` selection, `<ProjectSyncPicker>`, Save button → `PUT /api/team/sync-projects`, show `Saved.` / error text (mirror `ai-features-form.tsx`'s pattern — read it first).

- [ ] **Step 3: `/team` page.** In `apps/web/app/team/page.tsx`:
  - Add the banner right after `<h1>` when `config.setupPending`:

```tsx
        {config.setupPending && (
          <div className="border border-amber-400/40 bg-amber-400/10 rounded-lg p-4 text-sm">
            Setup isn't finished — nothing is syncing yet.{" "}
            <a className="underline font-medium" href="/team/onboarding">Finish onboarding</a>
          </div>
        )}
```

  - Update the file-header comment and any on-page prose claiming "all active projects … no member-side gating" to reflect the selection (e.g. "Projects are shared according to your Synced-projects selection (Settings)."). When `config.syncProjects` exists, show a one-line summary: `Syncing: all projects except N excluded` / `only N selected projects` (derive from `autoIncludeNew`).

- [ ] **Step 4: Verify.** `pnpm typecheck` → green.
- [ ] **Step 5: Commit.** `git add apps/web && git commit -m "feat(web): synced-projects settings editor + team page setup banner"` (+ trailer).

---

### Task 9: Smoke route, team-server copy, changelog

**Files:**
- Modify: `scripts/smoke.mjs` (add `/team/onboarding` next to the existing `/team` entry — read the file for the list format)
- Modify: `packages/team-server/src/components/pair-cli-panel.tsx`, `packages/team-server/src/components/signup-form.tsx` (one sentence near the command display: `Your browser will open to finish setup — choose which projects to share, then start syncing.`)
- Modify: `CHANGELOG.md` — add at the top (below the header, above `## [0.14.0]`):

```markdown
## [Unreleased]

### Added
- `fleetlens team join` now opens a browser onboarding wizard: explains exactly what data leaves the machine, lets you choose which projects sync to the team, and streams first-sync progress live. `--no-browser` keeps the old terminal-only behavior.
- Synced-projects editor in Settings — change the selection any time; the daemon applies it within ~5 minutes.
- `fleetlens team sync --progress-json` — machine-readable NDJSON progress events.
```

- [ ] **Step 1: Make the three edits.**
- [ ] **Step 2: Verify** `pnpm typecheck` and `pnpm -F @claude-lens/team-server test` (copy-only change must not break it).
- [ ] **Step 3: Commit.** `git add scripts CHANGELOG.md packages/team-server && git commit -m "chore: onboarding smoke route, pair-panel copy, changelog"` (+ trailer).

---

### Task 10: End-to-end verification (orchestrator-run — not for implementation subagents)

- [ ] Full build in the worktree: `rm -rf apps/web/.next packages/cli/app && NEXT_OUTPUT=standalone pnpm -F @claude-lens/web build && node scripts/prepare-cli.mjs && pnpm -F fleetlens build`, plus `pnpm test && pnpm typecheck`.
- [ ] Local team-server up (dev DB) + fresh account via the signup API → device token.
- [ ] Isolated CLI home: `CCLENS_HOME=/tmp/cclens-onboard-e2e CCLENS_PORT=3399 node packages/cli/dist/index.js team join <url> <token>` → assert: browser opens `/team/onboarding`, terminal prints the URL, `team.json` has `setupPending: true`, and `team sync` refuses with the setup-pending hint.
- [ ] Drive the wizard in a real browser: step 1 copy renders; step 2 exclude one project; step 3 streams per-day progress and lands on the summary.
- [ ] Server-side assertion: `rich_daily_rollups.projects` jsonb for the new member contains only selected projects; excluded name appears nowhere.
- [ ] Settings: flip the excluded project back on, `fleetlens team sync`, assert it now appears server-side.
- [ ] `--no-browser` path still does the full inline sync on a second fresh account.
- [ ] `pnpm verify` smoke against the running local server.
