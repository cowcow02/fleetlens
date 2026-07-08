import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../helpers/db.js";
import { getPool } from "../../src/db/pool.js";
import { createUserAccount, createSession } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";
import { createInvite, redeemInvite } from "../../src/lib/members.js";
import { createGroup, addGroupMember, setGroupMemberManager, type GroupRow } from "../../src/lib/groups.js";
import { GET as integrationsGET, POST as integrationsPOST } from "../../src/app/api/team/[slug]/groups/[group]/integrations/route.js";
import { PUT as sourcesPUT } from "../../src/app/api/team/[slug]/groups/[group]/integrations/[id]/sources/route.js";
import { POST as githubReposPOST } from "../../src/app/api/team/settings/integrations/github/repos/route.js";

let pool: ReturnType<typeof getPool>;
let teamSlug: string;
let teamId: string;
let adminCookieToken: string;
let m1CookieToken: string; // manager of g1, not g2
let m2CookieToken: string; // plain member of g1
let g1: GroupRow;
let g2: GroupRow;
let orgIntegrationId: string; // owner_group_id NULL — admin-managed
let g2IntegrationId: string; // owned by g2 — invisible/unmanageable from g1

function authedReq(url: string, cookieToken: string, opts: { method?: string; body?: unknown } = {}): NextRequest {
  const headers = new Headers();
  headers.set("cookie", `fleetlens_session=${cookieToken}`);
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, {
    method: opts.method,
    headers,
    body: opts.body === undefined ? null : JSON.stringify(opts.body),
  });
}

beforeAll(async () => {
  pool = await resetDb();
  const admin = await createUserAccount("gi-admin@example.com", "pass1234", "Admin", {}, pool);
  const { team } = await createTeamWithAdmin("GI Team", admin.id, pool);
  teamSlug = team.slug;
  teamId = team.id;
  adminCookieToken = (await createSession(admin.id, pool)).cookieToken;

  const m1 = await createUserAccount("gi-m1@example.com", "pass1234", "M1", {}, pool);
  const inv1 = await createInvite(teamId, admin.id, {}, pool);
  const m1MembershipId = (await redeemInvite(inv1.token, m1.id, pool))!.membershipId;
  m1CookieToken = (await createSession(m1.id, pool)).cookieToken;

  const m2 = await createUserAccount("gi-m2@example.com", "pass1234", "M2", {}, pool);
  const inv2 = await createInvite(teamId, admin.id, {}, pool);
  const m2MembershipId = (await redeemInvite(inv2.token, m2.id, pool))!.membershipId;
  m2CookieToken = (await createSession(m2.id, pool)).cookieToken;

  g1 = await createGroup(teamId, "g1", "Group One", admin.id, pool);
  g2 = await createGroup(teamId, "g2", "Group Two", admin.id, pool);
  await addGroupMember(g1.id, m1MembershipId, admin.id, pool);
  await setGroupMemberManager(g1.id, m1MembershipId, true, admin.id, pool);
  await addGroupMember(g1.id, m2MembershipId, admin.id, pool); // plain member — never promoted

  // Org-level integration: one repo mapped to all groups ("acme/app"), one
  // mapped to g1 only ("acme/onlyg1") — the latter feeds the orphan-refusal case.
  const orgRes = await pool.query<{ id: string }>(
    `INSERT INTO integrations (team_id, provider, label, owner_group_id, credentials_enc, config, status)
     VALUES ($1, 'github', 'Org GitHub', NULL, 'dummy-enc', $2::jsonb, 'active') RETURNING id`,
    [teamId, JSON.stringify({
      repos: [{ name: "acme/app", group_ids: [] }, { name: "acme/onlyg1", group_ids: [g1.id] }],
      sync_days: 60,
      login: "org-bot",
    })],
  );
  orgIntegrationId = orgRes.rows[0].id;

  const g2Res = await pool.query<{ id: string }>(
    `INSERT INTO integrations (team_id, provider, label, owner_group_id, credentials_enc, config, status)
     VALUES ($1, 'github', 'G2 GitHub', $2, 'dummy-enc', $3::jsonb, 'active') RETURNING id`,
    [teamId, g2.id, JSON.stringify({ repos: [{ name: "acme/g2repo", group_ids: [] }], sync_days: 60 })],
  );
  g2IntegrationId = g2Res.rows[0].id;
});

afterAll(async () => {
  await pool.end();
});

describe("GET /groups/:group/integrations", () => {
  it("manager sees the org-level integration (opaque) but not another group's", async () => {
    const req = authedReq(`http://localhost/api/team/${teamSlug}/groups/g1/integrations`, m1CookieToken);
    const res = await integrationsGET(req, { params: Promise.resolve({ slug: teamSlug, group: "g1" }) });
    expect(res.status).toBe(200);
    const { integrations } = await res.json();
    expect(integrations).toHaveLength(1);
    const org = integrations[0];
    expect(org.id).toBe(orgIntegrationId);
    expect(org.owned).toBe(false);
    expect(org.status).toBeUndefined();
    expect(org.login).toBeUndefined();
    expect(org.sources.map((s: { key: string }) => s.key).sort()).toEqual(["acme/app", "acme/onlyg1"]);
    expect(integrations.some((i: { id: string }) => i.id === g2IntegrationId)).toBe(false);
  });

  it("plain (non-manager) member gets 404, not 403 — anti-probing", async () => {
    const req = authedReq(`http://localhost/api/team/${teamSlug}/groups/g1/integrations`, m2CookieToken);
    const res = await integrationsGET(req, { params: Promise.resolve({ slug: teamSlug, group: "g1" }) });
    expect(res.status).toBe(404);
  });

  it("admin sees the group's view too", async () => {
    const req = authedReq(`http://localhost/api/team/${teamSlug}/groups/g1/integrations`, adminCookieToken);
    const res = await integrationsGET(req, { params: Promise.resolve({ slug: teamSlug, group: "g1" }) });
    expect(res.status).toBe(200);
    const { integrations } = await res.json();
    expect(integrations).toHaveLength(1);
  });
});

describe("PUT /groups/:group/integrations/:id/sources", () => {
  it("excludes an all-groups source from this group — expands to the remaining groups", async () => {
    const req = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/g1/integrations/${orgIntegrationId}/sources`,
      m1CookieToken,
      { method: "PUT", body: { sources: [{ key: "acme/app", counts: false }] } },
    );
    const res = await sourcesPUT(req, { params: Promise.resolve({ slug: teamSlug, group: "g1", id: orgIntegrationId }) });
    expect(res.status).toBe(200);

    const row = await pool.query<{ config: { repos: { name: string; group_ids: string[] }[] } }>(
      "SELECT config FROM integrations WHERE id = $1",
      [orgIntegrationId],
    );
    const app = row.rows[0].config.repos.find((r) => r.name === "acme/app")!;
    expect(app.group_ids).toEqual([g2.id]); // g1 excluded, only g2 remains of the team's groups
  });

  it("refuses to orphan a source from every group (400), leaving config untouched", async () => {
    const req = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/g1/integrations/${orgIntegrationId}/sources`,
      m1CookieToken,
      { method: "PUT", body: { sources: [{ key: "acme/onlyg1", counts: false }] } },
    );
    const res = await sourcesPUT(req, { params: Promise.resolve({ slug: teamSlug, group: "g1", id: orgIntegrationId }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/at least one group/);

    const row = await pool.query<{ config: { repos: { name: string; group_ids: string[] }[] } }>(
      "SELECT config FROM integrations WHERE id = $1",
      [orgIntegrationId],
    );
    expect(row.rows[0].config.repos.find((r) => r.name === "acme/onlyg1")!.group_ids).toEqual([g1.id]);
  });

  it("404s (not 500) on a non-UUID integration id", async () => {
    const req = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/g1/integrations/not-a-uuid/sources`,
      m1CookieToken,
      { method: "PUT", body: { sources: [{ key: "acme/app", counts: true }] } },
    );
    const res = await sourcesPUT(req, { params: Promise.resolve({ slug: teamSlug, group: "g1", id: "not-a-uuid" }) });
    expect(res.status).toBe(404);
  });

  it("404s on a group's manager targeting another group's owned integration", async () => {
    const req = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/g1/integrations/${g2IntegrationId}/sources`,
      m1CookieToken,
      { method: "PUT", body: { sources: [{ key: "acme/g2repo", counts: false }] } },
    );
    const res = await sourcesPUT(req, { params: Promise.resolve({ slug: teamSlug, group: "g1", id: g2IntegrationId }) });
    expect(res.status).toBe(404);
  });
});

describe("POST /groups/:group/integrations", () => {
  it("rejects an invalid GitHub token with 400 (credential validation, no live call)", async () => {
    process.env.FLEETLENS_ENCRYPTION_KEY = "a".repeat(64); // 32 bytes hex
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 }),
    );
    try {
      const req = authedReq(
        `http://localhost/api/team/${teamSlug}/groups/g1/integrations`,
        m1CookieToken,
        { method: "POST", body: { provider: "github", label: "New GH", token: "fake-token", repos: ["acme/newrepo"] } },
      );
      const res = await integrationsPOST(req, { params: Promise.resolve({ slug: teamSlug, group: "g1" }) });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/GitHub rejected the token/);
    } finally {
      fetchSpy.mockRestore();
      delete process.env.FLEETLENS_ENCRYPTION_KEY;
    }
  });

  it("returns 501 when FLEETLENS_ENCRYPTION_KEY is not set", async () => {
    delete process.env.FLEETLENS_ENCRYPTION_KEY;
    const req = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/g1/integrations`,
      m1CookieToken,
      { method: "POST", body: { provider: "github", token: "x", repos: ["acme/newrepo"] } },
    );
    const res = await integrationsPOST(req, { params: Promise.resolve({ slug: teamSlug, group: "g1" }) });
    expect(res.status).toBe(501);
  });
});

describe("stored-credential picker provider pin", () => {
  it("refuses to send a non-GitHub integration's stored credential to GitHub", async () => {
    process.env.FLEETLENS_ENCRYPTION_KEY = "a".repeat(64);
    try {
      const jiraRes = await pool.query<{ id: string }>(
        `INSERT INTO integrations (team_id, provider, label, credentials_enc, config, status)
         VALUES ($1, 'jira', 'Pin Test Jira', 'enc', '{"site":"https://x.atlassian.net","email":"a@b.c"}', 'active') RETURNING id`,
        [teamId],
      );
      const req = authedReq(
        `http://localhost/api/team/settings/integrations/github/repos?team=${teamSlug}`,
        adminCookieToken,
        { method: "POST", body: { id: jiraRes.rows[0].id } },
      );
      const res = await githubReposPOST(req);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/Not a GitHub integration/);
    } finally {
      delete process.env.FLEETLENS_ENCRYPTION_KEY;
    }
  });
});
