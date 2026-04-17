import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { getPool } from "../../src/db/pool.js";
import { runMigrations } from "../../src/db/migrate.js";
import { GET } from "../../src/app/api/sse/updates/route.js";
import { createUserAccount, createSession } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost:5432/fleetlens_dev";

let pool: ReturnType<typeof getPool>;
let adminCookieToken: string;
let teamSlug: string;
let teamId: string;
let otherCookieToken: string; // user not in the team

// Use NextRequest so req.cookies and req.nextUrl work correctly
function makeReq(url: string, cookie?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (cookie) headers["cookie"] = `fleetlens_session=${cookie}`;
  return new NextRequest(url, { headers });
}

beforeAll(async () => {
  pool = getPool();
  await runMigrations();
  await pool.query("DELETE FROM events");
  await pool.query("DELETE FROM daily_rollups");
  await pool.query("DELETE FROM ingest_log");
  await pool.query("DELETE FROM invites");
  await pool.query("DELETE FROM memberships");
  await pool.query("DELETE FROM sessions");
  await pool.query("DELETE FROM server_config");
  await pool.query("DELETE FROM teams");
  await pool.query("DELETE FROM user_accounts");

  const admin = await createUserAccount("sse-admin@example.com", "pass1234", null, {}, pool);
  const { team } = await createTeamWithAdmin("SSE Team", admin.id, pool);
  teamSlug = team.slug;
  teamId = team.id;
  const adminSession = await createSession(admin.id, pool);
  adminCookieToken = adminSession.cookieToken;

  // A user who has a session but is NOT in this team
  const other = await createUserAccount("sse-other@example.com", "pass1234", null, {}, pool);
  const otherSession = await createSession(other.id, pool);
  otherCookieToken = otherSession.cookieToken;
});

afterAll(async () => {
  await pool.end();
});

describe("GET /api/sse/updates", () => {
  it("returns 401 when no session cookie is present", async () => {
    const req = makeReq(`http://localhost/api/sse/updates?team=${teamSlug}`);
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid session cookie", async () => {
    const req = makeReq(`http://localhost/api/sse/updates?team=${teamSlug}`, "totally-invalid-token");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when team slug parameter is missing", async () => {
    const req = makeReq("http://localhost/api/sse/updates", adminCookieToken);
    const res = await GET(req);
    // No slug → 400 ("team slug required")
    expect(res.status).toBe(400);
  });

  it("returns 404 when team slug does not exist", async () => {
    const req = makeReq("http://localhost/api/sse/updates?team=nonexistent-team", adminCookieToken);
    const res = await GET(req);
    expect(res.status).toBe(404);
  });

  it("returns 403 when authenticated user is not a member of the team", async () => {
    const req = makeReq(`http://localhost/api/sse/updates?team=${teamSlug}`, otherCookieToken);
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns 200 with text/event-stream content type for a valid member", async () => {
    const req = makeReq(`http://localhost/api/sse/updates?team=${teamSlug}`, adminCookieToken);

    // Abort the request immediately so we don't hold the stream open
    const ctrl = new AbortController();
    const reqWithAbort = new NextRequest(
      `http://localhost/api/sse/updates?team=${teamSlug}`,
      {
        headers: { cookie: `fleetlens_session=${adminCookieToken}` },
        signal: ctrl.signal,
      }
    );

    const res = await GET(reqWithAbort);
    ctrl.abort();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
  });
});
