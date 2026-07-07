import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { resetDb } from "../helpers/db.js";
import { getPool } from "../../src/db/pool.js";
import { createUserAccount } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";
import { scopedSourceNames } from "../../src/lib/team-report-aggregate.js";

let pool: ReturnType<typeof getPool>;
let teamId: string;

async function addIntegration(provider: "github" | "linear" | "jira", config: unknown) {
  await pool.query(
    `INSERT INTO team_integrations (team_id, provider, credentials_enc, config, status)
     VALUES ($1, $2, 'enc', $3::jsonb, 'active')
     ON CONFLICT (team_id, provider) DO UPDATE SET config = EXCLUDED.config`,
    [teamId, provider, JSON.stringify(config)],
  );
}

beforeAll(async () => {
  pool = await resetDb();
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query("TRUNCATE TABLE user_accounts, teams RESTART IDENTITY CASCADE");
  const admin = await createUserAccount("ssn-admin@example.com", "pass1234", "Admin", {}, pool);
  teamId = (await createTeamWithAdmin("SSN Team", admin.id, pool)).team.id;
});

describe("scopedSourceNames", () => {
  it("returns empty arrays for each provider that isn't connected", async () => {
    const out = await scopedSourceNames(teamId, { kind: "team-wide" }, pool);
    expect(out).toEqual({ repoNames: [], teamKeys: [], projectKeys: [] });
  });

  it("returns every mapped source name for a team-wide scope", async () => {
    await addIntegration("github", { repos: [{ name: "acme/web", group_ids: [] }, "acme/api"] });
    await addIntegration("linear", { teams: [{ key: "ENG", group_ids: [] }] });
    await addIntegration("jira", { projects: [{ key: "OPS", group_ids: [] }] });

    const out = await scopedSourceNames(teamId, { kind: "team-wide" }, pool);
    expect(out.repoNames).toEqual(["acme/web", "acme/api"]);
    expect(out.teamKeys).toEqual(["ENG"]);
    expect(out.projectKeys).toEqual(["OPS"]);
  });

  it("filters group-scoped sources to the group's mappings (plus unmapped-to-all)", async () => {
    await addIntegration("github", {
      repos: [
        { name: "acme/web", group_ids: ["g1"] },
        { name: "acme/infra", group_ids: ["g2"] },
        { name: "acme/shared", group_ids: [] }, // empty = counts toward all groups
      ],
    });
    await addIntegration("linear", {
      teams: [
        { key: "ENG", group_ids: ["g1"] },
        { key: "SRE", group_ids: ["g2"] },
      ],
    });

    const out = await scopedSourceNames(teamId, { kind: "group", groupId: "g1" }, pool);
    expect([...(out.repoNames ?? [])].sort()).toEqual(["acme/shared", "acme/web"]);
    expect(out.teamKeys).toEqual(["ENG"]);
    expect(out.projectKeys).toEqual([]); // jira not connected
  });
});
