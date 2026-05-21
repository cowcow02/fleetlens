# Team-pairing visibility in Personal Edition

**Status:** design
**Date:** 2026-05-21
**Author:** Charlie (with Claude)

## Problem

A team member who has paired the Personal Edition with a Team Edition server
gets **zero feedback in the dashboard they actually look at every day**. After
running `fleetlens team join …`, the daemon silently pushes daily rollups and
usage snapshots every 5 minutes — and the only way to see any of that is to
drop into a terminal and run `fleetlens team status` or `fleetlens team logs`.

That silence is what creates the concern. Members aren't worried because the
sync is doing something wrong; they're worried because they can't see what it's
doing. The actual privacy story is reassuring (no transcripts, no prompts, no
project content), but if nobody on the dashboard ever says so, the absence
reads as opacity.

## Goal

Make the team-server connection **visible, inspectable, and reassuring** from
inside the dashboard, without changing what the daemon already pushes.
Specifically:

1. **Ambient visibility** — every page of the dashboard should make it obvious
   that pairing is active and healthy.
2. **Inspect-and-verify transparency** — the user should be able to see the
   exact numbers that left their machine in the most recent sync.
3. **Onboarding orientation** — a first-paired user should be told what just
   changed, in plain language, the first time they open the dashboard.
4. **In-app control over freshness** — a "Force sync now" button on the
   settings panel, surfacing the CLI's actual output, so the user never has to
   open a terminal just to confirm the connection is alive.

Disconnecting from a team stays CLI-only (`fleetlens team leave`). This is a
deliberate non-goal: the dashboard's job here is transparency, not membership
management.

## Surfaces

Three new surfaces in `apps/web`, all hidden when the user is not paired.

### 1. Sidebar footer chip

A persistent element placed between the existing `UsageSidebar` and the
version/settings row in `apps/web/components/sidebar.tsx`.

Layout: `● Team: <team-name> · synced 2m ago`

- The dot signals health, derived purely from the most recent push timestamp:
  - **green** — last push < 15 min ago
  - **amber** — last push 15–60 min ago, or paired but no push yet
  - **red** — last push > 60 min ago, or the most recent push recorded an error
- Clicking the chip navigates to `/settings#team`.
- Hover tooltip shows the absolute timestamp and a one-line hint
  ("Click to inspect what's synced.").

### 2. `/settings` → "Team connection" section

A new section added to `apps/web/app/settings/page.tsx`, rendered above the
existing AI Features section. Server-rendered (no client state).

Contents, top to bottom:

- **Header**: `Team connection — <team-name>` plus a small role pill
  (`member` / `lead` / `admin`).
- **Metadata block**: server URL, paired-at date, last-sync-at relative time.
- **Last-push preview** — see below.
- **"What does NOT leave your machine"** — see below.
- **Force sync now** — see below.
- **Closing line**: *"To disconnect from this team, run
  `fleetlens team leave` in your terminal."*

### 3. First-run welcome banner on `/`

A dismissable banner at the top of the overview page (`apps/web/app/page.tsx`).
One paragraph:

> You joined **<team-name>**. Fleetlens now syncs your daily activity totals
> and current cycle utilization to the team dashboard every 5 minutes.
> Transcripts, prompts, and project content never leave your machine.
> [See exactly what's shared →](/settings#team)

Dismiss writes a localStorage flag keyed by `pairedAt`
(`fleetlens:team-welcome-seen:<pairedAt>`). Re-pairing produces a new
`pairedAt`, so the banner will fire again — which is the correct behavior, as
"you just joined a team" is exactly when the explainer is most useful.

## Last-push preview

Plain-English rendering of the most recent successful `IngestPayload`. The
preview reads from a single on-disk artifact written by the sync code (see
"Data flow"), so there's no risk of drift between what the panel shows and
what actually went out.

Example rendering:

> **Last push — 2 minutes ago**
> - **Yesterday (2026-05-20):** 4h 12m agent time · 23 sessions · 187 tool calls · 612 turns · 1.2M tokens
> - **Current usage:** 5h cycle at 41% · 7d cycle at 22% · plan tier: pro-max
> - **Cycle peaks (last 3 five-hour cycles):** 38%, 52%, 41%

States:

- **Normal**: render as above.
- **Paired but no push yet** (just joined, daemon hasn't fired): *"Waiting for
  the first sync — the daemon pushes every 5 minutes."* No spinner.
- **Last sync failed**: render the most recent error line in red, e.g.
  *"Token revoked — run `fleetlens team leave` then re-join."*

## "What does NOT leave your machine"

A short, plain-language list. Required to read as reassurance, not as legal
disclaimer — the wording is part of the design.

- Session transcripts, prompts, or assistant responses
- Project names, paths, or repo information
- File contents or tool-call payloads
- Anything from sessions older than the start-of-day rollup window

## Force sync now

A button below the last-push preview labeled `[ Sync now ]`, with the
subtitle *"Push immediately instead of waiting for the next 5-minute daemon
cycle."*

On click:

1. Button enters a "Syncing…" state with an inline spinner.
2. Client POSTs to `/api/team/sync` (new route — see "Data flow").
3. Response renders inline directly below the button using the exact CLI
   output lines — so what the user sees on the page is byte-identical to what
   `fleetlens team sync` would print at the terminal.
4. On success, `router.refresh()` fires so the **last-push preview above
   updates with the fresh numbers**. The settings page is server-rendered, so
   refresh re-reads the on-disk last-push artifact.
5. On error (non-zero exit), surface the CLI's stderr line in red.

Disabled state: if `FLEETLENS_CLI_BIN` is not set in the Next.js process env
(i.e. `pnpm dev` mode where Next.js is running standalone without the
`fleetlens` parent process), the button renders disabled with tooltip
*"Force sync is only available when running via the `fleetlens` CLI."*

## Data flow

### Writing the last-push artifact (CLI side)

`packages/cli/src/team/sync.ts` is extended so that `runTeamSync` writes
`~/.cclens/team-last-push.json` after each push attempt. One file, overwritten
in place — not append-only. The shape is:

```ts
type LastPushRecord = {
  pushedAt: string;          // ISO timestamp
  ok: boolean;
  // The payload that was sent (or attempted), with no extra fields.
  // Includes dailyRollup (if any), usageSnapshot, planTier, cyclePeaks.
  payload: IngestPayload;
  // Present when ok === false; the human-readable line the CLI would print.
  error?: string;
};
```

Behavior:

- **Successful push** (HTTP 2xx): write `ok: true`, the `payload` we POSTed,
  no `error`.
- **Failed push** (HTTP error or fetch threw): write `ok: false`, the
  `payload` we attempted, and a human-readable `error` line.
- **Idle cycle with no live data** (nothing to push at all): do not touch the
  file. The previous record remains the source of truth for "last push".
- **`fleetlens team leave`**: delete the file alongside the team config so the
  panel disappears cleanly on the next render.

This file lives under `~/.cclens/` (the existing state directory). No new
directory.

### Reading the connection state (web side)

New module `apps/web/lib/team-data.ts`, server-only. Single exported function:

```ts
export function readTeamConnection(): TeamConnection;

type TeamConnection =
  | { paired: false }
  | {
      paired: true;
      team: { name: string; slug: string; serverUrl: string };
      member: { role: string; pairedAt: string };
      lastPush:
        | { kind: "none" }                    // paired but no push yet
        | { kind: "ok"; at: string; payload: IngestPayload }
        | { kind: "error"; at: string; error: string; payload: IngestPayload };
      health: "green" | "amber" | "red";      // derived from lastPush
    };
```

Internally it reads `readTeamConfig()` from the CLI's team module (already
file-backed) and the new `team-last-push.json`. The web app already imports
`@claude-lens/parser/fs` for similar disk-backed reads; team config and
last-push live under `~/.cclens/` so they're equally reachable.

The team config currently lives in `packages/cli/src/team/config.ts`. To keep
the web app from depending on `@fleetlens/cli`, we move the config
reader/writer into a new file `packages/parser/src/team-config.ts`, exported
via the existing `@claude-lens/parser/fs` entry point as `readTeamConfig` /
`writeTeamConfig` / `clearTeamConfig`. This is a thin file-IO module
(~30 lines, already imports `cclensHome` from `fs.ts`) — moving it does not
pull any sync/push logic into the parser. The CLI's `team/config.ts` becomes
a thin re-export so existing CLI call sites are untouched.

One field is added to `TeamConfig` at the same time: `teamName: string`.
`joinTeam` already has `data.team.name` available from the whoami response,
so writing it to config at pairing time is free. The new field is what the
chip and settings header display; `teamSlug` is kept for URL/identifier use.
Existing configs without the field are tolerated by falling back to
`teamSlug` for display.

This is the only refactor required by the design. Everything else is
additive.

### Triggering a sync from the web UI

New API route `apps/web/app/api/team/sync/route.ts`, POST only.

```ts
export async function POST() {
  const bin = process.env.FLEETLENS_CLI_BIN;
  if (!bin) {
    return Response.json(
      { ok: false, error: "FLEETLENS_CLI_BIN not set" },
      { status: 503 },
    );
  }
  // spawn `node <bin> team sync`, capture stdout + stderr + exit code,
  // 30s timeout. Return { ok, lines, exitCode, error? }.
}
```

The CLI sets `FLEETLENS_CLI_BIN=process.argv[1]` when it spawns the Next.js
standalone server (see `packages/cli/src/index.ts` — the spot where the web
server child process is launched today). This is the only CLI change required
for the sync route to work.

The subprocess approach is deliberate:

- It reuses the exact CLI flow and output formatting, so what renders on the
  page is what would render at the terminal.
- It avoids a multi-package refactor that would otherwise be needed to make
  `runTeamSync` importable from `apps/web` (the team module currently lives
  in `packages/cli/src/team/` and imports CLI-only helpers).
- It cleanly isolates the long-running sync from the Next.js request loop;
  the route can stream stdout incrementally if we ever want to, but for v1 a
  simple "wait, then return" is enough since a normal sync is < 5 s.

### LiveRefresher

`apps/web/components/live-refresher.tsx` subscribes to SSE from
`apps/web/app/api/events/route.ts`, which watches JSONL files under
`~/.claude/projects/` and emits change events. The route adds
`~/.cclens/team-last-push.json` to its watch set and emits a `team-push`
event on change; the client calls `router.refresh()` on receipt. The sidebar
chip's "synced 2m ago" then stays fresh without polling.

This is a small additive change to two files; not a redesign.

## Re-entrancy

The daemon polls every 5 minutes and may be running `runTeamSync` at the
exact moment the user clicks "Sync now". No lock is added because:

- Each `runTeamSync` builds its own `IngestPayload` with a distinct
  `ingestId`.
- The team server already dedups on `ingestId`.
- Worst case is a wasted POST.

A lock would cost complexity (lockfile + stale-lock recovery) for no real
user-visible benefit.

The local last-push file IS subject to a write race in this scenario: if both
the daemon and the route finish at the same moment, the later writer wins.
This is acceptable — both writers are writing the same shape and roughly the
same content (only `pushedAt` differs by milliseconds).

## Components inventory

New:

- `apps/web/lib/team-data.ts` — server-only reader.
- `apps/web/components/team-chip.tsx` — sidebar chip. Pure props, no
  fetching.
- `apps/web/components/team-welcome-banner.tsx` — overview banner. Client
  component, manages localStorage dismiss flag.
- `apps/web/app/settings/team-connection-section.tsx` — server component
  rendered inside the settings page.
- `apps/web/app/settings/force-sync-button.tsx` — client component that POSTs
  to `/api/team/sync` and renders the result lines.
- `apps/web/app/api/team/sync/route.ts` — POST handler that spawns the CLI.

Touched:

- `apps/web/components/sidebar.tsx` — render `<TeamChip />` above the version
  row.
- `apps/web/app/page.tsx` (overview) — render `<TeamWelcomeBanner />` at the
  top.
- `apps/web/app/settings/page.tsx` — render the new team-connection section.
- `apps/web/app/api/events/route.ts` — add `~/.cclens/team-last-push.json`
  to the watch set and emit a `team-push` SSE event on change.
- `apps/web/components/live-refresher.tsx` — handle the `team-push` event by
  calling `router.refresh()`.
- `packages/cli/src/team/sync.ts` — write `team-last-push.json` on success
  and on terminal failure.
- `packages/cli/src/team/leave.ts` — delete `team-last-push.json` alongside
  the team config.
- `packages/cli/src/index.ts` — set `FLEETLENS_CLI_BIN` when spawning the
  Next.js server.
- `packages/parser/src/team-config.ts` (new) — host the moved
  `readTeamConfig` / `writeTeamConfig` / `clearTeamConfig`. Re-exported via
  the existing `@claude-lens/parser/fs` entry point.
- `packages/cli/src/team/config.ts` — becomes a thin re-export of the
  parser-side module.

## Edge cases

- **Just paired, daemon hasn't pushed yet**: chip is amber with text
  *"Team: foo · waiting…"*. Settings panel preview shows the
  "Waiting for the first sync…" copy. Banner is shown. No spinner anywhere.
- **Daemon stopped**: stale timestamp drifts past 15 min → amber, then > 60
  min → red. Tooltip text changes to *"Last sync was X ago — is the daemon
  running? Run `fleetlens daemon status`."* The Force sync button still
  works.
- **Token revoked server-side**: the CLI's existing sync code logs and
  surfaces the 401. With this design, the failure is also captured in
  `team-last-push.json` as `{ ok: false, error: "Token revoked — …" }`, so
  the settings panel renders that message in red without needing a separate
  health-check round-trip.
- **Personal-only user (never paired)**: chip hidden, banner never fires,
  settings section absent. No "Join a team" CTA — keeps the personal edition
  uncluttered for solo users.
- **`pnpm dev` for `apps/web`** (no parent CLI): everything still renders;
  Force sync button is disabled with tooltip. Last-push preview reads
  whatever happens to be on disk.

## Testing

- `packages/cli/test/team/sync.test.ts` — assert that
  `team-last-push.json` is written with the correct shape after a successful
  push, overwritten on subsequent pushes, and contains `ok: false` plus an
  `error` line on 401.
- `packages/cli/test/team/leave.test.ts` — assert that `team-last-push.json`
  is removed by `team leave`.
- `apps/web` — smoke test (`pnpm verify`) hits `/`, `/settings`, and
  `/api/team/sync` (the route should 503 cleanly without
  `FLEETLENS_CLI_BIN`). No additional vitest tests; the components are
  thin presentational wrappers around the typed reader.
- Manual end-to-end check via the existing `scripts/seed-team-demo.mjs` —
  pair against the local demo team server, observe chip + settings panel +
  banner in the browser, click "Sync now" and confirm the result line
  matches `fleetlens team sync` output in a parallel terminal.

## Non-goals

- **No disconnect button in the UI.** Disconnect stays as
  `fleetlens team leave`.
- **No push history log.** The single most-recent push artifact is the
  transparency surface. Power users who want history use `fleetlens team
  logs`.
- **No new team-server-side changes.** This feature is entirely a Personal
  Edition addition.
- **No new permanent network calls.** The settings panel reads from disk;
  the only network call added is the on-demand POST that the user
  explicitly clicks "Sync now" to trigger.
- **No CLI button for `team backfill`.** Force-sync covers the "outdated,
  push now" case; the rare full-history rebuild stays in the terminal.

## Open questions

None. All design choices are locked in for implementation.
