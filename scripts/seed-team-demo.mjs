#!/usr/bin/env node
// Seeds a local fleetlens_demo Postgres with a representative team so the
// utilization-flip UI can be eyeballed across all three color buckets
// (full / moderate / underutilizing) plus the at-the-cap recommendation
// tone. Self-contained — runs migrations directly via journal order, no
// dependency on the team-server's compiled TS.
//
// Usage:  node scripts/seed-team-demo.mjs [--reset]
// Login:  demo-admin@example.com / demo1234

import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, scryptSync, randomUUID } from "node:crypto";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "packages/team-server/src/db/migrations");

function hashPassword(plain) {
  const salt = randomBytes(16);
  const hash = scryptSync(plain.normalize("NFKC"), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function ensureDbExists(reset) {
  const c = new pg.Client({ connectionString: "postgres://localhost:5432/postgres" });
  await c.connect();
  if (reset) {
    await c
      .query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname='fleetlens_demo' AND pid <> pg_backend_pid()`,
      )
      .catch(() => {});
    await c.query(`DROP DATABASE IF EXISTS fleetlens_demo`);
  }
  const exists = await c.query("SELECT 1 FROM pg_database WHERE datname='fleetlens_demo'");
  if (!exists.rowCount) await c.query(`CREATE DATABASE fleetlens_demo`);
  await c.end();
}

async function runMigrations(client) {
  // Replay every .sql file in journal order. Same shape the team-server's
  // own runner uses, minus the drizzle/__drizzle_migrations bookkeeping —
  // we reset the DB on every seed so idempotency isn't a concern.
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, "meta", "_journal.json"), "utf8"));
  for (const e of journal.entries) {
    const sql = readFileSync(join(MIGRATIONS, `${e.tag}.sql`), "utf8");
    // Drizzle uses "--> statement-breakpoint" between statements; pg can't
    // run multi-statement DDL with constraints in a single .query() call
    // because of CHECK + ALTER ordering, so split and run sequentially.
    const stmts = sql
      .split(/-->\s*statement-breakpoint/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of stmts) await client.query(s);
    console.log(`[seed] applied ${e.tag}`);
  }
}

async function seed(client) {
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

  // Profiles span the three new color buckets. Frank's at-the-cap state
  // exercises the "upgrade urgent" recommendation regardless of the new
  // tone scheme — throttling is bad in any framing.
  const profiles = {
    Charlie: { peakRange: [80, 95], midCyclePct: 50 }, // full
    Diana: { peakRange: [45, 62], midCyclePct: 32 }, // moderate
    Eve: { peakRange: [10, 32], midCyclePct: 15 }, // under
    Frank: { peakRange: [88, 100], midCyclePct: 60 }, // at-the-cap
  };

  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const now = Date.now();

  for (const [name, profile] of Object.entries(profiles)) {
    const memberId = memberIds[name];
    for (let cycleIdx = 6; cycleIdx >= 1; cycleIdx--) {
      const endsAt = new Date(now - cycleIdx * 7 * DAY);
      const peak = randomInRange(profile.peakRange);
      await client.query(
        `INSERT INTO membership_cycle_peaks
         (team_id, membership_id, "window", ends_at, peak_pct, source, is_current)
         VALUES ($1, $2, '7d', $3, $4, 'real', false)`,
        [teamId, memberId, endsAt, peak],
      );
    }
    const inProgressEnds = new Date(now + 4 * DAY + 4 * HOUR);
    await client.query(
      `INSERT INTO membership_cycle_peaks
       (team_id, membership_id, "window", ends_at, peak_pct, source, is_current)
       VALUES ($1, $2, '7d', $3, $4, 'real', true)`,
      [teamId, memberId, inProgressEnds, profile.midCyclePct],
    );

    const cycleStart = inProgressEnds.getTime() - 7 * DAY;
    for (let t = cycleStart; t <= now; t += 3 * HOUR) {
      const elapsed = (t - cycleStart) / (7 * DAY);
      const target = Math.min(99, profile.midCyclePct * elapsed * 1.05);
      const fiveHour = Math.min(95, target * 0.6 + Math.random() * 8);
      await client.query(
        `INSERT INTO plan_utilization
         (team_id, membership_id, captured_at,
          five_hour_utilization, seven_day_utilization, seven_day_resets_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [teamId, memberId, new Date(t), fiveHour, target, inProgressEnds],
      );
    }
  }

  await client.query("REFRESH MATERIALIZED VIEW membership_weekly_utilization");
  console.log(`[seed] done — admin login: demo-admin@example.com / demo1234`);
  console.log(`[seed]   team URL: /team/${teamSlug}/plan`);
}

function randomInRange([min, max]) {
  return min + Math.random() * (max - min);
}

(async () => {
  const reset = process.argv.includes("--reset");
  await ensureDbExists(reset);

  const client = new pg.Client({ connectionString: "postgres://localhost:5432/fleetlens_demo" });
  await client.connect();
  try {
    if (!reset) {
      const exists = await client.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'teams'",
      );
      if (exists.rowCount) {
        console.error(
          "fleetlens_demo already initialized. Re-run with --reset to wipe and re-seed.",
        );
        process.exit(1);
      }
    }
    await runMigrations(client);
    await seed(client);
  } finally {
    await client.end();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
