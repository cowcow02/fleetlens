# Team Groups & Managers — Design

**Status:** Draft for review
**Date:** 2026-05-15
**Scope:** `packages/team-server` only (Team Edition). No changes to the CLI, parser, or local-only web app.

---

## 1. Problem

Today's Team Edition visibility ladder is two-rung:

- `is_staff` — global superuser
- `memberships.role = 'admin'` — sees everything in one team
- `memberships.role = 'member'` — sees only themselves

For any team larger than a single squad, there's no middle tier. An engineering manager who legitimately needs visibility into their direct reports has to be made a team admin — which also hands them visibility into every other report in the organization, plus team-wide write actions (invites, plan tiers, retention). The blast radius of "make this person a manager" is currently the entire team.

We want a third rung: a **manager** with bounded read visibility on a defined subset of team members, plus a narrow invite power to add new people into that subset.

---

## 2. Concept

A **group** is a named subset of a team's memberships. Membership in a group is a row in `group_members`. That row has an `is_manager` boolean: when true, the membership both *belongs to* the group (a visibility target for any manager of the same group) and *manages* the group (a visibility grantee with read access to other members' metrics).

"Manager" is not a row on `memberships.role` — it's a property of a `group_members` row. The existing `role` column stays exactly as it is (`'admin' | 'member'`). This is deliberate: a person's relationship to the team is one thing (admin or regular member), and their relationship to a group is another (in or out, manager or not).

### Visibility ladder

| Tier | Sees |
|------|------|
| staff (`is_staff = true`) | Everything, every team |
| team admin (`memberships.role = 'admin'`) | Everything in that team |
| group manager (≥1 `group_members.is_manager = true` row) | Themselves + every other member of any group they manage |
| plain member (`memberships.role = 'member'`, no manager rows) | Themselves only |

A person who is *in* a group but not a manager of it gets no extra visibility from that fact — being in a group only makes you a visibility *target* for that group's managers.

### Ungrouped members

Group membership is optional. A person can be in 0, 1, or many groups. An ungrouped member is visible only to team admins/staff and to themselves — the most restrictive default. No synthetic "Unassigned" group is created; null is just null. Admin roster gains a small "Ungrouped (N)" filter chip so it's operationally easy to spot who hasn't been placed.

---

## 3. Authority model — who can do what

The principle: **admins own the visibility lever; managers get a frictionless invite path but cannot widen their own scope.**

| Action | Staff | Admin | Manager | Member |
|--------|-------|-------|---------|--------|
| See all team members' metrics | ✓ | ✓ | — | — |
| See managed-group members' metrics | ✓ | ✓ | ✓ | — |
| See self | ✓ | ✓ | ✓ | ✓ |
| Create / rename / delete groups | ✓ | ✓ | — | — |
| Add existing team members to a group | ✓ | ✓ | — | — |
| Remove members from a group | ✓ | ✓ | — | — |
| Promote/demote `is_manager` flag | ✓ | ✓ | — | — |
| Generate invite, any group(s) any role | ✓ | ✓ | — | — |
| Generate invite, role=member, scoped to managed group(s) | ✓ | ✓ | ✓ | — |
| Revoke memberships, change plan tier, change retention | ✓ | ✓ | — | — |

A manager **cannot** pull existing members into their group. That action is the moment new visibility is granted, and granting visibility belongs to whoever owns the team's privacy boundary — i.e., admin. A manager can only *invite a new person* into their group; the invite encodes the group placement server-side and the new person lands directly in the manager's group on redeem.

---

## 4. Data model

One migration, scoped to `packages/team-server/src/db/migrations/`:

```sql
-- description: add groups, group_members with is_manager flag, group-scoped invites

CREATE TABLE groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, slug)
);

CREATE TABLE group_members (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  is_manager boolean NOT NULL DEFAULT false,
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by uuid REFERENCES user_accounts(id),
  PRIMARY KEY (group_id, membership_id)
);
CREATE INDEX idx_group_members_membership ON group_members(membership_id);
CREATE INDEX idx_group_members_managers ON group_members(group_id) WHERE is_manager = true;

ALTER TABLE invites ADD COLUMN group_ids uuid[] NOT NULL DEFAULT '{}';
```

Key properties:

- `memberships.role` is **unchanged**.
- `group_members.is_manager` is the only place "manager" exists as data.
- `invites.group_ids[]` carries the group placement server-side; the invite token in the URL does not leak group ids.
- Revoking a membership (setting `revoked_at`) does not delete its `group_members` rows. The auth predicate filters on `revoked_at IS NULL`, so revoked memberships drop out of visibility sets automatically.
- Hard-deleting a group removes all `group_members` rows for it (cascade). Members in the group are not affected; they simply lose that group affiliation.

---

## 5. Authorization

### The single predicate

Every server-side path that returns per-member data routes through one function:

> *Can membership V see member T's data?*

The answer is yes if any of these is true:
1. V is staff.
2. V's role is `admin`.
3. V's membership id equals T's.
4. T belongs to some group G where V has `is_manager = true` for G, and T's membership is not revoked.

### Precomputed per request

For aggregate queries (roster, daily rollups, plan utilization, SSE events), we don't call the predicate per row. Instead we load V's **visibility set** once at the start of the request:

- staff / admin → unrestricted (no filter)
- manager → `{V.membershipId} ∪ { other members of groups V manages where memberships.revoked_at IS NULL }`
- plain member → `{V.membershipId}`

All aggregate queries get a `WHERE membership_id = ANY($visibility_set)` filter (or no filter for staff/admin). All single-record routes (`/members/<id>`) check the predicate inline and return 404 on failure — not 403, to avoid leaking the existence of members the viewer can't see.

### Bearer token paths (CLI ingest)

The CLI ingests transcripts using a per-membership bearer token (`memberships.bearer_token_hash`). That path is unchanged: ingest writes to *its own* membership's rows only, irrespective of group affiliation. Groups are a read-side visibility concept, not a write-side scoping concept.

---

## 6. URL & UI surface

### Routes

| Route | Admin / Staff | Manager (of ≥1 group) | Member |
|-------|---------------|------------------------|--------|
| `/team/<slug>` | Full roster (no change) | Redirect: `/team/<slug>/groups/<g>` if managing exactly 1; else `/team/<slug>/groups` | Redirect to self (no change) |
| `/team/<slug>/groups` *(new)* | List all groups | List groups they manage | 404 |
| `/team/<slug>/groups/<group-slug>` *(new)* | Group view: roster scoped to its members + group metadata | Same, only if `is_manager=true` for this group; else 404 | 404 |
| `/team/<slug>/groups/<group-slug>/invite` *(new)* | Admin can use it; same form as admin invite but pre-targeted | Manager invite form: role locked to `member`, group(s) pre-selected from their managed set | 404 |
| `/team/<slug>/members/<id>` | Any | Gated by `canSeeMember`; 404 otherwise | Self only (no change) |
| `/team/<slug>/settings/groups` *(new)* | Group CRUD: create, rename, delete; add/remove members; toggle `is_manager` | 404 | 404 |
| `/team/<slug>/settings` (existing) | Existing settings + link to `/settings/groups` | Existing manager-visible settings only | n/a |

### Visual placement of group affiliation

- Admin roster cards gain compact group badges (e.g., `Platform · iOS`). Truncated past 2; tooltip shows the rest.
- Group page header carries: group name, member count, manager count, "combined agent time this week" *(this is the obvious landing spot for the future group-level rollup feature — design leaves room but ships the page with only the per-member roster cards in v1)*.
- Member detail page gains a sidebar section "Groups: Platform Squad, iOS" visible to anyone who can see the member.

### Sidebar / nav

The team-server sidebar gains a "Groups" entry between "Roster" and "Plan". It links to `/team/<slug>/groups`. The entry is hidden for plain members (their visibility set is `{self}` — there's nothing to show).

---

## 7. Invite flow changes

### Admin invite form
Existing `/team/<slug>/settings/invites/new` gains a "Add to groups" multi-select. Defaults to empty (= ungrouped on redeem). Role selector unchanged.

### Manager invite form *(new)*
`/team/<slug>/groups/<group-slug>/invite`. Role is hardcoded `member`. Group multi-select shows only groups the manager manages, with the current group preselected. Submitting writes a row to `invites` with `group_ids` populated and `role='member'`.

### Redeem
On `invites.usedAt` flip:
1. Create the membership as today.
2. For each id in `invites.group_ids`, insert `group_members(group_id, membership_id, is_manager=false, added_by=invites.created_by)`.

Both inserts are in one transaction. If a group id no longer exists (admin deleted it between invite creation and redemption), the row is skipped silently — the membership still gets created. The redemption confirmation page tells the user which groups they were added to, including a note if any were skipped.

### Existing invites
The migration adds `group_ids` with default `'{}'`. Already-pending invites continue to work and produce an ungrouped membership on redeem. No data backfill needed.

---

## 8. Events / audit log

The `events` table gains these `action` values:

- `group.created` — payload: `{ group_id, slug, name }`
- `group.renamed` — payload: `{ group_id, from, to }`
- `group.deleted` — payload: `{ group_id, slug, name, removed_member_ids }`
- `group.member.added` — payload: `{ group_id, membership_id, is_manager }`
- `group.member.removed` — payload: `{ group_id, membership_id }`
- `group.member.role_changed` — payload: `{ group_id, membership_id, is_manager }` (covers both promote and demote — the new value tells you which)

`invite.created` payload extends to include `group_ids`.

`actor_id` for every event is the authenticated user. For manager-issued invites the actor is the manager.

---

## 9. Migration & rollout

- Single migration file at `packages/team-server/src/db/migrations/<NNN>__add_team_groups.sql` with the schema in §4. Description header per the team-server convention.
- Migration is purely additive — no `memberships` schema changes, no data backfill, no breaking changes.
- Existing teams: zero groups by default. Behavior is identical to today until an admin creates a group.
- Feature is on for everyone the moment the migration runs; no flag.

---

## 10. Out of scope for v1

These are intentionally deferred — each can be added later without schema or URL churn:

- **Group-level metric rollups** on the group page (combined agent time, parallelism, plan utilization aggregates). The page exists; the rollup card slots in later. This was the future feature referenced during design.
- **Manager-delegated write actions**: revoking memberships, changing plan tiers, retention, promoting other managers. All admin-only in v1.
- **Group hierarchies / nested groups**. Groups are flat within a team.
- **Cross-team groups**. A group belongs to exactly one team.
- **SCIM / SSO group sync**. Groups are manually managed via the admin UI.
- **Manager-without-membership** (a person who manages a group but is not "in" it). Anyone with managerial visibility is also a member of the group; if you need someone above that, they're an admin.
- **Per-group plan tier or retention overrides**. Plan and retention remain team-level.

---

## 11. Edge cases with explicit answers

These are decisions made up-front so the implementation doesn't invent them.

| Question | v1 answer | Why |
|----------|-----------|-----|
| If the last manager of a group is removed/revoked, does the system warn or block? | No warning, no block. The group simply has no managers; only admins can see it. | A no-op once admins already see everything; a warning here would be noise. |
| Can an admin be in a group? | Yes. It's just a `group_members` row. Their visibility is unchanged (already global), and being listed in the group is sometimes operationally meaningful. | Cheap to allow; nothing breaks. |
| Can `is_manager` be set on a `group_members` row whose membership is revoked? | No. Setting `is_manager=true` requires the membership be active. The auth predicate already filters revoked memberships out of visibility sets, but blocking the write is a defense-in-depth choice. | Avoids zombie manager rows that "wake up" if a membership is reinstated. |
| Where does an invite go if the inviter is removed from a group before redemption? | The invite still works; the new member lands in the groups listed on the invite. | The invite is a server-issued credential, not a delegated capability tied to the inviter's current state. Auditable via the invite's `created_by`. |

---

## 12. Why this design

- **Manager is a relationship, not a role.** Roles are flat enums on memberships and don't compose. Putting "manager" on `memberships.role` would force a single global team-level decision; making it a per-group property means one person can manage Platform without managing Growth, and an EM can be a member of one squad and the manager of another.
- **Groups have their own URL.** The future group-level rollup feature needs a stable URL to live at. Inventing it now means that feature is "add a card to an existing page", not "design a new route and migrate links".
- **Admins own the visibility lever.** Managers can only invite *new* people, never pull existing members into their group. That's the bright line that keeps "manager" from quietly becoming "back-door admin".
- **No new role enum.** Touching `memberships.role` would mean migrating every existing check across the codebase. Keeping it at `admin | member` and layering visibility via `group_members.is_manager` keeps the change additive.
