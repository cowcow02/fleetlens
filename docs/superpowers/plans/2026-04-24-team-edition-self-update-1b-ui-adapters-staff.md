# Team Edition Self-Update — Plan 1b: Self-Update UI + Platform Adapters + Staff Management

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship team-server v0.5.0 with a click-to-update mechanism: platform staff visits `/admin/updates`, sees current version + latest available (from GHCR), clicks Apply, and the running container calls its platform's control-plane API (Cloud Run Admin API or Railway GraphQL) to redeploy with the new image tag. Includes staff-management (first-signup auto-promotion + `/admin/staff` page) and installer updates to grant the service account the `roles/run.developer` IAM binding needed for self-update.

**Architecture:** Thin `PlatformAdapter` interface with `GcpCloudRunAdapter` + `RailwayAdapter` implementations. Update service polls GHCR tags list every hour (cached in a new `update_check_cache` table added via Drizzle migration) and fetches changelog from the GitHub Releases API + migrations preview from the `migrations-manifest.json` asset published in Plan 1a. Admin UI gated by `is_staff` (distinct from per-team `admin` role). Staff management uses the existing `is_staff` column from the Plan 1 schema.

**Tech Stack:** Same as Plan 1a, plus `@google-cloud/run` SDK (for the Cloud Run adapter), `semver` (for version comparison), and continued use of existing building blocks (Drizzle, `pg`, Next 16 App Router, vitest).

**Spec:** `docs/superpowers/specs/2026-04-22-team-edition-self-update-design.md` (Sections 3–5a in particular).

**Depends on:** Plan 1a (team-server v0.4.2) — merged. `feat/team-edition-1b-self-update` branches from master post-merge.

**Ships as:** team-server **v0.5.0** (git tag `server-v0.5.0`, GHCR `:0.5.0`). User-visible: the `/admin/updates` page + global "update available" banner.

---

## File Structure

### New files

```
packages/team-server/
  src/
    db/
      migrations/0001_update_check_cache.sql     # new Drizzle migration
      migrations/meta/0001_snapshot.json
      migrations/meta/_journal.json (updated)
    lib/
      self-update/
        platform.ts             # PlatformAdapter interface + getPlatformAdapter() factory
        gcp-cloud-run.ts        # GcpCloudRunAdapter
        railway.ts              # RailwayAdapter
        version-detector.ts     # GHCR tags query + semver compare
        changelog-fetcher.ts    # GitHub Releases API + manifest fetch
        service.ts              # getStatus, checkNow, getReview, applyUpdate
      staff.ts                  # staff promote/revoke logic + last-staff guard
    app/
      api/admin/updates/
        route.ts                           # GET status
        check/route.ts                     # POST force-refresh
        review/route.ts                    # GET changelog + pending migrations
        apply/route.ts                     # POST trigger redeploy
      api/admin/staff/
        route.ts                           # GET list
        grant/route.ts                     # POST promote
        revoke/route.ts                    # POST demote (refuses on last staff)
      admin/updates/
        page.tsx                           # list page
        [version]/page.tsx                 # review page
      admin/staff/
        page.tsx                           # staff list + toggles
    components/
      update-banner.tsx                    # global banner shown on every admin page when update is available
      update-review-view.tsx               # client component for review page (markdown + migrations list + apply button)
      staff-table.tsx                      # client component for staff page
  test/
    lib/
      self-update/
        version-detector.test.ts
        changelog-fetcher.test.ts
        gcp-cloud-run-adapter.test.ts
        railway-adapter.test.ts
        service.test.ts
      staff.test.ts
      route-helpers.test.ts                # extended: requireStaff tests
    api/
      admin-updates.integration.test.ts
      admin-staff.integration.test.ts
      signup.integration.test.ts            # extended: first-signup auto-promote
```

### Modified files

```
packages/team-server/package.json                       # + @google-cloud/run, + semver
packages/team-server/src/db/schema.ts                   # + updateCheckCache pgTable
packages/team-server/src/lib/auth.ts                    # SessionContext carries is_staff
packages/team-server/src/lib/route-helpers.ts           # + requireStaff helper
packages/team-server/src/lib/scheduler.ts               # + checkForUpdates hourly job
packages/team-server/src/app/api/auth/signup/route.ts   # first-signup auto-promote
packages/team-server/src/app/layout.tsx                 # render <UpdateBanner /> above main
deploy/gcp/install.sh                                   # + run.developer binding + --grant-staff flag
deploy/railway/README.md                                # document RAILWAY_TOKEN requirement
```

### Unmodified but referenced

```
packages/team-server/src/db/baseline.ts                 # (Plan 1a)
packages/team-server/src/db/migrate.ts                  # (Plan 1a)
packages/team-server/src/lib/rate-limit.ts              # reused for staff + apply rate limits
packages/team-server/src/app/signup/page.tsx            # server component; calls auto-promote via signup handler
packages/team-server/Dockerfile                          # APP_VERSION already baked (Plan 1a)
.github/workflows/publish-team-server-image.yml          # manifest publish already in place (Plan 1a)
```

---

## Chunk 1: RBAC Foundation (`requireStaff` + auto-promote)

This chunk is the hinge for everything downstream. Every `/api/admin/*` route in later chunks is gated by `requireStaff`, and the first-signup path is what makes the eventual demo work ("you sign up, you're staff").

### Task 1.1: Extend `SessionContext` to carry `is_staff`

**Files:**
- Modify: `packages/team-server/src/lib/auth.ts`
- Test: `packages/team-server/test/lib/auth.test.ts` (existing; extend)

- [ ] **Step 1: Read current `SessionContext` shape**

Run: `grep -n "SessionContext\|is_staff" packages/team-server/src/lib/auth.ts | head -20`

Find the `SessionContext` type definition. Today it likely has `{ userAccountId, memberships }` shape.

- [ ] **Step 2: Add `isStaff: boolean` to the type + the validator**

`SessionContext` gains `isStaff: boolean`. The `validateSession` function's SQL query must `SELECT is_staff FROM user_accounts` alongside whatever it already joins.

Example change (adjust to match actual file):

```ts
export type SessionContext = {
  userAccountId: string;
  isStaff: boolean;                       // NEW
  memberships: Array<{ team_id: string; role: "admin" | "member" }>;
};

export async function validateSession(token: string, pool: pg.Pool): Promise<SessionContext | null> {
  // … existing session lookup joins user_accounts already; just add is_staff to the SELECT list.
  // Return shape includes isStaff: row.is_staff.
}
```

- [ ] **Step 3: Write the failing test first (TDD)**

Extend `test/lib/auth.test.ts` with:

```ts
it("returns isStaff=true for a staff user", async () => {
  const u = await createUserAccount("staff-a@example.com", "p", "Staff", {}, pool);
  await pool.query("UPDATE user_accounts SET is_staff = true WHERE id = $1", [u.id]);
  const token = generateToken();
  await createSession(u.id, token, { days: 7 }, pool);
  const ctx = await validateSession(token, pool);
  expect(ctx?.isStaff).toBe(true);
});

it("returns isStaff=false for a non-staff user", async () => {
  const u = await createUserAccount("staff-b@example.com", "p", "B", {}, pool);
  const token = generateToken();
  await createSession(u.id, token, { days: 7 }, pool);
  const ctx = await validateSession(token, pool);
  expect(ctx?.isStaff).toBe(false);
});
```

- [ ] **Step 4: Run tests to verify they fail**, then implement Step 2, then run tests to confirm they pass.

- [ ] **Step 5: Commit**

```bash
git add packages/team-server/src/lib/auth.ts packages/team-server/test/lib/auth.test.ts
git commit -m "feat(team-server): surface is_staff on SessionContext"
```

### Task 1.2: Add `requireStaff` helper in `route-helpers.ts`

**Files:**
- Modify: `packages/team-server/src/lib/route-helpers.ts`
- Test: `packages/team-server/test/lib/route-helpers.test.ts` (existing; extend)

- [ ] **Step 1: Write the failing test first**

```ts
// Extend test/lib/route-helpers.test.ts
describe("requireStaff", () => {
  it("returns 401 when no session cookie is present", async () => {
    const req = new NextRequest("http://localhost/api/admin/updates");
    const res = await requireStaff(req);
    expect(res).toBeInstanceOf(NextResponse);
    expect((res as NextResponse).status).toBe(401);
  });

  it("returns 403 when the session is valid but is_staff is false", async () => {
    const u = await createUserAccount("non-staff@example.com", "p", "U", {}, pool);
    const token = generateToken();
    await createSession(u.id, token, { days: 7 }, pool);
    const req = new NextRequest("http://localhost/api/admin/updates");
    req.cookies.set("fleetlens_session", token);
    const res = await requireStaff(req);
    expect(res).toBeInstanceOf(NextResponse);
    expect((res as NextResponse).status).toBe(403);
  });

  it("returns the SessionContext when is_staff is true", async () => {
    const u = await createUserAccount("staff@example.com", "p", "S", {}, pool);
    await pool.query("UPDATE user_accounts SET is_staff = true WHERE id = $1", [u.id]);
    const token = generateToken();
    await createSession(u.id, token, { days: 7 }, pool);
    const req = new NextRequest("http://localhost/api/admin/updates");
    req.cookies.set("fleetlens_session", token);
    const res = await requireStaff(req);
    expect(res).not.toBeInstanceOf(NextResponse);
    expect((res as any).isStaff).toBe(true);
  });
});
```

- [ ] **Step 2: Implement `requireStaff`** alongside the existing `requireSession` and `requireAdmin`:

```ts
export async function requireStaff(
  req: NextRequest,
): Promise<(SessionContext & { pool: pg.Pool }) | NextResponse> {
  const base = await requireSession(req);
  if (base instanceof NextResponse) return base;
  if (!base.isStaff) return NextResponse.json({ error: "Staff only" }, { status: 403 });
  return base;
}
```

- [ ] **Step 3: Run the new tests** — all three should pass.

- [ ] **Step 4: Commit**

```bash
git add packages/team-server/src/lib/route-helpers.ts packages/team-server/test/lib/route-helpers.test.ts
git commit -m "feat(team-server): add requireStaff helper alongside requireAdmin"
```

### Task 1.3: First-signup auto-promotion to `is_staff`

**Files:**
- Modify: `packages/team-server/src/app/api/auth/signup/route.ts` (or whichever handler contains the user-creation logic)
- Modify: `packages/team-server/src/lib/auth.ts` — `createUserAccount` may need a signature tweak or we add the promote logic in the route handler
- Test: `packages/team-server/test/api/signup.integration.test.ts` (new)

**Key invariant:** the check-and-promote MUST be atomic with user creation. Done in a single transaction, with `READ COMMITTED` isolation + the `user_accounts.email` uniqueness constraint providing the serialization guarantee for concurrent first-signups.

- [ ] **Step 1: Find the signup handler**

Run: `find packages/team-server/src/app/api/auth -name "*.ts" | xargs grep -l "createUserAccount\|INSERT INTO user_accounts"`

- [ ] **Step 2: Write the failing integration test first**

Create `packages/team-server/test/api/signup.integration.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb } from "../helpers/db.js";
import { getPool } from "../../src/db/pool.js";
// plus the NextRequest/dispatcher pattern used in existing integration tests (e.g., auth.integration.test.ts)

let pool: ReturnType<typeof getPool>;
beforeEach(async () => { pool = await resetDb(); });
afterAll(async () => { await pool.end(); });

describe("signup auto-promotion", () => {
  it("first signup on a fresh DB auto-promotes to is_staff=true", async () => {
    // dispatch signup request for the first user; assert is_staff=true in DB
  });

  it("second signup on a DB with a staff user does NOT auto-promote", async () => {
    // create a pre-existing staff user first, then signup a second user; assert is_staff=false
  });

  it("two concurrent first-signups produce exactly one is_staff=true account", async () => {
    // Promise.all two signup calls with different emails; assert count(*) where is_staff=true == 1.
    // This locks down the atomicity claim.
  });
});
```

Match the existing `test/api/auth.integration.test.ts` pattern for dispatching requests.

- [ ] **Step 3: Run the test — expect it to fail** (not auto-promoted yet).

- [ ] **Step 4: Implement the auto-promote logic inside the signup handler**

The cleanest pattern is to wrap the user creation + the staff check in a single transaction. Inside the transaction:

```ts
await client.query("BEGIN");
try {
  // Check if any staff exists. Lock nothing — uniqueness constraint on email serializes concurrent inserts.
  const staffExists = await client.query("SELECT 1 FROM user_accounts WHERE is_staff = true LIMIT 1");
  const shouldPromote = staffExists.rowCount === 0;

  const user = await insertUser(client, { email, passwordHash, displayName, isStaff: shouldPromote });

  // … rest of signup flow (session, etc.) …

  await client.query("COMMIT");
  return user;
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
}
```

Concurrent first-signups: both transactions see zero staff → both would set `is_staff=true`. But only one of the two emails can land (unique constraint) — so exactly one user is created with `is_staff=true`. Net effect: the invariant "at least one staff on a non-empty DB" holds.

Important: if `createUserAccount` is the abstraction today, extend it to accept `isStaff?: boolean` or add a sibling `createFirstStaffUser` path.

- [ ] **Step 5: Run the tests** — all three should pass.

- [ ] **Step 6: Commit**

```bash
git add packages/team-server/src/app/api/auth/signup/ \
        packages/team-server/src/lib/auth.ts \
        packages/team-server/test/api/signup.integration.test.ts
git commit -m "feat(team-server): first-signup auto-promotes to is_staff=true (atomic with user creation)"
```

### Task 1.4: Upgrade-path migration — promote existing team admins to staff

This is a one-off concern but important: existing v0.4.x deployments have users with `is_staff=false` (the column defaults to false). When they upgrade to v0.5.0, nobody will be able to click Apply Update because nobody is staff yet. We need a controlled promotion for the upgrade path.

**Decision:** promote the user who created the first team (the `owner`-ish user — in practice, the one with `admin` role in the oldest membership). This mirrors "whoever originally installed this server" without any manual step on the customer's part.

**Files:**
- Create: `packages/team-server/src/db/migrations/0001_promote_initial_admin_to_staff.sql` (handwritten, not generated by `drizzle-kit` — it's a data migration, not a schema change)
- Modify: `packages/team-server/src/db/migrations/meta/_journal.json` (add entry for 0001)

Wait — Drizzle's migrator expects `.sql` files with matching snapshots in `meta/`. A data-only migration needs a special journal entry. Option:

**Defer this migration to Chunk 4 alongside the `update_check_cache` table migration.** Combining it with a real schema change avoids the journal-snapshot awkwardness for a data-only migration. Each migration in Chunk 4's SQL file can have multiple statements.

Action here in Chunk 1: just document this decision. No code yet. The actual SQL lives in Chunk 4's migration file.

- [ ] **Step 1: Add a one-paragraph note to `packages/team-server/src/db/MIGRATIONS.md`** explaining that v0.5.0 ships an upgrade-path data migration promoting the oldest-team-admin to staff. Include the SQL snippet that will run:

```sql
-- In 0001's migration file (Chunk 4): promote the earliest team admin to staff
-- so existing v0.4.x deployments have at least one staff user on upgrade.
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

The `AND NOT EXISTS` clause makes this idempotent — if a staff already exists (e.g., this is a fresh install whose first-signup ran), this does nothing.

- [ ] **Step 2: Commit the doc update**

```bash
git add packages/team-server/src/db/MIGRATIONS.md
git commit -m "docs(team-server): document upgrade-path staff promotion slated for 0001 migration"
```

### Task 1.5: Chunk 1 checkpoint

- [ ] Run: `pnpm -F @claude-lens/team-server test` — expect 249 + ~6 new tests = 255+. All pass.
- [ ] Run: `pnpm -F @claude-lens/team-server typecheck` — clean.
- [ ] Run: `git log --oneline origin/master..HEAD` — expect 4 commits from Chunk 1.

---

## Chunk 2: Platform adapter interface + GCP adapter

### Task 2.1: Add `@google-cloud/run` dependency

**Files:**
- Modify: `packages/team-server/package.json`

- [ ] **Step 1: Add the SDK**

```bash
pnpm --filter @claude-lens/team-server add @google-cloud/run@1.8.0
```

Pin exact (no `^`) — the SDK surface we use (`ServicesClient.getService`, `updateService`) is stable, but we want intentional bumps.

- [ ] **Step 2: Verify the SDK loads**

```bash
cd packages/team-server && node -e '
const { ServicesClient } = require("@google-cloud/run").v2;
console.log(typeof ServicesClient);
'
```

Expected: `function`.

- [ ] **Step 3: Commit**

```bash
git add packages/team-server/package.json pnpm-lock.yaml
git commit -m "build(team-server): add @google-cloud/run (pinned) for GCP adapter"
```

### Task 2.2: Define `PlatformAdapter` interface

**Files:**
- Create: `packages/team-server/src/lib/self-update/platform.ts`

- [ ] **Step 1: Write the interface**

```ts
export interface PlatformAdapter {
  readonly name: "gcp-cloud-run" | "railway";

  /**
   * Return the currently-running image reference. Read-only.
   * Used for audit + sanity checks before redeploy.
   */
  getCurrentImage(): Promise<{ image: string; tag: string | null }>;

  /**
   * Instruct the platform to redeploy this service with a new image tag.
   * Resolves when the platform has accepted the request (NOT when the new
   * revision is healthy — that's async).
   */
  redeploy(imageTag: string): Promise<{ revisionId: string }>;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/team-server/src/lib/self-update/platform.ts
git commit -m "feat(team-server): PlatformAdapter interface for self-update"
```

### Task 2.3: Implement `GcpCloudRunAdapter` (TDD)

**Files:**
- Create: `packages/team-server/src/lib/self-update/gcp-cloud-run.ts`
- Test: `packages/team-server/test/lib/self-update/gcp-cloud-run-adapter.test.ts`

Spec reference: Section 3 "Platform adapter interface" → `GcpCloudRunAdapter`. Key behavior: `redeploy` is a read-modify-write on the full Service spec (Cloud Run's `UpdateService` RPC is not a field-level patch).

- [ ] **Step 1: Write the failing test first**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetService = vi.fn();
const mockUpdateService = vi.fn();

vi.mock("@google-cloud/run", () => ({
  v2: {
    ServicesClient: vi.fn().mockImplementation(() => ({
      getService: mockGetService,
      updateService: mockUpdateService,
    })),
  },
}));

import { GcpCloudRunAdapter } from "../../../src/lib/self-update/gcp-cloud-run.js";

beforeEach(() => {
  process.env.K_SERVICE = "fleetlens-team-server";
  process.env.K_CONFIGURATION = "fleetlens-team-server";
  process.env.GCP_PROJECT_ID = "orbit";
  // Cloud Run injects these at runtime; the installer in Chunk 7 sets GCP_PROJECT_ID + region.
  process.env.GCP_REGION = "asia-southeast1";
  mockGetService.mockReset();
  mockUpdateService.mockReset();
});

describe("GcpCloudRunAdapter", () => {
  it("getCurrentImage returns the current image + tag", async () => {
    mockGetService.mockResolvedValue([
      { template: { containers: [{ image: "ghcr.io/cowcow02/fleetlens-team-server:0.4.2" }] } },
    ]);
    const adapter = new GcpCloudRunAdapter();
    const result = await adapter.getCurrentImage();
    expect(result).toEqual({ image: "ghcr.io/cowcow02/fleetlens-team-server:0.4.2", tag: "0.4.2" });
  });

  it("redeploy reads the current service, patches image, writes it back", async () => {
    mockGetService.mockResolvedValue([
      {
        name: "projects/orbit/locations/asia-southeast1/services/fleetlens-team-server",
        template: {
          containers: [{ image: "ghcr.io/cowcow02/fleetlens-team-server:0.4.2" }],
        },
        // other fields we must preserve
        serviceAccount: "1234-compute@developer.gserviceaccount.com",
      },
    ]);
    mockUpdateService.mockResolvedValue([
      { metadata: { revision: "fleetlens-team-server-00007-xyz" } },
    ]);

    const adapter = new GcpCloudRunAdapter();
    const result = await adapter.redeploy("0.5.0");

    expect(mockUpdateService).toHaveBeenCalledTimes(1);
    const [arg] = mockUpdateService.mock.calls[0];
    expect(arg.service.template.containers[0].image).toBe(
      "ghcr.io/cowcow02/fleetlens-team-server:0.5.0",
    );
    // Preserved fields survive the read-modify-write:
    expect(arg.service.serviceAccount).toBe("1234-compute@developer.gserviceaccount.com");
    expect(result.revisionId).toBe("fleetlens-team-server-00007-xyz");
  });
});
```

- [ ] **Step 2: Run — expect failure (module not found)**.

- [ ] **Step 3: Implement `gcp-cloud-run.ts`**

```ts
import { v2 as runV2 } from "@google-cloud/run";
import type { PlatformAdapter } from "./platform.js";

const IMAGE_REPO = "ghcr.io/cowcow02/fleetlens-team-server";

export class GcpCloudRunAdapter implements PlatformAdapter {
  readonly name = "gcp-cloud-run" as const;

  private getServiceName(): string {
    const project = process.env.GCP_PROJECT_ID;
    const region = process.env.GCP_REGION;
    const service = process.env.K_SERVICE;
    if (!project || !region || !service) {
      throw new Error("GcpCloudRunAdapter requires GCP_PROJECT_ID, GCP_REGION, K_SERVICE env vars");
    }
    return `projects/${project}/locations/${region}/services/${service}`;
  }

  async getCurrentImage(): Promise<{ image: string; tag: string | null }> {
    const client = new runV2.ServicesClient();
    const [service] = await client.getService({ name: this.getServiceName() });
    const image = service.template?.containers?.[0]?.image ?? "";
    const tag = image.includes(":") ? image.split(":").pop() ?? null : null;
    return { image, tag };
  }

  async redeploy(imageTag: string): Promise<{ revisionId: string }> {
    const client = new runV2.ServicesClient();
    const [service] = await client.getService({ name: this.getServiceName() });
    // Read-modify-write. Mutate only the container image; preserve everything else.
    if (!service.template?.containers?.[0]) {
      throw new Error("Unexpected Cloud Run service spec: missing template.containers[0]");
    }
    service.template.containers[0].image = `${IMAGE_REPO}:${imageTag}`;
    const [op] = await client.updateService({ service });
    // Cloud Run's long-running op has `.metadata.revision` on the first response.
    const revisionId = (op as any).metadata?.revision ?? "unknown";
    return { revisionId };
  }
}
```

- [ ] **Step 4: Run — expect pass.**

- [ ] **Step 5: Commit**

```bash
git add packages/team-server/src/lib/self-update/gcp-cloud-run.ts \
        packages/team-server/test/lib/self-update/gcp-cloud-run-adapter.test.ts
git commit -m "feat(team-server): GcpCloudRunAdapter for self-update"
```

### Task 2.4: Chunk 2 checkpoint

- [ ] `pnpm -F @claude-lens/team-server test` — all passes, +2 new tests.
- [ ] `pnpm -F @claude-lens/team-server typecheck` — clean.

---

## Chunk 3: Railway adapter + platform selection

### Task 3.1: Implement `RailwayAdapter` (TDD)

Spec reference: Section 3 "Platform adapter interface" → `RailwayAdapter`. Note: Railway's GraphQL schema has evolved; the implementer should verify the exact mutation names (e.g., `serviceInstanceUpdate` vs `serviceInstanceDeploy`) against Railway's current public schema at https://docs.railway.com/reference/public-api.

**Files:**
- Create: `packages/team-server/src/lib/self-update/railway.ts`
- Test: `packages/team-server/test/lib/self-update/railway-adapter.test.ts`

- [ ] **Step 1: Write the failing test** (mocks `fetch`)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RailwayAdapter } from "../../../src/lib/self-update/railway.js";

global.fetch = vi.fn() as unknown as typeof fetch;

beforeEach(() => {
  process.env.RAILWAY_TOKEN = "test-token";
  process.env.RAILWAY_PROJECT_ID = "proj-123";
  process.env.RAILWAY_SERVICE_ID = "svc-456";
  process.env.RAILWAY_ENVIRONMENT_ID = "env-789";
  (global.fetch as any).mockReset();
});

describe("RailwayAdapter", () => {
  it("getCurrentImage queries the current service instance", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          serviceInstance: { source: { image: "ghcr.io/cowcow02/fleetlens-team-server:0.4.2" } },
        },
      }),
    });
    const adapter = new RailwayAdapter();
    const result = await adapter.getCurrentImage();
    expect(result.tag).toBe("0.4.2");
  });

  it("redeploy updates source image + triggers redeploy via two GraphQL mutations", async () => {
    // First call: update source image
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { serviceInstanceUpdate: { id: "svc-456" } } }),
    });
    // Second call: trigger redeploy
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { serviceInstanceDeploy: { id: "deploy-xyz" } } }),
    });

    const adapter = new RailwayAdapter();
    const result = await adapter.redeploy("0.5.0");

    expect(global.fetch).toHaveBeenCalledTimes(2);
    // Assert the first call included the new image in variables
    const firstCallBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(firstCallBody.variables.input.source.image).toBe(
      "ghcr.io/cowcow02/fleetlens-team-server:0.5.0",
    );
    expect(result.revisionId).toBe("deploy-xyz");
  });

  it("throws a clear error when RAILWAY_TOKEN is missing", async () => {
    delete process.env.RAILWAY_TOKEN;
    expect(() => new RailwayAdapter()).toThrow(/RAILWAY_TOKEN/);
  });
});
```

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement `railway.ts`**

```ts
import type { PlatformAdapter } from "./platform.js";

const IMAGE_REPO = "ghcr.io/cowcow02/fleetlens-team-server";
const RAILWAY_GQL = "https://backboard.railway.app/graphql/v2";

export class RailwayAdapter implements PlatformAdapter {
  readonly name = "railway" as const;
  private readonly token: string;
  private readonly projectId: string;
  private readonly serviceId: string;
  private readonly environmentId: string;

  constructor() {
    const { RAILWAY_TOKEN, RAILWAY_PROJECT_ID, RAILWAY_SERVICE_ID, RAILWAY_ENVIRONMENT_ID } = process.env;
    if (!RAILWAY_TOKEN) throw new Error("RailwayAdapter requires RAILWAY_TOKEN");
    if (!RAILWAY_PROJECT_ID || !RAILWAY_SERVICE_ID || !RAILWAY_ENVIRONMENT_ID) {
      throw new Error("RailwayAdapter requires RAILWAY_PROJECT_ID, RAILWAY_SERVICE_ID, RAILWAY_ENVIRONMENT_ID");
    }
    this.token = RAILWAY_TOKEN;
    this.projectId = RAILWAY_PROJECT_ID;
    this.serviceId = RAILWAY_SERVICE_ID;
    this.environmentId = RAILWAY_ENVIRONMENT_ID;
  }

  private async gql<T = any>(query: string, variables: Record<string, any>): Promise<T> {
    const res = await fetch(RAILWAY_GQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`Railway GraphQL ${res.status}`);
    const data = await res.json();
    if (data.errors) throw new Error(`Railway GraphQL error: ${JSON.stringify(data.errors)}`);
    return data.data;
  }

  async getCurrentImage(): Promise<{ image: string; tag: string | null }> {
    const data = await this.gql<{ serviceInstance: { source?: { image?: string } } }>(
      `query($projectId: String!, $serviceId: String!, $environmentId: String!) {
        serviceInstance(projectId: $projectId, serviceId: $serviceId, environmentId: $environmentId) {
          source { image }
        }
      }`,
      { projectId: this.projectId, serviceId: this.serviceId, environmentId: this.environmentId },
    );
    const image = data.serviceInstance?.source?.image ?? "";
    const tag = image.includes(":") ? image.split(":").pop() ?? null : null;
    return { image, tag };
  }

  async redeploy(imageTag: string): Promise<{ revisionId: string }> {
    // NOTE: mutation names verified at implementation time — Railway's public GraphQL schema evolves.
    // As of writing, `serviceInstanceUpdate` exists for setting the source image, and
    // `serviceInstanceDeploy` triggers a redeploy. If these have been renamed by the time
    // you're reading this, grep Railway's docs + update these + the matching tests.
    await this.gql(
      `mutation($projectId: String!, $serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
        serviceInstanceUpdate(projectId: $projectId, serviceId: $serviceId, environmentId: $environmentId, input: $input) { id }
      }`,
      {
        projectId: this.projectId,
        serviceId: this.serviceId,
        environmentId: this.environmentId,
        input: { source: { image: `${IMAGE_REPO}:${imageTag}` } },
      },
    );

    const deployed = await this.gql<{ serviceInstanceDeploy: { id: string } }>(
      `mutation($projectId: String!, $serviceId: String!, $environmentId: String!) {
        serviceInstanceDeploy(projectId: $projectId, serviceId: $serviceId, environmentId: $environmentId) { id }
      }`,
      { projectId: this.projectId, serviceId: this.serviceId, environmentId: this.environmentId },
    );
    return { revisionId: deployed.serviceInstanceDeploy.id };
  }
}
```

- [ ] **Step 4: Run tests** — pass.

- [ ] **Step 5: Commit**

```bash
git add packages/team-server/src/lib/self-update/railway.ts \
        packages/team-server/test/lib/self-update/railway-adapter.test.ts
git commit -m "feat(team-server): RailwayAdapter for self-update (GraphQL)"
```

### Task 3.2: Add `getPlatformAdapter()` factory

**Files:**
- Modify: `packages/team-server/src/lib/self-update/platform.ts` (append factory)
- Test: extend existing adapter tests or add a new small test

- [ ] **Step 1: Add to `platform.ts`**

```ts
import { GcpCloudRunAdapter } from "./gcp-cloud-run.js";
import { RailwayAdapter } from "./railway.js";

export function getPlatformAdapter(): PlatformAdapter | null {
  if (process.env.K_SERVICE) return new GcpCloudRunAdapter();
  if (process.env.RAILWAY_TOKEN) return new RailwayAdapter();
  return null;
}
```

- [ ] **Step 2: Add tests**

Create `packages/team-server/test/lib/self-update/platform.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { getPlatformAdapter } from "../../../src/lib/self-update/platform.js";

describe("getPlatformAdapter", () => {
  beforeEach(() => {
    delete process.env.K_SERVICE;
    delete process.env.RAILWAY_TOKEN;
  });

  it("returns GcpCloudRunAdapter when K_SERVICE is set", () => {
    process.env.K_SERVICE = "svc";
    process.env.GCP_PROJECT_ID = "p";
    process.env.GCP_REGION = "r";
    expect(getPlatformAdapter()?.name).toBe("gcp-cloud-run");
  });

  it("returns RailwayAdapter when RAILWAY_TOKEN is set (and K_SERVICE isn't)", () => {
    process.env.RAILWAY_TOKEN = "t";
    process.env.RAILWAY_PROJECT_ID = "p";
    process.env.RAILWAY_SERVICE_ID = "s";
    process.env.RAILWAY_ENVIRONMENT_ID = "e";
    expect(getPlatformAdapter()?.name).toBe("railway");
  });

  it("returns null when neither env var is present", () => {
    expect(getPlatformAdapter()).toBeNull();
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add packages/team-server/src/lib/self-update/platform.ts \
        packages/team-server/test/lib/self-update/platform.test.ts
git commit -m "feat(team-server): getPlatformAdapter factory selects by env"
```

### Task 3.3: Chunk 3 checkpoint

- [ ] Tests pass, typecheck clean, 3 new commits.

---

## Chunk 4: Update service + scheduler + migration

### Task 4.1: New Drizzle migration (`update_check_cache` + staff promotion data migration)

**Files:**
- Modify: `packages/team-server/src/db/schema.ts` — add `updateCheckCache` pgTable
- Generate: `packages/team-server/src/db/migrations/0001_*.sql`

- [ ] **Step 1: Add to `schema.ts`**

Append to the existing schema file (keep all nine existing table declarations intact):

```ts
export const updateCheckCache = pgTable("update_check_cache", {
  key: text("key").primaryKey(),  // single row with key="global"
  currentVersion: text("current_version"),
  latestVersion: text("latest_version"),
  updateAvailable: boolean("update_available").notNull().default(false),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull().defaultNow(),
  lastUpdateAttempt: jsonb("last_update_attempt"),
});
```

- [ ] **Step 2: Generate the migration**

```bash
cd packages/team-server && pnpm exec drizzle-kit generate --name update_check_cache && cd -
```

- [ ] **Step 3: Hand-edit the generated `0001_*.sql` to add the staff-promotion data migration**

Append to the generated file (before or after the CREATE TABLE, order doesn't matter):

```sql
-- description: Add update_check_cache + promote initial team admin to staff

-- Data migration: ensure at least one staff user exists on upgrade from v0.4.x.
-- Promotes the admin of the oldest team. No-op if any staff user already exists.
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

Prepend the `-- description: ...` header as the first line (replaces whatever drizzle-kit put there).

- [ ] **Step 4: Verify the migration applies cleanly**

```bash
pnpm -F @claude-lens/team-server test test/db/migrate.test.ts
```

Both `creates all tables` and `is idempotent` should pass. The parity tests should still pass. Add a new small test in `migrate.test.ts` to verify `update_check_cache` exists:

```ts
it("0001 adds update_check_cache and promotes an existing admin to staff", async () => {
  const pool = getPool();
  // Ensure update_check_cache table exists
  const { rows: tableRows } = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='update_check_cache'",
  );
  expect(tableRows).toHaveLength(1);
});
```

(The staff-promotion data migration's effects are harder to test in isolation here because `resetDb()` truncates everything before each test; the integration tests in signup.integration.test.ts + staff.integration.test.ts will exercise the promotion logic.)

- [ ] **Step 5: Commit**

```bash
git add packages/team-server/src/db/schema.ts \
        packages/team-server/src/db/migrations/ \
        packages/team-server/test/db/migrate.test.ts
git commit -m "feat(team-server): 0001 migration — update_check_cache + promote initial admin to staff"
```

### Task 4.2: Version detector (TDD)

**Files:**
- Create: `packages/team-server/src/lib/self-update/version-detector.ts`
- Test: `packages/team-server/test/lib/self-update/version-detector.test.ts`

- [ ] **Step 1: Add `semver` dep**

```bash
pnpm --filter @claude-lens/team-server add semver@7.6.3
pnpm --filter @claude-lens/team-server add -D @types/semver@7.5.8
```

- [ ] **Step 2: Write failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getLatestVersion } from "../../../src/lib/self-update/version-detector.js";

global.fetch = vi.fn() as unknown as typeof fetch;
beforeEach(() => (global.fetch as any).mockReset());

describe("getLatestVersion", () => {
  it("returns the highest semver tag from GHCR tags list", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        name: "cowcow02/fleetlens-team-server",
        tags: ["0.4.1", "0.4.2", "0.5.0", "latest", "abc1234"],
      }),
    });
    const result = await getLatestVersion();
    expect(result).toBe("0.5.0");
  });

  it("filters out non-semver tags (latest, shas, etc.)", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ tags: ["latest", "main", "abc1234", "dev-123"] }),
    });
    const result = await getLatestVersion();
    expect(result).toBeNull();
  });

  it("orders by semver, not lexically", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ tags: ["0.9.0", "0.10.0"] }),
    });
    const result = await getLatestVersion();
    expect(result).toBe("0.10.0");
  });
});
```

- [ ] **Step 3: Implement**

```ts
import semver from "semver";

const GHCR_TAGS_URL = "https://ghcr.io/v2/cowcow02/fleetlens-team-server/tags/list";

export async function getLatestVersion(): Promise<string | null> {
  const res = await fetch(GHCR_TAGS_URL);
  if (!res.ok) throw new Error(`GHCR tags list returned ${res.status}`);
  const data = (await res.json()) as { tags?: string[] };
  const tags = data.tags ?? [];
  const semverTags = tags.filter((t) => semver.valid(t) !== null);
  if (semverTags.length === 0) return null;
  return semverTags.sort(semver.rcompare)[0];
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/team-server/src/lib/self-update/version-detector.ts \
        packages/team-server/test/lib/self-update/version-detector.test.ts \
        packages/team-server/package.json pnpm-lock.yaml
git commit -m "feat(team-server): GHCR-based version detector (semver filter + sort)"
```

### Task 4.3: Changelog fetcher (TDD)

**Files:**
- Create: `packages/team-server/src/lib/self-update/changelog-fetcher.ts`
- Test: `packages/team-server/test/lib/self-update/changelog-fetcher.test.ts`

- [ ] **Step 1: Write failing tests** for `getChangelog(version)` and `getMigrationsManifest(version)`.

- [ ] **Step 2: Implement**

```ts
const GH_REPO = "cowcow02/fleetlens";

export async function getChangelog(version: string): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${GH_REPO}/releases/tags/server-v${version}`,
    { headers: { Accept: "application/vnd.github+json" } },
  );
  if (!res.ok) throw new Error(`GitHub Releases API returned ${res.status}`);
  const data = (await res.json()) as { body?: string };
  return data.body ?? "";
}

export interface MigrationInfo { filename: string; description: string; sql: string; }

export async function getMigrationsManifest(
  version: string,
): Promise<{ version: string; migrations: MigrationInfo[] }> {
  const url = `https://github.com/${GH_REPO}/releases/download/server-v${version}/migrations-manifest.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Manifest fetch returned ${res.status}`);
  return res.json();
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/team-server/src/lib/self-update/changelog-fetcher.ts \
        packages/team-server/test/lib/self-update/changelog-fetcher.test.ts
git commit -m "feat(team-server): changelog + migrations-manifest fetchers"
```

### Task 4.4: Update service (`service.ts`)

**Files:**
- Create: `packages/team-server/src/lib/self-update/service.ts`
- Test: `packages/team-server/test/lib/self-update/service.test.ts`

- [ ] **Step 1: Write tests first** for the four public functions:
  - `getStatus()` returns cached row or default
  - `checkNow()` queries version-detector, writes to cache, returns fresh result
  - `getReview(version)` combines changelog + migrations manifest
  - `applyUpdate(version, actorId)` validates target, writes `self_update.apply_requested` event, invokes adapter

- [ ] **Step 2: Implement**

```ts
import { getPool } from "../../db/pool.js";
import { getLatestVersion } from "./version-detector.js";
import { getChangelog, getMigrationsManifest, type MigrationInfo } from "./changelog-fetcher.js";
import { getPlatformAdapter } from "./platform.js";

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  lastCheckedAt: Date | null;
}

export async function getStatus(): Promise<UpdateStatus> {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT current_version, latest_version, update_available, last_checked_at FROM update_check_cache WHERE key = 'global'",
  );
  const currentVersion = process.env.APP_VERSION ?? "0.0.0-dev";
  if (!rows.length) {
    return { currentVersion, latestVersion: null, updateAvailable: false, lastCheckedAt: null };
  }
  return {
    currentVersion,
    latestVersion: rows[0].latest_version,
    updateAvailable: rows[0].update_available,
    lastCheckedAt: rows[0].last_checked_at,
  };
}

export async function checkNow(): Promise<UpdateStatus> {
  const pool = getPool();
  const currentVersion = process.env.APP_VERSION ?? "0.0.0-dev";
  const latestVersion = await getLatestVersion();
  // "update available" iff latest > current, ignoring dev sentinel.
  const updateAvailable =
    !!latestVersion &&
    currentVersion !== "0.0.0-dev" &&
    // semver.gt, imported lazily to avoid paying cost on getStatus
    (await import("semver")).gt(latestVersion, currentVersion);
  await pool.query(
    `INSERT INTO update_check_cache (key, current_version, latest_version, update_available, last_checked_at)
     VALUES ('global', $1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET
       current_version = EXCLUDED.current_version,
       latest_version = EXCLUDED.latest_version,
       update_available = EXCLUDED.update_available,
       last_checked_at = now()`,
    [currentVersion, latestVersion, updateAvailable],
  );
  await pool.query(
    `INSERT INTO events (action, payload) VALUES ('self_update.check', $1)`,
    [JSON.stringify({ currentVersion, latestVersion })],
  );
  return { currentVersion, latestVersion, updateAvailable, lastCheckedAt: new Date() };
}

export async function getReview(
  version: string,
): Promise<{ changelog: string; migrations: MigrationInfo[] }> {
  const [changelog, manifest] = await Promise.all([
    getChangelog(version).catch(() => "*(Failed to fetch release notes.)*"),
    getMigrationsManifest(version).catch(() => ({ version, migrations: [] })),
  ]);
  return { changelog, migrations: manifest.migrations };
}

export async function applyUpdate(
  version: string,
  actorId: string,
): Promise<{ revisionId: string }> {
  const adapter = getPlatformAdapter();
  if (!adapter) throw new Error("Self-update is not available on this platform");
  const latest = await getLatestVersion();
  if (latest !== version) throw new Error(`Target version ${version} is no longer the latest (${latest ?? "unknown"})`);

  const pool = getPool();
  const currentVersion = process.env.APP_VERSION ?? "0.0.0-dev";
  await pool.query(
    `INSERT INTO events (actor_id, action, payload) VALUES ($1, 'self_update.apply_requested', $2)`,
    [actorId, JSON.stringify({ fromVersion: currentVersion, toVersion: version })],
  );

  const result = await adapter.redeploy(version);

  await pool.query(
    `UPDATE update_check_cache SET last_update_attempt = $1 WHERE key = 'global'`,
    [JSON.stringify({ version, revisionId: result.revisionId, at: new Date().toISOString() })],
  );

  return result;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/team-server/src/lib/self-update/service.ts \
        packages/team-server/test/lib/self-update/service.test.ts
git commit -m "feat(team-server): self-update service (status/check/review/apply)"
```

### Task 4.5: Scheduler integration

**Files:**
- Modify: `packages/team-server/src/lib/scheduler.ts`
- Test: `packages/team-server/test/lib/scheduler.test.ts` (existing; extend)

- [ ] **Step 1: Add an hourly job to the scheduler**

Find the existing `startScheduler()` function and add:

```ts
// Self-update check: poll GHCR every hour
setInterval(async () => {
  try {
    const { checkNow } = await import("./self-update/service.js");
    await checkNow();
  } catch (err) {
    console.warn("[scheduler] checkForUpdates failed:", err);
  }
}, 60 * 60 * 1000);
```

Also: run it once on startup (5 seconds in) so admins don't have to wait an hour for the first check.

- [ ] **Step 2: Extend the existing scheduler test** to verify the new job schedules correctly (you may need to mock `checkNow`).

- [ ] **Step 3: Commit**

```bash
git add packages/team-server/src/lib/scheduler.ts packages/team-server/test/lib/scheduler.test.ts
git commit -m "feat(team-server): scheduler runs checkForUpdates hourly"
```

### Task 4.6: Chunk 4 checkpoint

- [ ] Tests pass, typecheck clean.
- [ ] ~8 new commits in Chunk 4.

---

## Chunk 5: Admin UI — updates pages + banner

### Task 5.1: `/api/admin/updates/*` routes

**Files:**
- Create: `packages/team-server/src/app/api/admin/updates/route.ts` (GET status)
- Create: `packages/team-server/src/app/api/admin/updates/check/route.ts` (POST)
- Create: `packages/team-server/src/app/api/admin/updates/review/route.ts` (GET with `?version=X.Y.Z`)
- Create: `packages/team-server/src/app/api/admin/updates/apply/route.ts` (POST with `{ version }`)
- Test: `packages/team-server/test/api/admin-updates.integration.test.ts`

Each route uses `requireStaff`. Apply is rate-limited via the existing rate-limiter keyed globally (add a single-key variant if needed).

- [ ] **Step 1: TDD — write the integration test first**

```ts
describe("/api/admin/updates", () => {
  it("GET returns 401 without session", async () => { /* ... */ });
  it("GET returns 403 for team-admin who is not staff", async () => { /* ... */ });
  it("GET returns 200 + status JSON for staff", async () => { /* ... */ });
  it("POST /check refreshes the cache", async () => { /* ... */ });
  it("GET /review returns changelog + migrations (mocked fetches)", async () => { /* ... */ });
  it("POST /apply with invalid version returns 400", async () => { /* ... */ });
  it("POST /apply calls the mock adapter's redeploy", async () => { /* ... */ });
});
```

- [ ] **Step 2: Implement the four route files** — each is a thin wrapper around `service.ts`. Example for `apply`:

```ts
// src/app/api/admin/updates/apply/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "../../../../lib/route-helpers.js";
import { applyUpdate } from "../../../../lib/self-update/service.js";

export async function POST(req: NextRequest) {
  const ctx = await requireStaff(req);
  if (ctx instanceof NextResponse) return ctx;
  const body = await req.json().catch(() => ({}));
  const { version } = body as { version?: string };
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    return NextResponse.json({ error: "Invalid version" }, { status: 400 });
  }
  try {
    const result = await applyUpdate(version, ctx.userAccountId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Run integration tests** — pass.

- [ ] **Step 4: Commit**

```bash
git add packages/team-server/src/app/api/admin/updates/ \
        packages/team-server/test/api/admin-updates.integration.test.ts
git commit -m "feat(team-server): /api/admin/updates routes (status/check/review/apply) gated by requireStaff"
```

### Task 5.2: `/admin/updates` list page + review page

**Files:**
- Create: `packages/team-server/src/app/admin/updates/page.tsx` (server component)
- Create: `packages/team-server/src/app/admin/updates/[version]/page.tsx` (server component)
- Create: `packages/team-server/src/components/update-review-view.tsx` (client component with the Apply button)

The pages are server components that fetch via `service.ts` directly (not over HTTP). The review page's Apply button is a client component that POSTs to `/api/admin/updates/apply`.

- [ ] **Step 1: List page skeleton**

```tsx
// src/app/admin/updates/page.tsx
import { redirect } from "next/navigation";
import { requireStaffServer } from "../../../lib/route-helpers.js";  // may need a server-component variant
import { getStatus } from "../../../lib/self-update/service.js";

export default async function UpdatesPage() {
  await requireStaffServer();   // throws redirect to /login if not staff
  const status = await getStatus();
  return (
    <main className="admin-updates">
      <h1>Server Updates</h1>
      <p>You are running <code>v{status.currentVersion}</code>.</p>
      {status.updateAvailable ? (
        <section>
          <p>
            <strong>v{status.latestVersion}</strong> is available.{" "}
            <a href={`/admin/updates/${status.latestVersion}`}>Review update</a>
          </p>
        </section>
      ) : (
        <p>You are on the latest version.</p>
      )}
      <p className="muted">Last checked: {status.lastCheckedAt?.toISOString() ?? "never"}</p>
      {/* check-now button is a client form posting to /api/admin/updates/check */}
    </main>
  );
}
```

(Full prose + styling is the implementer's call. Match the existing admin-area visual style.)

- [ ] **Step 2: Review page + Apply button**

Client component at `update-review-view.tsx`:

```tsx
"use client";
import { useState } from "react";
import ReactMarkdown from "react-markdown";  // or whatever MD renderer the project already uses
// (if the codebase uses a different renderer, follow its pattern)

export function UpdateReviewView({
  version, changelog, migrations,
}: {
  version: string;
  changelog: string;
  migrations: { filename: string; description: string; sql: string }[];
}) {
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function onApply() {
    setApplying(true);
    try {
      const res = await fetch("/api/admin/updates/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      const data = await res.json();
      setResult(res.ok ? `Update requested. Revision: ${data.revisionId}` : `Error: ${data.error}`);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div>
      <h2>What's new in v{version}</h2>
      <ReactMarkdown>{changelog}</ReactMarkdown>
      <h2>Database changes</h2>
      {migrations.length === 0 ? <p>No migrations in this release.</p> : (
        <ul>
          {migrations.map((m) => (
            <li key={m.filename}>
              <strong>{m.filename}</strong> — {m.description}
              <pre>{m.sql}</pre>
            </li>
          ))}
        </ul>
      )}
      <h2>Safety</h2>
      <p>If the update fails, the previous version keeps serving traffic. You won't lose data.</p>
      <button disabled={applying} onClick={onApply}>
        {applying ? "Applying…" : "Apply update"}
      </button>
      {result && <p>{result}</p>}
    </div>
  );
}
```

The review page (server component) fetches `getReview(version)` and renders `<UpdateReviewView />`.

- [ ] **Step 3: Smoke-test manually via `pnpm -F @claude-lens/team-server dev`** if time permits.

- [ ] **Step 4: Commit**

```bash
git add packages/team-server/src/app/admin/updates/ \
        packages/team-server/src/components/update-review-view.tsx
git commit -m "feat(team-server): /admin/updates list + review pages"
```

### Task 5.3: Global update banner

**Files:**
- Create: `packages/team-server/src/components/update-banner.tsx`
- Modify: `packages/team-server/src/app/layout.tsx` (root layout) to render the banner conditionally

- [ ] **Step 1: Component**

```tsx
// src/components/update-banner.tsx
import { validateSessionFromCookies } from "../lib/auth.js";    // or similar helper
import { getStatus } from "../lib/self-update/service.js";

export async function UpdateBanner() {
  const ctx = await validateSessionFromCookies();
  if (!ctx?.isStaff) return null;
  const status = await getStatus();
  if (!status.updateAvailable) return null;
  return (
    <div className="update-banner">
      <span>Team-server v{status.latestVersion} is available.</span>
      <a href={`/admin/updates/${status.latestVersion}`}>Review update</a>
    </div>
  );
}
```

- [ ] **Step 2: Insert into root layout** above `<main>` or in the masthead area.

- [ ] **Step 3: Commit**

```bash
git add packages/team-server/src/components/update-banner.tsx \
        packages/team-server/src/app/layout.tsx
git commit -m "feat(team-server): global UpdateBanner on admin pages when is_staff + update available"
```

### Task 5.4: Chunk 5 checkpoint

- [ ] All integration tests pass. Visually check the UI via local dev server once.

---

## Chunk 6: Admin UI — staff management

### Task 6.1: `/api/admin/staff/*` routes + `lib/staff.ts`

**Files:**
- Create: `packages/team-server/src/lib/staff.ts`
- Create: `packages/team-server/src/app/api/admin/staff/route.ts` (GET list)
- Create: `packages/team-server/src/app/api/admin/staff/grant/route.ts` (POST)
- Create: `packages/team-server/src/app/api/admin/staff/revoke/route.ts` (POST)
- Test: `packages/team-server/test/api/admin-staff.integration.test.ts`
- Test: `packages/team-server/test/lib/staff.test.ts`

- [ ] **Step 1: TDD — write `lib/staff.ts` tests first**

```ts
// test/lib/staff.test.ts
describe("staff library", () => {
  it("grantStaff sets is_staff=true and writes staff.granted event", async () => { /* ... */ });
  it("revokeStaff sets is_staff=false for a non-last staff", async () => { /* ... */ });
  it("revokeStaff refuses with LastStaffError when target is the only staff", async () => { /* ... */ });
  it("listStaff returns all user_accounts with is_staff flag", async () => { /* ... */ });
});
```

- [ ] **Step 2: Implement `lib/staff.ts`**

```ts
export class LastStaffError extends Error {
  constructor() { super("Cannot revoke staff from the last remaining staff user"); }
}

export async function grantStaff(targetUserId: string, actorId: string, pool: pg.Pool) {
  await pool.query("UPDATE user_accounts SET is_staff = true WHERE id = $1", [targetUserId]);
  await pool.query(
    `INSERT INTO events (actor_id, action, payload) VALUES ($1, 'staff.granted', $2)`,
    [actorId, JSON.stringify({ targetUserId })],
  );
}

export async function revokeStaff(targetUserId: string, actorId: string, pool: pg.Pool) {
  // Transaction: atomically check-count-and-update so two concurrent revocations can't both pass.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM user_accounts WHERE is_staff = true",
    );
    if (rows[0].n <= 1) {
      const { rows: targetRows } = await client.query(
        "SELECT is_staff FROM user_accounts WHERE id = $1",
        [targetUserId],
      );
      if (targetRows[0]?.is_staff) throw new LastStaffError();
    }
    await client.query("UPDATE user_accounts SET is_staff = false WHERE id = $1", [targetUserId]);
    await client.query(
      `INSERT INTO events (actor_id, action, payload) VALUES ($1, 'staff.revoked', $2)`,
      [actorId, JSON.stringify({ targetUserId })],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listStaff(pool: pg.Pool) {
  const { rows } = await pool.query(
    "SELECT id, email, display_name, is_staff, created_at FROM user_accounts ORDER BY created_at ASC",
  );
  return rows;
}
```

- [ ] **Step 3: Route files** — `grant/route.ts` and `revoke/route.ts` both gated by `requireStaff`, rate-limited (10/hour/actor). `revoke/route.ts` catches `LastStaffError` and returns 400.

- [ ] **Step 4: Commit**

```bash
git add packages/team-server/src/lib/staff.ts \
        packages/team-server/src/app/api/admin/staff/ \
        packages/team-server/test/lib/staff.test.ts \
        packages/team-server/test/api/admin-staff.integration.test.ts
git commit -m "feat(team-server): staff promote/revoke routes + last-staff lockout guard"
```

### Task 6.2: `/admin/staff` page

**Files:**
- Create: `packages/team-server/src/app/admin/staff/page.tsx` (server component)
- Create: `packages/team-server/src/components/staff-table.tsx` (client component with toggle)

- [ ] **Step 1: Implement the page** — table of all users with is_staff toggle. Warning banner if only one staff. Dedicated warning if you try to revoke yourself as the last staff (client-side guard).

- [ ] **Step 2: Commit**

```bash
git add packages/team-server/src/app/admin/staff/ packages/team-server/src/components/staff-table.tsx
git commit -m "feat(team-server): /admin/staff page for promote/revoke"
```

### Task 6.3: Chunk 6 checkpoint

- [ ] Integration tests pass. Manually click through the UI once.

---

## Chunk 7: Installer updates

### Task 7.1: `deploy/gcp/install.sh` — IAM binding + `--grant-staff` flag

**Files:**
- Modify: `deploy/gcp/install.sh`

- [ ] **Step 1: Add the `run.developer` binding step** to the execute phase. Scope to the single Cloud Run service:

```bash
step "Granting run.developer on the runtime SA (scoped to this service)"
g run services add-iam-policy-binding "$SERVICE" \
  --region "$REGION" \
  --member "serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role roles/run.developer \
  --quiet 2>/dev/null || true
ok "run.developer bound on $SERVICE"
```

(Make it idempotent — re-runs don't fail.)

- [ ] **Step 2: Also set the deployed env vars the adapter needs**:

```bash
g run services update "$SERVICE" \
  --region "$REGION" \
  --set-env-vars "GCP_PROJECT_ID=$PROJECT,GCP_REGION=$REGION"
```

- [ ] **Step 3: Add `--grant-staff EMAIL` flag**

At the top of the script's arg-parsing block, accept `--grant-staff <email>`. If present, after the main install completes (or as a standalone mode), run:

```bash
if [ -n "$GRANT_STAFF_EMAIL" ]; then
  step "Granting staff to $GRANT_STAFF_EMAIL"
  PGPASSWORD="$DB_PASSWORD" psql "$DB_URL" \
    -c "UPDATE user_accounts SET is_staff = true WHERE email = '$GRANT_STAFF_EMAIL' RETURNING id, email"
  ok "Staff grant applied (if user exists)"
  exit 0
fi
```

(Use the Cloud SQL Auth Proxy for `psql`; the installer already handles this pattern for schema setup.)

- [ ] **Step 4: Commit**

```bash
git add deploy/gcp/install.sh
git commit -m "feat(deploy/gcp): install.sh grants run.developer + --grant-staff <email> recovery flag"
```

### Task 7.2: Railway template documentation

**Files:**
- Modify: `deploy/railway/README.md`

- [ ] **Step 1: Add a section** describing that self-update requires `RAILWAY_TOKEN`, `RAILWAY_PROJECT_ID`, `RAILWAY_SERVICE_ID`, `RAILWAY_ENVIRONMENT_ID` as env vars on the service. Document how to generate a Railway API token + how to look up the project/service/environment IDs from the Railway dashboard.

- [ ] **Step 2: Commit**

```bash
git add deploy/railway/README.md
git commit -m "docs(deploy/railway): document RAILWAY_TOKEN + IDs needed for self-update"
```

### Task 7.3: Chunk 7 checkpoint

- [ ] Shellcheck clean on install.sh (best-effort; not a hard gate).

---

## Chunk 8: Release team-server v0.5.0

### Task 8.1: Final verification

- [ ] Run: `pnpm -F @claude-lens/team-server test` — all pass, ~280+ tests.
- [ ] Run: `pnpm typecheck` — clean across monorepo.
- [ ] Run: `pnpm -F @claude-lens/team-server lint` — clean.
- [ ] Confirm no stray WIP commits in `git log origin/master..HEAD`.

### Task 8.2: Bump version + tag

```bash
cd packages/team-server && npm version patch --no-git-tag-version && cd -
V=$(jq -r .version packages/team-server/package.json)
# Should be 0.4.3 — but we want 0.5.0 since this is a significant new feature:
cd packages/team-server && npm version 0.5.0 --no-git-tag-version && cd -
V=$(jq -r .version packages/team-server/package.json)
# Now V == 0.5.0
git add packages/team-server/package.json
git commit -m "$V"
git tag -a "server-v$V" -m "server-v$V"
```

**Verify:**
- `jq -r .version packages/team-server/package.json` → `0.5.0`
- `git tag --list 'server-v*'` → includes `server-v0.5.0`
- `git log -1 --format="%s"` → `0.5.0`

### Task 8.3: Open PR + merge + push tag

- [ ] Push branch: `git push -u origin feat/team-edition-1b-self-update`
- [ ] Open PR: `gh pr create --base master --title "feat(team-server): Plan 1b — self-update UI + platform adapters + staff management" --body "..."`
- [ ] Merge: `gh pr merge <PR#> --merge`
- [ ] After merge: `git checkout master && git pull && git push origin server-v0.5.0`
- [ ] Watch: `gh run watch` — verify image builds + GitHub Release created (now that the `contents: write` fix from PR #13 is on master).

### Task 8.4: Hand off to user

When v0.5.0 is on GHCR + GitHub Release exists:
- Give the user the `./deploy/gcp/install.sh` command to re-run against orbit
- Publish a trivial v0.5.1 (e.g., a one-line README tweak) via the same `npm version` + tag flow
- User signs in (auto-promoted to staff via the 0001 migration), sees banner, clicks Apply, watches Cloud Run redeploy

---

## Done

At this point team-server v0.5.0 is on GHCR with the self-update UI live. The user's orbit GCP deployment has the IAM binding, is running v0.5.0, and has v0.5.1 available to click toward. The final click-through demo completes the verification goal.

**Next (post-1b):**
- Real-world smoke test via the user's click-through
- Optional: staff-granting invites (deferred from 1b per spec)
- Plan 2 (team-wide plan utilization) builds on the migration framework that now exists
