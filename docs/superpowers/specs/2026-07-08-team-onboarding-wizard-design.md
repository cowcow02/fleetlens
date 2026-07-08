# Team onboarding wizard — browser-based pairing setup

**Date:** 2026-07-08 · **Branch:** `feat/team-onboarding-wizard` · **Worktree:** `.worktrees/onboard`
Extends `2026-05-16-personal-to-team-bridge-design.md` (original pairing design).

## Problem

`fleetlens team join <url> <token>` verifies the device token, writes `~/.cclens/team.json`, and immediately pushes the member's **full local history inline** — every project on the machine, no explanation of what leaves the laptop, no consent granularity. Personal projects sync to the employer's team server whether the user wants that or not ("every project the member worked on is included — there is no per-project gating", `packages/cli/src/team/push.ts:161`).

## Goals

1. Keep `fleetlens team join <url> <token>` as the terminal entry point.
2. After token verification, the CLI starts the local web server + daemon and opens a **browser wizard**.
3. The wizard explains exactly what data leaves the machine.
4. The wizard lets the user choose which projects sync — all pre-checked, plus an "automatically sync new projects" toggle (default ON).
5. "Start syncing" pushes full history for the selected projects with **real-time progress** in the browser.
6. The selection is editable later via **Settings → Synced projects**.

## Non-goals

- History-depth/range control — full history always (decision 2026-07-08).
- Retroactive scrubbing of already-pushed data on the server.
- Team-server schema or ingest changes — payloads are unchanged; a filtered subset simply arrives.
- Per-payload-block opt-outs (enrichment etc.) — the session-level project filter is the only control.

## Approaches considered

- **A. CLI-orchestrated browser wizard in the local dashboard (chosen).** CLI does the handshake and gates sync; the local web app hosts the wizard; the selection lives in `team.json`, which the daemon already hot-reads every 5-min sync cycle.
- **B. Terminal-only interactive picker.** Rejected: poor multi-select UX, no rich explanation surface, doesn't meet the ask.
- **C. Wizard hosted on the team-server.** Rejected: the server would learn the names of *unselected* local projects — violates the local-first privacy invariant.

## Design

### 1. TeamConfig additions (`packages/parser/src/team-config.ts`; mirrored in `apps/web/lib/team-config.ts`)

```ts
setupPending?: boolean;      // written by join, cleared by the wizard's "Start syncing"
syncProjects?: {
  autoIncludeNew: boolean;   // wizard toggle, default true
  included: string[];        // checked at selection time (projectRepoName keys)
  excluded: string[];        // unchecked at selection time
};
```

Filter semantics for a session's repo name `R`: `R ∈ excluded` → drop; `R ∈ included` → keep; unknown (project appeared after selection) → keep iff `autoIncludeNew`. Absent `syncProjects` = sync everything; absent `setupPending` = not gated — existing paired members are unaffected (back-compat).

### 2. CLI join flow (`packages/cli/src/team/join.ts`)

1. Verify via `GET /api/team/whoami` (unchanged).
2. Write `team.json` with `setupPending: true`. Re-join to the same server+team preserves an existing `syncProjects`.
3. **No inline sync anymore** (moved behind the wizard).
4. `ensureCurrentServer` + `startDaemonSilent` — join now guarantees both are running.
5. `openBrowser("http://localhost:<port>/team/onboarding")` and print the URL (fallback if the browser fails to open).
6. `--no-browser`: legacy path for SSH/headless — no `setupPending`, run today's inline full sync.

### 3. Sync gate + project filter (`packages/cli/src/team/sync.ts`, `push.ts`)

- `runTeamSync` bails idle when `setupPending`, reason `setup pending — finish onboarding at <url>`. `fleetlens team status` / `team sync` print the same hint.
- One choke point `filterSyncedSessions(sessions, config)` applied where sessions enter payload building (before `buildRollupsForRange` / `buildRichBlocksForDay` / enriched extras / artifact signals). Key = `projectRepoName(canonicalProjectName(session.projectName))` — the same key the wizard lists and the payload uses.
- Excluded projects therefore vanish from **both** the per-project rows and the daily totals — no leak via total-minus-sum.
- Machine-level blocks unaffected by the filter: `usageSnapshot`, `cyclePeaks`, `planTier`, `snapshotHistory`, `syncLog`. The wizard copy states this.

### 4. Progress streaming

- `runTeamSync` gains `onProgress?: (ev) => void` emitting `{type: "phase"|"usage"|"day"|"queued"|"drained"|"done"|"error", …}` at the existing seams (usage backfill batches, per-day pushes, queue events).
- `fleetlens team sync --progress-json` prints one NDJSON line per event to stdout; behavior without the flag is unchanged.
- New route `POST /api/team/onboarding/start`: writes `syncProjects` + clears `setupPending` (read-merge-write of `team.json`), then spawns `FLEETLENS_CLI_BIN team sync --progress-json` and converts NDJSON stdout → SSE frames (same shape as the digest POST routes). 503 when `FLEETLENS_CLI_BIN` is unset (dev mode), with terminal-fallback copy in the UI.

### 5. Wizard (`apps/web/app/team/onboarding/`)

Server component: `readTeamConnection()` (redirect to `/team` when unpaired) + `groupByProject(await listSessions())` projected to plain rows `{name, sessions, agentTimeMs, lastActiveMs, worktreeCount, agents}`.

Client component, 3 steps:

1. **What happens** — team name / server host; exact list of what syncs (daily aggregates, per-project name + agent time + session counts, plan-utilization %, sync log lines) and what never leaves (transcripts, prompts, file contents, absolute paths — artifact signals are path-hash-only); 5-minute cadence.
2. **Choose projects** — checkbox rows (all pre-checked) with sessions / agent time / last active / worktree badge, search filter, auto-include-new toggle (default ON). Selection stays in client state until step 3 — no partial writes.
3. **Start syncing** — POST + stream; live progress list (per-day ✓ with project count, usage snapshot batches); terminal summary + links to the team dashboard (`serverUrl/team/<slug>`) and the local `/team` page. Errors surface the event message with a retry button.

`/team` page shows a "Finish setup" banner while `setupPending` (wizard-abandonment recovery).

### 6. Settings → Synced projects (`apps/web/app/settings/`)

- Shared `<ProjectSyncPicker>` component used by wizard step 2 and Settings.
- `GET/PUT /api/team/sync-projects`: GET returns the project list + current `syncProjects`; PUT read-merge-writes `team.json`. Rendered only when paired. Copy notes changes take effect within ~5 min and are not retroactive server-side.

### 7. Team-server copy

One-line copy tweak in `pair-cli-panel.tsx` / `signup-form.tsx`: "your browser will open to finish setup". No schema or API changes.

## Edge cases

- Wizard abandoned → daemon stays gated; recovery via the `/team` banner, re-running join (idempotent), or the `team sync` hint.
- CLI downgraded after a wizard join: old CLI ignores the unknown fields and would sync everything. Accepted, documented risk (rare).
- Web server port conflicts / version cycling: existing `ensureCurrentServer` behavior.
- Concurrent daemon tick during the wizard-triggered sync: cross-process overlap is tolerated today (idempotent upserts + ingestId dedup) — unchanged.
- Project appears mid-wizard: not in the list; governed by `autoIncludeNew`.

## Testing / verification

- Unit (vitest, `packages/cli`): filter matrix (included/excluded/unknown × autoIncludeNew), gate bail, progress-event order. Parser: `TeamConfig` round-trip preserving new fields.
- `pnpm verify` smoke: `/team/onboarding` returns 200.
- E2E (evidence before "done"): local team-server + `CCLENS_HOME`-isolated CLI; fresh signup → join → real browser wizard → exclude one project → start syncing → assert SSE progress renders **and** the server's `rich_daily_rollups.projects` jsonb contains only selected projects; then flip the selection in Settings and assert the next sync respects it.
