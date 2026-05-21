# Team-issued commands to member daemons

**Status:** design
**Date:** 2026-05-21
**Author:** Charlie (with Claude)

## Problem

A team admin can see when a member's data is incomplete (a gap in the daily-activity dashboard, a stale "last push" timestamp) but has no way to do anything about it. The only recovery path today is to ask the member individually to run `fleetlens team backfill` in their terminal — which doesn't scale, requires per-member coordination, and is exactly the kind of friction that turns a recoverable hole into a permanent one.

Members shouldn't have to operate their own dashboard for routine recovery. The trust scope established at pairing time (push aggregates to the team server) already covers "push the same aggregates over a wider time window when asked". An admin should be able to click a button on the team dashboard and have the work flow back from member daemons within their normal sync cadence.

## Goal

Let the team admin issue a **backfill-activity** command from the team dashboard against any paired member. The member's daemon picks it up on its next 5-minute sync, executes the backfill (re-pushes daily activity rollups for the last N days, server upserts), and reports completion. Member-side surfaces show no extra UI — the existing "last sync N ago" display updates naturally when the daemon completes its work, and the admin sees the same indicator tick green on the team dashboard.

This establishes a general command channel (server → daemon) that future command types can ride on without re-architecting. Backfill is the first concrete use case; the design accommodates more.

## Architecture

The daemon already POSTs `IngestPayload` to `/api/ingest/metrics` every 5 minutes. We piggyback admin-issued commands onto the server's **response** to those pushes. Zero new connections, zero new polling.

```
Admin clicks "Backfill 30 days" on team dashboard's member detail page
        │
        ▼
team-server: INSERT INTO member_commands (membership_id, type, params, issued_by_id)
        │  (response: {ok, command: {id, type, params}})
        │
        ▼   (waits for the member's next normal push — at most 5 min)
        │
member daemon POST /api/ingest/metrics  ─────►  Response includes:
                                                  {
                                                    ok: true,
                                                    snapshotHistory: {...},
                                                    commands: [
                                                      { id, type: "backfill-activity",
                                                        params: { days: 30 } }
                                                    ]
                                                  }
        │
        ▼
daemon parses `commands`, dispatches each:
  • backfill-activity → buildRollupsForRange(sessions, today − days)
                       → push each rollup as a normal POST (server upserts)
                       → collect { ok: true, completedAt, summary: { pushed: N } }
        │
        ▼
daemon's next normal push carries `commandResults` field:
  {
    ingestId, observedAt, dailyRollup,
    commandResults: [{ id, ok: true, completedAt, summary: { pushed: 30 } }]
  }
        │
        ▼
server marks command complete, stops echoing it in subsequent responses
        │
        ▼
admin sees "last push" timestamp on the member's row tick green;
historical activity rows now present in the team dashboard
```

The crucial constraint, which preserves the privacy guarantee we shipped in [`2026-05-21-team-pairing-visibility-design.md`](./2026-05-21-team-pairing-visibility-design.md): **commands can only widen the time window, not the data shape**. The daemon's command dispatcher only knows how to execute existing push paths (which are already aggregate-only). The admin can say "re-push the last N days of aggregates"; they cannot say "send me your prompts" because no such command exists in the dispatcher.

## Wire schema

Both new fields are optional additions to existing payload shapes. Older CLIs ignore `commands` (they don't dispatch anything). Older servers ignore `commandResults`. Fully backwards-compatible.

### Server response to `/api/ingest/metrics` (add)

```ts
type IngestResponse = {
  ok: boolean;
  // ... existing fields (snapshotHistory result, nextSyncAfter, etc.)
  commands?: ServerCommand[];
};

type ServerCommand = {
  id: string;                                    // server-issued, e.g. "cmd_<ULID>"
  type: "backfill-activity";                     // extensible — switch in client
  params: { days: number };                      // shape per type; days >= 1, <= 365
};
```

### Daemon push payload (add to existing `IngestPayload`)

```ts
type IngestPayload = {
  ingestId: string;
  observedAt: string;
  // ... existing optional fields (dailyRollup, usageSnapshot, planTier, cyclePeaks, snapshotHistory)
  commandResults?: CommandResult[];
};

type CommandResult =
  | { id: string; ok: true; completedAt: string; summary?: Record<string, unknown> }
  | { id: string; ok: false; completedAt: string; error: string };
```

## Server-side changes (`packages/team-server`)

### Database migration

New table — `packages/team-server/src/db/migrations/0005_member_commands.sql`:

```sql
-- description: Server-issued commands to member daemons (backfill, etc.)

CREATE TABLE member_commands (
  id              text PRIMARY KEY,                       -- 'cmd_' + ULID
  team_id         uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  membership_id   uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  command_type    text NOT NULL,                          -- 'backfill-activity'
  params          jsonb NOT NULL DEFAULT '{}'::jsonb,
  issued_by_id    uuid NOT NULL REFERENCES user_accounts(id),
  issued_at       timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,                            -- first ingest response that carried it
  completed_at    timestamptz,                            -- daemon reported result
  result          jsonb                                   -- { ok, error?, summary? }
);

CREATE INDEX idx_member_commands_pending
  ON member_commands (membership_id, completed_at)
  WHERE completed_at IS NULL;

CREATE INDEX idx_member_commands_team_recent
  ON member_commands (team_id, issued_at DESC);
```

Drizzle schema entry added to `packages/team-server/src/db/schema.ts` mirroring the table.

### Ingest handler changes (`packages/team-server/src/lib/ingest.ts`)

Inside `processIngest`, after the existing payload processing:

1. **Process incoming `commandResults`** (if present):
   - For each result, `UPDATE member_commands SET completed_at = now(), result = $1 WHERE id = $2 AND membership_id = $3 AND completed_at IS NULL`.
   - Silently no-op on unknown IDs (replay protection; daemon doesn't care).

2. **Fetch pending commands for this member**:
   - `SELECT id, command_type, params FROM member_commands WHERE membership_id = $1 AND completed_at IS NULL ORDER BY issued_at LIMIT 10`.
   - Stamp `delivered_at = now()` for any without a value (first delivery).
   - Include the result in the response under `commands`.

The limit of 10 prevents a runaway "admin queued 500 commands" scenario from making every response huge. Excess commands just wait for the next sync.

### Admin endpoint

New route — `packages/team-server/src/app/api/admin/members/[id]/commands/route.ts`:

```
POST /api/admin/members/:membershipId/commands
Body: { type: "backfill-activity", params: { days: 30 } }
```

Behavior:
- Auth: require an authenticated session (existing pattern) where the calling user is either staff (`session.user.is_staff`) or has `role = 'admin'` in the target member's team.
- Validate `params` per `type`: for `backfill-activity`, `days` is an integer in `[1, 365]`.
- Idempotency: if there's already a pending command of the same type + same params for this member (where `completed_at IS NULL`), return the existing row rather than creating a duplicate. Prevents "admin double-clicks the button" causing two backfills.
- Returns `201 Created` with the row, or `200 OK` with the existing row on dedup.

### Admin UI

A single button on the member detail page (`packages/team-server/src/app/team/[slug]/members/[id]/page.tsx`).

Placement: in the existing actions area for the member. Label: **"Request 30-day backfill"**. Click opens a minimal confirmation:

> Queue a 30-day activity backfill for this member?
> The member's daemon will pick it up on its next sync (within 5 minutes) and re-push their last 30 days of daily activity. Already-recorded days are upserted, not duplicated.
> [Cancel] [Queue command]

On submit, POSTs to the new endpoint. Toasts `"Command queued — will execute on member's next sync."` and refreshes the page. If there's already a pending command, the toast says `"Backfill already queued (will execute on next sync)."` so a flustered admin doesn't think the system is broken.

(Per the design conversation: we deliberately do NOT add a "command history" panel on either side. The existing "last push N ago" timestamp is the feedback signal. If admins later want a full history view, that's a follow-up — not blocking.)

## Client-side changes (`packages/cli`)

### New module `packages/cli/src/team/commands.ts`

Pure dispatcher with one initial command type:

```ts
import type { TeamConfig } from "@claude-lens/parser/fs";

export type ServerCommand =
  | { id: string; type: "backfill-activity"; params: { days: number } };

export type CommandResult =
  | { id: string; ok: true; completedAt: string; summary?: Record<string, unknown> }
  | { id: string; ok: false; completedAt: string; error: string };

export async function dispatchCommand(
  command: ServerCommand,
  config: TeamConfig,
  log: (level: "info" | "warn", msg: string) => void,
): Promise<CommandResult> {
  switch (command.type) {
    case "backfill-activity":
      return runActivityBackfill(command, config, log);
    default:
      // TypeScript narrows — but defensive runtime branch for forward compat.
      return {
        id: (command as { id: string }).id,
        ok: false,
        completedAt: new Date().toISOString(),
        error: `Unknown command type: ${(command as { type: string }).type}`,
      };
  }
}
```

`runActivityBackfill`:
- Reads sessions via `listSessions({ limit: 10_000 })`.
- Computes `targetDay = formatLocalDay(today - params.days)`.
- Calls `buildRollupsForRange(sessions, targetDay)` — same helper as normal sync.
- Pushes each rollup serially via `pushToTeamServer` (no live snapshot/cyclePeaks attached; this is historical-only).
- Critically, does NOT touch `config.lastSyncedDay`. The watermark stays where it was; we're filling in past days, not advancing the cursor. A failed mid-stream push leaves the watermark untouched and the command unfinished — the server will re-deliver it on the next sync.
- Returns `{ ok: true, summary: { pushed: N, days: targetDay-to-today } }` on success, or `{ ok: false, error: "..." }` on failure (with as many days as got through reported in the error).

### Integration into `runTeamSync`

After the existing push loop, two additions:

1. **Parse `commands` from each push response**. `pushToTeamServer` already returns `body`; extract `body.commands ?? []`.
2. **Dispatch + collect results**. Run commands serially after the regular push completes (so a slow backfill doesn't block the live snapshot). Collect `CommandResult[]`.
3. **Attach results to the next push**. Since the next sync tick is up to 5 min away, that's fine for backfill (the admin's "last push" timestamp updates anyway). If the dispatch produced new daily activity, it'll show up on the team server immediately via the per-rollup pushes — the `commandResults` block is just bookkeeping for the server to mark the command done.

### In-flight lock

If a command is currently being dispatched when the next sync tick fires, the same command would be re-delivered (server hasn't marked it complete yet). A small in-process `Set<string>` of in-flight command IDs prevents the same command from starting twice:

```ts
const inFlightCommands = new Set<string>();

for (const cmd of response.commands ?? []) {
  if (inFlightCommands.has(cmd.id)) continue;
  inFlightCommands.add(cmd.id);
  try {
    const result = await dispatchCommand(cmd, config, log);
    pendingResults.push(result);
  } finally {
    inFlightCommands.delete(cmd.id);
  }
}
```

Set is process-scoped, lost on daemon restart — that's fine; on restart the daemon picks up the command again from the server and starts over (backfill is idempotent).

### No opt-out

Per the design conversation: accepting team-issued commands is implicit in the act of pairing with a team server. There is no `FLEETLENS_ACCEPT_REMOTE_COMMANDS` env var; the daemon always processes commands when paired. The trust model is: pairing implies consent to receive operational commands within the same data scope that pairing already covers (aggregates only, no content).

The dispatcher's switch statement is the formal boundary: a new command type cannot be added without a code change to the CLI. That's the audit surface for "what can the team do to my daemon?" — the answer is "exactly what's in `dispatchCommand`'s switch, nothing more".

## Edge cases

- **Multiple commands queued**: daemon dispatches serially in order. Each result is reported in the next push.
- **Command takes >5 min**: in-flight lock prevents duplicate dispatch. Server re-delivers until completion is reported.
- **Daemon crashes mid-execution**: command never marked complete on server; next sync re-delivers; daemon retries. Backfill is idempotent on the server side via daily-rollup upsert.
- **Unknown command type from a newer server**: daemon reports `{ ok: false, error: "Unknown command type: X" }`. Server marks complete with the error. Admin sees in any future "command history" UI (out of scope for v1) that the command failed.
- **Member never syncs again**: command stays pending forever. We can revisit a TTL or cancellation UI later; not blocking for v1.
- **Member unpairs (revoked token)**: subsequent ingests return 401, so pending commands never deliver. When/if the member re-pairs, the `membership_id` changes (new bearer hash) so the old commands won't be re-delivered.
- **Race between admin enqueue and ongoing sync**: not a problem — the new command gets picked up on the next sync, not the one currently in flight.

## Versioning

This is a meaningful capability addition (new architectural pattern: server → daemon command channel). **Minor bump on both tracks**:

- CLI: `v0.10.6` → `v0.11.0`
- Team-server: `v0.8.5` → `v0.9.0` (whatever the current is — confirm at release time)

The two changes ship in a single PR but the release-tagging is independent per the repo's `Versioning` section in CLAUDE.md.

## Non-goals

- **No member-side UI for commands** (no audit log, no notice, no opt-out switch). The existing "last sync N ago" tick on `/settings → Team connection` is the only visible signal, exactly the same as for any other daemon push. Design conversation confirmed this.
- **No admin-side "command history" view**. The button + the natural "last push" feedback on the member detail page is the v1 surface. Builds-on territory.
- **No "execute now / dry-run" preview**. The confirmation modal's explainer ("will execute on next sync, within 5 minutes") is sufficient.
- **No general command framework**. Single switch in `dispatchCommand`, single command type initially. Adding the next type means adding a case + a handler — not building a registry/plugin system.
- **No cancellation of queued-but-undelivered commands**. v1 has no UI for it; admin re-queueing the same command is the idempotency safety net.
- **No member opt-out**. Pairing = consent to operational commands within the existing aggregate-only data scope.

## Open questions

None. All design choices are locked in for implementation.
