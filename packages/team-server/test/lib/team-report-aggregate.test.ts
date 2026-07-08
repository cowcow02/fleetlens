import { describe, it, expect } from "vitest";
import { resetDb } from "../helpers/db.js";
import { linearVelocity } from "../../src/lib/team-report-aggregate.js";

// The SQL fix adds `\m` (word boundary BEFORE the identifier) to the existing
// `\M` after it. Without `\m`, `XKIP-315` matches `KIP-315`, falsely tagging
// unrelated PRs as AI-linked to the ticket. This regression test inserts the
// four title shapes that distinguish the buggy from fixed regex.
describe("linearVelocity · ai-linked PR join (word-boundary regex)", () => {
  it("matches only PR titles where the ticket id sits on a word boundary", async () => {
    const pool = await resetDb();
    const t = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','Team T') RETURNING id");
    const teamId: string = t.rows[0].id;

    // Pick a Monday + week window. Issue completed mid-week; PRs merged the
    // same day so all four count in the current-week aggregation.
    const weekMonday = "2026-06-22";
    const completed = "2026-06-23T10:00:00Z";
    const merged = "2026-06-23T11:00:00Z";

    await pool.query(
      `INSERT INTO linear_issues
        (team_id, identifier, title, state_name, state_type, linear_team_key,
         created_at, started_at, completed_at)
       VALUES ($1, 'KIP-315', 'Fix the bug', 'Done', 'completed', 'KIP',
         '2026-06-22T09:00:00Z', '2026-06-22T10:00:00Z', $2)`,
      [teamId, completed],
    );

    type Title = { title: string; expectLinked: boolean };
    const titles: Title[] = [
      { title: "XKIP-315 unrelated work", expectLinked: false }, // bug trigger — fix must reject
      { title: "fix KIP-315 bug", expectLinked: true }, // mid-string match
      { title: "(KIP-315) refactor", expectLinked: true }, // paren is a word boundary
      { title: "KIP-315: handle empty", expectLinked: true }, // start-of-string boundary
    ];
    let prNumber = 1;
    for (const t of titles) {
      await pool.query(
        `INSERT INTO github_pull_requests
          (team_id, repo, number, title, state, created_at, merged_at, ai_assisted)
         VALUES ($1, 'acme/app', $2, $3, 'merged', '2026-06-23T09:00:00Z', $4, true)`,
        [teamId, prNumber++, t.title, merged],
      );
    }

    const integ = {
      provider: "linear",
      config: { team_keys: ["KIP"] },
      last_sync_at: "2026-06-23T12:00:00Z",
    };
    const result = await linearVelocity(teamId, { kind: "team-wide" }, weekMonday, pool, [integ]);

    expect(result).not.toBeNull();
    expect(result!.week.completed).toBe(1);
    const expectedLinked = titles.filter((x) => x.expectLinked).length;
    // Postgres only counts the issue once; ai_linked is "any matching PR exists".
    // Three valid titles point at the same issue → ai_linked count stays 1, not 3.
    expect(result!.week.ai_linked).toBe(1);

    // Drop the three matching PRs; only `XKIP-315` remains. With the fix in
    // place, the issue should now be NOT ai-linked. Without the fix (no `\m`),
    // the XKIP-315 title would still match KIP-315 and the count would stay 1.
    await pool.query(
      `DELETE FROM github_pull_requests
       WHERE team_id = $1 AND title <> 'XKIP-315 unrelated work'`,
      [teamId],
    );
    const after = await linearVelocity(teamId, { kind: "team-wide" }, weekMonday, pool, [integ]);
    expect(after).not.toBeNull();
    expect(after!.week.completed).toBe(1);
    expect(after!.week.ai_linked).toBe(0); // ← the bug: would be 1 without `\m`
    expect(expectedLinked).toBe(3); // sanity: matrix shape
  });
});
