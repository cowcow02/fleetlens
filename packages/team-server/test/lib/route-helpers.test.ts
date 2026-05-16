import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resetDb } from "../helpers/db.js";
import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../src/db/pool.js";
import {
  requireSession,
  requireTeamMembership,
  requireAdmin,
  requireStaff,
  type TeamContext,
} from "../../src/lib/route-helpers.js";
import { createUserAccount, createSession } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";
import { createInvite, redeemInvite } from "../../src/lib/members.js";

// Use real NextRequest so req.cookies and req.nextUrl work
function makeNextReq(url: string, opts: { method?: string; headers?: HeadersInit; body?: BodyInit | null } = {}): NextRequest {
  return new NextRequest(url, opts);
}

function makeNextReqWithCookie(cookie: string, url = "http://localhost/api/test"): NextRequest {
  return new NextRequest(url, {
    headers: { cookie: `fleetlens_session=${cookie}` },
  });
}
let pool: ReturnType<typeof getPool>;
let adminCookieToken: string;
let memberCookieToken: string;
let teamSlug: string;
let teamId: string;
let adminMembershipId: string;
let memberMembershipId: string;


beforeAll(async () => {
  pool = await resetDb();
  const admin = await createUserAccount("rh-admin@example.com", "pass1234", null, {}, pool);
  const { team, membership } = await createTeamWithAdmin("RH Team", admin.id, pool);
  teamSlug = team.slug;
  teamId = team.id;
  adminMembershipId = membership.id;
  const adminSession = await createSession(admin.id, pool);
  adminCookieToken = adminSession.cookieToken;

  const member = await createUserAccount("rh-member@example.com", "pass1234", null, {}, pool);
  const { token } = await createInvite(teamId, admin.id, {}, pool);
  const redeemed = await redeemInvite(token, member.id, pool);
  memberMembershipId = redeemed!.membershipId;
  const memberSession = await createSession(member.id, pool);
  memberCookieToken = memberSession.cookieToken;
});

afterAll(async () => {
  await pool.end();
});

describe("requireSession", () => {
  it("returns 401 when no cookie is present", async () => {
    const req = makeNextReq("http://localhost/api/test");
    const result = await requireSession(req);
    expect(result instanceof NextResponse).toBe(true);
    expect((result as NextResponse).status).toBe(401);
  });

  it("returns 401 for a bogus cookie token", async () => {
    const req = makeNextReqWithCookie("totally-invalid-token");
    const result = await requireSession(req);
    expect(result instanceof NextResponse).toBe(true);
    expect((result as NextResponse).status).toBe(401);
  });

  it("returns session context for a valid cookie", async () => {
    const req = makeNextReqWithCookie(adminCookieToken);
    const result = await requireSession(req);
    expect(result instanceof NextResponse).toBe(false);
    const ctx = result as Awaited<ReturnType<typeof requireSession>> & { user: { email: string } };
    expect(ctx.user.email).toBe("rh-admin@example.com");
  });
});

describe("requireTeamMembership", () => {
  it("returns 404 when team slug does not exist", async () => {
    const req = makeNextReqWithCookie(adminCookieToken);
    const result = await requireTeamMembership(req, "nonexistent-team", { bySlug: true });
    expect(result instanceof NextResponse).toBe(true);
    expect((result as NextResponse).status).toBe(404);
  });

  it("returns 403 when authenticated user is not a member", async () => {
    // Create a second team that admin has no membership in
    const other = await createUserAccount("other-admin@example.com", "pass1234", null, {}, pool);
    const { team: otherTeam } = await createTeamWithAdmin("Other Team", other.id, pool);
    const otherSession = await createSession(other.id, pool);

    // admin tries to access the original team they don't belong to
    const req = makeNextReqWithCookie(adminCookieToken);
    const result = await requireTeamMembership(req, otherTeam.slug, { bySlug: true });
    expect(result instanceof NextResponse).toBe(true);
    expect((result as NextResponse).status).toBe(403);
  });

  it("returns team context when user is a member (by slug)", async () => {
    const req = makeNextReqWithCookie(adminCookieToken);
    const result = await requireTeamMembership(req, teamSlug, { bySlug: true });
    expect(result instanceof NextResponse).toBe(false);
    const ctx = result as TeamContext;
    expect(ctx.membership.team_id).toBe(teamId);
    expect(ctx.membership.role).toBe("admin");
  });

  it("returns team context when user is a member (by id, no bySlug)", async () => {
    const req = makeNextReqWithCookie(adminCookieToken);
    const result = await requireTeamMembership(req, teamId);
    expect(result instanceof NextResponse).toBe(false);
    const ctx = result as TeamContext;
    expect(ctx.membership.team_id).toBe(teamId);
  });

  it("forwards 401 from requireSession when no cookie", async () => {
    const req = makeNextReq("http://localhost/api/test");
    const result = await requireTeamMembership(req, teamSlug, { bySlug: true });
    expect(result instanceof NextResponse).toBe(true);
    expect((result as NextResponse).status).toBe(401);
  });
});

describe("requireStaff", () => {
  it("returns 401 when no session cookie is present", async () => {
    const req = makeNextReq("http://localhost/api/admin/updates");
    const res = await requireStaff(req);
    expect(res).toBeInstanceOf(NextResponse);
    expect((res as NextResponse).status).toBe(401);
  });

  it("returns 403 when the session is valid but is_staff is false", async () => {
    const u = await createUserAccount("non-staff@example.com", "pass1234", "U", {}, pool);
    const { cookieToken } = await createSession(u.id, pool);
    const req = makeNextReqWithCookie(cookieToken, "http://localhost/api/admin/updates");
    const res = await requireStaff(req);
    expect(res).toBeInstanceOf(NextResponse);
    expect((res as NextResponse).status).toBe(403);
  });

  it("returns the SessionContext when is_staff is true", async () => {
    const u = await createUserAccount("staff@example.com", "pass1234", "S", {}, pool);
    await pool.query("UPDATE user_accounts SET is_staff = true WHERE id = $1", [u.id]);
    const { cookieToken } = await createSession(u.id, pool);
    const req = makeNextReqWithCookie(cookieToken, "http://localhost/api/admin/updates");
    const res = await requireStaff(req);
    expect(res).not.toBeInstanceOf(NextResponse);
    const ctx = res as Awaited<ReturnType<typeof requireStaff>> & { user: { is_staff: boolean } };
    expect(ctx.user.is_staff).toBe(true);
  });
});

describe("requireAdmin", () => {
  it("returns null (ok) when role is admin", async () => {
    const req = makeNextReqWithCookie(adminCookieToken);
    const ctx = (await requireTeamMembership(req, teamSlug, { bySlug: true })) as TeamContext;
    expect(ctx instanceof NextResponse).toBe(false);
    const err = requireAdmin(ctx);
    expect(err).toBeNull();
  });

  it("returns 403 NextResponse when role is member and not staff", async () => {
    const req = makeNextReqWithCookie(memberCookieToken);
    const ctx = (await requireTeamMembership(req, teamSlug, { bySlug: true })) as TeamContext;
    expect(ctx instanceof NextResponse).toBe(false);
    const err = requireAdmin(ctx as TeamContext);
    expect(err).not.toBeNull();
    expect((err as NextResponse).status).toBe(403);
  });

  it("returns null (ok) for a staff user joined as a regular member", async () => {
    const staff = await createUserAccount("rh-staff-member@example.com", "pass1234", null, { isStaff: true }, pool);
    const { token } = await createInvite(teamId, (await pool.query("SELECT user_account_id FROM memberships WHERE id = $1", [adminMembershipId])).rows[0].user_account_id, {}, pool);
    await redeemInvite(token, staff.id, pool);
    const { cookieToken } = await createSession(staff.id, pool);
    const req = makeNextReqWithCookie(cookieToken);
    const ctx = (await requireTeamMembership(req, teamSlug, { bySlug: true })) as TeamContext;
    expect(ctx instanceof NextResponse).toBe(false);
    expect(ctx.membership.role).toBe("member");
    expect(ctx.user.is_staff).toBe(true);
    const err = requireAdmin(ctx);
    expect(err).toBeNull();
  });
});
