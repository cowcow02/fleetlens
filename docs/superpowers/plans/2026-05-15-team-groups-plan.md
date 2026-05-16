# Team Groups & Managers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third visibility rung (group manager) to the Team Edition. Admins place people into named groups; managers see only members of groups they manage, plus get a scoped invite path.

**Architecture:** Single migration adds `groups`, `group_members(is_manager)`, and `invites.group_ids[]`. `memberships.role` is unchanged. A single `canSeeMember` predicate gates every per-member read; aggregate queries use a precomputed visibility set. New routes live under `/team/<slug>/groups/...` and `/team/<slug>/settings/groups`.

**Tech Stack:** PostgreSQL + Drizzle ORM, Next.js 16 App Router (server components), vitest for unit + integration tests, TypeScript everywhere.

**Spec:** See `docs/superpowers/specs/2026-05-15-team-groups-design.md` for the full design.

---

## Working directory

All file paths are relative to the repo root. The package this plan touches is `packages/team-server/`. No changes to the parser, CLI, or local web app.

## Test setup notes

- Integration tests use `packages/team-server/test/helpers/db.ts` and require a running Postgres at `postgres://localhost:5432/fleetlens_dev` (overridable via `DATABASE_URL`).
- `pnpm -F @claude-lens/team-server test` runs vitest once.
- `pnpm -F @claude-lens/team-server typecheck` runs `tsc --noEmit`.
- After UI changes, run `pnpm -F @claude-lens/team-server dev` on port 3322 and exercise the routes in a browser.

## File map

**Created:**
- `packages/team-server/src/db/migrations/0004_team_groups.sql`
- `packages/team-server/src/lib/visibility.ts`
- `packages/team-server/src/lib/groups.ts`
- `packages/team-server/src/app/team/[slug]/groups/page.tsx`
- `packages/team-server/src/app/team/[slug]/groups/[group]/page.tsx`
- `packages/team-server/src/app/team/[slug]/groups/[group]/invite/page.tsx`
- `packages/team-server/src/app/team/[slug]/settings/groups/page.tsx`
- `packages/team-server/src/app/api/team/[slug]/groups/route.ts`
- `packages/team-server/src/app/api/team/[slug]/groups/[group]/route.ts`
- `packages/team-server/src/app/api/team/[slug]/groups/[group]/members/route.ts`
- `packages/team-server/src/app/api/team/[slug]/groups/[group]/invite/route.ts`
- `packages/team-server/src/components/groups-settings-panel.tsx`
- `packages/team-server/src/components/group-roster.tsx`
- `packages/team-server/src/components/manager-invite-form.tsx`
- `packages/team-server/test/lib/visibility.test.ts`
- `packages/team-server/test/lib/groups.test.ts`
- `packages/team-server/test/api/groups.integration.test.ts`
- `packages/team-server/test/api/groups-invite.integration.test.ts`
- `packages/team-server/test/api/visibility.integration.test.ts`

**Modified:**
- `packages/team-server/src/db/schema.ts`
- `packages/team-server/src/lib/auth.ts` (extend `Membership` shape minimally — no new tables; we load groups in queries.ts)
- `packages/team-server/src/lib/queries.ts` (visibility-filtered `loadRoster`, new `loadGroup`, `loadGroupRoster`, `loadGroupsForTeam`, `loadGroupsManagedBy`)
- `packages/team-server/src/lib/members.ts` (`createInvite` accepts `groupIds[]`; `redeemInvite` applies them)
- `packages/team-server/src/lib/route-helpers.ts` (`requireGroupManager`)
- `packages/team-server/src/app/team/[slug]/layout.tsx` (sidebar Groups entry)
- `packages/team-server/src/app/team/[slug]/page.tsx` (manager redirect)
- `packages/team-server/src/app/team/[slug]/members/[id]/page.tsx` (visibility guard)
- `packages/team-server/src/components/settings-panel.tsx` (link to settings/groups; group select on invite form)
- `packages/team-server/src/components/roster-card.tsx` (group badges)
- `packages/team-server/test/helpers/db.ts` (TRUNCATE list)

---

## Task 1: Migration + Drizzle schema

**Files:**
- Create: `packages/team-server/src/db/migrations/0004_team_groups.sql`
- Modify: `packages/team-server/src/db/schema.ts`
- Modify: `packages/team-server/test/helpers/db.ts`

- [ ] **Step 1: Write the migration SQL**

Create `packages/team-server/src/db/migrations/0004_team_groups.sql`:

```sql
-- description: Team groups & manager flag; group-scoped invites

CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "groups_team_slug_key" ON "groups" USING btree ("team_id","slug");--> statement-breakpoint

CREATE TABLE "group_members" (
	"group_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"is_manager" boolean DEFAULT false NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" uuid,
	CONSTRAINT "group_members_pkey" PRIMARY KEY ("group_id","membership_id")
);
--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_added_by_user_accounts_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_group_members_membership" ON "group_members" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "idx_group_members_managers" ON "group_members" USING btree ("group_id") WHERE "is_manager" = true;--> statement-breakpoint

ALTER TABLE "invites" ADD COLUMN "group_ids" uuid[] DEFAULT '{}' NOT NULL;
```

- [ ] **Step 2: Add Drizzle table definitions**

Append to `packages/team-server/src/db/schema.ts`:

```typescript
export const groups = pgTable(
  "groups",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamSlug: uniqueIndex("groups_team_slug_key").on(t.teamId, t.slug),
  }),
);

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull().references(() => memberships.id, { onDelete: "cascade" }),
    isManager: boolean("is_manager").notNull().default(false),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    addedBy: uuid("added_by").references(() => userAccounts.id, { onDelete: "set null" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.groupId, t.membershipId] }),
    byMembership: index("idx_group_members_membership").on(t.membershipId),
    managers: index("idx_group_members_managers").on(t.groupId).where(sql`${t.isManager} = true`),
  }),
);
```

And add `groupIds` to the existing `invites` table definition (inside the existing `pgTable` call):

```typescript
groupIds: uuid("group_ids").array().notNull().default(sql`'{}'::uuid[]`),
```

Place it after the existing `role` column.

- [ ] **Step 3: Add the new tables to the test reset TRUNCATE**

Edit `packages/team-server/test/helpers/db.ts`. Change the TRUNCATE statement to include `group_members, groups` (before `memberships`):

```typescript
await pool.query(`
  TRUNCATE TABLE
    events, daily_rollups, ingest_log, invites,
    plan_utilization,
    group_members, groups,
    memberships, sessions, server_config,
    update_check_cache,
    user_accounts, teams
  RESTART IDENTITY CASCADE
`);
```

- [ ] **Step 4: Verify migration runs cleanly**

Run: `pnpm -F @claude-lens/team-server test -- test/lib/auth.test.ts`
Expected: PASS. (Existing tests must still pass — the schema change is purely additive.)

If migrations aren't auto-run by tests, run them once manually:
```bash
DATABASE_URL=postgres://localhost:5432/fleetlens_dev pnpm -F @claude-lens/team-server exec tsx src/db/migrate.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/team-server/src/db/migrations/0004_team_groups.sql packages/team-server/src/db/schema.ts packages/team-server/test/helpers/db.ts
git commit -m "feat(team-server): add groups, group_members, invites.group_ids schema"
```

---

## Task 2: Visibility library

**Files:**
- Create: `packages/team-server/src/lib/visibility.ts`
- Create: `packages/team-server/test/lib/visibility.test.ts`

- [ ] **Step 1: Write failing test for the pure predicate**

Create `packages/team-server/test/lib/visibility.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { canSeeMember } from "../../src/lib/visibility";

describe("canSeeMember", () => {
  const baseViewer = { membershipId: "v1", role: "member" as const, isStaff: false };

  it("staff sees everyone", () => {
    expect(canSeeMember({ ...baseViewer, isStaff: true }, "anyone", new Set())).toBe(true);
  });
  it("admin sees everyone", () => {
    expect(canSeeMember({ ...baseViewer, role: "admin" }, "anyone", new Set())).toBe(true);
  });
  it("member sees self", () => {
    expect(canSeeMember(baseViewer, "v1", new Set())).toBe(true);
  });
  it("member cannot see others", () => {
    expect(canSeeMember(baseViewer, "other", new Set())).toBe(false);
  });
  it("manager sees members in their managed set", () => {
    expect(canSeeMember(baseViewer, "managed", new Set(["managed"]))).toBe(true);
  });
  it("manager cannot see members outside their managed set", () => {
    expect(canSeeMember(baseViewer, "outside", new Set(["managed"]))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm -F @claude-lens/team-server test -- test/lib/visibility.test.ts`
Expected: FAIL with "Cannot find module '../../src/lib/visibility'".

- [ ] **Step 3: Implement the library**

Create `packages/team-server/src/lib/visibility.ts`:

```typescript
import type pg from "pg";

export type ViewerContext = {
  membershipId: string;
  role: "admin" | "member";
  isStaff: boolean;
};

export function canSeeMember(
  viewer: ViewerContext,
  targetMembershipId: string,
  managedMemberIds: Set<string>,
): boolean {
  if (viewer.isStaff) return true;
  if (viewer.role === "admin") return true;
  if (viewer.membershipId === targetMembershipId) return true;
  return managedMemberIds.has(targetMembershipId);
}

/**
 * Returns the set of OTHER active membership ids that `viewerMembershipId`
 * can see by virtue of managing one or more groups. The viewer's own id is
 * NOT included — callers union it in if they want a full visibility set.
 */
export async function loadManagedMemberIds(
  viewerMembershipId: string,
  pool: pg.Pool,
): Promise<Set<string>> {
  const res = await pool.query<{ membership_id: string }>(
    `SELECT DISTINCT other.membership_id
     FROM group_members me
     JOIN group_members other ON other.group_id = me.group_id
     JOIN memberships m_other ON m_other.id = other.membership_id
     WHERE me.membership_id = $1
       AND me.is_manager = true
       AND m_other.revoked_at IS NULL`,
    [viewerMembershipId],
  );
  return new Set(res.rows.map((r) => r.membership_id));
}

/**
 * Full visibility set for a viewer, suitable for `WHERE membership_id = ANY($1)`.
 * Returns null for staff/admin (= no filter, see everything in scope).
 */
export async function loadVisibilitySet(
  viewer: ViewerContext,
  pool: pg.Pool,
): Promise<string[] | null> {
  if (viewer.isStaff || viewer.role === "admin") return null;
  const managed = await loadManagedMemberIds(viewer.membershipId, pool);
  managed.add(viewer.membershipId);
  return Array.from(managed);
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm -F @claude-lens/team-server test -- test/lib/visibility.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add an integration test for `loadManagedMemberIds`**

Append to `packages/team-server/test/lib/visibility.test.ts`:

```typescript
import { resetDb } from "../helpers/db";
import { createUserAccount } from "../../src/lib/auth";
import { loadManagedMemberIds } from "../../src/lib/visibility";

describe("loadManagedMemberIds (integration)", () => {
  it("includes other group members but not unrelated members", async () => {
    const pool = await resetDb();
    const team = await pool.query(
      "INSERT INTO teams (slug, name) VALUES ('t1', 'Team 1') RETURNING id",
    );
    const teamId = team.rows[0].id;

    const mgr = await createUserAccount("mgr@x.com", "pw12345678", "Mgr", {}, pool);
    const m1 = await createUserAccount("m1@x.com", "pw12345678", "M1", {}, pool);
    const m2 = await createUserAccount("m2@x.com", "pw12345678", "M2", {}, pool);
    const out = await createUserAccount("out@x.com", "pw12345678", "Out", {}, pool);

    const mkMembership = async (userId: string) => {
      const r = await pool.query(
        "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1, $2, 'member') RETURNING id",
        [userId, teamId],
      );
      return r.rows[0].id;
    };
    const mgrM = await mkMembership(mgr.id);
    const m1M = await mkMembership(m1.id);
    const m2M = await mkMembership(m2.id);
    const outM = await mkMembership(out.id);

    const gRes = await pool.query(
      "INSERT INTO groups (team_id, slug, name) VALUES ($1, 'platform', 'Platform') RETURNING id",
      [teamId],
    );
    const groupId = gRes.rows[0].id;

    await pool.query(
      `INSERT INTO group_members (group_id, membership_id, is_manager) VALUES
       ($1, $2, true), ($1, $3, false), ($1, $4, false)`,
      [groupId, mgrM, m1M, m2M],
    );

    const managed = await loadManagedMemberIds(mgrM, pool);
    expect(managed.has(m1M)).toBe(true);
    expect(managed.has(m2M)).toBe(true);
    expect(managed.has(mgrM)).toBe(true);
    expect(managed.has(outM)).toBe(false);
  });

  it("excludes revoked memberships", async () => {
    const pool = await resetDb();
    const team = await pool.query("INSERT INTO teams (slug, name) VALUES ('t1','t') RETURNING id");
    const teamId = team.rows[0].id;
    const a = await createUserAccount("a@x.com", "pw12345678", null, {}, pool);
    const b = await createUserAccount("b@x.com", "pw12345678", null, {}, pool);
    const aM = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'member') RETURNING id",
      [a.id, teamId],
    )).rows[0].id;
    const bM = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role, revoked_at) VALUES ($1,$2,'member', now()) RETURNING id",
      [b.id, teamId],
    )).rows[0].id;
    const g = (await pool.query(
      "INSERT INTO groups (team_id, slug, name) VALUES ($1, 'g', 'G') RETURNING id",
      [teamId],
    )).rows[0].id;
    await pool.query(
      "INSERT INTO group_members (group_id, membership_id, is_manager) VALUES ($1,$2,true), ($1,$3,false)",
      [g, aM, bM],
    );
    const managed = await loadManagedMemberIds(aM, pool);
    expect(managed.has(bM)).toBe(false);
  });
});
```

- [ ] **Step 6: Run integration tests, expect pass**

Run: `pnpm -F @claude-lens/team-server test -- test/lib/visibility.test.ts`
Expected: PASS, 8 tests total.

- [ ] **Step 7: Commit**

```bash
git add packages/team-server/src/lib/visibility.ts packages/team-server/test/lib/visibility.test.ts
git commit -m "feat(team-server): visibility predicate and managed-member set loader"
```

---

## Task 3: Group library

**Files:**
- Create: `packages/team-server/src/lib/groups.ts`
- Create: `packages/team-server/test/lib/groups.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/team-server/test/lib/groups.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resetDb } from "../helpers/db";
import { createUserAccount } from "../../src/lib/auth";
import {
  createGroup, renameGroup, deleteGroup,
  listGroupsForTeam, listGroupsManagedBy,
  addGroupMember, removeGroupMember, setGroupMemberManager,
  loadGroupBySlug,
} from "../../src/lib/groups";

async function seedTeamWithMembership(): Promise<{ teamId: string; userId: string; membershipId: string; pool: Awaited<ReturnType<typeof resetDb>> }> {
  const pool = await resetDb();
  const t = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','T') RETURNING id");
  const teamId = t.rows[0].id;
  const u = await createUserAccount("a@x.com", "pw12345678", null, {}, pool);
  const m = await pool.query(
    "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'admin') RETURNING id",
    [u.id, teamId],
  );
  return { teamId, userId: u.id, membershipId: m.rows[0].id, pool };
}

describe("groups library", () => {
  it("creates, renames, lists, and deletes a group", async () => {
    const { teamId, userId, pool } = await seedTeamWithMembership();
    const g = await createGroup(teamId, "platform", "Platform", userId, pool);
    expect(g.slug).toBe("platform");
    const fetched = await loadGroupBySlug(teamId, "platform", pool);
    expect(fetched?.id).toBe(g.id);
    await renameGroup(g.id, "Platform Eng", pool);
    const list = await listGroupsForTeam(teamId, pool);
    expect(list[0].name).toBe("Platform Eng");
    await deleteGroup(g.id, pool);
    expect((await listGroupsForTeam(teamId, pool)).length).toBe(0);
  });

  it("adds, promotes, demotes, and removes a group member", async () => {
    const { teamId, userId, membershipId, pool } = await seedTeamWithMembership();
    const g = await createGroup(teamId, "g", "G", userId, pool);
    await addGroupMember(g.id, membershipId, userId, pool);
    await setGroupMemberManager(g.id, membershipId, true, pool);
    let managed = await listGroupsManagedBy(membershipId, pool);
    expect(managed.length).toBe(1);
    await setGroupMemberManager(g.id, membershipId, false, pool);
    managed = await listGroupsManagedBy(membershipId, pool);
    expect(managed.length).toBe(0);
    await removeGroupMember(g.id, membershipId, pool);
    managed = await listGroupsManagedBy(membershipId, pool);
    expect(managed.length).toBe(0);
  });

  it("rejects setting is_manager=true on a revoked membership", async () => {
    const { teamId, userId, membershipId, pool } = await seedTeamWithMembership();
    const g = await createGroup(teamId, "g", "G", userId, pool);
    await addGroupMember(g.id, membershipId, userId, pool);
    await pool.query("UPDATE memberships SET revoked_at = now() WHERE id = $1", [membershipId]);
    await expect(setGroupMemberManager(g.id, membershipId, true, pool)).rejects.toThrow(/revoked/i);
  });

  it("rejects duplicate slug within the same team", async () => {
    const { teamId, userId, pool } = await seedTeamWithMembership();
    await createGroup(teamId, "g", "G", userId, pool);
    await expect(createGroup(teamId, "g", "G2", userId, pool)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm -F @claude-lens/team-server test -- test/lib/groups.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the library**

Create `packages/team-server/src/lib/groups.ts`:

```typescript
import type pg from "pg";

export type GroupRow = {
  id: string;
  team_id: string;
  slug: string;
  name: string;
  created_at: string;
};

export type GroupMembershipRow = {
  group_id: string;
  membership_id: string;
  is_manager: boolean;
  added_at: string;
};

export async function createGroup(
  teamId: string,
  slug: string,
  name: string,
  actorUserId: string,
  pool: pg.Pool,
): Promise<GroupRow> {
  const res = await pool.query<GroupRow>(
    `INSERT INTO groups (team_id, slug, name) VALUES ($1, $2, $3)
     RETURNING id, team_id, slug, name, created_at`,
    [teamId, slug, name],
  );
  const row = res.rows[0];
  await pool.query(
    "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'group.created', $3)",
    [teamId, actorUserId, JSON.stringify({ group_id: row.id, slug, name })],
  );
  return row;
}

export async function renameGroup(
  groupId: string,
  newName: string,
  pool: pg.Pool,
  actorUserId?: string,
): Promise<void> {
  const res = await pool.query<{ team_id: string; old_name: string }>(
    `UPDATE groups SET name = $2
     WHERE id = $1
     RETURNING team_id, (SELECT name FROM groups WHERE id = $1) AS old_name`,
    [groupId, newName],
  );
  if (!res.rowCount) throw new Error("group not found");
  await pool.query(
    "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'group.renamed', $3)",
    [res.rows[0].team_id, actorUserId ?? null, JSON.stringify({ group_id: groupId, to: newName })],
  );
}

export async function deleteGroup(groupId: string, pool: pg.Pool, actorUserId?: string): Promise<void> {
  const g = await pool.query<{ team_id: string; slug: string; name: string }>(
    "SELECT team_id, slug, name FROM groups WHERE id = $1",
    [groupId],
  );
  if (!g.rowCount) return;
  await pool.query("DELETE FROM groups WHERE id = $1", [groupId]);
  await pool.query(
    "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'group.deleted', $3)",
    [g.rows[0].team_id, actorUserId ?? null, JSON.stringify({ group_id: groupId, slug: g.rows[0].slug, name: g.rows[0].name })],
  );
}

export async function loadGroupBySlug(
  teamId: string,
  slug: string,
  pool: pg.Pool,
): Promise<GroupRow | null> {
  const res = await pool.query<GroupRow>(
    "SELECT id, team_id, slug, name, created_at FROM groups WHERE team_id = $1 AND slug = $2",
    [teamId, slug],
  );
  return res.rowCount ? res.rows[0] : null;
}

export async function listGroupsForTeam(teamId: string, pool: pg.Pool): Promise<GroupRow[]> {
  const res = await pool.query<GroupRow>(
    "SELECT id, team_id, slug, name, created_at FROM groups WHERE team_id = $1 ORDER BY name",
    [teamId],
  );
  return res.rows;
}

export async function listGroupsManagedBy(
  membershipId: string,
  pool: pg.Pool,
): Promise<GroupRow[]> {
  const res = await pool.query<GroupRow>(
    `SELECT g.id, g.team_id, g.slug, g.name, g.created_at
     FROM groups g
     JOIN group_members gm ON gm.group_id = g.id
     WHERE gm.membership_id = $1 AND gm.is_manager = true
     ORDER BY g.name`,
    [membershipId],
  );
  return res.rows;
}

export async function addGroupMember(
  groupId: string,
  membershipId: string,
  actorUserId: string,
  pool: pg.Pool,
  opts: { isManager?: boolean } = {},
): Promise<void> {
  // Look up team_id once for the event row.
  const g = await pool.query<{ team_id: string }>("SELECT team_id FROM groups WHERE id = $1", [groupId]);
  if (!g.rowCount) throw new Error("group not found");
  await pool.query(
    `INSERT INTO group_members (group_id, membership_id, is_manager, added_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (group_id, membership_id) DO NOTHING`,
    [groupId, membershipId, !!opts.isManager, actorUserId],
  );
  await pool.query(
    "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'group.member.added', $3)",
    [g.rows[0].team_id, actorUserId, JSON.stringify({ group_id: groupId, membership_id: membershipId, is_manager: !!opts.isManager })],
  );
}

export async function removeGroupMember(
  groupId: string,
  membershipId: string,
  pool: pg.Pool,
  actorUserId?: string,
): Promise<void> {
  const g = await pool.query<{ team_id: string }>("SELECT team_id FROM groups WHERE id = $1", [groupId]);
  if (!g.rowCount) return;
  await pool.query(
    "DELETE FROM group_members WHERE group_id = $1 AND membership_id = $2",
    [groupId, membershipId],
  );
  await pool.query(
    "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'group.member.removed', $3)",
    [g.rows[0].team_id, actorUserId ?? null, JSON.stringify({ group_id: groupId, membership_id: membershipId })],
  );
}

export async function setGroupMemberManager(
  groupId: string,
  membershipId: string,
  isManager: boolean,
  pool: pg.Pool,
  actorUserId?: string,
): Promise<void> {
  if (isManager) {
    const r = await pool.query(
      "SELECT 1 FROM memberships WHERE id = $1 AND revoked_at IS NULL",
      [membershipId],
    );
    if (!r.rowCount) throw new Error("cannot promote: membership is revoked or missing");
  }
  const upd = await pool.query<{ team_id: string }>(
    `UPDATE group_members gm
     SET is_manager = $3
     FROM groups g
     WHERE gm.group_id = $1 AND gm.membership_id = $2 AND g.id = gm.group_id
     RETURNING g.team_id`,
    [groupId, membershipId, isManager],
  );
  if (!upd.rowCount) throw new Error("group_members row not found");
  await pool.query(
    "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'group.member.role_changed', $3)",
    [upd.rows[0].team_id, actorUserId ?? null, JSON.stringify({ group_id: groupId, membership_id: membershipId, is_manager: isManager })],
  );
}

export async function listGroupMembers(
  groupId: string,
  pool: pg.Pool,
): Promise<GroupMembershipRow[]> {
  const res = await pool.query<GroupMembershipRow>(
    `SELECT group_id, membership_id, is_manager, added_at
     FROM group_members WHERE group_id = $1`,
    [groupId],
  );
  return res.rows;
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm -F @claude-lens/team-server test -- test/lib/groups.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/team-server/src/lib/groups.ts packages/team-server/test/lib/groups.test.ts
git commit -m "feat(team-server): group CRUD, member ops, manager flag toggle"
```

---

## Task 4: Invite group placement (createInvite + redeemInvite)

**Files:**
- Modify: `packages/team-server/src/lib/members.ts`

- [ ] **Step 1: Write failing test**

Append to `packages/team-server/test/lib/members.test.ts`:

```typescript
import { createGroup } from "../../src/lib/groups";
import { createInvite, redeemInvite } from "../../src/lib/members";
import { createUserAccount } from "../../src/lib/auth";

describe("invite group placement", () => {
  it("places redeemed member into invite.group_ids", async () => {
    const pool = await resetDb();
    const t = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','T') RETURNING id");
    const teamId = t.rows[0].id;
    const admin = await createUserAccount("admin@x.com", "pw12345678", null, {}, pool);
    const g1 = await createGroup(teamId, "g1", "G1", admin.id, pool);
    const g2 = await createGroup(teamId, "g2", "G2", admin.id, pool);

    const { token } = await createInvite(
      teamId, admin.id,
      { role: "member", groupIds: [g1.id, g2.id] },
      pool,
    );

    const newUser = await createUserAccount("new@x.com", "pw12345678", null, {}, pool);
    const r = await redeemInvite(token, newUser.id, pool);
    expect(r).not.toBeNull();

    const membership = await pool.query(
      "SELECT id FROM memberships WHERE user_account_id = $1 AND team_id = $2",
      [newUser.id, teamId],
    );
    const mId = membership.rows[0].id;
    const memberships = await pool.query(
      "SELECT group_id, is_manager FROM group_members WHERE membership_id = $1 ORDER BY group_id",
      [mId],
    );
    expect(memberships.rows).toHaveLength(2);
    expect(memberships.rows.every((r) => r.is_manager === false)).toBe(true);
  });

  it("skips group_ids that no longer exist at redeem time", async () => {
    const pool = await resetDb();
    const t = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','T') RETURNING id");
    const teamId = t.rows[0].id;
    const admin = await createUserAccount("admin@x.com", "pw12345678", null, {}, pool);
    const g1 = await createGroup(teamId, "g1", "G1", admin.id, pool);
    const g2 = await createGroup(teamId, "g2", "G2", admin.id, pool);
    const { token } = await createInvite(
      teamId, admin.id, { role: "member", groupIds: [g1.id, g2.id] }, pool,
    );
    await pool.query("DELETE FROM groups WHERE id = $1", [g2.id]);
    const newUser = await createUserAccount("new@x.com", "pw12345678", null, {}, pool);
    await redeemInvite(token, newUser.id, pool);
    const membership = await pool.query(
      "SELECT id FROM memberships WHERE user_account_id = $1 AND team_id = $2",
      [newUser.id, teamId],
    );
    const rows = await pool.query(
      "SELECT group_id FROM group_members WHERE membership_id = $1",
      [membership.rows[0].id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].group_id).toBe(g1.id);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm -F @claude-lens/team-server test -- test/lib/members.test.ts`
Expected: FAIL (`createInvite` doesn't accept `groupIds`).

- [ ] **Step 3: Extend `createInvite` and `redeemInvite`**

Edit `packages/team-server/src/lib/members.ts`. Replace the existing `createInvite` and `redeemInvite` with:

```typescript
export async function createInvite(
  teamId: string,
  createdBy: string,
  opts: { email?: string; role?: "admin" | "member"; expiresInDays?: number; groupIds?: string[] } = {},
  pool: pg.Pool,
): Promise<{ inviteId: string; token: string; expiresAt: string }> {
  const token = "iv_" + generateToken(16);
  const role = opts.role ?? "member";
  const expiresAt = new Date(Date.now() + (opts.expiresInDays ?? 7) * 24 * 60 * 60 * 1000);
  const groupIds = opts.groupIds ?? [];

  const res = await pool.query(
    `INSERT INTO invites (team_id, created_by, email, role, token_hash, expires_at, group_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [teamId, createdBy, opts.email?.toLowerCase() ?? null, role, sha256(token), expiresAt, groupIds],
  );
  await pool.query(
    "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'member.invite', $3)",
    [teamId, createdBy, JSON.stringify({ inviteId: res.rows[0].id, email: opts.email ?? null, role, groupIds })],
  );
  return { inviteId: res.rows[0].id, token, expiresAt: expiresAt.toISOString() };
}
```

Also change the `InviteRow` type:

```typescript
export type InviteRow = {
  id: string;
  team_id: string;
  created_by: string;
  email: string | null;
  role: "admin" | "member";
  expires_at: Date;
  group_ids: string[];
};
```

Update `lookupInvite` to select `created_by` and `group_ids`:

```typescript
export async function lookupInvite(token: string, pool: pg.Pool): Promise<InviteRow | null> {
  const res = await pool.query<InviteRow>(
    `SELECT id, team_id, created_by, email, role, expires_at, group_ids FROM invites
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [sha256(token)],
  );
  return res.rowCount ? res.rows[0] : null;
}
```

Update `redeemInvite` to also write group_members rows:

```typescript
export async function redeemInvite(
  inviteToken: string,
  userAccountId: string,
  pool: pg.Pool,
): Promise<{ membershipId: string; bearerToken: string; teamId: string; joinedGroupIds: string[] } | null> {
  const invite = await lookupInvite(inviteToken, pool);
  if (!invite) return null;

  const bearerToken = "bt_" + generateToken(32);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE invites SET used_at = now() WHERE id = $1", [invite.id]);
    const mRes = await client.query(
      `INSERT INTO memberships (user_account_id, team_id, role, bearer_token_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_account_id, team_id) DO UPDATE SET revoked_at = NULL, bearer_token_hash = EXCLUDED.bearer_token_hash
       RETURNING id`,
      [userAccountId, invite.team_id, invite.role, sha256(bearerToken)],
    );
    const membershipId = mRes.rows[0].id;

    // Insert one group_members row per still-existing group_id on the invite.
    let joinedGroupIds: string[] = [];
    if (invite.group_ids.length > 0) {
      const ins = await client.query<{ group_id: string }>(
        `INSERT INTO group_members (group_id, membership_id, is_manager, added_by)
         SELECT g.id, $2, false, $3 FROM groups g
         WHERE g.id = ANY($1::uuid[]) AND g.team_id = $4
         ON CONFLICT (group_id, membership_id) DO NOTHING
         RETURNING group_id`,
        [invite.group_ids, membershipId, invite.created_by, invite.team_id],
      );
      joinedGroupIds = ins.rows.map((r) => r.group_id);
    }

    await client.query(
      "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'member.join', $3)",
      [invite.team_id, userAccountId, JSON.stringify({ via: "invite", inviteId: invite.id, joinedGroupIds })],
    );
    await client.query("COMMIT");
    return { membershipId, bearerToken, teamId: invite.team_id, joinedGroupIds };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm -F @claude-lens/team-server test -- test/lib/members.test.ts`
Expected: PASS, all tests including the two new ones.

- [ ] **Step 5: Update callers that consume `redeemInvite`'s return value**

Grep callers:
```bash
grep -rn "redeemInvite" packages/team-server/src
```

If any caller destructures the return value, the new `joinedGroupIds` field is additive — no caller breakage. If any TypeScript code passed an unknown property to `createInvite`, the new optional `groupIds` won't conflict.

- [ ] **Step 6: Commit**

```bash
git add packages/team-server/src/lib/members.ts packages/team-server/test/lib/members.test.ts
git commit -m "feat(team-server): carry group placement through invite create/redeem"
```

---

## Task 5: Route helpers

**Files:**
- Modify: `packages/team-server/src/lib/route-helpers.ts`

- [ ] **Step 1: Add `requireGroupManager`**

Append to `packages/team-server/src/lib/route-helpers.ts`:

```typescript
/**
 * Asserts that the team context represents a member who manages `groupId`,
 * OR is an admin/staff. Returns the resolved group on success, or a 403/404
 * NextResponse on failure.
 */
export async function requireGroupManager(
  ctx: TeamContext,
  groupSlug: string,
): Promise<{ id: string; slug: string; name: string } | NextResponse> {
  const g = await ctx.pool.query<{ id: string; slug: string; name: string }>(
    "SELECT id, slug, name FROM groups WHERE team_id = $1 AND slug = $2",
    [ctx.membership.team_id, groupSlug],
  );
  if (!g.rowCount) return NextResponse.json({ error: "Group not found" }, { status: 404 });
  if (ctx.user.is_staff || ctx.membership.role === "admin") return g.rows[0];
  const isMgr = await ctx.pool.query(
    "SELECT 1 FROM group_members WHERE group_id = $1 AND membership_id = $2 AND is_manager = true",
    [g.rows[0].id, ctx.membership.id],
  );
  if (!isMgr.rowCount) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return g.rows[0];
}
```

- [ ] **Step 2: Verify the file still compiles**

Run: `pnpm -F @claude-lens/team-server typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/team-server/src/lib/route-helpers.ts
git commit -m "feat(team-server): requireGroupManager route helper"
```

---

## Task 6: Visibility-filtered queries

**Files:**
- Modify: `packages/team-server/src/lib/queries.ts`

- [ ] **Step 1: Write failing integration test**

Create `packages/team-server/test/lib/queries-visibility.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resetDb } from "../helpers/db";
import { createUserAccount } from "../../src/lib/auth";
import { createGroup, addGroupMember, setGroupMemberManager } from "../../src/lib/groups";
import { loadRoster, loadGroupRoster } from "../../src/lib/queries";

describe("loadRoster", () => {
  it("returns the full team roster (no filter)", async () => {
    const pool = await resetDb();
    const t = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','T') RETURNING id");
    const teamId = t.rows[0].id;
    const u1 = await createUserAccount("a@x.com", "pw12345678", null, {}, pool);
    const u2 = await createUserAccount("b@x.com", "pw12345678", null, {}, pool);
    await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'admin'),($3,$2,'member')",
      [u1.id, teamId, u2.id],
    );
    const rows = await loadRoster(teamId, pool);
    expect(rows.length).toBe(2);
  });
});

describe("loadGroupRoster", () => {
  it("returns only memberships in the given group", async () => {
    const pool = await resetDb();
    const t = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','T') RETURNING id");
    const teamId = t.rows[0].id;
    const u1 = await createUserAccount("in@x.com", "pw12345678", null, {}, pool);
    const u2 = await createUserAccount("out@x.com", "pw12345678", null, {}, pool);
    const m1 = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'member') RETURNING id",
      [u1.id, teamId],
    )).rows[0].id;
    const m2 = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'member') RETURNING id",
      [u2.id, teamId],
    )).rows[0].id;
    const g = await createGroup(teamId, "g", "G", u1.id, pool);
    await addGroupMember(g.id, m1, u1.id, pool);
    const rows = await loadGroupRoster(g.id, pool);
    expect(rows.map((r) => r.id)).toEqual([m1]);
    expect(rows.map((r) => r.id)).not.toContain(m2);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm -F @claude-lens/team-server test -- test/lib/queries-visibility.test.ts`
Expected: FAIL (`loadGroupRoster` not defined).

- [ ] **Step 3: Add `loadGroupRoster` and a visibility-aware variant**

Append to `packages/team-server/src/lib/queries.ts`:

```typescript
export async function loadGroupRoster(groupId: string, pool: pg.Pool): Promise<RosterRow[]> {
  const res = await pool.query<RosterRow & { is_manager: boolean }>(`
    SELECT
      m.id, u.email, u.display_name, m.role, m.joined_at, m.last_seen_at,
      gm.is_manager,
      COALESCE(SUM(r.agent_time_ms), 0)::bigint AS week_agent_time_ms,
      COALESCE(SUM(r.sessions), 0)::int AS week_sessions,
      COALESCE(SUM(r.tool_calls), 0)::int AS week_tool_calls,
      COALESCE(SUM(r.turns), 0)::int AS week_turns,
      COALESCE(SUM(r.tokens_input + r.tokens_output + r.tokens_cache_read + r.tokens_cache_write), 0)::bigint AS week_tokens
    FROM group_members gm
    JOIN memberships m ON m.id = gm.membership_id
    JOIN user_accounts u ON u.id = m.user_account_id
    LEFT JOIN daily_rollups r ON r.membership_id = m.id AND r.team_id = m.team_id AND r.day >= $2
    WHERE gm.group_id = $1 AND m.revoked_at IS NULL
    GROUP BY m.id, u.email, u.display_name, gm.is_manager
    ORDER BY gm.is_manager DESC, m.last_seen_at DESC NULLS LAST
  `, [groupId, weekStartIso()]);
  return res.rows;
}

export async function loadMemberGroupAffiliations(
  teamId: string,
  pool: pg.Pool,
): Promise<Map<string, { groupId: string; slug: string; name: string; isManager: boolean }[]>> {
  const res = await pool.query<{ membership_id: string; group_id: string; slug: string; name: string; is_manager: boolean }>(`
    SELECT gm.membership_id, g.id AS group_id, g.slug, g.name, gm.is_manager
    FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    WHERE g.team_id = $1
  `, [teamId]);
  const map = new Map<string, { groupId: string; slug: string; name: string; isManager: boolean }[]>();
  for (const row of res.rows) {
    if (!map.has(row.membership_id)) map.set(row.membership_id, []);
    map.get(row.membership_id)!.push({ groupId: row.group_id, slug: row.slug, name: row.name, isManager: row.is_manager });
  }
  return map;
}
```

The existing `loadRoster` does *not* need a visibility filter — admins are the only callers of it (the team root page redirects everyone else). Manager group pages use `loadGroupRoster` instead. `loadMember` will be guarded at the page level (Task 12).

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm -F @claude-lens/team-server test -- test/lib/queries-visibility.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/team-server/src/lib/queries.ts packages/team-server/test/lib/queries-visibility.test.ts
git commit -m "feat(team-server): loadGroupRoster and group affiliation lookup"
```

---

## Task 7: Admin groups settings page

**Files:**
- Create: `packages/team-server/src/app/team/[slug]/settings/groups/page.tsx`
- Create: `packages/team-server/src/components/groups-settings-panel.tsx`

- [ ] **Step 1: Server-component page**

Create `packages/team-server/src/app/team/[slug]/settings/groups/page.tsx`:

```typescript
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../../../db/pool";
import { validateSession } from "../../../../../lib/auth";
import { listGroupsForTeam, listGroupMembers } from "../../../../../lib/groups";
import { GroupsSettingsPanel } from "../../../../../components/groups-settings-panel";

export default async function GroupsSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pool = getPool();
  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const teamRes = await pool.query("SELECT id, name FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) return <div>Team not found.</div>;
  const team = teamRes.rows[0];

  const m = session.memberships.find((x) => x.team_id === team.id);
  if (!m) redirect("/login");
  if (m.role !== "admin" && !session.user.is_staff) {
    return <div className="section-head"><div><h1>Admin <em>only</em></h1></div></div>;
  }

  const groups = await listGroupsForTeam(team.id, pool);
  const membersByGroup = await Promise.all(
    groups.map(async (g) => ({ group: g, members: await listGroupMembers(g.id, pool) })),
  );

  const allMembers = await pool.query(
    `SELECT m.id, u.email, u.display_name
     FROM memberships m JOIN user_accounts u ON u.id = m.user_account_id
     WHERE m.team_id = $1 AND m.revoked_at IS NULL
     ORDER BY u.email`,
    [team.id],
  );

  return (
    <>
      <div className="section-head">
        <div>
          <h1><em>Groups</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>{groups.length} groups</div>
        </div>
      </div>
      <GroupsSettingsPanel
        teamSlug={slug}
        groups={membersByGroup}
        allMembers={allMembers.rows}
      />
    </>
  );
}
```

- [ ] **Step 2: Client component scaffold**

Create `packages/team-server/src/components/groups-settings-panel.tsx`:

```typescript
"use client";
import { useState } from "react";

type Member = { id: string; email: string | null; display_name: string | null };
type GroupMembership = { group_id: string; membership_id: string; is_manager: boolean; added_at: string };
type GroupWithMembers = {
  group: { id: string; slug: string; name: string };
  members: GroupMembership[];
};

export function GroupsSettingsPanel({
  teamSlug,
  groups,
  allMembers,
}: {
  teamSlug: string;
  groups: GroupWithMembers[];
  allMembers: Member[];
}) {
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!newName || !newSlug) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/team/${teamSlug}/groups`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: newSlug, name: newName }),
      });
      if (!r.ok) {
        alert(`Failed: ${(await r.json()).error ?? r.status}`);
        return;
      }
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  async function addMember(groupId: string, membershipId: string) {
    await fetch(`/api/team/${teamSlug}/groups/${groupId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ membershipId }),
    });
    window.location.reload();
  }
  async function removeMember(groupId: string, membershipId: string) {
    await fetch(`/api/team/${teamSlug}/groups/${groupId}/members?membershipId=${membershipId}`, {
      method: "DELETE",
    });
    window.location.reload();
  }
  async function toggleManager(groupId: string, membershipId: string, next: boolean) {
    await fetch(`/api/team/${teamSlug}/groups/${groupId}/members`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ membershipId, isManager: next }),
    });
    window.location.reload();
  }
  async function deleteGroup(groupId: string) {
    if (!confirm("Delete this group? Members keep their team membership but lose this group affiliation.")) return;
    await fetch(`/api/team/${teamSlug}/groups/${groupId}`, { method: "DELETE" });
    window.location.reload();
  }

  return (
    <div>
      <section style={{ marginBottom: 24 }}>
        <h2>Create group</h2>
        <input placeholder="slug (e.g., platform)" value={newSlug} onChange={(e) => setNewSlug(e.target.value)} />
        <input placeholder="Name (e.g., Platform Squad)" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button disabled={busy} onClick={create}>Create</button>
      </section>
      {groups.map(({ group, members }) => {
        const memberIds = new Set(members.map((m) => m.membership_id));
        const available = allMembers.filter((m) => !memberIds.has(m.id));
        return (
          <section key={group.id} style={{ marginBottom: 24, border: "1px solid #333", padding: 12 }}>
            <h2>{group.name} <small style={{ opacity: 0.6 }}>/{group.slug}</small></h2>
            <table>
              <thead><tr><th>Member</th><th>Role in group</th><th></th></tr></thead>
              <tbody>
                {members.map((gm) => {
                  const member = allMembers.find((a) => a.id === gm.membership_id);
                  return (
                    <tr key={gm.membership_id}>
                      <td>{member?.email ?? gm.membership_id}</td>
                      <td>
                        <label>
                          <input
                            type="checkbox"
                            checked={gm.is_manager}
                            onChange={(e) => toggleManager(group.id, gm.membership_id, e.target.checked)}
                          /> Manager
                        </label>
                      </td>
                      <td><button onClick={() => removeMember(group.id, gm.membership_id)}>Remove</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {available.length > 0 && (
              <details>
                <summary>Add member</summary>
                {available.map((m) => (
                  <button key={m.id} onClick={() => addMember(group.id, m.id)}>
                    + {m.email}
                  </button>
                ))}
              </details>
            )}
            <button onClick={() => deleteGroup(group.id)} style={{ marginTop: 8, color: "tomato" }}>Delete group</button>
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Add a link from `/settings` to `/settings/groups`**

Edit `packages/team-server/src/components/settings-panel.tsx` and add — somewhere in the top-level section list — a link like:

```tsx
<a href={`/team/${teamSlug}/settings/groups`} className="settings-link">Manage groups</a>
```

(Match the existing component's link/section style — the exact JSX depends on settings-panel.tsx's current layout. Place the link in the obvious settings-actions section.)

- [ ] **Step 4: Manual smoke**

Start the dev server: `pnpm -F @claude-lens/team-server dev`
Open `http://localhost:3322/team/<your-team-slug>/settings/groups` as an admin.
Expected: empty groups list with "Create group" form. Member as non-admin: "Admin only".
(API routes don't exist yet, so the buttons won't work — that's Task 8.)

- [ ] **Step 5: Commit**

```bash
git add packages/team-server/src/app/team/\[slug\]/settings/groups packages/team-server/src/components/groups-settings-panel.tsx packages/team-server/src/components/settings-panel.tsx
git commit -m "feat(team-server): admin groups settings page (UI only)"
```

---

## Task 8: Admin groups API

**Files:**
- Create: `packages/team-server/src/app/api/team/[slug]/groups/route.ts`
- Create: `packages/team-server/src/app/api/team/[slug]/groups/[group]/route.ts`
- Create: `packages/team-server/src/app/api/team/[slug]/groups/[group]/members/route.ts`
- Create: `packages/team-server/test/api/groups.integration.test.ts`

- [ ] **Step 1: Write failing integration test**

Create `packages/team-server/test/api/groups.integration.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { resetDb } from "../helpers/db";
import { createFirstOrSubsequentUser, createSession } from "../../src/lib/auth";

async function adminSession(): Promise<{ teamId: string; teamSlug: string; cookie: string; pool: Awaited<ReturnType<typeof resetDb>>; userId: string }> {
  const pool = await resetDb();
  const { user } = await createFirstOrSubsequentUser("admin@x.com", "pw12345678", "Admin", pool);
  const team = await pool.query("INSERT INTO teams (slug, name) VALUES ('t', 'T') RETURNING id, slug");
  const teamId = team.rows[0].id;
  await pool.query(
    "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1, $2, 'admin')",
    [user.id, teamId],
  );
  const { cookieToken } = await createSession(user.id, pool);
  return { teamId, teamSlug: team.rows[0].slug, cookie: `fleetlens_session=${cookieToken}`, pool, userId: user.id };
}

describe("groups API", () => {
  beforeAll(() => {
    process.env.PORT ||= "3322";
  });

  it("admin can create, list, rename, delete a group", async () => {
    const ctx = await adminSession();
    const base = `http://localhost:${process.env.PORT}/api/team/${ctx.teamSlug}/groups`;

    const created = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ctx.cookie },
      body: JSON.stringify({ slug: "platform", name: "Platform Squad" }),
    });
    expect(created.status).toBe(200);
    const { group } = await created.json();
    expect(group.slug).toBe("platform");

    const list = await fetch(base, { headers: { cookie: ctx.cookie } });
    const listed = await list.json();
    expect(listed.groups).toHaveLength(1);

    const ren = await fetch(`${base}/${group.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: ctx.cookie },
      body: JSON.stringify({ name: "Platform" }),
    });
    expect(ren.status).toBe(200);

    const del = await fetch(`${base}/${group.id}`, { method: "DELETE", headers: { cookie: ctx.cookie } });
    expect(del.status).toBe(200);
  });

  it("non-admin cannot create a group", async () => {
    const pool = await resetDb();
    const { user: admin } = await createFirstOrSubsequentUser("admin@x.com", "pw12345678", null, pool);
    const team = await pool.query("INSERT INTO teams (slug, name) VALUES ('t', 'T') RETURNING id, slug");
    await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1, $2, 'admin')",
      [admin.id, team.rows[0].id],
    );
    const { user: member } = await createFirstOrSubsequentUser("m@x.com", "pw12345678", null, pool);
    await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1, $2, 'member')",
      [member.id, team.rows[0].id],
    );
    const { cookieToken } = await createSession(member.id, pool);
    const r = await fetch(`http://localhost:${process.env.PORT}/api/team/${team.rows[0].slug}/groups`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `fleetlens_session=${cookieToken}` },
      body: JSON.stringify({ slug: "platform", name: "P" }),
    });
    expect(r.status).toBe(403);
  });
});
```

This test pattern matches existing `*.integration.test.ts` files — it assumes the dev server is running on `$PORT`. Existing integration tests have a setup file or use a shared `beforeAll` to ensure the server is up; mirror what's in `packages/team-server/test/api/team.integration.test.ts` for the harness.

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm -F @claude-lens/team-server test -- test/api/groups.integration.test.ts`
Expected: FAIL (routes return 404 because they don't exist).

- [ ] **Step 3: Implement list + create**

Create `packages/team-server/src/app/api/team/[slug]/groups/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireAdmin } from "../../../../../lib/route-helpers";
import { createGroup, listGroupsForTeam, listGroupsManagedBy } from "../../../../../lib/groups";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const isAdminOrStaff = ctx.user.is_staff || ctx.membership.role === "admin";
  const groups = isAdminOrStaff
    ? await listGroupsForTeam(ctx.membership.team_id, ctx.pool)
    : await listGroupsManagedBy(ctx.membership.id, ctx.pool);
  return NextResponse.json({ groups });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const fail = requireAdmin(ctx);
  if (fail) return fail;

  const body = await req.json();
  if (!body.slug || !body.name) return NextResponse.json({ error: "slug and name required" }, { status: 400 });
  if (!/^[a-z0-9-]+$/.test(body.slug)) return NextResponse.json({ error: "slug must be lowercase letters, digits, hyphens" }, { status: 400 });

  try {
    const group = await createGroup(ctx.membership.team_id, body.slug, body.name, ctx.user.id, ctx.pool);
    return NextResponse.json({ group });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "Group slug already exists in this team" }, { status: 409 });
    }
    throw err;
  }
}
```

- [ ] **Step 4: Implement rename + delete**

Create `packages/team-server/src/app/api/team/[slug]/groups/[group]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireAdmin } from "../../../../../../lib/route-helpers";
import { renameGroup, deleteGroup, loadGroupBySlug } from "../../../../../../lib/groups";

async function resolveGroupId(ctx: { pool: import("pg").Pool; membership: { team_id: string } }, groupParam: string): Promise<string | null> {
  // Accept either a UUID id or a slug for ergonomics.
  if (/^[0-9a-f-]{36}$/i.test(groupParam)) return groupParam;
  const g = await loadGroupBySlug(ctx.membership.team_id, groupParam, ctx.pool);
  return g?.id ?? null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string; group: string }> }) {
  const { slug, group } = await params;
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const fail = requireAdmin(ctx); if (fail) return fail;

  const id = await resolveGroupId(ctx, group);
  if (!id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "name required" }, { status: 400 });
  await renameGroup(id, body.name, ctx.pool, ctx.user.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string; group: string }> }) {
  const { slug, group } = await params;
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const fail = requireAdmin(ctx); if (fail) return fail;

  const id = await resolveGroupId(ctx, group);
  if (!id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await deleteGroup(id, ctx.pool, ctx.user.id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Implement member add / remove / promote**

Create `packages/team-server/src/app/api/team/[slug]/groups/[group]/members/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireAdmin } from "../../../../../../../lib/route-helpers";
import { addGroupMember, removeGroupMember, setGroupMemberManager, loadGroupBySlug } from "../../../../../../../lib/groups";

async function resolveGroupId(ctx: { pool: import("pg").Pool; membership: { team_id: string } }, groupParam: string): Promise<string | null> {
  if (/^[0-9a-f-]{36}$/i.test(groupParam)) return groupParam;
  const g = await loadGroupBySlug(ctx.membership.team_id, groupParam, ctx.pool);
  return g?.id ?? null;
}

async function assertMembershipBelongsToTeam(ctx: { pool: import("pg").Pool; membership: { team_id: string } }, membershipId: string): Promise<boolean> {
  const r = await ctx.pool.query("SELECT 1 FROM memberships WHERE id = $1 AND team_id = $2", [membershipId, ctx.membership.team_id]);
  return r.rowCount === 1;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string; group: string }> }) {
  const { slug, group } = await params;
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const fail = requireAdmin(ctx); if (fail) return fail;
  const id = await resolveGroupId(ctx, group);
  if (!id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json();
  if (!body.membershipId) return NextResponse.json({ error: "membershipId required" }, { status: 400 });
  if (!(await assertMembershipBelongsToTeam(ctx, body.membershipId))) {
    return NextResponse.json({ error: "membership not in this team" }, { status: 400 });
  }
  await addGroupMember(id, body.membershipId, ctx.user.id, ctx.pool, { isManager: !!body.isManager });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string; group: string }> }) {
  const { slug, group } = await params;
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const fail = requireAdmin(ctx); if (fail) return fail;
  const id = await resolveGroupId(ctx, group);
  if (!id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membershipId = req.nextUrl.searchParams.get("membershipId");
  if (!membershipId) return NextResponse.json({ error: "membershipId required" }, { status: 400 });
  await removeGroupMember(id, membershipId, ctx.pool, ctx.user.id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string; group: string }> }) {
  const { slug, group } = await params;
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const fail = requireAdmin(ctx); if (fail) return fail;
  const id = await resolveGroupId(ctx, group);
  if (!id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json();
  if (!body.membershipId || typeof body.isManager !== "boolean") {
    return NextResponse.json({ error: "membershipId and isManager required" }, { status: 400 });
  }
  try {
    await setGroupMemberManager(id, body.membershipId, body.isManager, ctx.pool, ctx.user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
```

- [ ] **Step 6: Run test, expect pass**

Run: `pnpm -F @claude-lens/team-server dev` (in another terminal) and `pnpm -F @claude-lens/team-server test -- test/api/groups.integration.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 7: Manual smoke of the admin UI**

Reload `/team/<slug>/settings/groups` and exercise create / add member / promote / remove / delete. Every action should succeed and refresh the page.

- [ ] **Step 8: Commit**

```bash
git add packages/team-server/src/app/api/team/\[slug\]/groups packages/team-server/test/api/groups.integration.test.ts
git commit -m "feat(team-server): admin groups CRUD API"
```

---

## Task 9: Admin invite form gains group multi-select

**Files:**
- Modify: `packages/team-server/src/components/settings-panel.tsx`
- Modify: the existing invite API handler (find via `grep -rn "createInvite" packages/team-server/src/app/api`)

- [ ] **Step 1: Find the existing admin invite endpoint**

Run: `grep -rln "createInvite" packages/team-server/src/app/api`. The result is the file to modify in Step 3.

- [ ] **Step 2: Pass `groupIds` from the UI**

Edit `packages/team-server/src/components/settings-panel.tsx`. Locate the invite-creation section (it calls the admin invite API). Add a group multi-select before the submit button:

```tsx
{/* Add to admin invite form */}
<fieldset>
  <legend>Add to groups (optional)</legend>
  {props.groups.map((g) => (
    <label key={g.id}>
      <input type="checkbox" value={g.id}
        checked={selectedGroupIds.includes(g.id)}
        onChange={(e) => {
          setSelectedGroupIds((cur) =>
            e.target.checked ? [...cur, g.id] : cur.filter((x) => x !== g.id)
          );
        }}
      /> {g.name}
    </label>
  ))}
</fieldset>
```

`props.groups` requires the parent server component to pass `groups: { id, slug, name }[]` from `listGroupsForTeam`. Update the page that renders `SettingsPanel` (`packages/team-server/src/app/team/[slug]/settings/page.tsx`) to pass it:

```typescript
import { listGroupsForTeam } from "../../../../lib/groups";
// ...
const groups = await listGroupsForTeam(team.id, pool);
return <SettingsPanel team={team} members={members.rows} teamSlug={slug} groups={groups} />;
```

And the SettingsPanel signature gets a new prop typed `{ id: string; slug: string; name: string }[]`.

Update the fetch call that submits the invite to include `groupIds: selectedGroupIds`.

- [ ] **Step 3: Extend the invite API to accept `groupIds`**

In the file found in Step 1, parse and forward `groupIds`:

```typescript
const body = await req.json();
const { groupIds } = body;
if (groupIds !== undefined) {
  if (!Array.isArray(groupIds) || !groupIds.every((g) => typeof g === "string")) {
    return NextResponse.json({ error: "groupIds must be string[]" }, { status: 400 });
  }
  // Validate group ids belong to this team
  if (groupIds.length > 0) {
    const r = await ctx.pool.query(
      "SELECT id FROM groups WHERE id = ANY($1::uuid[]) AND team_id = $2",
      [groupIds, ctx.membership.team_id],
    );
    if (r.rowCount !== groupIds.length) {
      return NextResponse.json({ error: "one or more groups not in this team" }, { status: 400 });
    }
  }
}
// then pass through:
const result = await createInvite(ctx.membership.team_id, ctx.user.id, { role, email, groupIds }, ctx.pool);
```

- [ ] **Step 4: Smoke**

Generate an admin invite with two groups selected. Redeem the link in a different browser/incognito by signing up. Check the database:

```sql
SELECT g.slug FROM group_members gm JOIN groups g ON g.id = gm.group_id
WHERE gm.membership_id = '<new-membership-id>';
```

Expected: the two groups appear.

- [ ] **Step 5: Commit**

```bash
git add packages/team-server/src/components/settings-panel.tsx packages/team-server/src/app/team/\[slug\]/settings/page.tsx packages/team-server/src/app/api
git commit -m "feat(team-server): admin invite form accepts group placement"
```

---

## Task 10: Groups list page

**Files:**
- Create: `packages/team-server/src/app/team/[slug]/groups/page.tsx`

- [ ] **Step 1: Create the list page**

```typescript
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../../db/pool";
import { validateSession } from "../../../../lib/auth";
import { listGroupsForTeam, listGroupsManagedBy } from "../../../../lib/groups";

export default async function GroupsListPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pool = getPool();
  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const teamRes = await pool.query("SELECT id FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) return <div>Team not found.</div>;
  const teamId = teamRes.rows[0].id;
  const m = session.memberships.find((x) => x.team_id === teamId);
  if (!m) redirect("/login");

  const isAdminOrStaff = session.user.is_staff || m.role === "admin";
  const groups = isAdminOrStaff
    ? await listGroupsForTeam(teamId, pool)
    : await listGroupsManagedBy(m.id, pool);

  // Plain members with no managed groups → not allowed here.
  if (groups.length === 0 && !isAdminOrStaff) {
    redirect(`/team/${slug}/members/${m.id}`);
  }

  return (
    <>
      <div className="section-head">
        <div>
          <h1><em>Groups</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            {isAdminOrStaff ? "All groups" : "Groups you manage"}
          </div>
        </div>
      </div>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {groups.map((g) => (
          <li key={g.id}>
            <a href={`/team/${slug}/groups/${g.slug}`}>
              <strong>{g.name}</strong> <small style={{ opacity: 0.6 }}>/{g.slug}</small>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
```

- [ ] **Step 2: Smoke**

As admin, visit `/team/<slug>/groups` and see all groups. As manager (of ≥1 group), see only their managed groups. As plain member, get redirected to self.

- [ ] **Step 3: Commit**

```bash
git add packages/team-server/src/app/team/\[slug\]/groups/page.tsx
git commit -m "feat(team-server): groups list page"
```

---

## Task 11: Group detail page

**Files:**
- Create: `packages/team-server/src/app/team/[slug]/groups/[group]/page.tsx`
- Create: `packages/team-server/src/components/group-roster.tsx`

- [ ] **Step 1: Build the page**

```typescript
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { getPool } from "../../../../../db/pool";
import { validateSession } from "../../../../../lib/auth";
import { loadGroupBySlug } from "../../../../../lib/groups";
import { loadGroupRoster } from "../../../../../lib/queries";
import { RosterCard } from "../../../../../components/roster-card";

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ slug: string; group: string }>;
}) {
  const { slug, group: groupSlug } = await params;
  const pool = getPool();
  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const teamRes = await pool.query("SELECT id FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) notFound();
  const teamId = teamRes.rows[0].id;
  const m = session.memberships.find((x) => x.team_id === teamId);
  if (!m) redirect("/login");

  const group = await loadGroupBySlug(teamId, groupSlug, pool);
  if (!group) notFound();

  // Authorization: admin/staff always; manager iff is_manager=true for this group.
  const isAdminOrStaff = session.user.is_staff || m.role === "admin";
  if (!isAdminOrStaff) {
    const r = await pool.query(
      "SELECT 1 FROM group_members WHERE group_id = $1 AND membership_id = $2 AND is_manager = true",
      [group.id, m.id],
    );
    if (!r.rowCount) notFound();
  }

  const roster = await loadGroupRoster(group.id, pool);
  const totalAgentMs = roster.reduce((sum, r) => sum + Number(r.week_agent_time_ms), 0);

  return (
    <>
      <div className="section-head">
        <div>
          <h1><em>{group.name}</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            {roster.length} {roster.length === 1 ? "member" : "members"}
            {" · "}{(totalAgentMs / 3600000).toFixed(1)}h combined agent time
            {" · "}<a href={`/team/${slug}/groups/${group.slug}/invite`}>Invite to this group</a>
          </div>
        </div>
      </div>
      <div className="roster-grid">
        {roster.map((r) => <RosterCard key={r.id} member={r} teamSlug={slug} />)}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Smoke**

Visit `/team/<slug>/groups/<g>` as admin (works), as manager of that group (works), as manager of a different group (404), as plain member (404).

- [ ] **Step 3: Commit**

```bash
git add packages/team-server/src/app/team/\[slug\]/groups/\[group\]/page.tsx
git commit -m "feat(team-server): group detail page"
```

---

## Task 12: Manager invite form and API

**Files:**
- Create: `packages/team-server/src/app/team/[slug]/groups/[group]/invite/page.tsx`
- Create: `packages/team-server/src/app/api/team/[slug]/groups/[group]/invite/route.ts`
- Create: `packages/team-server/src/components/manager-invite-form.tsx`
- Create: `packages/team-server/test/api/groups-invite.integration.test.ts`

- [ ] **Step 1: Manager invite API**

Create `packages/team-server/src/app/api/team/[slug]/groups/[group]/invite/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireGroupManager } from "../../../../../../../lib/route-helpers";
import { listGroupsManagedBy } from "../../../../../../../lib/groups";
import { createInvite } from "../../../../../../../lib/members";

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string; group: string }> }) {
  const { slug, group } = await params;
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const gr = await requireGroupManager(ctx, group);
  if (gr instanceof NextResponse) return gr;

  const body = await req.json();
  // Manager can choose additional groups, but only ones they also manage.
  const extras: string[] = Array.isArray(body.groupIds) ? body.groupIds : [];
  let allGroupIds = [gr.id, ...extras.filter((x) => x !== gr.id)];
  if (extras.length > 0) {
    const managed = await listGroupsManagedBy(ctx.membership.id, ctx.pool);
    const managedSet = new Set(managed.map((m) => m.id));
    // Admin/staff bypass.
    if (!(ctx.user.is_staff || ctx.membership.role === "admin")) {
      if (!allGroupIds.every((g) => managedSet.has(g))) {
        return NextResponse.json({ error: "Cannot invite into groups you don't manage" }, { status: 403 });
      }
    }
  }

  const result = await createInvite(
    ctx.membership.team_id,
    ctx.user.id,
    { role: "member", email: body.email, groupIds: allGroupIds },
    ctx.pool,
  );
  return NextResponse.json(result);
}
```

- [ ] **Step 2: Manager invite form (server component)**

Create `packages/team-server/src/app/team/[slug]/groups/[group]/invite/page.tsx`:

```typescript
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { getPool } from "../../../../../../db/pool";
import { validateSession } from "../../../../../../lib/auth";
import { loadGroupBySlug, listGroupsManagedBy, listGroupsForTeam } from "../../../../../../lib/groups";
import { ManagerInviteForm } from "../../../../../../components/manager-invite-form";

export default async function GroupInvitePage({ params }: { params: Promise<{ slug: string; group: string }> }) {
  const { slug, group: groupSlug } = await params;
  const pool = getPool();
  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const teamRes = await pool.query("SELECT id FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) notFound();
  const teamId = teamRes.rows[0].id;
  const m = session.memberships.find((x) => x.team_id === teamId);
  if (!m) redirect("/login");

  const group = await loadGroupBySlug(teamId, groupSlug, pool);
  if (!group) notFound();
  const isAdminOrStaff = session.user.is_staff || m.role === "admin";
  const availableGroups = isAdminOrStaff
    ? await listGroupsForTeam(teamId, pool)
    : await listGroupsManagedBy(m.id, pool);
  if (!availableGroups.find((g) => g.id === group.id)) notFound();

  return (
    <>
      <div className="section-head">
        <div>
          <h1>Invite to <em>{group.name}</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            New member · role locked to member
          </div>
        </div>
      </div>
      <ManagerInviteForm
        teamSlug={slug}
        groupSlug={group.slug}
        availableGroups={availableGroups}
        preselectedGroupId={group.id}
      />
    </>
  );
}
```

- [ ] **Step 3: Client component**

Create `packages/team-server/src/components/manager-invite-form.tsx`:

```typescript
"use client";
import { useState } from "react";

export function ManagerInviteForm({
  teamSlug,
  groupSlug,
  availableGroups,
  preselectedGroupId,
}: {
  teamSlug: string;
  groupSlug: string;
  availableGroups: { id: string; slug: string; name: string }[];
  preselectedGroupId: string;
}) {
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState<string[]>([preselectedGroupId]);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (selected.length === 0) { setError("Pick at least one group"); return; }
    const r = await fetch(`/api/team/${teamSlug}/groups/${groupSlug}/invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email || undefined, groupIds: selected }),
    });
    if (!r.ok) { setError(((await r.json()).error) ?? `HTTP ${r.status}`); return; }
    const { token } = await r.json();
    setLink(`${window.location.origin}/signup?invite=${token}`);
  }

  return (
    <div>
      <p style={{ opacity: 0.7 }}>Generates an invite link. The new member will join as a regular team member and be added to the groups you select below.</p>
      <label>Email (optional, for the invite record only):
        <input value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <fieldset>
        <legend>Groups to add the new member to</legend>
        {availableGroups.map((g) => (
          <label key={g.id} style={{ display: "block" }}>
            <input
              type="checkbox"
              checked={selected.includes(g.id)}
              disabled={g.id === preselectedGroupId}
              onChange={(e) => setSelected((cur) =>
                e.target.checked ? [...cur, g.id] : cur.filter((x) => x !== g.id)
              )}
            /> {g.name}
          </label>
        ))}
      </fieldset>
      <button onClick={submit}>Generate invite link</button>
      {error && <div style={{ color: "tomato" }}>{error}</div>}
      {link && (
        <div style={{ marginTop: 12 }}>
          <strong>Share this link:</strong>
          <input readOnly value={link} style={{ width: "100%" }} onClick={(e) => e.currentTarget.select()} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write integration test**

Create `packages/team-server/test/api/groups-invite.integration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resetDb } from "../helpers/db";
import { createFirstOrSubsequentUser, createSession } from "../../src/lib/auth";
import { createGroup, addGroupMember, setGroupMemberManager } from "../../src/lib/groups";

describe("manager invite API", () => {
  it("manager can invite into a group they manage", async () => {
    const pool = await resetDb();
    const { user: admin } = await createFirstOrSubsequentUser("admin@x.com", "pw12345678", null, pool);
    const team = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','T') RETURNING id, slug");
    const teamId = team.rows[0].id;
    await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'admin')",
      [admin.id, teamId],
    );
    const { user: mgr } = await createFirstOrSubsequentUser("mgr@x.com", "pw12345678", null, pool);
    const mgrM = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'member') RETURNING id",
      [mgr.id, teamId],
    )).rows[0].id;
    const g = await createGroup(teamId, "platform", "Platform", admin.id, pool);
    await addGroupMember(g.id, mgrM, admin.id, pool);
    await setGroupMemberManager(g.id, mgrM, true, pool, admin.id);

    const { cookieToken } = await createSession(mgr.id, pool);
    const r = await fetch(
      `http://localhost:${process.env.PORT}/api/team/${team.rows[0].slug}/groups/${g.slug}/invite`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `fleetlens_session=${cookieToken}` },
        body: JSON.stringify({ groupIds: [g.id] }),
      },
    );
    expect(r.status).toBe(200);
    const { inviteId } = await r.json();
    const invite = await pool.query("SELECT role, group_ids FROM invites WHERE id = $1", [inviteId]);
    expect(invite.rows[0].role).toBe("member");
    expect(invite.rows[0].group_ids).toEqual([g.id]);
  });

  it("manager cannot invite into a group they don't manage", async () => {
    const pool = await resetDb();
    const { user: admin } = await createFirstOrSubsequentUser("admin@x.com", "pw12345678", null, pool);
    const team = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','T') RETURNING id, slug");
    const teamId = team.rows[0].id;
    await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'admin')",
      [admin.id, teamId],
    );
    const { user: mgr } = await createFirstOrSubsequentUser("mgr@x.com", "pw12345678", null, pool);
    const mgrM = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'member') RETURNING id",
      [mgr.id, teamId],
    )).rows[0].id;
    const platform = await createGroup(teamId, "platform", "Platform", admin.id, pool);
    const growth = await createGroup(teamId, "growth", "Growth", admin.id, pool);
    await addGroupMember(platform.id, mgrM, admin.id, pool);
    await setGroupMemberManager(platform.id, mgrM, true, pool, admin.id);

    const { cookieToken } = await createSession(mgr.id, pool);
    // Try to invite to platform AND growth — should fail because mgr doesn't manage growth.
    const r = await fetch(
      `http://localhost:${process.env.PORT}/api/team/${team.rows[0].slug}/groups/platform/invite`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `fleetlens_session=${cookieToken}` },
        body: JSON.stringify({ groupIds: [platform.id, growth.id] }),
      },
    );
    expect(r.status).toBe(403);
  });
});
```

- [ ] **Step 5: Run tests, expect pass**

Run: `pnpm -F @claude-lens/team-server test -- test/api/groups-invite.integration.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Manual smoke**

As a manager, visit `/team/<slug>/groups/<your-group>/invite`. The current group is pre-checked and disabled. Other groups you manage are checkable. Generate a link, open in incognito, sign up, verify the new member appears in the group roster.

- [ ] **Step 7: Commit**

```bash
git add packages/team-server/src/app/team/\[slug\]/groups/\[group\]/invite packages/team-server/src/app/api/team/\[slug\]/groups/\[group\]/invite packages/team-server/src/components/manager-invite-form.tsx packages/team-server/test/api/groups-invite.integration.test.ts
git commit -m "feat(team-server): manager invite form + API scoped to managed groups"
```

---

## Task 13: Member detail page visibility guard

**Files:**
- Modify: `packages/team-server/src/app/team/[slug]/members/[id]/page.tsx`
- Create: `packages/team-server/test/api/visibility.integration.test.ts`

- [ ] **Step 1: Read the existing page**

```bash
cat packages/team-server/src/app/team/\[slug\]/members/\[id\]/page.tsx
```

Identify the spot where the page loads the member by id (`loadMember(id, pool)`).

- [ ] **Step 2: Add the visibility check**

Insert after the membership lookup, before rendering member data:

```typescript
import { canSeeMember, loadManagedMemberIds } from "../../../../../lib/visibility";
import { notFound } from "next/navigation";
// ...
const myMembership = session.memberships.find((mm) => mm.team_id === team.id);
if (!myMembership) redirect("/login");

const viewer = {
  membershipId: myMembership.id,
  role: myMembership.role,
  isStaff: session.user.is_staff,
};
const managed = await loadManagedMemberIds(viewer.membershipId, pool);
if (!canSeeMember(viewer, id, managed)) notFound();
```

The existing redirect-to-self path for plain members still works: they hit their own page and pass the predicate (self).

- [ ] **Step 3: Write integration test**

Create `packages/team-server/test/api/visibility.integration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resetDb } from "../helpers/db";
import { createFirstOrSubsequentUser, createSession } from "../../src/lib/auth";
import { createGroup, addGroupMember, setGroupMemberManager } from "../../src/lib/groups";

describe("member detail visibility", () => {
  it("manager can fetch a managed member's detail page", async () => {
    const pool = await resetDb();
    const { user: admin } = await createFirstOrSubsequentUser("admin@x.com", "pw12345678", null, pool);
    const team = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','T') RETURNING id, slug");
    const teamId = team.rows[0].id;
    await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'admin')",
      [admin.id, teamId],
    );
    const { user: mgr } = await createFirstOrSubsequentUser("mgr@x.com", "pw12345678", null, pool);
    const mgrM = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'member') RETURNING id",
      [mgr.id, teamId],
    )).rows[0].id;
    const { user: target } = await createFirstOrSubsequentUser("t@x.com", "pw12345678", null, pool);
    const tgtM = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'member') RETURNING id",
      [target.id, teamId],
    )).rows[0].id;
    const g = await createGroup(teamId, "g", "G", admin.id, pool);
    await addGroupMember(g.id, mgrM, admin.id, pool);
    await addGroupMember(g.id, tgtM, admin.id, pool);
    await setGroupMemberManager(g.id, mgrM, true, pool, admin.id);

    const { cookieToken } = await createSession(mgr.id, pool);
    const r = await fetch(
      `http://localhost:${process.env.PORT}/team/${team.rows[0].slug}/members/${tgtM}`,
      { headers: { cookie: `fleetlens_session=${cookieToken}` }, redirect: "manual" },
    );
    expect(r.status).toBe(200);
  });

  it("non-manager member cannot fetch another member's detail page", async () => {
    const pool = await resetDb();
    const { user: admin } = await createFirstOrSubsequentUser("admin@x.com", "pw12345678", null, pool);
    const team = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','T') RETURNING id, slug");
    const teamId = team.rows[0].id;
    await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'admin')",
      [admin.id, teamId],
    );
    const { user: a } = await createFirstOrSubsequentUser("a@x.com", "pw12345678", null, pool);
    const { user: b } = await createFirstOrSubsequentUser("b@x.com", "pw12345678", null, pool);
    const aM = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'member') RETURNING id",
      [a.id, teamId],
    )).rows[0].id;
    const bM = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'member') RETURNING id",
      [b.id, teamId],
    )).rows[0].id;

    const { cookieToken } = await createSession(a.id, pool);
    const r = await fetch(
      `http://localhost:${process.env.PORT}/team/${team.rows[0].slug}/members/${bM}`,
      { headers: { cookie: `fleetlens_session=${cookieToken}` }, redirect: "manual" },
    );
    expect(r.status).toBe(404);
  });
});
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm -F @claude-lens/team-server test -- test/api/visibility.integration.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/team-server/src/app/team/\[slug\]/members/\[id\]/page.tsx packages/team-server/test/api/visibility.integration.test.ts
git commit -m "feat(team-server): gate member detail page on canSeeMember"
```

---

## Task 14: Team root redirect for managers

**Files:**
- Modify: `packages/team-server/src/app/team/[slug]/page.tsx`

- [ ] **Step 1: Modify redirect logic**

Replace the existing non-admin redirect block (`if (myMembership.role !== "admin") redirect(...)`) with:

```typescript
import { listGroupsManagedBy } from "../../../lib/groups";

// ...inside the page function, after myMembership resolution:
if (myMembership.role !== "admin" && !session.user.is_staff) {
  const managed = await listGroupsManagedBy(myMembership.id, pool);
  if (managed.length === 1) {
    redirect(`/team/${slug}/groups/${managed[0].slug}`);
  }
  if (managed.length > 1) {
    redirect(`/team/${slug}/groups`);
  }
  // No managed groups → plain member, see only self.
  redirect(`/team/${slug}/members/${myMembership.id}`);
}
```

- [ ] **Step 2: Smoke**

- Log in as admin → land on full roster.
- Log in as a manager of one group → land on `/groups/<that-group-slug>`.
- Log in as a manager of two groups → land on `/groups`.
- Log in as a plain member → land on `/members/<self>`.

- [ ] **Step 3: Commit**

```bash
git add packages/team-server/src/app/team/\[slug\]/page.tsx
git commit -m "feat(team-server): redirect managers to their group page on team root"
```

---

## Task 15: Sidebar nav — Groups entry

**Files:**
- Modify: `packages/team-server/src/app/team/[slug]/layout.tsx`

- [ ] **Step 1: Add a conditional Groups link**

Inside `TeamLayout`, after the admin-only Plan/Settings links and before the Account section, add a managed-groups query and the link:

```typescript
import { listGroupsManagedBy } from "../../../lib/groups";
// ...
const managed = isAdmin
  ? null
  : await listGroupsManagedBy(myMembership.id, pool);
const hasGroupsNav = isAdmin || (managed && managed.length > 0);
```

Then in the JSX, between the Settings link and `+ New team`:

```tsx
{hasGroupsNav && (
  <a href={`/team/${slug}/groups`}>Groups <span className="mono">{isAdmin ? "04" : "02"}</span></a>
)}
```

(Renumber the section labels as appropriate — admin's "Settings" is currently 03; insert Groups as 04. Managers were already on a custom-numbered scheme.)

- [ ] **Step 2: Smoke**

- Admin: see Roster / Plan / Settings / Groups.
- Manager: see "My profile" / Groups.
- Plain member: see "My profile" only (no Groups entry).

- [ ] **Step 3: Commit**

```bash
git add packages/team-server/src/app/team/\[slug\]/layout.tsx
git commit -m "feat(team-server): sidebar Groups entry for admins and managers"
```

---

## Task 16: Group affiliation chips on admin roster

**Files:**
- Modify: `packages/team-server/src/app/team/[slug]/page.tsx`
- Modify: `packages/team-server/src/components/roster-card.tsx`

- [ ] **Step 1: Load affiliations in the team page**

In `packages/team-server/src/app/team/[slug]/page.tsx` (admin branch), after `loadRoster`:

```typescript
import { loadMemberGroupAffiliations } from "../../../lib/queries";
// ...
const affiliations = await loadMemberGroupAffiliations(teamId, pool);
```

Pass `affiliations.get(m.id) ?? []` to each `RosterCard`:

```tsx
{roster.map((m) => (
  <RosterCard key={m.id} member={m} teamSlug={slug} groups={affiliations.get(m.id) ?? []} />
))}
```

- [ ] **Step 2: Render chips in `RosterCard`**

Edit `packages/team-server/src/components/roster-card.tsx`. Extend the `member` prop's type to accept optional `groups`:

```typescript
groups?: { groupId: string; slug: string; name: string; isManager: boolean }[];
```

Add the prop:

```tsx
export function RosterCard({ member, teamSlug, groups = [] }: { /* ... */ groups?: { ... }[] }) {
```

In the card body, render the chips:

```tsx
{groups.length > 0 && (
  <div className="member-groups" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
    {groups.slice(0, 2).map((g) => (
      <a key={g.groupId} href={`/team/${teamSlug}/groups/${g.slug}`}
         className="group-chip" title={g.isManager ? `${g.name} (manager)` : g.name}>
        {g.name}{g.isManager && <span style={{ marginLeft: 4, opacity: 0.7 }}>★</span>}
      </a>
    ))}
    {groups.length > 2 && <span style={{ opacity: 0.6 }}>+{groups.length - 2}</span>}
  </div>
)}
```

- [ ] **Step 3: Smoke**

Admin roster shows group chips for each member who's in a group. Members in 0 groups show nothing extra. Member in 3+ groups shows the first 2 + "+N".

- [ ] **Step 4: Commit**

```bash
git add packages/team-server/src/app/team/\[slug\]/page.tsx packages/team-server/src/components/roster-card.tsx
git commit -m "feat(team-server): group affiliation chips on admin roster"
```

---

## Task 17: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run all tests**

Run: `pnpm -F @claude-lens/team-server test`
Expected: PASS — all existing tests plus the new visibility/groups/groups-invite/queries-visibility suites.

- [ ] **Step 2: Run typecheck**

Run: `pnpm -F @claude-lens/team-server typecheck`
Expected: clean exit.

- [ ] **Step 3: Manual smoke matrix**

In a browser, signed in as **admin**, walk:
1. `/team/<slug>` — full roster, group chips visible on members.
2. `/team/<slug>/settings/groups` — create a group, add a member, toggle manager, remove, delete.
3. `/team/<slug>/groups` — group list shows everything.
4. `/team/<slug>/groups/<g>` — group roster filtered correctly.
5. Generate invite from admin form with two groups → redeem in incognito → new member shows up in both groups.

Signed in as a freshly minted **manager** (admin promoted you):
1. `/team/<slug>` redirects to `/team/<slug>/groups/<your-group>`.
2. `/team/<slug>/groups` lists only your managed groups.
3. `/team/<slug>/groups/<g>/invite` — current group preselected and disabled; generate invite; redeem; new member appears in your group's roster.
4. `/team/<slug>/members/<member-in-your-group>` — 200.
5. `/team/<slug>/members/<member-not-in-your-group>` — 404.

Signed in as a **plain member** (no group, just role=member):
1. `/team/<slug>` redirects to `/team/<slug>/members/<self>`.
2. `/team/<slug>/groups` redirects to self.
3. `/team/<slug>/groups/<any>` — 404.

- [ ] **Step 4: Confirm audit events were written**

```sql
SELECT action, payload FROM events
WHERE action LIKE 'group.%' OR action = 'member.invite'
ORDER BY created_at DESC LIMIT 20;
```

Expected: `group.created`, `group.member.added`, `group.member.role_changed`, `group.member.removed`, `group.deleted`, `member.invite` (with `groupIds` in payload) all present from the smoke walk.

- [ ] **Step 5: Final commit if anything was tweaked during smoke**

```bash
git status
# if anything modified during smoke (e.g., small style fix), commit it
```

- [ ] **Step 6: PR**

Push the branch and open a PR titled `feat(team-server): team groups and manager visibility`. PR body summarizes the four-rung visibility ladder, the schema additions (groups + group_members + invites.group_ids), and the new routes. Link the spec at `docs/superpowers/specs/2026-05-15-team-groups-design.md`.
