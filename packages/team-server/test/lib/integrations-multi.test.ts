import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resetDb } from "../helpers/db.js";
import { getPool } from "../../src/db/pool.js";
import { createUserAccount } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";
import { createGroup } from "../../src/lib/groups.js";
import { listIntegrations, getIntegrationById, deleteIntegration } from "../../src/lib/integrations.js";
import { scopedSourceNames } from "../../src/lib/team-report-aggregate.js";

let pool: ReturnType<typeof getPool>;
let teamId: string;

async function insertIntegration(provider: string, label: string, config: unknown) {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO integrations (team_id, provider, label, credentials_enc, config, status)
     VALUES ($1, $2, $3, 'dummy-enc', $4::jsonb, 'active') RETURNING id`,
    [teamId, provider, label, JSON.stringify(config)],
  );
  return res.rows[0].id;
}

beforeAll(async () => {
  pool = await resetDb();
  const admin = await createUserAccount("integ-multi-admin@example.com", "pass1234", "Admin", {}, pool);
  teamId = (await createTeamWithAdmin("Integ Multi Team", admin.id, pool)).team.id;
});

afterAll(async () => {
  await pool.end();
});

describe("listIntegrations / getIntegrationById", () => {
  it("lists every integration for a team and filters by provider", async () => {
    const ghA = await insertIntegration("github", "GH A", { repos: [] });
    const ghB = await insertIntegration("github", "GH B", { repos: [] });
    const lin = await insertIntegration("linear", "Linear", { teams: [] });

    const all = await listIntegrations(teamId, pool);
    expect(all.map((i) => i.id).sort()).toEqual([ghA, ghB, lin].sort());

    const githubOnly = await listIntegrations(teamId, pool, "github");
    expect(githubOnly.map((i) => i.id).sort()).toEqual([ghA, ghB].sort());
    expect(githubOnly.every((i) => i.provider === "github")).toBe(true);
  });

  it("is team-scoped — a wrong team id returns null", async () => {
    const id = await insertIntegration("github", "Scoped", { repos: [] });
    expect(await getIntegrationById(teamId, id, pool)).not.toBeNull();

    const otherAdmin = await createUserAccount("integ-multi-other@example.com", "pass1234", null, {}, pool);
    const otherTeamId = (await createTeamWithAdmin("Other Team", otherAdmin.id, pool)).team.id;
    expect(await getIntegrationById(otherTeamId, id, pool)).toBeNull();
  });
});

describe("scopedSourceNames with multiple integrations per provider", () => {
  it("unions and dedupes mapped repos across integrations, scoped to a group", async () => {
    const admin = await createUserAccount("integ-multi-scope-admin@example.com", "pass1234", null, {}, pool);
    const scopeTeamId = (await createTeamWithAdmin("Scope Team", admin.id, pool)).team.id;
    const gA = await createGroup(scopeTeamId, "ga", "Group A", admin.id, pool);
    const gB = await createGroup(scopeTeamId, "gb", "Group B", admin.id, pool);

    await pool.query(
      `INSERT INTO integrations (team_id, provider, label, credentials_enc, config, status)
       VALUES ($1, 'github', 'GH A', 'enc', $2::jsonb, 'active')`,
      [scopeTeamId, JSON.stringify({
        repos: [{ name: "acme/web", group_ids: [gA.id] }, { name: "acme/shared", group_ids: [] }],
      })],
    );
    await pool.query(
      `INSERT INTO integrations (team_id, provider, label, credentials_enc, config, status)
       VALUES ($1, 'github', 'GH B', 'enc', $2::jsonb, 'active')`,
      // "acme/shared" repeats across both integrations (empty group_ids) — must dedupe, not double-count.
      [scopeTeamId, JSON.stringify({
        repos: [{ name: "acme/infra", group_ids: [gB.id] }, { name: "acme/shared", group_ids: [] }],
      })],
    );

    const scopedA = await scopedSourceNames(scopeTeamId, { kind: "group", groupId: gA.id }, pool);
    expect([...scopedA.repoNames!].sort()).toEqual(["acme/shared", "acme/web"]);

    const teamWide = await scopedSourceNames(scopeTeamId, { kind: "team-wide" }, pool);
    expect([...teamWide.repoNames!].sort()).toEqual(["acme/infra", "acme/shared", "acme/web"]);
  });
});

describe("deleteIntegration", () => {
  it("cascades to synced facts carrying its integration_id; NULL-provenance rows survive", async () => {
    const id = await insertIntegration("github", "Cascade Test", { repos: [{ name: "acme/cascade", group_ids: [] }] });

    await pool.query(
      `INSERT INTO github_pull_requests (team_id, repo, number, title, state, created_at, integration_id)
       VALUES ($1, 'acme/cascade', 1, 'owned by integration', 'open', now(), $2)`,
      [teamId, id],
    );
    await pool.query(
      `INSERT INTO github_pull_requests (team_id, repo, number, title, state, created_at, integration_id)
       VALUES ($1, 'acme/cascade', 2, 'pre-0015, no provenance', 'open', now(), NULL)`,
      [teamId],
    );

    await deleteIntegration(teamId, id, pool);

    const remaining = await pool.query<{ number: number }>(
      "SELECT number FROM github_pull_requests WHERE team_id = $1 AND repo = 'acme/cascade'",
      [teamId],
    );
    expect(remaining.rows.map((r) => r.number)).toEqual([2]);
  });
});
