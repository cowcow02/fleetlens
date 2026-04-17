import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { getPool } from "../../src/db/pool.js";
import { runMigrations } from "../../src/db/migrate.js";
import { GET, POST } from "../../src/app/logout/route.js";
import { createUserAccount, createSession } from "../../src/lib/auth.js";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost:5432/fleetlens_dev";
process.env.BASE_URL = "http://localhost:3322";

let pool: ReturnType<typeof getPool>;

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
});

afterAll(async () => {
  await pool.end();
});

describe("GET /logout (page route)", () => {
  it("redirects to /login when called without a session cookie", async () => {
    const req = new NextRequest("http://localhost/logout", {
      headers: {
        host: "localhost:3322",
        "x-forwarded-proto": "http",
      },
    });
    const res = await GET(req);
    expect(res.status).toBe(307); // Next.js redirect default
    expect(res.headers.get("location")).toContain("/login");
  });

  it("redirects to /login and clears the cookie with a valid session", async () => {
    const user = await createUserAccount("logoutpage@example.com", "pass1234", null, {}, pool);
    const { cookieToken } = await createSession(user.id, pool);

    const req = new NextRequest("http://localhost/logout", {
      headers: {
        cookie: `fleetlens_session=${cookieToken}`,
        host: "localhost:3322",
        "x-forwarded-proto": "http",
      },
    });
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    // session should be gone
    const sessionRow = await pool.query(
      "SELECT id FROM sessions WHERE user_account_id = $1",
      [user.id]
    );
    expect(sessionRow.rowCount).toBe(0);
  });
});

describe("POST /logout (page route)", () => {
  it("also redirects to /login", async () => {
    const req = new NextRequest("http://localhost/logout", {
      method: "POST",
      headers: {
        host: "localhost:3322",
        "x-forwarded-proto": "http",
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});
