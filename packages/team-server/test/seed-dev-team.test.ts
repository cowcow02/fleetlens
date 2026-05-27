// One-shot dev seeder. Runs only when explicitly invoked with vitest's -t
// filter, otherwise no-ops, so the regular `pnpm test` stays clean.
//
// Usage:
//   DATABASE_URL="postgres://localhost:5432/fleetlens_dev" \
//   pnpm -F @claude-lens/team-server exec vitest run -t "seed-dev-team"
//
// Prints the session cookie token + team slug so curl can be pointed at the
// dev server (port 3322).

import { describe, it } from "vitest";
import { getPool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrate.js";
import { createUserAccount, createSession } from "../src/lib/auth.js";
import { isoMondayOf, previousIsoMonday } from "../src/lib/insights-aggregate.js";

// Only runs when the file is invoked by name; vitest's discovery glob omits
// `.fixture.test.ts` from default runs.
describe("seed-dev-team", () => {
  it("seeds a real-data team + cookie", { timeout: 60_000 }, async () => {
    process.env.DATABASE_URL ||= "postgres://localhost:5432/fleetlens_dev";

    console.log("Running migrations…");
    await runMigrations();
    const pool = getPool();

    console.log("Wiping dev tables…");
    await pool.query(`
      TRUNCATE TABLE
        events, daily_rollups, rich_daily_rollups, ingest_log, invites,
        plan_utilization,
        group_members, groups, member_commands, membership_cycle_peaks,
        memberships, sessions, server_config,
        update_check_cache,
        user_accounts, teams
      RESTART IDENTITY CASCADE
    `);

    const teamRes = await pool.query(
      `INSERT INTO teams (slug, name) VALUES ('acme-eng', 'Acme Engineering') RETURNING id`,
    );
    const teamId = teamRes.rows[0].id;
    const admin = await createUserAccount("admin@acme.dev", "devpass1", "Charlie", { isStaff: false }, pool);
    const alice = await createUserAccount("alice@acme.dev", "devpass1", "Alice", {}, pool);
    const bob = await createUserAccount("bob@acme.dev", "devpass1", "Bob", {}, pool);
    const dana = await createUserAccount("dana@acme.dev", "devpass1", "Dana", {}, pool);
    const adminMem = await pool.query(
      `INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1, $2, 'admin') RETURNING id`,
      [admin.id, teamId],
    );
    const aliceMem = await pool.query(
      `INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1, $2, 'member') RETURNING id`,
      [alice.id, teamId],
    );
    const bobMem = await pool.query(
      `INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1, $2, 'member') RETURNING id`,
      [bob.id, teamId],
    );
    const danaMem = await pool.query(
      `INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1, $2, 'member') RETURNING id`,
      [dana.id, teamId],
    );
    const members = [
      { id: adminMem.rows[0].id, name: "Charlie", weight: 1.6 },
      { id: aliceMem.rows[0].id, name: "Alice", weight: 1.2 },
      { id: bobMem.rows[0].id, name: "Bob", weight: 1.3 },
      { id: danaMem.rows[0].id, name: "Dana", weight: 0.35 },
    ];

    const thisWeek = isoMondayOf(new Date());
    const lastWeek = previousIsoMonday(thisWeek);
    const days: string[] = [];
    for (const start of [lastWeek, thisWeek]) {
      const d = new Date(`${start}T00:00:00Z`);
      for (let i = 0; i < 7; i++) {
        const dd = new Date(d);
        dd.setUTCDate(d.getUTCDate() + i);
        days.push(dd.toISOString().slice(0, 10));
      }
    }

    const PROJECTS = ["topeka", "kipwise-v1", "ops-runbooks", "infra-bootstrap"];
    const SKILLS = [
      "harness-orchestrate",
      "kipwise-migration-guard",
      "release-ship-check",
      "brainstorming",
      "test-driven-development",
    ];
    const SHAPES = ["focused-build", "rescue-debug", "long-autonomous", "review-burst"];
    const pseudo = (seed: number) => {
      const x = Math.sin(seed) * 10_000;
      return x - Math.floor(x);
    };

    let rowCount = 0;
    for (let mi = 0; mi < members.length; mi++) {
      const m = members[mi];
      for (let di = 0; di < days.length; di++) {
        const day = days[di];
        if (pseudo(mi * 31 + di) < 0.25 && m.weight < 0.5) continue;
        const base = m.weight * (0.5 + pseudo(mi * 17 + di + 3));
        const agentMs = Math.round(base * 2 * 3600 * 1000);
        const sessions = Math.max(1, Math.round(base * 4));
        const prs = Math.round(base * 1.2 * pseudo(mi + di));
        const commits = Math.round(prs * 1.6 + 1);
        const concurrencyPeak = 1 + Math.round(pseudo(mi + di + 7) * 3);
        const parallelMin = Math.round(base * 22 * pseudo(mi + di + 11));
        const longAutoCount = Math.round(base * 1.3 * pseudo(mi + di + 13));
        const longAutoTotalMin = longAutoCount * Math.round(8 + pseudo(mi + di + 17) * 20);
        const longAutoMaxSingleMin = longAutoCount === 0 ? 0 : Math.max(longAutoTotalMin / Math.max(longAutoCount, 1), 6);

        const projects = PROJECTS.slice(0, 1 + Math.round(pseudo(mi + di + 19) * 2)).map((p, j) => ({
          project: p,
          agentTimeMs: Math.round(agentMs * (0.5 - 0.1 * j) * (0.8 + pseudo(mi + di + 23 + j) * 0.3)),
          sessions: Math.max(1, Math.round(sessions / (j + 1.5))),
        }));
        const workingShapes = SHAPES.slice(0, 1 + Math.round(pseudo(mi + di + 25) * 2)).map((s, j) => ({
          shape: s,
          sessions: Math.max(1, Math.round(sessions / (j + 2))),
          agentTimeMs: Math.round(agentMs / (j + 2)),
        }));
        const skillsLoaded = SKILLS.slice(0, 2 + Math.round(pseudo(mi + di + 31) * 3)).map((s, j) => ({
          name: s,
          sessions: Math.max(1, Math.round(sessions / (j + 1.4))),
        }));
        const subagentsDispatched = [
          { type: "code-simplifier", count: Math.round(base * 2) },
          { type: "Explore", count: Math.round(base * 3) },
        ];

        await pool.query(
          `INSERT INTO rich_daily_rollups (
            team_id, membership_id, day,
            agent_time_ms, sessions, prs, commits, pushes,
            concurrency_peak, parallel_minutes,
            long_auto_count, long_auto_total_min, long_auto_max_single_min,
            tool_errors, brainstorm_warmup_sessions, plan_mode_used,
            projects, working_shapes, skills_loaded, subagents_dispatched,
            tokens_input, tokens_output, tokens_cache_read, tokens_cache_write
          ) VALUES (
            $1, $2, $3,
            $4, $5, $6, $7, $8,
            $9, $10,
            $11, $12, $13,
            $14, $15, $16,
            $17, $18, $19, $20,
            $21, $22, $23, $24
          )`,
          [
            teamId, m.id, day,
            agentMs, sessions, prs, commits, commits,
            concurrencyPeak, parallelMin,
            longAutoCount, longAutoTotalMin, longAutoMaxSingleMin,
            Math.round(base * pseudo(mi + di + 37)),
            Math.round(base * pseudo(mi + di + 41)),
            Math.round(base * pseudo(mi + di + 43)),
            JSON.stringify(projects),
            JSON.stringify(workingShapes),
            JSON.stringify(skillsLoaded),
            JSON.stringify(subagentsDispatched),
            Math.round(agentMs * 0.4),
            Math.round(agentMs * 0.06),
            Math.round(agentMs * 1.2),
            Math.round(agentMs * 0.14),
          ],
        );
        rowCount++;
      }
    }

    const { cookieToken } = await createSession(admin.id, pool);

    console.log(`Seeded ${rowCount} rollup rows.`);
    console.log("\n=== READY ===");
    console.log("Team slug:        acme-eng");
    console.log("Admin email:      admin@acme.dev / devpass1");
    console.log(`Cookie token:     ${cookieToken}`);
    console.log(`Live insights:    http://localhost:3322/team/acme-eng/insights`);
    console.log(`PDF endpoint:     http://localhost:3322/api/team/acme-eng/insights/pdf`);

    // Persist cookie + slug for follow-up shell invocations to grep out.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      "/tmp/fleetlens-seed.json",
      JSON.stringify({ slug: "acme-eng", cookieToken, rowCount }, null, 2),
    );
    console.log("Cookie persisted to /tmp/fleetlens-seed.json");
  });
});
