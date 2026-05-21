import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../helpers/db.js";
import { getPool } from "../../src/db/pool.js";
import { createUserAccount } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";
import { createInvite } from "../../src/lib/members.js";
import { setAllowedSignupDomains } from "../../src/lib/teams.js";
import { POST as signupPOST } from "../../src/app/api/auth/signup/route.js";

let pool: ReturnType<typeof getPool>;

function makeSignupReq(body: Record<string, unknown>, ip = "1.2.3.4"): NextRequest {
  return new NextRequest("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  pool = await resetDb();
});

afterAll(async () => {
  await pool.end();
});

describe("signup domain allowlist", () => {
  it("rejects invite signup when email's domain is not in the team allowlist", async () => {
    const admin = await createUserAccount("admin@acme.com", "adminpass1", "Admin", { isStaff: true }, pool);
    const { team } = await createTeamWithAdmin("Acme", admin.id, pool);
    await setAllowedSignupDomains(team.id, ["acme.com"], pool);

    const inv = await createInvite(team.id, admin.id, {}, pool);

    const res = await signupPOST(makeSignupReq({
      email: "outsider@example.com",
      password: "outpass1234",
      inviteToken: inv.token,
    }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/restricted/i);
  });

  it("allows invite signup when email's domain matches the allowlist", async () => {
    const admin = await createUserAccount("admin@acme.com", "adminpass1", "Admin", { isStaff: true }, pool);
    const { team } = await createTeamWithAdmin("Acme", admin.id, pool);
    await setAllowedSignupDomains(team.id, ["acme.com"], pool);

    const inv = await createInvite(team.id, admin.id, {}, pool);

    const res = await signupPOST(makeSignupReq({
      email: "newhire@acme.com",
      password: "newpass1234",
      inviteToken: inv.token,
    }));
    expect(res.status).toBe(201);
  });

  it("empty allowlist is a no-op (allows any domain)", async () => {
    const admin = await createUserAccount("admin@acme.com", "adminpass1", "Admin", { isStaff: true }, pool);
    const { team } = await createTeamWithAdmin("Acme", admin.id, pool);

    const inv = await createInvite(team.id, admin.id, {}, pool);

    const res = await signupPOST(makeSignupReq({
      email: "anyone@elsewhere.io",
      password: "anypass1234",
      inviteToken: inv.token,
    }));
    expect(res.status).toBe(201);
  });

  it("does NOT enforce allowlist on first-user bootstrap (no team yet)", async () => {
    const res = await signupPOST(makeSignupReq({
      email: "founder@example.org",
      password: "founderpass1",
      teamName: "Example",
    }));
    expect(res.status).toBe(201);
  });

  it("rejects email scoped to a different domain on an invite even with allowlist matching", async () => {
    const admin = await createUserAccount("admin@acme.com", "adminpass1", "Admin", { isStaff: true }, pool);
    const { team } = await createTeamWithAdmin("Acme", admin.id, pool);
    await setAllowedSignupDomains(team.id, ["acme.com"], pool);

    const inv = await createInvite(team.id, admin.id, { email: "specific@acme.com" }, pool);

    const res = await signupPOST(makeSignupReq({
      email: "different@acme.com",
      password: "diffpass1234",
      inviteToken: inv.token,
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/different email/i);
  });
});
