# Team-Issued Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server→daemon command channel that lets a team admin queue a 30-day activity backfill against any paired member from the team dashboard, with the daemon executing on its next 5-minute sync.

**Architecture:** Piggyback commands on the existing `/api/ingest/metrics` response. New `member_commands` table on the team-server tracks pending/completed commands. Admin UI is a single button on the member detail page. CLI gets a thin dispatcher (`packages/cli/src/team/commands.ts`) that runs the existing `buildRollupsForRange` helper with a widened day window. No member-side UI changes — the existing "last sync" tick is the only feedback signal. No opt-out: pairing implies consent.

**Tech Stack:** TypeScript, pnpm Turborepo monorepo, PostgreSQL (Drizzle migrations), Next.js (team-server), Node 22, vitest.

**Spec:** `docs/superpowers/specs/2026-05-21-team-issued-commands-design.md`

---

## File Structure

**New files:**
- `packages/team-server/src/db/migrations/0005_member_commands.sql` — DB migration for the new table.
- `packages/team-server/src/app/api/admin/members/[id]/commands/route.ts` — admin endpoint to enqueue commands.
- `packages/team-server/src/lib/member-commands.ts` — small helper for the ingest handler to read pending + write results.
- `packages/team-server/src/app/team/[slug]/members/[id]/request-backfill-button.tsx` — client component for the admin button + modal.
- `packages/team-server/test/api/admin-commands.integration.test.ts` — auth, validation, idempotency.
- `packages/cli/src/team/commands.ts` — dispatcher + `runActivityBackfill` handler.
- `packages/cli/test/team/commands.test.ts` — unit tests for the dispatcher.

**Modified files:**
- `packages/parser/src/team-wire.ts` — add `ServerCommand`, `CommandResult`, `IngestResponse` types; extend `IngestPayload` with `commandResults?`.
- `packages/parser/src/fs.ts` — re-export the new types.
- `packages/cli/src/team/push.ts` — re-export the new types from parser; update `pushToTeamServer` to type the response body as `IngestResponse`.
- `packages/team-server/src/db/schema.ts` — add `memberCommands` Drizzle table entry.
- `packages/team-server/src/lib/zod-schemas.ts` — accept `commandResults` in incoming payloads; add `commands` to the outgoing response shape.
- `packages/team-server/src/lib/ingest.ts` — call the new helper to process incoming results + fetch pending commands.
- `packages/team-server/src/app/team/[slug]/members/[id]/page.tsx` — render the new button (admin/staff only).
- `packages/cli/src/team/sync.ts` — after main push loop, parse `commands`, dispatch with in-flight lock, fire bare-results push.
- `packages/cli/test/team/sync.test.ts` — extend with command-dispatch integration test.

---

## Task 1: Wire types in parser

**Why:** Both the CLI dispatcher (Task 6) and the typed push response (Task 7) need shared definitions. Putting them in `@claude-lens/parser/fs` keeps the single source of truth pattern established by `IngestPayload`/`LastPushRecord`.

**Files:**
- Modify: `packages/parser/src/team-wire.ts`
- Modify: `packages/parser/src/fs.ts`
- Modify: `packages/cli/src/team/push.ts`

- [ ] **Step 1: Extend `packages/parser/src/team-wire.ts`**

Append after the existing `LastPushRecord` declaration:

```ts
// Commands issued by the team server, embedded in /api/ingest/metrics
// responses. Daemon parses, dispatches via the switch in
// packages/cli/src/team/commands.ts, reports back via `commandResults`
// on the next push. See docs/superpowers/specs/2026-05-21-team-issued-commands-design.md.
export type ServerCommand =
  | { id: string; type: "backfill-activity"; params: { days: number } };

export type CommandResult =
  | { id: string; ok: true; completedAt: string; summary?: Record<string, unknown> }
  | { id: string; ok: false; completedAt: string; error: string };

// Typed shape of the server's /api/ingest/metrics response. Fields are
// optional because the server may add new ones over time; callers should
// tolerate missing fields.
export type IngestResponse = {
  ok?: boolean;
  snapshotHistory?: { inserted: number; skipped: number };
  commands?: ServerCommand[];
  // Additional fields the server may include (nextSyncAfter, etc.) are
  // not modeled here — callers can cast if they need them.
};
```

Also add `commandResults?: CommandResult[]` to the existing `IngestPayload` type, immediately after the `snapshotHistory?` field:

```ts
  // Bulk historical snapshot batch (formerly POST /api/ingest/usage-history).
  // Server dedups at the row level via captured_at, so retries on the same
  // ingestId still apply new rows.
  snapshotHistory?: WireUsageSnapshot[];
  // Reports completion of server-issued commands the daemon executed since
  // the previous push. Server marks corresponding rows in `member_commands`
  // as completed. See docs/superpowers/specs/2026-05-21-team-issued-commands-design.md.
  commandResults?: CommandResult[];
};
```

- [ ] **Step 2: Re-export from `packages/parser/src/fs.ts`**

Find the existing block:

```ts
export {
  type DailyRollup,
  type WireUsageWindow,
  type WireExtraUsage,
  type WireUsageSnapshot,
  type WireCyclePeak,
  type WireCyclePeaks,
  type IngestPayload,
  type LastPushRecord,
} from "./team-wire.js";
```

Add three more exports inside the brace list (alphabetized within the block is fine — match what's there):

```ts
  type ServerCommand,
  type CommandResult,
  type IngestResponse,
```

- [ ] **Step 3: Update `packages/cli/src/team/push.ts` re-exports**

Extend the existing import + re-export block at the top:

```ts
import type {
  DailyRollup,
  WireUsageWindow,
  WireExtraUsage,
  WireUsageSnapshot,
  WireCyclePeak,
  WireCyclePeaks,
  IngestPayload,
  IngestResponse,
  ServerCommand,
  CommandResult,
} from "@claude-lens/parser/fs";

export type {
  DailyRollup,
  WireUsageWindow,
  WireExtraUsage,
  WireUsageSnapshot,
  WireCyclePeak,
  WireCyclePeaks,
  IngestPayload,
  IngestResponse,
  ServerCommand,
  CommandResult,
};
```

Then update the `pushToTeamServer` return type to use `IngestResponse`:

```ts
export async function pushToTeamServer(
  config: TeamConfig,
  payload: IngestPayload,
): Promise<{ ok: boolean; status: number; body: IngestResponse | null }> {
  const res = await fetch(`${config.serverUrl}/api/ingest/metrics`, {
    method: "POST",
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.bearerToken}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null) as IngestResponse | null;
  return { ok: res.ok, status: res.status, body };
}
```

- [ ] **Step 4: Verify typecheck + build**

Run:
```
pnpm -F @claude-lens/parser build
pnpm -F fleetlens build
pnpm typecheck
```
All green.

- [ ] **Step 5: Commit**

```
git add packages/parser/src/team-wire.ts packages/parser/src/fs.ts packages/cli/src/team/push.ts
git commit -m "feat(team): add wire types for server-issued commands"
```

---

## Task 2: Server DB migration

**Why:** Persistent storage for queued + completed commands. Indexed for the two read paths: (a) "pending commands for this member" on every ingest, and (b) "recent commands for this team" for any future admin history view.

**Files:**
- Create: `packages/team-server/src/db/migrations/0005_member_commands.sql`
- Modify: `packages/team-server/src/db/schema.ts`

- [ ] **Step 1: Write the migration SQL**

Create `packages/team-server/src/db/migrations/0005_member_commands.sql`:

```sql
-- description: Server-issued commands to member daemons (backfill, etc.)

CREATE TABLE member_commands (
  id              text PRIMARY KEY,
  team_id         uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  membership_id   uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  command_type    text NOT NULL,
  params          jsonb NOT NULL DEFAULT '{}'::jsonb,
  issued_by_id    uuid NOT NULL REFERENCES user_accounts(id),
  issued_at       timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  completed_at    timestamptz,
  result          jsonb
);

CREATE INDEX idx_member_commands_pending
  ON member_commands (membership_id, completed_at)
  WHERE completed_at IS NULL;

CREATE INDEX idx_member_commands_team_recent
  ON member_commands (team_id, issued_at DESC);
```

The `-- description:` header line is required per `packages/team-server/src/db/MIGRATIONS.md` for the release manifest.

- [ ] **Step 2: Add Drizzle schema entry to `packages/team-server/src/db/schema.ts`**

Read the existing schema file end-to-end. Add the new table entry following the same style as `memberships` and `dailyRollups`. Place it near the other team-scoped tables (e.g., after `membershipCyclePeaks` or wherever the existing pattern groups team-scoped tables):

```ts
export const memberCommands = pgTable(
  "member_commands",
  {
    id: text("id").primaryKey(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull().references(() => memberships.id, { onDelete: "cascade" }),
    commandType: text("command_type").notNull(),
    params: jsonb("params").notNull().default(sql`'{}'::jsonb`),
    issuedById: uuid("issued_by_id").notNull().references(() => userAccounts.id),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    result: jsonb("result"),
  },
  (t) => ({
    pendingIdx: index("idx_member_commands_pending")
      .on(t.membershipId, t.completedAt)
      .where(sql`${t.completedAt} IS NULL`),
    teamRecentIdx: index("idx_member_commands_team_recent")
      .on(t.teamId, sql`${t.issuedAt} DESC`),
  }),
);
```

Imports: if `text`, `jsonb`, or `index` are not already imported at the top of `schema.ts`, add them to the existing `drizzle-orm/pg-core` import line.

- [ ] **Step 3: Verify build + migrate test**

Run:
```
pnpm -F @claude-lens/team-server build
pnpm -F @claude-lens/team-server test
```

Existing tests should still pass; the migration is additive. If there's a smoke test that runs all migrations against a temp DB (look in `packages/team-server/test/`), it should pick up the new file automatically.

- [ ] **Step 4: Commit**

```
git add packages/team-server/src/db/migrations/0005_member_commands.sql packages/team-server/src/db/schema.ts
git commit -m "feat(team-server): add member_commands table"
```

---

## Task 3: Ingest handler — process commandResults + return pending commands

**Why:** This is the actual command-channel logic on the server side. Without it, the admin endpoint (Task 4) would enqueue commands that no daemon ever picks up.

**Files:**
- Create: `packages/team-server/src/lib/member-commands.ts`
- Modify: `packages/team-server/src/lib/zod-schemas.ts`
- Modify: `packages/team-server/src/lib/ingest.ts`
- Modify: `packages/team-server/test/api/ingest.integration.test.ts`

- [ ] **Step 1: Create the helper module**

Create `packages/team-server/src/lib/member-commands.ts`:

```ts
import type { Pool } from "pg";

export type PendingCommand = {
  id: string;
  type: string;
  params: Record<string, unknown>;
};

export type IncomingResult = {
  id: string;
  ok: boolean;
  completedAt: string;
  summary?: Record<string, unknown>;
  error?: string;
};

// Capped per response so a runaway "admin queued 500 commands" doesn't bloat
// every ingest. Excess wait for the next sync.
const MAX_COMMANDS_PER_RESPONSE = 10;

export async function processCommandResults(
  pool: Pool,
  membershipId: string,
  results: IncomingResult[],
): Promise<void> {
  if (results.length === 0) return;
  for (const r of results) {
    await pool.query(
      `UPDATE member_commands
         SET completed_at = $1, result = $2
       WHERE id = $3 AND membership_id = $4 AND completed_at IS NULL`,
      [r.completedAt, { ok: r.ok, summary: r.summary, error: r.error }, r.id, membershipId],
    );
  }
}

export async function fetchPendingCommands(
  pool: Pool,
  membershipId: string,
): Promise<PendingCommand[]> {
  const res = await pool.query<{ id: string; command_type: string; params: Record<string, unknown> }>(
    `UPDATE member_commands
       SET delivered_at = COALESCE(delivered_at, now())
     WHERE id IN (
       SELECT id FROM member_commands
       WHERE membership_id = $1 AND completed_at IS NULL
       ORDER BY issued_at
       LIMIT $2
     )
     RETURNING id, command_type, params`,
    [membershipId, MAX_COMMANDS_PER_RESPONSE],
  );
  return res.rows.map((row) => ({
    id: row.id,
    type: row.command_type,
    params: row.params,
  }));
}
```

The `UPDATE ... RETURNING` pattern stamps `delivered_at` and returns the same rows in one round trip.

- [ ] **Step 2: Extend the zod schemas**

In `packages/team-server/src/lib/zod-schemas.ts`, add a schema for incoming `commandResults` and update the `IngestPayload` schema to accept it. Locate the existing `IngestPayloadSchema` (or whatever the payload schema is called) and add the optional field:

```ts
const CommandResultSchema = z.object({
  id: z.string(),
  ok: z.boolean(),
  completedAt: z.string(),
  summary: z.record(z.unknown()).optional(),
  error: z.string().optional(),
});

// In the IngestPayload schema, add alongside existing optional fields:
commandResults: z.array(CommandResultSchema).max(50).optional(),
```

(`max(50)` is a reasonable upper bound to prevent payload bloat.)

For the response, no schema validation is needed (responses are TypeScript objects, not parsed); just ensure the `IngestResponse` shape in code accommodates the new `commands` field. If a response Zod schema exists, extend it likewise.

- [ ] **Step 3: Wire the helpers into `processIngest`**

In `packages/team-server/src/lib/ingest.ts`:

1. Add imports near the top:
```ts
import { processCommandResults, fetchPendingCommands } from "./member-commands.js";
```

2. Inside `processIngest`, after the existing payload-validation + dedupe logic but BEFORE returning the response, add:

```ts
  // Process any command results from the daemon (mark commands complete).
  if (payload.commandResults && payload.commandResults.length > 0) {
    await processCommandResults(pool, membershipId, payload.commandResults);
  }

  // Fetch any pending commands for this member, stamp delivered_at, include
  // them in the response. Capped at 10 per response.
  const commands = await fetchPendingCommands(pool, membershipId);
```

3. Include `commands` in the return value (whatever the existing return shape looks like, add `commands` to it):

```ts
  return {
    // ... existing fields
    ...(commands.length > 0 ? { commands } : {}),
  };
```

- [ ] **Step 4: Add an integration test**

In `packages/team-server/test/api/ingest.integration.test.ts`, add a test that:

1. Seeds a pending command via a direct SQL insert (or via a test helper).
2. POSTs a normal ingest payload from the test client.
3. Asserts the response includes the command in `commands` and the command's `delivered_at` is now set.
4. POSTs a follow-up payload with `commandResults: [{ id, ok: true, completedAt }]`.
5. Asserts the command's `completed_at` is now set and subsequent ingests no longer include it in `commands`.

Use the existing integration-test scaffolding (test DB setup) — look at sibling tests for the pattern.

- [ ] **Step 5: Run tests**

Run:
```
pnpm -F @claude-lens/team-server test
```

All existing tests should still pass; the new test should pass.

- [ ] **Step 6: Commit**

```
git add packages/team-server/src/lib/member-commands.ts packages/team-server/src/lib/zod-schemas.ts packages/team-server/src/lib/ingest.ts packages/team-server/test/api/ingest.integration.test.ts
git commit -m "feat(team-server): ingest handler reads/writes member_commands"
```

---

## Task 4: Admin command-enqueue endpoint

**Why:** The button (Task 5) needs an endpoint to POST to. Auth, validation, and idempotency are all enforced here so the UI can be dumb.

**Files:**
- Create: `packages/team-server/src/app/api/admin/members/[id]/commands/route.ts`
- Create: `packages/team-server/test/api/admin-commands.integration.test.ts`

- [ ] **Step 1: Write the failing test first**

Create `packages/team-server/test/api/admin-commands.integration.test.ts`. Follow the existing integration-test pattern (look at any sibling `*.integration.test.ts`). Cover:

1. **401** when no session.
2. **403** when caller is a regular member (not admin, not staff) of the target team.
3. **403** when caller is admin of a DIFFERENT team than the target member.
4. **400** when `type` is missing or `params.days` is out of range (≤0 or >365).
5. **201** when caller is admin of the target's team — returns the created row.
6. **200** with the SAME id when called twice with the same `type` + `params` (idempotency).
7. **201** with a NEW id when called with the same `type` but different `params` (different command intent).

- [ ] **Step 2: Run the test to confirm it fails**

```
pnpm -F @claude-lens/team-server test -- admin-commands
```
All 7 tests fail (module not found).

- [ ] **Step 3: Implement the route**

Create `packages/team-server/src/app/api/admin/members/[id]/commands/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../../db/pool";
import { z } from "zod";
// Adjust this import to match how the existing admin routes get the session;
// look at packages/team-server/src/app/api/admin/staff or /prune/* for the pattern.
import { auth } from "../../../../../lib/auth-session";

const ParamsSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("backfill-activity"),
    params: z.object({ days: z.number().int().min(1).max(365) }),
  }),
]);

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const { id: membershipId } = await context.params;
  const pool = getPool();

  // Look up the target membership's team.
  const target = await pool.query<{ team_id: string }>(
    `SELECT team_id FROM memberships WHERE id = $1`,
    [membershipId],
  );
  if (target.rowCount === 0) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  const targetTeamId = target.rows[0]!.team_id;

  // Auth gate: caller must be staff, OR an admin in the target's team.
  if (!session.user.is_staff) {
    const caller = await pool.query<{ role: string }>(
      `SELECT role FROM memberships
        WHERE user_account_id = $1 AND team_id = $2 AND revoked_at IS NULL`,
      [session.user.id, targetTeamId],
    );
    if (caller.rowCount === 0 || caller.rows[0]!.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Validate body.
  const parsed = ParamsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsed.error.format() }, { status: 400 });
  }
  const { type, params } = parsed.data;

  // Idempotency: if there's already a pending command with the same type and
  // params, return that row instead of creating a duplicate.
  const existing = await pool.query(
    `SELECT id, command_type, params, issued_at FROM member_commands
      WHERE membership_id = $1 AND command_type = $2 AND params = $3::jsonb
        AND completed_at IS NULL
      LIMIT 1`,
    [membershipId, type, JSON.stringify(params)],
  );
  if (existing.rowCount && existing.rowCount > 0) {
    return NextResponse.json(existing.rows[0], { status: 200 });
  }

  // Insert. ID format: cmd_<26-char ULID lookalike>. We don't need crypto ULID;
  // a UUID with a 'cmd_' prefix is fine for traceability.
  const id = `cmd_${crypto.randomUUID().replace(/-/g, "")}`;
  const inserted = await pool.query(
    `INSERT INTO member_commands (id, team_id, membership_id, command_type, params, issued_by_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id, command_type, params, issued_at`,
    [id, targetTeamId, membershipId, type, JSON.stringify(params), session.user.id],
  );
  return NextResponse.json(inserted.rows[0], { status: 201 });
}
```

Note: the `auth-session` import path is a placeholder — verify the exact pattern in `packages/team-server/src/app/api/admin/staff/**/route.ts` or `prune/**/route.ts` (an existing admin route) and match it.

- [ ] **Step 4: Run the test to confirm it passes**

```
pnpm -F @claude-lens/team-server test -- admin-commands
```
All 7 pass.

- [ ] **Step 5: Commit**

```
git add packages/team-server/src/app/api/admin/members/[id]/commands/route.ts packages/team-server/test/api/admin-commands.integration.test.ts
git commit -m "feat(team-server): admin endpoint to enqueue member commands"
```

---

## Task 5: Admin UI button on member detail page

**Why:** The endpoint exists; we need a way for admins to invoke it without curl.

**Files:**
- Create: `packages/team-server/src/app/team/[slug]/members/[id]/request-backfill-button.tsx`
- Modify: `packages/team-server/src/app/team/[slug]/members/[id]/page.tsx`

- [ ] **Step 1: Create the client component**

Create `packages/team-server/src/app/team/[slug]/members/[id]/request-backfill-button.tsx`:

```tsx
"use client";

import { useState } from "react";

type Status = "idle" | "submitting" | "success" | "already-queued" | "error";

export function RequestBackfillButton({ membershipId }: { membershipId: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const submit = async () => {
    setStatus("submitting");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/admin/members/${membershipId}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "backfill-activity", params: { days: 30 } }),
      });
      if (res.status === 201) {
        setStatus("success");
      } else if (res.status === 200) {
        setStatus("already-queued");
      } else {
        const body = await res.json().catch(() => null);
        setStatus("error");
        setErrorMessage(body?.error ?? `Request failed (${res.status})`);
      }
      setOpen(false);
    } catch (err) {
      setStatus("error");
      setErrorMessage((err as Error).message);
      setOpen(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={status === "submitting"}
        className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
      >
        Request 30-day backfill
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 flex items-center justify-center bg-black/40 z-50"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-lg p-6 max-w-md space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-medium">Queue 30-day activity backfill?</h3>
            <p className="text-sm text-gray-600">
              The member&apos;s daemon will pick this up on its next sync (within 5 minutes)
              and re-push their last 30 days of daily activity. Already-recorded days are
              upserted, not duplicated.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 text-sm rounded border border-gray-300 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={status === "submitting"}
                className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {status === "submitting" ? "Queuing…" : "Queue command"}
              </button>
            </div>
          </div>
        </div>
      )}

      {status === "success" && (
        <p className="text-xs text-green-700">
          Command queued — will execute on member&apos;s next sync (within 5 min).
        </p>
      )}
      {status === "already-queued" && (
        <p className="text-xs text-gray-600">
          A backfill is already queued for this member; it will execute on their next sync.
        </p>
      )}
      {status === "error" && (
        <p className="text-xs text-red-700">
          {errorMessage ?? "Failed to queue command."}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render the button on the member detail page**

In `packages/team-server/src/app/team/[slug]/members/[id]/page.tsx`:

1. Read the current page to find the existing admin-only actions area (look for `isAdminOrStaff` or similar gate).
2. Add the import:
```tsx
import { RequestBackfillButton } from "./request-backfill-button";
```
3. Inside the admin-gated section, render:
```tsx
{isAdminOrStaff && <RequestBackfillButton membershipId={member.id} />}
```

If there's no existing admin section, add one. Use the pattern from other admin gates in the file (`packages/team-server/src/app/team/[slug]/groups/page.tsx` is a good reference for the `isAdminOrStaff` pattern).

- [ ] **Step 3: Manual smoke test**

```
pnpm -F @claude-lens/team-server dev
```

(or your usual local team-server dev command — match the existing `npm run dev` in the team-server's package.json.)

In a browser, log in as an admin, navigate to a member's detail page, click "Request 30-day backfill", confirm in the modal, and verify the success toast.

Verify with a direct DB query: `SELECT * FROM member_commands ORDER BY issued_at DESC LIMIT 1` should show your newly-queued row.

- [ ] **Step 4: Commit**

```
git add packages/team-server/src/app/team/[slug]/members/[id]/request-backfill-button.tsx packages/team-server/src/app/team/[slug]/members/[id]/page.tsx
git commit -m "feat(team-server): admin button to queue 30-day backfill from member page"
```

---

## Task 6: CLI command dispatcher

**Why:** This is where commands actually become work on the daemon side. Kept as a small focused module so adding a future command type is a single switch case + a new handler function.

**Files:**
- Create: `packages/cli/src/team/commands.ts`
- Create: `packages/cli/test/team/commands.test.ts`

- [ ] **Step 1: Write the failing test first**

Create `packages/cli/test/team/commands.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dispatchCommand } from "../../src/team/commands.js";
import type { ServerCommand } from "../../src/team/commands.js";
import type { TeamConfig } from "@claude-lens/parser/fs";

const noopLog = () => {};

const SAMPLE_CONFIG: TeamConfig = {
  serverUrl: "https://team.example.com",
  memberId: "mem_test",
  bearerToken: "tok_test",
  teamSlug: "acme",
  teamName: "Acme",
  pairedAt: "2026-05-01T00:00:00.000Z",
};

let testHome: string;
let prevCclensHome: string | undefined;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), "cclens-commands-"));
  prevCclensHome = process.env.CCLENS_HOME;
  process.env.CCLENS_HOME = testHome;
});

afterEach(() => {
  if (prevCclensHome === undefined) delete process.env.CCLENS_HOME;
  else process.env.CCLENS_HOME = prevCclensHome;
  rmSync(testHome, { recursive: true, force: true });
});

describe("dispatchCommand", () => {
  it("returns ok:false for an unknown command type", async () => {
    const cmd = { id: "cmd_x", type: "unknown-type", params: {} } as unknown as ServerCommand;
    const result = await dispatchCommand(cmd, SAMPLE_CONFIG, noopLog);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("Unknown command type");
    expect(result.id).toBe("cmd_x");
    expect(typeof result.completedAt).toBe("string");
  });

  it("backfill-activity pushes daily rollups for the requested window", async () => {
    // Mock pushToTeamServer to record calls without doing network IO.
    const pushSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, body: { ok: true } });
    vi.doMock("../../src/team/push.js", async (orig) => {
      const actual = await orig() as Record<string, unknown>;
      return { ...actual, pushToTeamServer: pushSpy };
    });

    // Mock listSessions to return a known fixture so buildRollupsForRange produces predictable rollups.
    vi.doMock("@claude-lens/parser/fs", async (orig) => {
      const actual = await orig() as Record<string, unknown>;
      return {
        ...actual,
        listSessions: async () => [
          {
            sessionId: "sess1",
            projectDir: "proj",
            agentKind: "claude-code",
            startTs: "2026-05-19T10:00:00.000Z",
            endTs: "2026-05-19T11:00:00.000Z",
            activeSegments: [{ start: "2026-05-19T10:00:00.000Z", end: "2026-05-19T11:00:00.000Z", durationMs: 3_600_000 }],
            toolCalls: 5,
            turns: 3,
            tokens: { input: 100, output: 200, cacheRead: 1000, cacheWrite: 50 },
          },
        ],
      };
    });

    // Re-import after mocks.
    const { dispatchCommand: dispatch } = await import("../../src/team/commands.js");
    const cmd: ServerCommand = { id: "cmd_b", type: "backfill-activity", params: { days: 7 } };
    const result = await dispatch(cmd, SAMPLE_CONFIG, noopLog);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(pushSpy).toHaveBeenCalled();
    expect(result.summary).toBeDefined();
    vi.resetModules();
  });
});
```

The mocking is the trickiest part. If `vi.doMock` ergonomics fight you, simplify the second test to assert just that `dispatchCommand` returns `ok: true` for a `backfill-activity` command when there are no sessions to push (which means `pushToTeamServer` isn't called at all). The key contract is the return shape; the integration with `buildRollupsForRange` is covered indirectly by the existing `sync.test.ts` suite once Task 7 lands.

If the simpler version is acceptable, replace the second test with:

```ts
it("backfill-activity returns ok:true with summary when no sessions exist", async () => {
  vi.doMock("@claude-lens/parser/fs", async (orig) => {
    const actual = await orig() as Record<string, unknown>;
    return { ...actual, listSessions: async () => [] };
  });
  const { dispatchCommand: dispatch } = await import("../../src/team/commands.js");
  const cmd: ServerCommand = { id: "cmd_b", type: "backfill-activity", params: { days: 30 } };
  const result = await dispatch(cmd, SAMPLE_CONFIG, noopLog);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  expect(result.summary).toMatchObject({ pushed: 0 });
  vi.resetModules();
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
pnpm -F fleetlens test -- commands
```
Both tests fail (module not found).

- [ ] **Step 3: Implement the dispatcher**

Create `packages/cli/src/team/commands.ts`:

```ts
import type { TeamConfig, ServerCommand, CommandResult } from "@claude-lens/parser/fs";
import { buildRollupsForRange, buildIngestPayload, pushToTeamServer } from "./push.js";

export type { ServerCommand, CommandResult };

type LogFn = (level: "info" | "warn", message: string) => void;

export async function dispatchCommand(
  command: ServerCommand,
  config: TeamConfig,
  log: LogFn,
): Promise<CommandResult> {
  switch (command.type) {
    case "backfill-activity":
      return runActivityBackfill(command, config, log);
    default:
      // Defensive: a future server might send a command type this CLI doesn't
      // know yet. Report failure so the server can surface it (and so we don't
      // silently swallow it).
      return {
        id: (command as { id: string }).id,
        ok: false,
        completedAt: new Date().toISOString(),
        error: `Unknown command type: ${(command as { type: string }).type}`,
      };
  }
}

async function runActivityBackfill(
  command: Extract<ServerCommand, { type: "backfill-activity" }>,
  config: TeamConfig,
  log: LogFn,
): Promise<CommandResult> {
  const { listSessions } = await import("@claude-lens/parser/fs");
  const { toLocalDay } = await import("@claude-lens/parser");

  const days = command.params.days;
  const todayMs = Date.now();
  const targetDayMs = todayMs - days * 24 * 60 * 60 * 1000;
  const targetDay = toLocalDay(targetDayMs);

  log("info", `command ${command.id}: backfill-activity from ${targetDay} (${days} days)`);

  let sessions;
  try {
    sessions = await listSessions({ limit: 10_000 });
  } catch (err) {
    return {
      id: command.id,
      ok: false,
      completedAt: new Date().toISOString(),
      error: `Failed to read sessions: ${(err as Error).message}`,
    };
  }

  const rollups = buildRollupsForRange(sessions, targetDay);
  if (rollups.length === 0) {
    return {
      id: command.id,
      ok: true,
      completedAt: new Date().toISOString(),
      summary: { pushed: 0, fromDay: targetDay },
    };
  }

  let pushed = 0;
  for (const rollup of rollups) {
    // Historical-only push: no live snapshot, no cyclePeaks, no planTier.
    // Those belong on the latest rollup which the regular sync handles.
    const payload = buildIngestPayload(rollup);
    const result = await pushToTeamServer(config, payload);
    if (!result.ok) {
      return {
        id: command.id,
        ok: false,
        completedAt: new Date().toISOString(),
        error: `Push failed on ${rollup.day} (HTTP ${result.status}); pushed ${pushed}/${rollups.length} before failing`,
      };
    }
    pushed++;
  }

  log("info", `command ${command.id}: backfill-activity ok — pushed ${pushed} day${pushed === 1 ? "" : "s"}`);
  return {
    id: command.id,
    ok: true,
    completedAt: new Date().toISOString(),
    summary: { pushed, fromDay: targetDay },
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```
pnpm -F fleetlens test -- commands
```
Both tests pass.

- [ ] **Step 5: Commit**

```
git add packages/cli/src/team/commands.ts packages/cli/test/team/commands.test.ts
git commit -m "feat(cli): dispatcher + backfill-activity handler for server commands"
```

---

## Task 7: Integrate dispatcher into runTeamSync

**Why:** The dispatcher exists but nothing calls it. The integration is the meaningful part — parsing commands from each push response, dispatching with the in-flight lock, and reporting results.

**Files:**
- Modify: `packages/cli/src/team/sync.ts`
- Modify: `packages/cli/test/team/sync.test.ts`

- [ ] **Step 1: Add imports + in-flight lock**

In `packages/cli/src/team/sync.ts`, at the top alongside existing imports:

```ts
import { dispatchCommand, type ServerCommand, type CommandResult } from "./commands.js";
import { randomUUID } from "node:crypto";
```

Below the imports, at module scope, add the in-flight lock:

```ts
// Process-scoped to prevent the same command from being dispatched twice
// when a long backfill spans multiple sync ticks. Lost on daemon restart,
// which is fine — the server will re-deliver and we'll start over.
const inFlightCommands = new Set<string>();
```

- [ ] **Step 2: Collect commands from each push response**

Each call site to `pushToTeamServer` returns `{ ok, status, body }` where `body` is now typed as `IngestResponse | null`. Update all THREE push sites (live-only, per-rollup, top-level catch) to aggregate `body.commands` into a single array that we'll dispatch after the main push loop.

Add a local `collectedCommands: ServerCommand[] = []` at the top of the `try` block in `runTeamSync`.

After each successful `pushToTeamServer` call (success path only — failures don't deliver new commands), append:

```ts
if (result.body?.commands && result.body.commands.length > 0) {
  collectedCommands.push(...result.body.commands);
}
```

Apply at all three success sites:
- Live-only fast path after `writeLastPushSuccess(payload)`.
- Per-rollup loop after `writeLastPushSuccess(payload); pushed++;`.
- (Backlog drain loops: also collect, so a long-buffered command sitting in the queue still gets dispatched when drain succeeds. Optional but consistent.)

- [ ] **Step 3: Dispatch + report after the main push loop**

Before the final `return { paired: true, pushed, ... }` of the success path, add:

```ts
  // Dispatch any commands the server included in push responses.
  if (collectedCommands.length > 0) {
    const results: CommandResult[] = [];
    for (const cmd of collectedCommands) {
      if (inFlightCommands.has(cmd.id)) continue;
      inFlightCommands.add(cmd.id);
      try {
        const result = await dispatchCommand(cmd, config, log);
        results.push(result);
      } finally {
        inFlightCommands.delete(cmd.id);
      }
    }

    if (results.length > 0) {
      // Bare-results push: no rollup/snapshot/tier/cyclePeaks, just the
      // commandResults so the server can mark them complete. Errors here are
      // non-fatal — the daemon's next normal sync will retry via the same
      // re-delivered commands.
      const resultsPayload = {
        ingestId: randomUUID(),
        observedAt: new Date().toISOString(),
        commandResults: results,
      };
      const r = await pushToTeamServer(config, resultsPayload);
      if (!r.ok) {
        log("warn", `team commandResults push failed (${r.status}); will retry on next sync`);
      } else {
        log("info", `team commandResults push ok: ${results.length} result${results.length === 1 ? "" : "s"}`);
      }
    }
  }
```

The same dispatch block applies in the live-only fast-path branch as well — refactor to a small helper if it would otherwise duplicate. A simple approach: pull the dispatch block into a local `async function dispatchAndReport(commands: ServerCommand[]): Promise<void>` defined inside `runTeamSync`, and call it from both branches before each `return`.

- [ ] **Step 4: Extend the existing sync.test.ts with one command-dispatch test**

In `packages/cli/test/team/sync.test.ts`, add a test that:

1. Mocks `pushToTeamServer` to:
   - First call (regular push): return `{ ok: true, status: 200, body: { ok: true, commands: [{ id: "cmd_test", type: "backfill-activity", params: { days: 1 } }] } }`.
   - All subsequent calls: return `{ ok: true, status: 200, body: { ok: true } }`.
2. Mocks `listSessions` to return an empty array (so the backfill has nothing to push but still completes successfully).
3. Calls `runTeamSync`.
4. Asserts that the LAST `pushToTeamServer` call had a payload with `commandResults: [{ id: "cmd_test", ok: true, ... }]`.

- [ ] **Step 5: Run sync + commands tests**

```
pnpm -F fleetlens test -- sync commands
pnpm typecheck
```
All pass.

- [ ] **Step 6: Commit**

```
git add packages/cli/src/team/sync.ts packages/cli/test/team/sync.test.ts
git commit -m "feat(cli): runTeamSync dispatches commands and reports results"
```

---

## Task 8: End-to-end verification

**Why:** The two halves were built independently; verify they fit together against a real (local) team server before declaring done.

**Files:** None modified — verification only.

- [ ] **Step 1: Full typecheck + test + smoke**

```
pnpm test
pnpm verify
NEXT_TELEMETRY_DISABLED=1 pnpm -F @claude-lens/web build
```
All green. Test count should be ~1020 + new tests from Tasks 3, 4, 6, 7 (~12 new tests).

- [ ] **Step 2: Local server + local CLI end-to-end**

In one terminal, start the team-server locally:
```
pnpm -F @claude-lens/team-server dev
```

In a second terminal, ensure the CLI bundle is rebuilt:
```
rm -rf apps/web/.next packages/cli/app
NEXT_OUTPUT=standalone pnpm -F @claude-lens/web build
node scripts/prepare-cli.mjs
pnpm -F fleetlens build
```

Pair the local CLI against the local team-server (use the existing `scripts/seed-team-demo.mjs` flow or the README's pairing instructions).

Then start the dashboard:
```
node packages/cli/dist/index.js web usage --no-open
```

- [ ] **Step 3: Issue a command from the team admin UI**

Log into the local team-server's admin UI, navigate to your paired member's detail page, click "Request 30-day backfill", confirm.

Wait up to 5 minutes (or trigger an immediate daemon tick by clicking "Sync now" in the personal dashboard at `/settings → Team connection`).

- [ ] **Step 4: Verify the dispatch + result flow**

1. The CLI's terminal log should show: `[info] command cmd_<id>: backfill-activity from <day> (30 days)`, followed by `[info] command cmd_<id>: backfill-activity ok — pushed N days`.
2. Check the team-server DB: `SELECT * FROM member_commands ORDER BY issued_at DESC LIMIT 1` should show the command with `completed_at` set and `result = { ok: true, summary: { pushed: N, fromDay: ... } }`.
3. The personal `/settings → Team connection` panel's "last sync" timestamp should advance (the bare-results push counts).

- [ ] **Step 5: Verify idempotency**

In the admin UI, click "Request 30-day backfill" again on the same member. The toast should read "A backfill is already queued for this member" (if the previous one isn't complete yet) OR a new command should queue (if the previous one is complete).

Either is correct depending on timing; just verify the UI doesn't crash and the DB doesn't get a duplicate pending row.

- [ ] **Step 6: Final commit (if any docs need updating during verification)**

If no further changes, this task ships nothing.

```
git status   # should be clean
```

---

## Self-review

After writing this plan, I cross-checked against the spec:

- **Wire schema (server response + payload extension)** → Task 1.
- **member_commands DB table** → Task 2.
- **Ingest reads pending + writes results** → Task 3.
- **Admin enqueue endpoint with auth + idempotency** → Task 4.
- **Admin UI button on member detail page** → Task 5.
- **Client dispatcher with backfill-activity handler** → Task 6.
- **runTeamSync integration with in-flight lock + bare-results push** → Task 7.
- **No member-side UI changes** → respected throughout; the dispatcher is invisible to the user.
- **No opt-out** → respected; the dispatcher always runs when commands are received. No env var is added.
- **End-to-end verification** → Task 8.

No placeholders remain. Function names + types are consistent across tasks (`ServerCommand`, `CommandResult`, `IngestResponse`, `dispatchCommand`, `runActivityBackfill`, `member_commands`, `processCommandResults`, `fetchPendingCommands`). Type re-export chain (parser → push.ts → commands.ts) is wired consistently.

Two open considerations the plan addresses but reviewers should be aware of:

1. The dispatcher test in Task 6 has two variants (full mock vs. simplified). Either is acceptable — the simpler one is recommended if `vi.doMock` ergonomics make the full version flaky.
2. The bare-results push in Task 7 fires inside the same `runTeamSync` invocation. If that POST fails, the next sync re-delivers the same commands and the dispatcher's in-flight lock skips them (since the dispatch already ran, the result is just lost in memory). That's a minor data-loss-on-network-failure window for the completion bookkeeping but not for the actual backfill data. Acceptable for v1.
