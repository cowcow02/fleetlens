// Seed a COMPLETE team-insights story: rich_daily_rollups + day_artifact_signals
// + team_skill_catalog, with members spread cleanly across L0–L4 so every widget
// in LIVE_STARTER_BLOCKS_V8 renders. Representative demo data (not real engineers).
//
//   DATABASE_URL=postgres://localhost:5432/fleetlens_chicago node scripts/seed-team-story.mjs
//
// Login after seeding: demo-admin@example.com / demo1234  →  /team/demo-team/insights

import pg from "pg";
import { randomBytes, scryptSync, randomUUID, createHash } from "node:crypto";

const DAY = 24 * 3600_000;

function hashPassword(plain) {
  const salt = randomBytes(16);
  const hash = scryptSync(plain.normalize("NFKC"), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("hex")}$${hash.toString("hex")}`;
}
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const pathHash = (s) => "user:skills:" + sha256(s).slice(0, 24);

// midnight UTC date string N days before "today"
function dayStr(offsetDays) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}
function dowMonStart(offsetDays) {
  // 0=Mon ... 6=Sun for the date `offsetDays` ago
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return (d.getUTCDay() + 6) % 7;
}

const PROJECTS = ["amigo-api", "ca-revamp", "ops-runbooks", "dispatch-ml", "kipwise", "fleet-dashboard"];
const SKILLS = ["brainstorming", "test-driven-development", "harness-orchestrate", "code-review",
                "release-ship-check", "systematic-debugging", "writing-plans"];
const SUBAGENTS = ["reviewer", "implementer", "explorer", "researcher", "planner"];
const dow0 = dowMonStart(0); // today's weekday (Mon-start); days with off<=dow0 are "this week"
// per-skill WoW trend so the skill-usage bars show movement, not a wall of zeros
const SKILL_TREND = [1.35, 1.15, 1.0, 0.82, 0.7, 1.25, 1.05];

function pick(arr, n) { return arr.slice(0, n); }
function jitter(base, pct = 0.25) { return Math.round(base * (1 + (Math.random() * 2 - 1) * pct)); }

// Per-member adoption profiles. activeDows = which weekdays (0=Mon..6=Sun) they work,
// applied to BOTH the current week and the trailing 30d. sessionsPerDay kept <20/wk for
// non-L4 so the quick + portrait classifiers agree.
const MEMBERS = [
  { name: "Maya",  email: "maya@example.com",  role: "admin",  tier: "pro-max-20x", level: "L4",
    activeDows: [0,1,2,3,4], sessionsPerDay: 4, projN: 3, skillN: 6, subN: 3, prsWk: 9,
    authorsSkills: true },
  { name: "Devin", email: "devin@example.com", role: "member", tier: "pro-max-20x", level: "L3",
    activeDows: [0,1,2,3,4], sessionsPerDay: 2, projN: 3, skillN: 5, subN: 2, prsWk: 6 },
  { name: "Priya", email: "priya@example.com", role: "member", tier: "pro-max",    level: "L3",
    activeDows: [0,1,2,3],       sessionsPerDay: 2, projN: 2, skillN: 4, subN: 1, prsWk: 4,
    adopter: true },
  { name: "Theo",  email: "theo@example.com",  role: "member", tier: "pro-max",    level: "L2",
    activeDows: [0,2,4],         sessionsPerDay: 2, projN: 1, skillN: 2, subN: 0, prsWk: 1,
    adopter: true },
  { name: "Lena",  email: "lena@example.com",  role: "member", tier: "pro",        level: "L1",
    activeDows: [1,3],           sessionsPerDay: 1, projN: 1, skillN: 1, subN: 0, prsWk: 0 },
  { name: "Sam",   email: "sam@example.com",   role: "member", tier: "pro",        level: "L0",
    activeDows: [],              sessionsPerDay: 0, projN: 0, skillN: 0, subN: 0, prsWk: 0 },
];

// Two groups so the per-group momentum dashboard renders distinct stories:
// Platform has an L4 multiplier (Maya), Product has none. Managers are
// deliberately NON-admins (Devin, Theo) so the guarded coaching view is
// exercised by a line manager, not the all-seeing admin. Maya's adopters span
// both groups (Priya in Platform, Theo in Product), so the within-group
// L4-coaches count differs by scope: 1 in-group adopter in Platform vs 2
// team-wide. (The pure coaches-without-builds isolation is exercised by the
// unit test, which omits Maya's day_artifact_signals.)
const GROUPS = [
  { slug: "platform", name: "Platform", manager: "Devin", members: ["Maya", "Devin", "Priya"] },
  { slug: "product",  name: "Product Squad", manager: "Theo", members: ["Theo", "Lena", "Sam"] },
];

async function seed(client) {
  for (const t of ["team_skill_catalog", "day_artifact_signals", "rich_daily_rollups",
                   "plan_utilization", "membership_cycle_peaks", "sessions",
                   "group_members", "groups", "memberships", "teams", "user_accounts"]) {
    await client.query(`DELETE FROM ${t}`).catch(() => {});
  }

  const teamId = randomUUID();
  const teamSlug = "demo-team";
  await client.query(`INSERT INTO teams (id, name, slug) VALUES ($1, 'Product Engineering (demo)', $2)`,
    [teamId, teamSlug]);

  const mId = {};
  let adminUserId = null;
  for (const m of MEMBERS) {
    const userId = randomUUID();
    await client.query(
      `INSERT INTO user_accounts (id, email, password_hash, display_name, is_staff)
       VALUES ($1, $2, $3, $4, false)`,
      [userId, m.email, hashPassword("demo1234"), m.name]);
    const membershipId = randomUUID();
    await client.query(
      `INSERT INTO memberships (id, team_id, user_account_id, role, plan_tier)
       VALUES ($1, $2, $3, $4, $5)`,
      [membershipId, teamId, userId, m.role, m.tier]);
    mId[m.name] = membershipId;
    if (m.role === "admin") adminUserId = userId;
  }

  // Groups + membership assignment (manager flag on group_members).
  const gId = {};
  for (const g of GROUPS) {
    const groupId = randomUUID();
    gId[g.slug] = groupId;
    await client.query(`INSERT INTO groups (id, team_id, slug, name) VALUES ($1, $2, $3, $4)`,
      [groupId, teamId, g.slug, g.name]);
    for (const name of g.members) {
      await client.query(
        `INSERT INTO group_members (group_id, membership_id, is_manager) VALUES ($1, $2, $3)`,
        [groupId, mId[name], name === g.manager]);
    }
  }

  // a session for the admin so the dashboard is reachable without the UI login
  const token = randomBytes(24).toString("hex");
  await client.query(
    `INSERT INTO sessions (token_hash, user_account_id, expires_at)
     VALUES ($1, $2, now() + interval '30 days')`,
    [sha256(token), adminUserId]).catch(async (e) => {
      // fall back to whatever the sessions schema actually is
      console.warn("[seed] session insert failed (will rely on UI login):", e.message);
    });

  // 35 days of rollups (covers this week + last week + trailing 30d)
  const SPAN = 35;
  for (const m of MEMBERS) {
    if (m.level === "L0") continue; // onboarding gap: no recent activity at all
    for (let off = SPAN; off >= 0; off--) {
      const dow = dowMonStart(off);
      if (!m.activeDows.includes(dow)) continue;
      const day = dayStr(off);
      const sessions = Math.max(1, jitter(m.sessionsPerDay));
      const agentMs = jitter(sessions * 48 * 60_000); // ~48 min/session
      const projects = pick(PROJECTS, m.projN).map((p, i) => ({
        project: p,
        agentTimeMs: Math.round(agentMs / m.projN),
        sessions: Math.max(1, Math.round(sessions / m.projN)),
      }));
      const skills_loaded = pick(SKILLS, m.skillN).map((name, i) => {
        const f = off <= dow0 ? SKILL_TREND[i % SKILL_TREND.length] : 1; // boost/dampen this week
        return { name, sessions: Math.max(1, Math.round(jitter(2) * f)) };
      });
      const subagents_dispatched = pick(SUBAGENTS, m.subN).map((type) => ({ type }));
      const prs = Math.random() < (m.prsWk / 7) ? 1 : 0;
      await client.query(
        `INSERT INTO rich_daily_rollups
          (team_id, membership_id, day, agent_time_ms, sessions, prs, commits, pushes,
           concurrency_peak, parallel_minutes, long_auto_count, long_auto_total_min,
           long_auto_max_single_min, tool_errors, brainstorm_warmup_sessions, plan_mode_used,
           projects, working_shapes, skills_loaded, subagents_dispatched,
           outcome_mix, helpfulness_mix, goal_mix,
           tokens_input, tokens_output, tokens_cache_read, tokens_cache_write)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                 $17::jsonb,$18::jsonb,$19::jsonb,$20::jsonb,$21::jsonb,$22::jsonb,$23::jsonb,
                 $24,$25,$26,$27)`,
        [teamId, mId[m.name], day, agentMs, sessions, prs, jitter(prs * 3), prs,
         m.subN >= 2 ? jitter(2) : 1, m.subN >= 2 ? jitter(40) : 0,
         m.level === "L4" || m.level === "L3" ? jitter(2) : 0,
         m.level === "L4" || m.level === "L3" ? jitter(35) : 0,
         m.level === "L4" ? jitter(23) : 0,
         jitter(2), m.skillN >= 4 && Math.random() < 0.4 ? 1 : 0,
         m.skillN >= 3 && Math.random() < 0.5 ? 1 : 0,
         JSON.stringify(projects), JSON.stringify([]), JSON.stringify(skills_loaded),
         JSON.stringify(subagents_dispatched),
         JSON.stringify({ shipped: prs, partial: 1, exploratory: 1 }),
         JSON.stringify({ essential: 1, helpful: 2, neutral: 1 }),
         JSON.stringify({ build: jitter(60), debug: jitter(25), review: jitter(15) }),
         jitter(sessions * 12000), jitter(sessions * 4000),
         jitter(sessions * 90000), jitter(sessions * 30000)]);
    }
  }

  // L4 "Multiplier": Maya authored skills (recent) + others adopted them
  const maya = mId["Maya"];
  const authoredSkills = ["harness-orchestrate", "release-ship-check"];
  for (let off = 12; off >= 8; off -= 2) {
    await client.query(
      `INSERT INTO day_artifact_signals
        (team_id, membership_id, day, skills_authored, skills_edited,
         subagents_authored, slash_commands_authored, claudemd_line_delta)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8)
       ON CONFLICT (team_id, membership_id, day) DO NOTHING`,
      [teamId, maya, dayStr(off),
       JSON.stringify(authoredSkills.map((n) => ({ name: n, path_hash: pathHash(n) }))),
       JSON.stringify([]),
       JSON.stringify([{ type: "reviewer", path_hash: pathHash("reviewer") }]),
       JSON.stringify([]), 24]);
  }
  for (const name of authoredSkills) {
    await client.query(
      `INSERT INTO team_skill_catalog
        (team_id, path_hash, kind, originator_membership_id, originator_first_seen,
         adopter_membership_ids, loads_total)
       VALUES ($1,$2,'skill',$3,$4,$5::uuid[],$6)
       ON CONFLICT (team_id, path_hash) DO NOTHING`,
      [teamId, pathHash(name), maya, dayStr(12), [mId["Priya"], mId["Theo"]], jitter(40)]);
  }

  const counts = await client.query(
    `SELECT
       (SELECT count(*) FROM rich_daily_rollups WHERE team_id=$1) rr,
       (SELECT count(*) FROM day_artifact_signals WHERE team_id=$1) das,
       (SELECT count(*) FROM team_skill_catalog WHERE team_id=$1) tsc`, [teamId]);
  console.log("[seed] rows:", counts.rows[0]);
  console.log(`[seed] team: /team/${teamSlug}/insights  ·  admin login: maya@example.com / demo1234`);
  for (const g of GROUPS) {
    console.log(`[seed] group: /team/${teamSlug}/groups/${g.slug}/insights  (manager: ${g.manager.toLowerCase()}@example.com / demo1234)`);
  }
  console.log(`[seed] ADMIN_SESSION_TOKEN=${token}`);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try { await seed(client); } finally { await client.end(); }
