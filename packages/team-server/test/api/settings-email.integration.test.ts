import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPool } from "../../src/db/pool.js";
import { runMigrations } from "../../src/db/migrate.js";
import { PUT } from "../../src/app/api/team/settings/email/route.js";
import { createUserAccount, createSession } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost:5432/fleetlens_dev";

let pool: ReturnType<typeof getPool>;
let adminCookieToken: string;
let teamSlug: string;
let teamId: string;

function makeReq(url: string, cookie: string, body?: unknown, method = "PUT"): NextRequest {
  const headers: Record<string, string> = {
    "cookie": `fleetlens_session=${cookie}`,
    "Content-Type": "application/json",
  };
  return new NextRequest(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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

  const admin = await createUserAccount("emailsettings-admin@example.com", "pass1234", null, {}, pool);
  const { team } = await createTeamWithAdmin("Email Settings Team", admin.id, pool);
  teamSlug = team.slug;
  teamId = team.id;
  const session = await createSession(admin.id, pool);
  adminCookieToken = session.cookieToken;
});

afterAll(async () => {
  await pool.end();
  vi.restoreAllMocks();
});

describe("PUT /api/team/settings/email", () => {
  it("returns 401 when unauthenticated", async () => {
    const req = new NextRequest(
      `http://localhost/api/team/settings/email?team=${teamSlug}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "re_test" }),
      }
    );
    const res = await PUT(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when team slug is missing", async () => {
    const req = makeReq("http://localhost/api/team/settings/email", adminCookieToken, { apiKey: "re_test" });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it("returns 501 when FLEETLENS_ENCRYPTION_KEY env var is not set", async () => {
    delete process.env.FLEETLENS_ENCRYPTION_KEY;
    const req = makeReq(
      `http://localhost/api/team/settings/email?team=${teamSlug}`,
      adminCookieToken,
      { apiKey: "re_test" }
    );
    const res = await PUT(req);
    expect(res.status).toBe(501);
  });

  it("returns 400 when apiKey is missing from body", async () => {
    process.env.FLEETLENS_ENCRYPTION_KEY = "a".repeat(64); // 32 bytes hex
    const req = makeReq(
      `http://localhost/api/team/settings/email?team=${teamSlug}`,
      adminCookieToken,
      {} // no apiKey
    );
    const res = await PUT(req);
    delete process.env.FLEETLENS_ENCRYPTION_KEY;
    expect(res.status).toBe(400);
  });

  it("returns 400 when Resend API validation fails", async () => {
    process.env.FLEETLENS_ENCRYPTION_KEY = "a".repeat(64);
    // Mock global fetch to return a non-ok response
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid key" }), { status: 401 })
    );

    const req = makeReq(
      `http://localhost/api/team/settings/email?team=${teamSlug}`,
      adminCookieToken,
      { apiKey: "re_invalid_key" }
    );
    const res = await PUT(req);
    delete process.env.FLEETLENS_ENCRYPTION_KEY;
    fetchSpy.mockRestore();
    expect(res.status).toBe(400);
  });

  it("saves encrypted API key and returns { saved: true } on success", async () => {
    process.env.FLEETLENS_ENCRYPTION_KEY = "a".repeat(64);
    // Mock global fetch to return a valid Resend response
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), { status: 200 })
    );

    const req = makeReq(
      `http://localhost/api/team/settings/email?team=${teamSlug}`,
      adminCookieToken,
      { apiKey: "re_valid_key_12345" }
    );
    const res = await PUT(req);
    delete process.env.FLEETLENS_ENCRYPTION_KEY;
    fetchSpy.mockRestore();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toBe(true);

    // Verify the encrypted key was stored
    const row = await pool.query("SELECT resend_api_key_enc FROM teams WHERE id = $1", [teamId]);
    expect(row.rows[0].resend_api_key_enc).toBeTruthy();
  });
});
