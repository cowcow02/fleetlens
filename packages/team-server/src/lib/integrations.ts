import type pg from "pg";
import { encryptAesGcm, decryptAesGcm } from "./crypto";
import { assertRepoAccess, fetchRepoPulls, validateGithubToken } from "./github";

// A repo and which groups it counts toward in the insight report.
// Empty group_ids = counts toward every group (the safe default).
export type GithubRepoMapping = { name: string; group_ids: string[] };

export type GithubIntegrationConfig = {
  repos: GithubRepoMapping[];
  sync_days: number;
  // Login the token authenticated as at save time — display only.
  login?: string;
};

// Accepts the legacy shape (plain "owner/name" strings) and anything a client
// sends; always returns clean mappings.
export function normalizeGithubRepos(raw: unknown): GithubRepoMapping[] {
  if (!Array.isArray(raw)) return [];
  const out: GithubRepoMapping[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      if (item.trim()) out.push({ name: item.trim(), group_ids: [] });
    } else if (item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string") {
      const it = item as { name: string; group_ids?: unknown };
      out.push({
        name: it.name.trim(),
        group_ids: Array.isArray(it.group_ids) ? it.group_ids.filter((g): g is string => typeof g === "string") : [],
      });
    }
  }
  return out.filter((r) => r.name);
}

export type IntegrationRow = {
  provider: string;
  config: GithubIntegrationConfig;
  status: "active" | "error";
  last_error: string | null;
  last_sync_at: string | null;
  created_at: string;
};

function encryptionKey(): string {
  const key = process.env.FLEETLENS_ENCRYPTION_KEY;
  if (!key) throw new Error("FLEETLENS_ENCRYPTION_KEY env var must be set to store integration credentials at rest");
  return key;
}

export async function getIntegration(
  teamId: string,
  provider: string,
  pool: pg.Pool,
): Promise<IntegrationRow | null> {
  const res = await pool.query(
    `SELECT provider, config, status, last_error, last_sync_at::text, created_at::text
     FROM team_integrations WHERE team_id = $1 AND provider = $2`,
    [teamId, provider],
  );
  return (res.rows[0] as IntegrationRow | undefined) ?? null;
}

/** Decrypted token of an existing integration, or null when not connected. */
export async function storedGithubToken(teamId: string, pool: pg.Pool): Promise<string | null> {
  const res = await pool.query(
    "SELECT credentials_enc FROM team_integrations WHERE team_id = $1 AND provider = 'github'",
    [teamId],
  );
  if (!res.rowCount) return null;
  return decryptAesGcm(res.rows[0].credentials_enc, encryptionKey());
}

/** Connect or reconfigure. `token` null = keep the stored token (mapping-only
 *  edits and adding repos don't force the admin to re-paste credentials). */
export async function saveGithubIntegration(
  teamId: string,
  token: string | null,
  repos: GithubRepoMapping[],
  createdBy: string,
  pool: pg.Pool,
): Promise<{ login: string }> {
  const key = encryptionKey();
  const effectiveToken = token ?? (await storedGithubToken(teamId, pool));
  if (!effectiveToken) throw new Error("GitHub token required — no stored credentials to reuse");
  const { login } = await validateGithubToken(effectiveToken);
  await assertRepoAccess(effectiveToken, repos.map((r) => r.name));
  const config: GithubIntegrationConfig = { repos, sync_days: 60, login };
  await pool.query(
    `INSERT INTO team_integrations (team_id, provider, credentials_enc, config, status, last_error, created_by)
     VALUES ($1, 'github', $2, $3, 'active', NULL, $4)
     ON CONFLICT (team_id, provider)
     DO UPDATE SET credentials_enc = $2, config = $3, status = 'active', last_error = NULL, created_by = $4`,
    [teamId, encryptAesGcm(effectiveToken, key), JSON.stringify(config), createdBy],
  );
  return { login };
}

export async function deleteIntegration(teamId: string, provider: string, pool: pg.Pool): Promise<void> {
  await pool.query("DELETE FROM team_integrations WHERE team_id = $1 AND provider = $2", [teamId, provider]);
}

export type GithubSyncSummary = {
  repos: number;
  prs: number;
  aiAssisted: number;
};

export async function runGithubSync(teamId: string, pool: pg.Pool): Promise<GithubSyncSummary> {
  const res = await pool.query(
    "SELECT credentials_enc, config FROM team_integrations WHERE team_id = $1 AND provider = 'github'",
    [teamId],
  );
  if (!res.rowCount) throw new Error("GitHub integration not configured");
  const config = res.rows[0].config as GithubIntegrationConfig;
  const token = decryptAesGcm(res.rows[0].credentials_enc, encryptionKey());

  try {
    let prs = 0;
    let aiAssisted = 0;
    for (const { name: repo } of normalizeGithubRepos(config.repos)) {
      const rows = await fetchRepoPulls(token, repo, config.sync_days ?? 60);
      for (const r of rows) {
        await pool.query(
          `INSERT INTO github_pull_requests (
             team_id, repo, number, title, author_login, state,
             created_at, merged_at, closed_at, first_commit_at, first_review_at,
             additions, deletions, commits_total, commits_ai, ai_assisted, synced_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
           ON CONFLICT (team_id, repo, number) DO UPDATE SET
             title = $4, author_login = $5, state = $6,
             created_at = $7, merged_at = $8, closed_at = $9,
             first_commit_at = $10, first_review_at = $11,
             additions = $12, deletions = $13,
             commits_total = $14, commits_ai = $15, ai_assisted = $16,
             synced_at = now()`,
          [
            teamId, repo, r.number, r.title, r.authorLogin, r.state,
            r.createdAt, r.mergedAt, r.closedAt, r.firstCommitAt, r.firstReviewAt,
            r.additions, r.deletions, r.commitsTotal, r.commitsAi, r.aiAssisted,
          ],
        );
      }
      prs += rows.length;
      aiAssisted += rows.filter((r) => r.aiAssisted).length;
    }
    await pool.query(
      `UPDATE team_integrations SET status = 'active', last_error = NULL, last_sync_at = now()
       WHERE team_id = $1 AND provider = 'github'`,
      [teamId],
    );
    return { repos: config.repos.length, prs, aiAssisted };
  } catch (err) {
    await pool.query(
      `UPDATE team_integrations SET status = 'error', last_error = $2 WHERE team_id = $1 AND provider = 'github'`,
      [teamId, (err as Error).message],
    );
    throw err;
  }
}

/** Hourly scheduler entry: sync every team with an active github integration. */
export async function syncAllGithubIntegrations(pool: pg.Pool): Promise<void> {
  const res = await pool.query(
    "SELECT team_id FROM team_integrations WHERE provider = 'github' AND status = 'active'",
  );
  for (const row of res.rows) {
    try {
      await runGithubSync(row.team_id, pool);
    } catch (err) {
      // Row is already marked status='error'; keep going for other teams.
      console.error(`[integrations] github sync failed for team ${row.team_id}: ${(err as Error).message}`);
    }
  }
}
