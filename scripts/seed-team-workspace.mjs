import pg from "pg";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, scryptSync, randomUUID } from "node:crypto";

const ROOT = process.cwd();

// Load the environment variables from .harness/conductor-env
let pgPort = 55132;
try {
  const envContent = readFileSync(join(ROOT, ".harness/conductor-env"), "utf8");
  const match = envContent.match(/PG_PORT=(\d+)/);
  if (match) {
    pgPort = parseInt(match[1], 10);
  }
} catch (e) {
  console.log("Could not read PG_PORT from .harness/conductor-env, using default 55132");
}

console.log(`Targeting PG_PORT: ${pgPort}`);

function hashPassword(plain) {
  const salt = randomBytes(16);
  const hash = scryptSync(plain.normalize("NFKC"), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function seed(client) {
  // First clear existing data to make seeding idempotent
  await client.query("DELETE FROM plan_utilization");
  await client.query("DELETE FROM membership_cycle_peaks");
  await client.query("DELETE FROM memberships");
  await client.query("DELETE FROM teams");
  await client.query("DELETE FROM user_accounts");

  console.log("[seed] Cleaned up existing data");

  // Admin user + team
  const adminId = randomUUID();
  const passwordHash = hashPassword("demo1234");
  await client.query(
    `INSERT INTO user_accounts (id, email, password_hash, display_name, is_staff)
     VALUES ($1, 'demo-admin@example.com', $2, 'Charlie', false)`,
    [adminId, passwordHash],
  );

  const teamId = randomUUID();
  const teamSlug = "demo-team";
  await client.query(
    `INSERT INTO teams (id, name, slug) VALUES ($1, 'Demo Team', $2)`,
    [teamId, teamSlug],
  );

  const charlieMembership = randomUUID();
  await client.query(
    `INSERT INTO memberships (id, team_id, user_account_id, role, plan_tier)
     VALUES ($1, $2, $3, 'admin', 'pro-max-20x')`,
    [charlieMembership, teamId, adminId],
  );

  const others = [
    { name: "Diana", email: "diana@example.com", tier: "pro-max" },
    { name: "Eve", email: "eve@example.com", tier: "pro-max-20x" },
    { name: "Frank", email: "frank@example.com", tier: "pro" },
    { name: "Grace", email: "grace@example.com", tier: "pro" },
  ];
  const memberIds = { Charlie: charlieMembership };
  for (const o of others) {
    const userId = randomUUID();
    await client.query(
      `INSERT INTO user_accounts (id, email, password_hash, display_name, is_staff)
       VALUES ($1, $2, $3, $4, false)`,
      [userId, o.email, hashPassword("demo1234"), o.name],
    );
    const mId = randomUUID();
    await client.query(
      `INSERT INTO memberships (id, team_id, user_account_id, role, plan_tier)
       VALUES ($1, $2, $3, 'member', $4)`,
      [mId, teamId, userId, o.tier],
    );
    memberIds[o.name] = mId;
  }

  // Seeding profile definitions:
  // - completedCyclesCount controls how many finished cycles they have.
  // - peakRange controls their historical peak values.
  // - midCyclePct is their current cycle progress.
  // - hasActiveCycle controls if they have active telemetry (Grace and Frank do not).
  const profiles = {
    Charlie: { completedCyclesCount: 6, peakRange: [80, 95], midCyclePct: 78, hasActiveCycle: true }, 
    Diana:   { completedCyclesCount: 3, peakRange: [45, 62], midCyclePct: 42, hasActiveCycle: true },
    Eve:     { completedCyclesCount: 2, peakRange: [10, 32], midCyclePct: 15, hasActiveCycle: true },
    Frank:   { completedCyclesCount: 1, peakRange: [88, 100], midCyclePct: 0,  hasActiveCycle: false },
    Grace:   { completedCyclesCount: 0, peakRange: [0, 0],   midCyclePct: 0,  hasActiveCycle: false },
  };

  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const now = Date.now();

  for (const [name, profile] of Object.entries(profiles)) {
    const memberId = memberIds[name];

    // 1. Seed Completed Cycles
    for (let cycleIdx = profile.completedCyclesCount; cycleIdx >= 1; cycleIdx--) {
      const endsAt = new Date(now - cycleIdx * 7 * DAY);
      const peak = randomInRange(profile.peakRange);
      await client.query(
        `INSERT INTO membership_cycle_peaks
         (team_id, membership_id, "window", ends_at, peak_pct, source, is_current)
         VALUES ($1, $2, '7d', $3, $4, 'real', false)`,
        [teamId, memberId, endsAt, peak],
      );
    }

    // 2. Seed Active Cycle and Burndown telemetry (if applicable)
    if (profile.hasActiveCycle) {
      const inProgressEnds = new Date(now + 4 * DAY + 4 * HOUR);
      await client.query(
        `INSERT INTO membership_cycle_peaks
         (team_id, membership_id, "window", ends_at, peak_pct, source, is_current)
         VALUES ($1, $2, '7d', $3, $4, 'real', true)`,
        [teamId, memberId, inProgressEnds, profile.midCyclePct],
      );

      const cycleStart = inProgressEnds.getTime() - 7 * DAY;
      for (let t = cycleStart; t <= now; t += 4 * HOUR) {
        const elapsed = (t - cycleStart) / (7 * DAY);
        // Map realistic progression curve
        const target = Math.min(99, profile.midCyclePct * elapsed * 1.08);
        const fiveHour = Math.min(95, target * 0.55 + Math.random() * 9);
        await client.query(
          `INSERT INTO plan_utilization
           (team_id, membership_id, captured_at,
            five_hour_utilization, seven_day_utilization, seven_day_resets_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [teamId, memberId, new Date(t), fiveHour, target, inProgressEnds],
        );
      }
    }
  }

  await client.query("REFRESH MATERIALIZED VIEW membership_weekly_utilization");
  console.log(`\n✓ [seed] Success — admin login: demo-admin@example.com / demo1234`);
  console.log(`✓ [seed]   team URL: /team/${teamSlug}/plan`);
}

function randomInRange([min, max]) {
  return min + Math.random() * (max - min);
}

(async () => {
  const client = new pg.Client({
    connectionString: `postgresql://fleetlens:fleetlens@localhost:${pgPort}/fleetlens_team`
  });
  await client.connect();
  try {
    await seed(client);
  } finally {
    await client.end();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
