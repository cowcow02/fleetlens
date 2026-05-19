import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb } from "../helpers/db.js";
import { NextRequest } from "next/server";
import { getPool } from "../../src/db/pool.js";
import { POST as signupPOST } from "../../src/app/api/auth/signup/route.js";
import { PATCH as memberPATCH } from "../../src/app/api/team/members/[id]/route.js";
import { createUserAccount, createSession } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";
import {
  createInvite,
  redeemInvite,
  revokeMembership,
} from "../../src/lib/members.js";

let pool: ReturnType<typeof getPool>;

function makeSignupReq(body: Record<string, unknown>, ip = "1.2.3.4"): NextRequest {
  return new NextRequest("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

async function seedAdminAndTeam() {
  const admin = await createUserAccount(
    "admin@acme.com",
    "adminpass1",
    "Admin",
    { isStaff: true },
    pool,
  );
  const { team } = await createTeamWithAdmin("Acme", admin.id, pool);
  return { admin, team };
}

beforeEach(async () => {
  pool = await resetDb();
});

afterAll(async () => {
  await pool.end();
});

describe("signup endpoint — existing user redeems an invite", () => {
  it("re-inviting an existing member as admin upgrades their role in place", async () => {
    const { admin, team } = await seedAdminAndTeam();
    const bob = await createUserAccount(
      "bob@acme.com",
      "bobpass1234",
      "Bob",
      {},
      pool,
    );

    // Bob originally joined as a member.
    const memberInvite = await createInvite(
      team.id,
      admin.id,
      { email: "bob@acme.com", role: "member" },
      pool,
    );
    await redeemInvite(memberInvite.token, bob.id, pool);

    // Admin decides Bob should be an admin and sends a fresh invite.
    const adminInvite = await createInvite(
      team.id,
      admin.id,
      { email: "bob@acme.com", role: "admin" },
      pool,
    );

    // Bob clicks the link and reuses his existing password.
    const req = makeSignupReq({
      email: "bob@acme.com",
      password: "bobpass1234",
      inviteToken: adminInvite.token,
    });
    const res = await signupPOST(req);
    expect(res.status).toBe(201);

    const rows = await pool.query(
      "SELECT role, revoked_at FROM memberships WHERE user_account_id = $1 AND team_id = $2",
      [bob.id, team.id],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].role).toBe("admin");
    expect(rows.rows[0].revoked_at).toBeNull();

    // Response shape stays consistent with the new-user invite path.
    const body = await res.json();
    expect(body.isFirstUser).toBe(false);
    expect(body.landingSlug).toBe(team.slug);
    expect(body.deviceToken).toMatch(/^bt_/);
  });

  it("a member-role invite redeemed by an existing admin does NOT silently downgrade them", async () => {
    const { admin, team } = await seedAdminAndTeam();
    const second = await createUserAccount(
      "second-admin@acme.com",
      "secondpass1",
      "Second",
      {},
      pool,
    );
    // Promote `second` to admin first — there's no UI for this in the test
    // helper, so build it directly: an admin-role invite that they redeem.
    const promote = await createInvite(
      team.id,
      admin.id,
      { email: "second-admin@acme.com", role: "admin" },
      pool,
    );
    await redeemInvite(promote.token, second.id, pool);

    // Now another admin (or even the same one) accidentally sends them a
    // generic member-role invite. Redeeming it must NOT demote the admin.
    const memberInvite = await createInvite(
      team.id,
      admin.id,
      { email: "second-admin@acme.com", role: "member" },
      pool,
    );
    const req = makeSignupReq({
      email: "second-admin@acme.com",
      password: "secondpass1",
      inviteToken: memberInvite.token,
    });
    const res = await signupPOST(req);
    expect(res.status).toBe(201);

    const row = await pool.query(
      "SELECT role FROM memberships WHERE user_account_id = $1 AND team_id = $2",
      [second.id, team.id],
    );
    expect(row.rows[0].role).toBe("admin");
  });

  it("a revoked admin re-invited as member comes back AS member (admin's choice wins post-revoke)", async () => {
    const { admin, team } = await seedAdminAndTeam();
    const second = await createUserAccount(
      "ex-admin@acme.com",
      "expass1234",
      null,
      {},
      pool,
    );
    const promote = await createInvite(
      team.id,
      admin.id,
      { email: "ex-admin@acme.com", role: "admin" },
      pool,
    );
    const redeemed = await redeemInvite(promote.token, second.id, pool);
    await revokeMembership(redeemed!.membershipId, pool);

    // After revoke, admin decides to bring them back as a plain member.
    // The role of the invite IS authoritative here because the prior
    // membership state is conceptually wiped.
    const memberInvite = await createInvite(
      team.id,
      admin.id,
      { email: "ex-admin@acme.com", role: "member" },
      pool,
    );
    const req = makeSignupReq({
      email: "ex-admin@acme.com",
      password: "expass1234",
      inviteToken: memberInvite.token,
    });
    expect((await signupPOST(req)).status).toBe(201);

    const row = await pool.query(
      "SELECT role, revoked_at FROM memberships WHERE user_account_id = $1 AND team_id = $2",
      [second.id, team.id],
    );
    expect(row.rows[0].role).toBe("member");
    expect(row.rows[0].revoked_at).toBeNull();
  });

  it("re-inviting a revoked member reactivates them with their original password", async () => {
    const { admin, team } = await seedAdminAndTeam();
    const bob = await createUserAccount(
      "bob@acme.com",
      "bobpass1234",
      "Bob",
      {},
      pool,
    );

    const firstInvite = await createInvite(
      team.id,
      admin.id,
      { email: "bob@acme.com" },
      pool,
    );
    const redeemed = await redeemInvite(firstInvite.token, bob.id, pool);
    await revokeMembership(redeemed!.membershipId, pool);

    // Admin sends a new invite to bring Bob back.
    const rejoinInvite = await createInvite(
      team.id,
      admin.id,
      { email: "bob@acme.com" },
      pool,
    );

    const req = makeSignupReq({
      email: "bob@acme.com",
      password: "bobpass1234",
      inviteToken: rejoinInvite.token,
    });
    const res = await signupPOST(req);
    expect(res.status).toBe(201);

    const row = await pool.query(
      "SELECT revoked_at, bearer_token_hash FROM memberships WHERE user_account_id = $1 AND team_id = $2",
      [bob.id, team.id],
    );
    expect(row.rows[0].revoked_at).toBeNull();
    // A fresh bearer token was issued (replaces the cleared one).
    expect(row.rows[0].bearer_token_hash).not.toBeNull();

    const body = await res.json();
    expect(body.landingSlug).toBe(team.slug);
    expect(body.deviceToken).toMatch(/^bt_/);
  });

  it("existing user + valid invite + wrong password returns 401 with an actionable message", async () => {
    const { admin, team } = await seedAdminAndTeam();
    await createUserAccount("bob@acme.com", "bobpass1234", null, {}, pool);

    const invite = await createInvite(
      team.id,
      admin.id,
      { email: "bob@acme.com", role: "admin" },
      pool,
    );

    const req = makeSignupReq({
      email: "bob@acme.com",
      password: "WRONG-PASSWORD-99",
      inviteToken: invite.token,
    });
    const res = await signupPOST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/already exists/i);
    expect(body.error).toMatch(/password|sign in/i);

    // The invite must remain unused so Bob can retry with the right password.
    const inviteRow = await pool.query(
      "SELECT used_at FROM invites WHERE id = $1",
      [invite.inviteId],
    );
    expect(inviteRow.rows[0].used_at).toBeNull();
  });

  it("redeeming an invite for an existing user does NOT overwrite their password", async () => {
    const { admin, team } = await seedAdminAndTeam();
    await createUserAccount("bob@acme.com", "bobpass1234", "Bob", {}, pool);
    const before = await pool.query(
      "SELECT password_hash FROM user_accounts WHERE email = $1",
      ["bob@acme.com"],
    );

    const invite = await createInvite(
      team.id,
      admin.id,
      { email: "bob@acme.com", role: "admin" },
      pool,
    );
    const req = makeSignupReq({
      email: "bob@acme.com",
      password: "bobpass1234",
      inviteToken: invite.token,
    });
    expect((await signupPOST(req)).status).toBe(201);

    const after = await pool.query(
      "SELECT password_hash FROM user_accounts WHERE email = $1",
      ["bob@acme.com"],
    );
    expect(after.rows[0].password_hash).toBe(before.rows[0].password_hash);
  });

  it("duplicate-email signup without an invite still returns 409 (public-signup path is unchanged)", async () => {
    await seedAdminAndTeam();
    await pool.query(
      "INSERT INTO server_config (key, value) VALUES ('allow_public_signup', 'true') ON CONFLICT (key) DO UPDATE SET value = 'true'",
    );
    await createUserAccount("bob@acme.com", "bobpass1234", null, {}, pool);

    const req = makeSignupReq({
      email: "bob@acme.com",
      password: "bobpass1234",
    });
    const res = await signupPOST(req);
    expect(res.status).toBe(409);
  });

  it("admin can reactivate a revoked member in one click — no invite link, no user action", async () => {
    const { admin, team } = await seedAdminAndTeam();
    const bob = await createUserAccount(
      "bob@acme.com",
      "bobpass1234",
      "Bob",
      {},
      pool,
    );
    const invite = await createInvite(
      team.id,
      admin.id,
      { email: "bob@acme.com" },
      pool,
    );
    const redeemed = await redeemInvite(invite.token, bob.id, pool);
    await revokeMembership(redeemed!.membershipId, pool);

    const { cookieToken } = await createSession(admin.id, pool);
    const req = new NextRequest(
      `http://localhost/api/team/members/${redeemed!.membershipId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          cookie: `fleetlens_session=${cookieToken}`,
        },
        body: JSON.stringify({ reactivate: true }),
      },
    );
    const res = await memberPATCH(req, {
      params: Promise.resolve({ id: redeemed!.membershipId }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.deviceToken).toMatch(/^bt_/);

    const row = await pool.query(
      "SELECT revoked_at, bearer_token_hash FROM memberships WHERE id = $1",
      [redeemed!.membershipId],
    );
    expect(row.rows[0].revoked_at).toBeNull();
    expect(row.rows[0].bearer_token_hash).not.toBeNull();

    const ev = await pool.query(
      "SELECT action FROM events WHERE team_id = $1 ORDER BY id DESC LIMIT 1",
      [team.id],
    );
    expect(ev.rows[0].action).toBe("member.reactivate");
  });

  it("reactivate is rejected for an already-active member (no token rotation)", async () => {
    const { admin, team } = await seedAdminAndTeam();
    const bob = await createUserAccount("bob@acme.com", "bobpass1234", null, {}, pool);
    const invite = await createInvite(team.id, admin.id, { email: "bob@acme.com" }, pool);
    const redeemed = await redeemInvite(invite.token, bob.id, pool);

    const before = await pool.query(
      "SELECT bearer_token_hash FROM memberships WHERE id = $1",
      [redeemed!.membershipId],
    );

    const { cookieToken } = await createSession(admin.id, pool);
    const req = new NextRequest(
      `http://localhost/api/team/members/${redeemed!.membershipId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          cookie: `fleetlens_session=${cookieToken}`,
        },
        body: JSON.stringify({ reactivate: true }),
      },
    );
    const res = await memberPATCH(req, {
      params: Promise.resolve({ id: redeemed!.membershipId }),
    });
    expect(res.status).toBe(400);

    const after = await pool.query(
      "SELECT bearer_token_hash FROM memberships WHERE id = $1",
      [redeemed!.membershipId],
    );
    expect(after.rows[0].bearer_token_hash).toBe(before.rows[0].bearer_token_hash);
  });

  it("PATCH with malformed JSON body returns 400 (not a 500 crash)", async () => {
    const { admin, team } = await seedAdminAndTeam();
    const bob = await createUserAccount("bob@acme.com", "bobpass1234", null, {}, pool);
    const invite = await createInvite(team.id, admin.id, { email: "bob@acme.com" }, pool);
    const redeemed = await redeemInvite(invite.token, bob.id, pool);

    const { cookieToken } = await createSession(admin.id, pool);
    const req = new NextRequest(
      `http://localhost/api/team/members/${redeemed!.membershipId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          cookie: `fleetlens_session=${cookieToken}`,
        },
        body: "not-json",
      },
    );
    const res = await memberPATCH(req, {
      params: Promise.resolve({ id: redeemed!.membershipId }),
    });
    expect(res.status).toBeLessThan(500);
  });

  it("non-admin cannot reactivate", async () => {
    const { admin, team } = await seedAdminAndTeam();
    const bob = await createUserAccount("bob@acme.com", "bobpass1234", null, {}, pool);
    const invite = await createInvite(team.id, admin.id, { email: "bob@acme.com" }, pool);
    const redeemed = await redeemInvite(invite.token, bob.id, pool);
    await revokeMembership(redeemed!.membershipId, pool);

    // Bob's own session — even though he owns the revoked membership, he's not
    // an admin of this team so he cannot self-reactivate.
    const { cookieToken } = await createSession(bob.id, pool);
    const req = new NextRequest(
      `http://localhost/api/team/members/${redeemed!.membershipId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          cookie: `fleetlens_session=${cookieToken}`,
        },
        body: JSON.stringify({ reactivate: true }),
      },
    );
    const res = await memberPATCH(req, {
      params: Promise.resolve({ id: redeemed!.membershipId }),
    });
    expect(res.status).toBe(403);
  });

  it("heals the previously-bugged state: existing unused admin invite redeems for an existing member without manual intervention", async () => {
    // Reproduce the original bug timeline: Bob signs up as member, admin then
    // tries to invite him as admin, the invite link is generated but Bob's
    // signup attempt fails — leaving an unused admin invite in the DB.
    const { admin, team } = await seedAdminAndTeam();
    const bob = await createUserAccount(
      "bob@acme.com",
      "bobpass1234",
      "Bob",
      {},
      pool,
    );
    const memberInvite = await createInvite(
      team.id,
      admin.id,
      { email: "bob@acme.com", role: "member" },
      pool,
    );
    await redeemInvite(memberInvite.token, bob.id, pool);

    const stuckAdminInvite = await createInvite(
      team.id,
      admin.id,
      { email: "bob@acme.com", role: "admin" },
      pool,
    );

    // Without any manual SQL fix, Bob can now redeem the existing stuck invite.
    const req = makeSignupReq({
      email: "bob@acme.com",
      password: "bobpass1234",
      inviteToken: stuckAdminInvite.token,
    });
    const res = await signupPOST(req);
    expect(res.status).toBe(201);

    const role = await pool.query(
      "SELECT role FROM memberships WHERE user_account_id = $1 AND team_id = $2",
      [bob.id, team.id],
    );
    expect(role.rows[0].role).toBe("admin");
  });
});
