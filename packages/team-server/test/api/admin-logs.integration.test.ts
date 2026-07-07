import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { resetDb } from "../helpers/db.js";
import { NextRequest } from "next/server";
import { getPool } from "../../src/db/pool.js";
import { hydrate, type LogLine } from "../../src/lib/log-buffer.js";

const { GET } = await import("../../src/app/api/admin/logs/route.js");
const { createUserAccount, createSession } = await import("../../src/lib/auth.js");

let pool: ReturnType<typeof getPool>;

function makeAuthedReq(url: string, cookie?: string): NextRequest {
  const headers = new Headers();
  if (cookie) headers.set("cookie", `fleetlens_session=${cookie}`);
  return new NextRequest(url, { headers });
}

async function makeStaff(email: string) {
  const u = await createUserAccount(email, "pass1234", "Staff", {}, pool);
  await pool.query("UPDATE user_accounts SET is_staff = true WHERE id = $1", [u.id]);
  return (await createSession(u.id, pool)).cookieToken;
}

async function makeNonStaff(email: string) {
  const u = await createUserAccount(email, "pass1234", "Member", {}, pool);
  return (await createSession(u.id, pool)).cookieToken;
}

beforeAll(async () => {
  pool = await resetDb();
  // Seed the in-memory ring buffer deterministically. hydrate() is idempotent
  // per process, so this is the single seed the whole file reads through.
  const lines: LogLine[] = [
    { seq: 1, ts: 1_700_000_000_000, level: "log", msg: "boot ok" },
    { seq: 2, ts: 1_700_000_001_000, level: "warn", msg: "[scheduler] slow flush" },
    { seq: 3, ts: 1_700_000_002_000, level: "error", msg: "boom ingest failure" },
    { seq: 4, ts: 1_700_000_003_000, level: "log", msg: "handled request" },
  ];
  hydrate(lines);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query("TRUNCATE TABLE events, sessions, memberships, user_accounts RESTART IDENTITY CASCADE");
});

describe("GET /api/admin/logs", () => {
  it("returns 401 without a session cookie", async () => {
    const res = await GET(makeAuthedReq("http://localhost/api/admin/logs"));
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-staff user", async () => {
    const cookie = await makeNonStaff("logs-member@example.com");
    const res = await GET(makeAuthedReq("http://localhost/api/admin/logs", cookie));
    expect(res.status).toBe(403);
  });

  it("returns the whole buffer for a staff session", async () => {
    const cookie = await makeStaff("logs-staff@example.com");
    const res = await GET(makeAuthedReq("http://localhost/api/admin/logs", cookie));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lines: LogLine[]; lastSeq: number };
    expect(body.lines).toHaveLength(4);
    expect(body.lastSeq).toBe(4);
  });

  it("honors the after cursor for incremental polling", async () => {
    const cookie = await makeStaff("logs-staff-after@example.com");
    const res = await GET(makeAuthedReq("http://localhost/api/admin/logs?after=2", cookie));
    const body = (await res.json()) as { lines: LogLine[] };
    expect(body.lines.map((l) => l.seq)).toEqual([3, 4]);
  });

  it("filters to warn+error with level=warn", async () => {
    const cookie = await makeStaff("logs-staff-warn@example.com");
    const res = await GET(makeAuthedReq("http://localhost/api/admin/logs?level=warn", cookie));
    const body = (await res.json()) as { lines: LogLine[] };
    expect(body.lines.map((l) => l.level).sort()).toEqual(["error", "warn"]);
  });

  it("filters by case-insensitive substring query", async () => {
    const cookie = await makeStaff("logs-staff-q@example.com");
    const res = await GET(makeAuthedReq("http://localhost/api/admin/logs?q=BOOM", cookie));
    const body = (await res.json()) as { lines: LogLine[] };
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0].msg).toContain("boom");
  });

  it("caps the response to the most-recent `limit` lines", async () => {
    const cookie = await makeStaff("logs-staff-limit@example.com");
    const res = await GET(makeAuthedReq("http://localhost/api/admin/logs?limit=1", cookie));
    const body = (await res.json()) as { lines: LogLine[] };
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0].seq).toBe(4); // newest line only
  });
});
