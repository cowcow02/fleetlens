# Team Edition Foundation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the walking skeleton of Fleetlens Team Edition — deployable team server (Railway + Terraform), member daemon pairing, basic per-member roster page with live refresh.

**Architecture:** New `packages/team-server` Next.js 16 app (separate from solo-edition `apps/web`) with Postgres backend, plus CLI extensions in `packages/cli` for `fleetlens team join/status/leave`. The existing daemon (`daemon-worker.ts`) gains a team-ingest push path. Railway template + AWS Terraform module + Docker Compose reference in `deploy/`.

**Tech Stack:** Next.js 16 (App Router), PostgreSQL 14+, node-postgres (`pg`), Zod (validation), esbuild (CLI), vitest (tests), Docker, Terraform, Railway

**Spec:** `docs/superpowers/specs/2026-04-16-team-edition-01-foundation-design.md`

---

## File Structure

### New package: `packages/team-server/`

The team server is a standalone Next.js 16 app — separate from the solo-edition `apps/web` — because the solo edition reads local JSONL via `@claude-lens/parser/fs` while the team server reads from Postgres. They share no server-side data access path.

```
packages/team-server/
  package.json                    # @claude-lens/team-server, depends on pg, zod, next
  next.config.ts                  # standalone output, port 3322
  tsconfig.json
  src/
    db/
      pool.ts                     # pg Pool singleton, reads DATABASE_URL
      schema.sql                  # all 7 Doc 1 tables, used by migrate command
      migrate.ts                  # run-on-boot migration runner (applies schema.sql idempotently)
    lib/
      auth.ts                     # bearer token validation, admin session cookie, bootstrap token
      crypto.ts                   # sha256 hash, random token generation, AES-256-GCM for resend key
      ingest.ts                   # POST /api/ingest/metrics handler logic (validation, upsert, dedup)
      members.ts                  # CRUD for members table (invite, join, revoke, list)
      teams.ts                    # team creation (claim), settings read/write
      sse.ts                      # SSE broadcast manager (in-memory client list, team_id scoping)
      types.ts                    # shared TypeScript types for API request/response shapes
      zod-schemas.ts              # Zod schemas for ingest payload, onboarding endpoints
    app/
      layout.tsx                  # team server root layout (admin nav sidebar)
      page.tsx                    # redirect to /team/:slug
      team/
        [slug]/
          layout.tsx              # team-scoped layout (sidebar nav, SSE subscription)
          page.tsx                # roster page (hero)
          members/
            [id]/
              page.tsx            # per-member profile page
          settings/
            page.tsx              # admin settings (team profile, members, email, security)
      api/
        ingest/
          metrics/
            route.ts              # POST /api/ingest/metrics (bearer auth)
        team/
          claim/
            route.ts              # POST /api/team/claim (bootstrap token)
          invites/
            route.ts              # POST /api/team/invites (admin auth)
          join/
            route.ts              # POST /api/team/join (invite token)
          admin-recover/
            route.ts              # POST /api/team/admin-recover (recovery token)
          leave/
            route.ts              # POST /api/team/leave (member bearer)
          roster/
            route.ts              # GET /api/team/roster (admin or member)
          members/
            [id]/
              route.ts            # GET per-member data, DELETE to revoke
          settings/
            route.ts              # GET/PUT team settings
            email/
              route.ts            # PUT /api/team/settings/email (Resend key)
        sse/
          updates/
            route.ts              # GET /api/sse/updates (SSE stream)
    components/
      roster-card.tsx             # member card for the roster page
      member-profile.tsx          # per-member profile content
      settings-panel.tsx          # settings form components
      live-refresher.tsx          # SSE subscription hook (adapted from solo edition)
      recovery-token-modal.tsx    # mandatory first-login modal
  test/
    db/
      migrate.test.ts             # schema migration tests
    lib/
      auth.test.ts                # token hashing, validation, cookie lifecycle
      crypto.test.ts              # SHA-256, random generation, AES-GCM round-trip
      ingest.test.ts              # ingest validation, rollup upsert, dedup
      members.test.ts             # invite, join, revoke, list
      teams.test.ts               # claim, settings
      zod-schemas.test.ts         # schema validation edge cases
    api/
      ingest.integration.test.ts  # full HTTP round-trip: POST → DB verify
      onboarding.integration.test.ts  # claim → invite → join → status flow
  Dockerfile                      # multi-stage: build + standalone output
  .env.example                    # template for local dev
```

### CLI extensions in `packages/cli/`

```
packages/cli/src/
  commands/
    team.ts                       # NEW: `fleetlens team <join|status|leave|logs>` command dispatcher
  team/
    join.ts                       # `fleetlens team join <url> <token>` — pair with team server
    status.ts                     # `fleetlens team status` — print pair state, last sync, queue depth
    leave.ts                      # `fleetlens team leave` — unpair, notify server, clean up
    logs.ts                       # `fleetlens team logs` — tail daemon.log for team ingest lines
    config.ts                     # read/write ~/.cclens/team.json (server URL, member_id, bearer token)
    push.ts                       # build + send ingest payload (called from daemon-worker.ts)
    queue.ts                      # local ingest queue (~/.cclens/ingest-queue.jsonl) with retry
  daemon-worker.ts                # MODIFY: add team-ingest push on each 5-min cycle
packages/cli/test/
  team/
    config.test.ts                # team.json read/write/permissions
    push.test.ts                  # payload construction from daily_rollups
    queue.test.ts                 # queue write/read/prune/overflow
```

### Deployment artifacts in `deploy/`

```
deploy/
  railway/
    railway.json                  # Railway template spec (2 services, 0 env vars for user)
    README.md                     # Deploy button + docs
  terraform/
    aws/
      main.tf                     # Fargate + RDS + ALB + ACM + IAM + Secrets Manager
      variables.tf                # ~10 input variables
      outputs.tf                  # fleetlens_url, alb_dns_name
      versions.tf                 # provider version pins
      examples/
        basic/
          main.tf                 # minimal usage example
          terraform.tfvars.example
      README.md
  compose/
    docker-compose.yml            # fleetlens-team-server + postgres + caddy
    Caddyfile                     # automatic TLS
    .env.example
    README.md
```

---

## Chunk 1: Database + Auth Foundation

### Task 1: Initialize team-server package

**Files:**
- Create: `packages/team-server/package.json`
- Create: `packages/team-server/tsconfig.json`
- Create: `packages/team-server/next.config.ts`
- Modify: `turbo.json` (add team-server to pipeline)
- Modify: `pnpm-workspace.yaml` (add packages/team-server)

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@claude-lens/team-server",
  "version": "0.3.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --port 3322",
    "build": "next build",
    "start": "next start --port 3322",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^16.2.2",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "pg": "^8.13.0",
    "zod": "^3.24.0",
    "@claude-lens/parser": "workspace:*"
  },
  "devDependencies": {
    "@types/pg": "^8.11.0",
    "@types/react": "^19.1.0",
    "typescript": "^5.8.0",
    "vitest": "^3.1.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json, next.config.ts**

next.config.ts:
```ts
import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg"],
};
export default config;
```

- [ ] **Step 3: Add to turbo.json and pnpm-workspace.yaml**

turbo.json: add `"@claude-lens/team-server#build"` to the pipeline with same shape as existing packages.

pnpm-workspace.yaml: add `packages/team-server` to the packages list.

- [ ] **Step 4: Run `pnpm install` and verify typecheck**

```bash
pnpm install && pnpm -F @claude-lens/team-server typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/team-server/ turbo.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(team-server): initialize package with Next.js 16 + pg + zod"
```

### Task 2: Database schema + migration runner

**Files:**
- Create: `packages/team-server/src/db/schema.sql`
- Create: `packages/team-server/src/db/pool.ts`
- Create: `packages/team-server/src/db/migrate.ts`
- Create: `packages/team-server/test/db/migrate.test.ts`

- [ ] **Step 1: Write schema.sql**

Copy all 7 `CREATE TABLE` statements + indexes directly from the Doc 1 spec. Wrap in `CREATE TABLE IF NOT EXISTS` for idempotency. Include the `CREATE INDEX IF NOT EXISTS` variants.

Tables: `teams`, `members`, `invites`, `admin_sessions`, `daily_rollups`, `events`, `ingest_log`.

- [ ] **Step 2: Write pool.ts**

```ts
import pg from "pg";
const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString, max: 10 });
  }
  return pool;
}
```

- [ ] **Step 3: Write migrate.ts**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPool } from "./pool.js";

export async function runMigrations(): Promise<void> {
  const sql = readFileSync(join(import.meta.dirname, "schema.sql"), "utf8");
  await getPool().query(sql);
}
```

- [ ] **Step 4: Write failing test for migration**

```ts
// test/db/migrate.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPool } from "../../src/db/pool.js";
import { runMigrations } from "../../src/db/migrate.js";

describe("runMigrations", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = "postgres://localhost:5432/fleetlens_test";
    await runMigrations();
  });

  afterAll(async () => {
    await getPool().end();
  });

  it("creates all 7 Doc 1 tables", async () => {
    const res = await getPool().query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    const tables = res.rows.map((r: { table_name: string }) => r.table_name);
    expect(tables).toContain("teams");
    expect(tables).toContain("members");
    expect(tables).toContain("invites");
    expect(tables).toContain("admin_sessions");
    expect(tables).toContain("daily_rollups");
    expect(tables).toContain("events");
    expect(tables).toContain("ingest_log");
  });

  it("is idempotent — running twice does not throw", async () => {
    await expect(runMigrations()).resolves.not.toThrow();
  });
});
```

- [ ] **Step 5: Run test to verify it fails (no DB yet), then create local test DB and re-run**

```bash
createdb fleetlens_test 2>/dev/null || true
pnpm -F @claude-lens/team-server test -- test/db/migrate.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/team-server/src/db/ packages/team-server/test/db/
git commit -m "feat(team-server): Postgres schema + idempotent migration runner"
```

### Task 3: Crypto utilities (SHA-256, token generation, AES-GCM)

**Files:**
- Create: `packages/team-server/src/lib/crypto.ts`
- Create: `packages/team-server/test/lib/crypto.test.ts`

- [ ] **Step 1: Write failing tests**

Tests for: `generateToken(byteLength)`, `sha256(input)`, `encryptAesGcm(plaintext, key)`, `decryptAesGcm(ciphertext, key)`.

- [ ] **Step 2: Implement crypto.ts using Node.js `crypto` module**

All functions are thin wrappers around `node:crypto`:
- `generateToken(n)` → `randomBytes(n).toString("hex")`
- `sha256(s)` → `createHash("sha256").update(s).digest("hex")`
- `encryptAesGcm` / `decryptAesGcm` → standard AES-256-GCM with random IV prepended to ciphertext

- [ ] **Step 3: Run tests, verify passing**

```bash
pnpm -F @claude-lens/team-server test -- test/lib/crypto.test.ts
```

- [ ] **Step 4: Commit**

### Task 4: Auth library (bearer tokens, admin sessions, bootstrap)

**Files:**
- Create: `packages/team-server/src/lib/auth.ts`
- Create: `packages/team-server/test/lib/auth.test.ts`

- [ ] **Step 1: Write failing tests for auth functions**

Test cases:
- `validateBearerToken(token, hash)` returns true/false
- `createAdminSession(memberId, pool)` returns `{sessionId, cookieToken}`
- `validateAdminSession(cookieToken, pool)` returns `memberId | null`
- `generateBootstrapToken()` returns `{token, hash, expiresAt}`
- `validateBootstrapToken(token, hash, expiresAt)` returns boolean (time-sensitive)

- [ ] **Step 2: Implement auth.ts**

Core logic: all token validation is `sha256(input) === storedHash`. Admin sessions use `admin_sessions` table with `expires_at` check. Bootstrap token uses an in-memory or `teams.settings` stored hash with 15-minute TTL.

- [ ] **Step 3: Run tests, commit**

### Task 5: Zod schemas for API validation

**Files:**
- Create: `packages/team-server/src/lib/zod-schemas.ts`
- Create: `packages/team-server/test/lib/zod-schemas.test.ts`

- [ ] **Step 1: Write schemas**

```ts
import { z } from "zod";

export const IngestPayload = z.object({
  ingestId: z.string(),
  observedAt: z.string().datetime(),
  dailyRollup: z.object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    agentTimeMs: z.number().int().nonneg(),
    sessions: z.number().int().nonneg(),
    toolCalls: z.number().int().nonneg(),
    turns: z.number().int().nonneg(),
    tokens: z.object({
      input: z.number().int().nonneg(),
      output: z.number().int().nonneg(),
      cacheRead: z.number().int().nonneg(),
      cacheWrite: z.number().int().nonneg(),
    }).passthrough(),          // permissive at every level
  }).passthrough(),
}).passthrough();              // top-level permissive too

export const ClaimPayload = z.object({
  bootstrapToken: z.string(),
  teamName: z.string().min(1).max(100),
  adminEmail: z.string().email().optional(),
  adminDisplayName: z.string().min(1).max(100).optional(),
});

export const InvitePayload = z.object({
  label: z.string().max(100).optional(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export const JoinPayload = z.object({
  inviteToken: z.string(),
  email: z.string().email().optional(),
  displayName: z.string().max(100).optional(),
});
```

Key: `.passthrough()` at every nesting level per Doc 1's forward-compat invariant.

- [ ] **Step 2: Write test cases — valid payloads pass, missing required fields fail, unknown fields are preserved**

- [ ] **Step 3: Run tests, commit**

### Task 6: Ingest handler (POST /api/ingest/metrics)

**Files:**
- Create: `packages/team-server/src/lib/ingest.ts`
- Create: `packages/team-server/src/app/api/ingest/metrics/route.ts`
- Create: `packages/team-server/test/lib/ingest.test.ts`
- Create: `packages/team-server/test/api/ingest.integration.test.ts`

- [ ] **Step 1: Write failing unit tests for `processIngest(payload, memberId, pool)`**

Test cases:
- Valid payload → upserts `daily_rollups` row, inserts `ingest_log`, updates `members.last_seen_at`
- Duplicate `ingestId` → returns `{deduplicated: true}`, no DB changes
- Invalid payload (missing dailyRollup) → throws validation error
- Unknown top-level fields preserved in parse, not stored

- [ ] **Step 2: Implement ingest.ts**

Core logic:
```ts
export async function processIngest(raw: unknown, memberId: string, teamId: string, pool: Pool) {
  const payload = IngestPayload.parse(raw);

  // Dedup check
  const existing = await pool.query("SELECT 1 FROM ingest_log WHERE ingest_id = $1", [payload.ingestId]);
  if (existing.rowCount > 0) return { accepted: true, deduplicated: true };

  // Begin transaction
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Insert ingest_log
    await client.query(
      "INSERT INTO ingest_log (ingest_id, team_id, member_id) VALUES ($1, $2, $3)",
      [payload.ingestId, teamId, memberId]
    );

    // Upsert daily_rollup (REPLACE semantics per spec)
    const r = payload.dailyRollup;
    await client.query(`
      INSERT INTO daily_rollups (team_id, member_id, day, agent_time_ms, sessions, tool_calls, turns,
                                 tokens_input, tokens_output, tokens_cache_read, tokens_cache_write)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (team_id, member_id, day) DO UPDATE SET
        agent_time_ms = EXCLUDED.agent_time_ms,
        sessions = EXCLUDED.sessions,
        tool_calls = EXCLUDED.tool_calls,
        turns = EXCLUDED.turns,
        tokens_input = EXCLUDED.tokens_input,
        tokens_output = EXCLUDED.tokens_output,
        tokens_cache_read = EXCLUDED.tokens_cache_read,
        tokens_cache_write = EXCLUDED.tokens_cache_write
    `, [teamId, memberId, r.day, r.agentTimeMs, r.sessions, r.toolCalls, r.turns,
        r.tokens.input, r.tokens.output, r.tokens.cacheRead, r.tokens.cacheWrite]);

    // Update last_seen_at
    await client.query(
      "UPDATE members SET last_seen_at = now() WHERE id = $1",
      [memberId]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { accepted: true, nextSyncAfter: new Date(Date.now() + 5 * 60 * 1000).toISOString() };
}
```

- [ ] **Step 3: Write the API route handler**

```ts
// src/app/api/ingest/metrics/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../db/pool.js";
import { processIngest } from "../../../../lib/ingest.js";
import { validateBearerToken, resolveMemberFromToken } from "../../../../lib/auth.js";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  const token = authHeader.slice(7);
  const pool = getPool();
  const member = await resolveMemberFromToken(token, pool);
  if (!member) {
    return NextResponse.json({ error: "Invalid or revoked token" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const result = await processIngest(body, member.id, member.teamId, pool);
    // Broadcast SSE event
    return NextResponse.json(result, { status: result.deduplicated ? 202 : 200 });
  } catch (err) {
    if (err instanceof Error && err.name === "ZodError") {
      return NextResponse.json({ error: "Validation failed", details: err.message }, { status: 400 });
    }
    throw err;
  }
}
```

- [ ] **Step 4: Write integration test (HTTP round-trip)**

- [ ] **Step 5: Run all tests, commit**

### Task 7: Onboarding endpoints (claim, invite, join, leave, recover)

**Files:**
- Create: `packages/team-server/src/lib/teams.ts`
- Create: `packages/team-server/src/lib/members.ts`
- Create: `packages/team-server/src/app/api/team/claim/route.ts`
- Create: `packages/team-server/src/app/api/team/invites/route.ts`
- Create: `packages/team-server/src/app/api/team/join/route.ts`
- Create: `packages/team-server/src/app/api/team/admin-recover/route.ts`
- Create: `packages/team-server/src/app/api/team/leave/route.ts`
- Create: `packages/team-server/test/api/onboarding.integration.test.ts`

- [ ] **Step 1: Write failing integration test for the full onboarding flow**

Test sequence:
1. POST `/api/team/claim` with valid bootstrap token → 201 + admin cookie + recovery token
2. POST `/api/team/invites` with admin cookie → 201 + invite URL
3. POST `/api/team/join` with invite token → 201 + member bearer token
4. POST `/api/ingest/metrics` with member bearer → 200
5. POST `/api/team/leave` with member bearer → 200
6. POST `/api/ingest/metrics` with same bearer → 401 (revoked)

- [ ] **Step 2: Implement teams.ts (claim logic)**

Core: validate bootstrap token → create `teams` row with slugified name → create first `members` row (admin) → create 2 `admin_sessions` rows (session cookie + recovery token) → return all.

Slug generation: `teamName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")`. If slug collides, append `-${randomBytes(2).toString("hex")}`.

- [ ] **Step 3: Implement members.ts (invite, join, revoke, leave)**

Invite: generate token → `sha256(token)` → insert `invites` row → return plaintext + URL.
Join: validate invite token against `invites.token_hash` → check not expired/used → create `members` row → generate bearer → return.
Revoke: set `members.revoked_at = now()`.
Leave: same as revoke, but called by the member themselves via bearer.

- [ ] **Step 4: Wire up all 5 API route handlers**

Each is a thin HTTP adapter: parse body, call lib function, return JSON.

- [ ] **Step 5: Run integration test end-to-end, fix until green**

- [ ] **Step 6: Commit**

---

## Chunk 2: CLI Team Commands + Daemon Extension

### Task 8: Team config file (~/.cclens/team.json)

**Files:**
- Create: `packages/cli/src/team/config.ts`
- Create: `packages/cli/test/team/config.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
- `readTeamConfig()` returns null when file doesn't exist
- `writeTeamConfig({serverUrl, memberId, bearerToken})` creates the file with mode 0600
- `readTeamConfig()` returns the written data
- `clearTeamConfig()` deletes the file

- [ ] **Step 2: Implement config.ts**

```ts
import { readFileSync, writeFileSync, unlinkSync, chmodSync } from "node:fs";
import { join } from "node:path";

const CONFIG_DIR = join(process.env.HOME || "", ".cclens");
const CONFIG_PATH = join(CONFIG_DIR, "team.json");

export type TeamConfig = {
  serverUrl: string;
  memberId: string;
  bearerToken: string;
  teamSlug: string;
  pairedAt: string;
};

export function readTeamConfig(): TeamConfig | null {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return null;
  }
}

export function writeTeamConfig(config: TeamConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function clearTeamConfig(): void {
  try { unlinkSync(CONFIG_PATH); } catch {}
}
```

- [ ] **Step 3: Run tests, commit**

### Task 9: Ingest payload builder + push function

**Files:**
- Create: `packages/cli/src/team/push.ts`
- Create: `packages/cli/test/team/push.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
- `buildDailyRollup(sessions, day)` aggregates SessionMeta[] into the rollup shape
- `pushToTeamServer(config, payload)` sends a POST and returns the response
- `pushToTeamServer` with invalid bearer → returns error

- [ ] **Step 2: Implement push.ts**

`buildDailyRollup` uses the existing parser's `SessionMeta` fields: sum `airTimeMs`, `toolCallCount`, `turnCount`, `totalUsage` across all sessions whose `toLocalDay(firstTimestamp)` matches the target day. The `day` field uses `toLocalDay` from `@claude-lens/parser` for feature parity with solo edition.

`pushToTeamServer` is a simple `fetch(config.serverUrl + "/api/ingest/metrics", { method: "POST", headers: { Authorization: `Bearer ${config.bearerToken}` }, body: JSON.stringify(payload) })`.

- [ ] **Step 3: Run tests, commit**

### Task 10: Local ingest queue with retry

**Files:**
- Create: `packages/cli/src/team/queue.ts`
- Create: `packages/cli/test/team/queue.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
- `enqueuePayload(payload)` appends to `~/.cclens/ingest-queue.jsonl`
- `dequeuePayloads()` reads + removes queued payloads
- Queue overflow: when file > 10MB, oldest entries are dropped
- Queue aging: entries older than 7 days are dropped

- [ ] **Step 2: Implement queue.ts**

Append-only JSONL file. `dequeuePayloads()` reads all, validates age + size, returns valid payloads, rewrites the file without consumed/expired entries.

- [ ] **Step 3: Run tests, commit**

### Task 11: Extend daemon-worker.ts with team push

**Files:**
- Modify: `packages/cli/src/daemon-worker.ts`

- [ ] **Step 1: Add team-push import and cycle hook**

After the existing usage-poll cycle, add:

```ts
import { readTeamConfig } from "./team/config.js";
import { buildDailyRollup, pushToTeamServer } from "./team/push.js";
import { enqueuePayload, dequeuePayloads } from "./team/queue.js";

// ... in the main tick function, after existing usage poll:
const teamConfig = readTeamConfig();
if (teamConfig) {
  // Build today's rollup from local JSONL
  const payload = await buildIngestPayload(teamConfig);
  try {
    const result = await pushToTeamServer(teamConfig, payload);
    if (result.ok) {
      // Also flush any queued payloads
      const queued = dequeuePayloads();
      for (const q of queued) {
        await pushToTeamServer(teamConfig, q);
      }
    }
  } catch {
    enqueuePayload(payload);
  }
}
```

- [ ] **Step 2: Test daemon cycle manually with a running team server**

- [ ] **Step 3: Commit**

### Task 12: CLI `fleetlens team` subcommands

**Files:**
- Create: `packages/cli/src/commands/team.ts`
- Create: `packages/cli/src/team/join.ts`
- Create: `packages/cli/src/team/status.ts`
- Create: `packages/cli/src/team/leave.ts`
- Create: `packages/cli/src/team/logs.ts`
- Modify: `packages/cli/src/index.ts` (register `team` command)

- [ ] **Step 1: Implement `fleetlens team join <url> <token>`**

```ts
// team/join.ts
export async function joinTeam(serverUrl: string, inviteToken: string, opts: { email?: string; name?: string }) {
  const email = opts.email || getGitConfigValue("user.email");
  const displayName = opts.name || getGitConfigValue("user.name");

  const res = await fetch(`${serverUrl}/api/team/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inviteToken, email, displayName }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Join failed: ${err.error}`);
  }

  const data = await res.json();
  writeTeamConfig({
    serverUrl: data.serverBaseUrl,
    memberId: data.member.id,
    bearerToken: data.bearerToken,
    teamSlug: data.teamSlug,
    pairedAt: new Date().toISOString(),
  });

  console.log(`Joined team "${data.teamSlug}" as ${data.member.displayName || data.member.email}`);
  console.log("Your daemon will start pushing metrics on the next cycle (~5 min).");
}
```

- [ ] **Step 2: Implement `fleetlens team status`**

Read `~/.cclens/team.json`, print server URL, member ID, last sync time (from daemon.log or queue state), queue depth.

- [ ] **Step 3: Implement `fleetlens team leave`**

```ts
export async function leaveTeam() {
  const config = readTeamConfig();
  if (!config) { console.log("Not paired with any team."); return; }

  // Notify server
  try {
    await fetch(`${config.serverUrl}/api/team/leave`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.bearerToken}` },
    });
  } catch {
    // Server unreachable — still clean up locally
  }

  clearTeamConfig();
  console.log("Left team. Local data is unaffected.");
}
```

- [ ] **Step 4: Register the `team` command in index.ts**

Add `team` to the command dispatcher with subcommands `join`, `status`, `leave`, `logs`.

- [ ] **Step 5: Build CLI and test manually**

```bash
pnpm -F fleetlens build
node packages/cli/dist/index.js team status
```

- [ ] **Step 6: Commit**

---

## Chunk 3: Web UI + SSE + Deployment

### Task 13: SSE broadcast manager

**Files:**
- Create: `packages/team-server/src/lib/sse.ts`
- Create: `packages/team-server/src/app/api/sse/updates/route.ts`

- [ ] **Step 1: Implement SSE manager**

In-memory client list scoped by `teamId`. Adapted from solo edition's `/api/events/route.ts`:

```ts
type Client = { controller: ReadableStreamDefaultController; teamId: string };
const clients = new Set<Client>();

export function addClient(controller: ReadableStreamDefaultController, teamId: string) {
  const client = { controller, teamId };
  clients.add(client);
  return () => clients.delete(client);
}

export function broadcastEvent(teamId: string, event: string, data: unknown) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    if (c.teamId === teamId) {
      try { c.controller.enqueue(new TextEncoder().encode(msg)); } catch { clients.delete(c); }
    }
  }
}
```

- [ ] **Step 2: Write SSE route handler**

```ts
// src/app/api/sse/updates/route.ts
export async function GET(req: NextRequest) {
  const teamId = await resolveTeamIdFromAuth(req); // from cookie or bearer
  const stream = new ReadableStream({
    start(controller) {
      const remove = addClient(controller, teamId);
      req.signal.addEventListener("abort", remove);
      // Heartbeat every 15s
      const hb = setInterval(() => {
        try { controller.enqueue(new TextEncoder().encode(": heartbeat\n\n")); }
        catch { clearInterval(hb); remove(); }
      }, 15000);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
```

- [ ] **Step 3: Wire `broadcastEvent("roster-updated", ...)` into the ingest handler (Task 6)**

After successful ingest, call `broadcastEvent(teamId, "roster-updated", { memberId })`.

- [ ] **Step 4: Commit**

### Task 14: Team roster page (hero view)

**Files:**
- Create: `packages/team-server/src/app/team/[slug]/page.tsx`
- Create: `packages/team-server/src/app/team/[slug]/layout.tsx`
- Create: `packages/team-server/src/app/api/team/roster/route.ts`
- Create: `packages/team-server/src/components/roster-card.tsx`
- Create: `packages/team-server/src/components/live-refresher.tsx`

- [ ] **Step 1: Implement `GET /api/team/roster`**

Query: for each non-revoked member in the team, join to `daily_rollups` for the current week (Mon-Sun), sum `agent_time_ms`, `sessions`, token counts. Return as JSON array sorted by `last_seen_at DESC`.

- [ ] **Step 2: Implement roster-card.tsx**

Server component rendering: member name, email, last seen (relative time), this-week stats (agent hours, sessions, token count).

- [ ] **Step 3: Implement live-refresher.tsx**

Client component that subscribes to `/api/sse/updates` and calls `router.refresh()` on `roster-updated` events. Adapted from solo edition's `LiveRefresher`.

- [ ] **Step 4: Implement the roster page**

Server component that fetches `/api/team/roster` and renders a card grid.

- [ ] **Step 5: Implement the team-scoped layout**

Sidebar with: team name, nav links (Roster, Settings), version badge.

- [ ] **Step 6: Test in browser — start team server, claim, invite a test daemon, verify roster updates live**

```bash
cd packages/team-server && pnpm dev
# In another terminal: open http://localhost:3322 and claim
```

- [ ] **Step 7: Commit**

### Task 15: Per-member profile page

**Files:**
- Create: `packages/team-server/src/app/team/[slug]/members/[id]/page.tsx`
- Create: `packages/team-server/src/app/api/team/members/[id]/route.ts`
- Create: `packages/team-server/src/components/member-profile.tsx`

- [ ] **Step 1: Implement `GET /api/team/members/:id`**

Return: member details + 30-day daily_rollups data (one row per day, for the chart).

- [ ] **Step 2: Implement member-profile.tsx**

30-day activity chart (Recharts BarChart of daily agent time), token breakdown, session count per day. Admin-only: revoke button, copy fresh invite link.

- [ ] **Step 3: Wire into page.tsx, test in browser**

- [ ] **Step 4: Commit**

### Task 16: Admin settings page

**Files:**
- Create: `packages/team-server/src/app/team/[slug]/settings/page.tsx`
- Create: `packages/team-server/src/app/api/team/settings/route.ts`
- Create: `packages/team-server/src/app/api/team/settings/email/route.ts`
- Create: `packages/team-server/src/components/settings-panel.tsx`
- Create: `packages/team-server/src/components/recovery-token-modal.tsx`

- [ ] **Step 1: Implement settings GET/PUT endpoints**

Read and write `teams` row fields: `name`, `resend_api_key_enc`, `custom_domain`, `settings` JSON, `retention_days`.

- [ ] **Step 2: Implement Resend key save with validation**

On PUT `/api/team/settings/email`: if Resend API key is provided, send a test email to the admin's email address via `fetch("https://api.resend.com/emails", ...)`. If 2xx → persist encrypted key. If 4xx → reject with error.

- [ ] **Step 3: Implement recovery-token-modal.tsx**

Client component. On first admin login (detected via `localStorage.getItem("recoveryTokenExported") === null`), render a blocking modal showing the recovery token with a "I've saved it" button. On click → `localStorage.setItem("recoveryTokenExported", "true")`.

- [ ] **Step 4: Implement settings-panel.tsx**

Sections: Team profile, Members table (invite/revoke/copy-link), Email (Resend key input), Security (export recovery token, revoke all sessions), Danger zone (delete team).

- [ ] **Step 5: Test in browser**

- [ ] **Step 6: Commit**

### Task 17: Bootstrap token + first-claim flow

**Files:**
- Create: `packages/team-server/src/app/page.tsx` (redirect or claim page)
- Modify: `packages/team-server/src/db/migrate.ts` (generate + print bootstrap token on first boot)

- [ ] **Step 1: Implement first-boot bootstrap token generation**

In `migrate.ts`, after schema creation: check if any `teams` row exists. If not, generate a bootstrap token, store hash in a temporary table or environment, and print to stdout:

```
fleetlens-server: bootstrap token = ab8d-3f21-9c47-5e80 (valid for 15 minutes)
fleetlens-server: to claim this instance, open <BASE_URL> and paste the token
```

- [ ] **Step 2: Implement root page**

If no team exists: render a "Claim this instance" form (paste token, enter team name + admin email). If team exists: redirect to `/team/:slug`.

- [ ] **Step 3: Test the full boot → claim → roster flow end-to-end**

- [ ] **Step 4: Commit**

### Task 18: Dockerfile + deployment artifacts

**Files:**
- Create: `packages/team-server/Dockerfile`
- Create: `deploy/railway/railway.json`
- Create: `deploy/railway/README.md`
- Create: `deploy/compose/docker-compose.yml`
- Create: `deploy/compose/Caddyfile`
- Create: `deploy/compose/.env.example`
- Create: `deploy/compose/README.md`

- [ ] **Step 1: Write multi-stage Dockerfile**

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY . .
RUN corepack enable pnpm && pnpm install --frozen-lockfile
RUN pnpm -F @claude-lens/team-server build

FROM node:22-alpine AS runner
WORKDIR /app
COPY --from=builder /app/packages/team-server/.next/standalone ./
COPY --from=builder /app/packages/team-server/.next/static ./.next/static
COPY --from=builder /app/packages/team-server/src/db/schema.sql ./schema.sql
ENV PORT=3322
EXPOSE 3322
CMD ["node", "server.js"]
```

- [ ] **Step 2: Write Railway template**

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": { "dockerfilePath": "packages/team-server/Dockerfile" },
  "deploy": { "healthcheckPath": "/api/health", "restartPolicyType": "ON_FAILURE" }
}
```

Plus the Postgres service definition.

- [ ] **Step 3: Write docker-compose.yml + Caddyfile**

Three services: fleetlens (from Dockerfile), postgres:17, caddy:2 with automatic TLS.

- [ ] **Step 4: Test local docker-compose up**

```bash
cd deploy/compose && docker compose up -d
# Wait for boot, check logs for bootstrap token, open http://localhost:3322
```

- [ ] **Step 5: Commit**

### Task 19: Node-cron scheduler + ingest_log prune

**Files:**
- Create: `packages/team-server/src/lib/scheduler.ts`

- [ ] **Step 1: Implement scheduler with ingest_log prune job**

```ts
import { CronJob } from "cron";
import { getPool } from "../db/pool.js";

export function startScheduler() {
  // 03:00 UTC daily — prune ingest_log older than 24h
  new CronJob("0 3 * * *", async () => {
    const pool = getPool();
    const res = await pool.query(
      "DELETE FROM ingest_log WHERE received_at < now() - interval '24 hours'"
    );
    console.log(`[scheduler] pruned ${res.rowCount} ingest_log rows`);
  }, null, true, "UTC");
}
```

- [ ] **Step 2: Call `startScheduler()` in the server's instrumentation hook or layout server init**

- [ ] **Step 3: Commit**

### Task 20: End-to-end smoke test

**Files:**
- Create: `packages/team-server/test/e2e/smoke.test.ts`

- [ ] **Step 1: Write a full-cycle smoke test**

1. Start the team server (or use a running dev instance)
2. Read the bootstrap token from stdout/logs
3. POST `/api/team/claim` with the token
4. POST `/api/team/invites` → get invite URL
5. POST `/api/team/join` → get bearer token
6. POST `/api/ingest/metrics` with a synthetic daily rollup
7. GET `/api/team/roster` → verify the member appears with correct stats
8. POST `/api/team/leave` → verify member is revoked
9. POST `/api/ingest/metrics` with same bearer → expect 401

- [ ] **Step 2: Run the smoke test**

```bash
pnpm -F @claude-lens/team-server test -- test/e2e/smoke.test.ts
```

- [ ] **Step 3: Commit**

### Task 21: Terraform module (AWS)

**Files:**
- Create: `deploy/terraform/aws/main.tf`
- Create: `deploy/terraform/aws/variables.tf`
- Create: `deploy/terraform/aws/outputs.tf`
- Create: `deploy/terraform/aws/versions.tf`
- Create: `deploy/terraform/aws/examples/basic/main.tf`
- Create: `deploy/terraform/aws/README.md`

- [ ] **Step 1: Write the Terraform module**

Resources: `aws_ecs_cluster`, `aws_ecs_task_definition` (Fargate, 0.5 vCPU / 1GB), `aws_ecs_service` (desired_count=1), `aws_lb` + `aws_lb_target_group` + `aws_lb_listener` (HTTPS, ACM cert), `aws_rds_cluster` (Aurora Serverless v2 PostgreSQL, or `aws_db_instance` for simplicity), `aws_secretsmanager_secret` for SMTP creds + secret key, `aws_iam_role` for task execution.

Variables: `hostname`, `admin_email`, `vpc_id`, `subnet_ids`, `postgres_version` (default "17"), `smtp_host`, `smtp_user`, `smtp_pass`, `smtp_from`, `database_url` (optional — skip RDS if provided).

Outputs: `fleetlens_url`, `alb_dns_name`, `ecs_cluster_name`, `rds_endpoint`.

- [ ] **Step 2: Write the basic example**

- [ ] **Step 3: Write the README with step-by-step matching the spec**

- [ ] **Step 4: Validate with `terraform init && terraform validate`**

```bash
cd deploy/terraform/aws && terraform init && terraform validate
```

- [ ] **Step 5: Commit**

---

## Summary

**21 tasks across 3 chunks.** Estimated implementation time: **8-10 weeks** for a single developer, or **5-6 weeks** for two developers working in parallel on chunks 2 and 3 after chunk 1 is done.

**Key integration points to verify during development:**
1. Daemon push → team server ingest → daily_rollups upsert → SSE broadcast → roster refresh
2. Bootstrap token → claim → admin cookie → invite → member join → bearer → ingest auth
3. Docker build → Railway deploy → first-boot migration → bootstrap token in logs → claim → live roster

**Test strategy:**
- Unit tests (vitest) for every lib function: crypto, auth, ingest, members, teams, zod schemas
- Integration tests for API routes: full HTTP round-trips against a test Postgres
- E2E smoke test: complete claim → invite → join → ingest → roster → leave flow
- Manual browser test: verify the UI renders correctly with live SSE refresh
- Docker compose smoke: verify the containerized deploy works end-to-end
