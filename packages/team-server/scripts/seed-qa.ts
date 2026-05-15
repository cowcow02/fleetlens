import { getPool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrate.js";
import { createFirstOrSubsequentUser, createUserAccount } from "../src/lib/auth.js";
import {
  createGroup,
  addGroupMember,
  setGroupMemberManager,
} from "../src/lib/groups.js";

async function main() {
  await runMigrations();
  const pool = getPool();

  // Admin (first user → auto-staff)
  const { user: admin } = await createFirstOrSubsequentUser(
    "admin@qa.local",
    "password1234",
    "Alice Admin",
    pool,
  );

  // Create team
  const teamRes = await pool.query(
    "INSERT INTO teams (slug, name) VALUES ('acme', 'Acme Corp') RETURNING id",
  );
  const teamId = teamRes.rows[0].id;

  // Admin membership
  const adminM = (
    await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'admin') RETURNING id",
      [admin.id, teamId],
    )
  ).rows[0].id;

  // Other users
  const mgr = await createUserAccount(
    "manager@qa.local",
    "password1234",
    "Mia Manager",
    {},
    pool,
  );
  const mgrM = (
    await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'member') RETURNING id",
      [mgr.id, teamId],
    )
  ).rows[0].id;

  const member1 = await createUserAccount(
    "member1@qa.local",
    "password1234",
    "Mark Member",
    {},
    pool,
  );
  const member1M = (
    await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'member') RETURNING id",
      [member1.id, teamId],
    )
  ).rows[0].id;

  const member2 = await createUserAccount(
    "member2@qa.local",
    "password1234",
    "Maya Outsider",
    {},
    pool,
  );
  const member2M = (
    await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'member') RETURNING id",
      [member2.id, teamId],
    )
  ).rows[0].id;

  const member3 = await createUserAccount(
    "ungrouped@qa.local",
    "password1234",
    "Una Ungrouped",
    {},
    pool,
  );
  await pool.query(
    "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'member') RETURNING id",
    [member3.id, teamId],
  );

  // Two groups
  const platform = await createGroup(teamId, "platform", "Platform Squad", admin.id, pool);
  const growth = await createGroup(teamId, "growth", "Growth Team", admin.id, pool);

  // Manager → platform (manager); member1 → platform
  await addGroupMember(platform.id, mgrM, admin.id, pool);
  await setGroupMemberManager(platform.id, mgrM, true, admin.id, pool);
  await addGroupMember(platform.id, member1M, admin.id, pool);

  // member2 is in growth only (not visible to mgr)
  await addGroupMember(growth.id, member2M, admin.id, pool);

  // Seed some daily_rollups so the roster cards show non-zero data
  const today = new Date().toISOString().slice(0, 10);
  for (const [m, agentMs, sessions] of [
    [adminM, 7_200_000, 5],
    [mgrM, 5_400_000, 4],
    [member1M, 3_600_000, 3],
    [member2M, 1_800_000, 2],
  ] as const) {
    await pool.query(
      `INSERT INTO daily_rollups (team_id, membership_id, day, agent_time_ms, sessions, tool_calls, turns, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write)
       VALUES ($1, $2, $3, $4, $5, 20, 10, 1000, 500, 2000, 200)
       ON CONFLICT (team_id, membership_id, day) DO NOTHING`,
      [teamId, m, today, agentMs, sessions],
    );
  }

  console.log("Seed complete:");
  console.log("  Team: acme");
  console.log("  Login URLs:");
  console.log("    Admin    → http://localhost:3322/login  (admin@qa.local / password1234)");
  console.log("    Manager  → http://localhost:3322/login  (manager@qa.local / password1234)");
  console.log("    Member1  → http://localhost:3322/login  (member1@qa.local / password1234) [in platform]");
  console.log("    Member2  → http://localhost:3322/login  (member2@qa.local / password1234) [in growth only]");
  console.log("    Ungrouped → http://localhost:3322/login (ungrouped@qa.local / password1234)");
  console.log("  Groups: platform (mgr is manager, member1 is member), growth (member2 is member)");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
