# Team-server database migrations

All schema changes ship as ordered, numbered SQL files in `src/db/migrations/`.
`src/db/schema.ts` (Drizzle) stays the source of truth for what the schema
looks like, but migrations 0009 onward are **hand-authored SQL** — Drizzle's
journal (`migrations/meta/_journal.json`) is frozen at 0008, and the migration
runner (`src/db/migrate.ts`) applies journaled migrations first, then discovers
and applies the newer "orphan" files in filename order.

> **Do not run `drizzle-kit generate`.** With the journal frozen at 0008 it
> diffs against a stale snapshot and emits a migration that re-creates every
> table added since — colliding with existing file numbers and failing with
> "relation already exists" on any real database.

## Workflow

1. Edit `src/db/schema.ts` — add tables, add columns, etc. (schema.ts must
   always reflect the post-migration state; queries are built from it).
2. Hand-write `src/db/migrations/NNNN_<short_description>.sql` using the next
   unused number. The file MUST begin with a `-- description: ...` header —
   the release pipeline builds `migrations-manifest.json` from it and fails
   without it. Follow the style of `0009`–`0016`.
3. Test it end-to-end: `createdb fleetlens_test` (if you haven't) and run
   `pnpm -F @claude-lens/team-server test` — the suite applies every
   migration, including orphans, to the test database before running.
4. Commit the schema change AND the migration file together.

## Expand/Contract Rules (NON-NEGOTIABLE)

Every released migration MUST be safe to run against a database being
served by the PREVIOUS version of team-server. This is what makes the
Cloud Run / Railway revision swap zero-downtime: the old container keeps
serving during the migration, and the new container can't corrupt
things for the old one.

### Allowed in a single migration

- `CREATE TABLE ...`
- `ADD COLUMN ... NULL` (no default required)
- `ADD COLUMN ... NOT NULL DEFAULT <value>` (where the default is cheap)
- `CREATE INDEX CONCURRENTLY ...`
- `CREATE INDEX IF NOT EXISTS ...` (non-concurrent for new small tables only)
- New `CHECK` constraints marked `NOT VALID` (validated later)

### FORBIDDEN in a single migration

- `DROP COLUMN` — takes two releases (see below)
- `DROP TABLE` — takes two releases (see below)
- `RENAME COLUMN` — takes two or three releases (see below)
- `ALTER COLUMN TYPE` — beyond compatible widening (int → bigint OK, anything else: two releases)
- `ADD COLUMN ... NOT NULL` without a default — breaks old code's inserts

### Multi-release patterns

**Removing a column**:
- Release N: stop reading and writing the column in code. Migration file: empty or unrelated.
- Release N+1: `DROP COLUMN`.

**Renaming a column `old` → `new`**:
- Release N: `ADD COLUMN new`. Code writes BOTH columns, reads from `new` with fallback to `old`.
- Release N+1: backfill `new` from `old`, start ignoring `old`.
- Release N+2: `DROP COLUMN old`.

**Changing a column's type incompatibly**:
- Release N: add a new column with the new type, dual-write from code.
- Release N+1: backfill, switch reads, drop old column.

## Why this discipline exists

See `docs/superpowers/specs/2026-04-22-team-edition-self-update-design.md`
(Section 2 "Expand/contract discipline"). Short version: Cloud Run and
Railway keep the old revision serving until the new revision is healthy.
If the new migration drops a column the old code still writes to, the
old revision errors on every write during the swap window. Expand/contract
keeps every intermediate schema state backwards-compatible.

## Upgrade-path data migration: staff promotion (0001)

v0.5.0 introduces `requireStaff`-gated admin routes + first-signup auto-promotion
(see `packages/team-server/src/lib/auth.ts:createFirstOrSubsequentUser`). Fresh
installs bootstrap a staff user on first signup. But existing v0.4.x deployments
have users with `is_staff=false` (column default) and no one to click "Apply
Update" on upgrade.

The 0001 migration (landing in Chunk 4 alongside the `update_check_cache` schema
change) includes an idempotent data statement that promotes the earliest team
admin — a reasonable proxy for "whoever installed this server" — to staff:

```sql
-- Promote the earliest team admin to staff on upgrade so v0.4.x deployments
-- have at least one staff user after upgrading to v0.5.0. Idempotent: the
-- NOT EXISTS clause makes this a no-op on fresh installs where first-signup
-- already promoted someone.
UPDATE user_accounts
SET is_staff = true
WHERE id IN (
  SELECT m.user_account_id
  FROM memberships m
  JOIN teams t ON t.id = m.team_id
  WHERE m.role = 'admin' AND m.revoked_at IS NULL
  ORDER BY t.created_at ASC, m.joined_at ASC
  LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM user_accounts WHERE is_staff = true);
```

The SQL is bundled with the `update_check_cache` schema change rather than living
in its own data-only migration, because Drizzle's journal + snapshot format is
awkward for migrations that don't change schema. See
`docs/superpowers/specs/2026-04-22-team-edition-self-update-design.md` Section 5a
for the full staff-management spec.

## Review checklist (for authors AND reviewers)

- [ ] Does the generated `.sql` match the changes you expected, with no surprises?
- [ ] Is every operation in the "Allowed" list above? If not: did you split into two releases?
- [ ] For new `NOT NULL` columns: is the default cheap to apply (no data backfill required)?
- [ ] For new tables: does the code that reads from them handle "no rows yet" gracefully?
- [ ] Did you commit the schema change and the migration file together?
