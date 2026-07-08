import type pg from "pg";
import { encryptAesGcm, decryptAesGcm } from "./crypto";
import { assertRepoAccess, fetchRepoPulls, validateGithubToken } from "./github";
import { fetchLinearIssues, validateLinearKey } from "./linear";
import { fetchJiraIssues, normalizeSite, validateJiraCredentials, isSafeProjectKey, DEFAULT_STORY_POINTS_FIELD } from "./jira";

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
  id: string;
  provider: string;
  label: string;
  // NULL = org-level (admin-managed); set = owned by that group, manageable
  // by its managers.
  owner_group_id: string | null;
  // Provider-shaped jsonb — narrow with normalizeGithubRepos /
  // normalizeLinearTeams / normalizeJiraProjects rather than trusting the
  // stored shape.
  config: {
    login?: string; repos?: unknown; teams?: unknown; team_keys?: unknown; sync_days?: number;
    site?: string; email?: string; projects?: unknown; story_points_field?: string;
  };
  status: "active" | "error";
  last_error: string | null;
  last_sync_at: string | null;
  created_at: string;
};

const ROW_COLUMNS =
  "id, provider, label, owner_group_id, config, status, last_error, last_sync_at::text, created_at::text";

function encryptionKey(): string {
  const key = process.env.FLEETLENS_ENCRYPTION_KEY;
  if (!key) throw new Error("FLEETLENS_ENCRYPTION_KEY env var must be set to store integration credentials at rest");
  return key;
}

/** Friendly message for the (team_id, provider, label) unique index. */
function rethrowDuplicateLabel(err: unknown, label: string): never {
  if ((err as { code?: string }).code === "23505" && (err as { constraint?: string }).constraint === "integrations_team_provider_label_key") {
    throw new Error(`An integration named "${label}" already exists for this provider — pick a different label`);
  }
  throw err;
}

export async function listIntegrations(
  teamId: string,
  pool: pg.Pool,
  provider?: string,
): Promise<IntegrationRow[]> {
  const res = provider
    ? await pool.query(
        `SELECT ${ROW_COLUMNS} FROM integrations WHERE team_id = $1 AND provider = $2 ORDER BY created_at, id`,
        [teamId, provider],
      )
    : await pool.query(
        `SELECT ${ROW_COLUMNS} FROM integrations WHERE team_id = $1 ORDER BY provider, created_at, id`,
        [teamId],
      );
  return res.rows as IntegrationRow[];
}

export async function getIntegrationById(
  teamId: string,
  integrationId: string,
  pool: pg.Pool,
): Promise<IntegrationRow | null> {
  const res = await pool.query(
    `SELECT ${ROW_COLUMNS} FROM integrations WHERE team_id = $1 AND id = $2`,
    [teamId, integrationId],
  );
  return (res.rows[0] as IntegrationRow | undefined) ?? null;
}

/** Decrypted credential blob of an existing integration, or null. */
async function storedCredential(integrationId: string, pool: pg.Pool): Promise<string | null> {
  const res = await pool.query("SELECT credentials_enc FROM integrations WHERE id = $1", [integrationId]);
  if (!res.rowCount) return null;
  return decryptAesGcm(res.rows[0].credentials_enc, encryptionKey());
}

export const storedGithubToken = storedCredential;
export const storedLinearKey = storedCredential;
export const storedJiraToken = storedCredential;

export type SaveIntegrationBase = {
  teamId: string;
  // null = connect a new integration; set = reconfigure that one.
  id: string | null;
  label: string;
  // Only applied on create — ownership is fixed for the integration's life.
  ownerGroupId: string | null;
  createdBy: string;
};

async function insertIntegration(
  opts: SaveIntegrationBase,
  provider: string,
  credentialEnc: string,
  config: unknown,
  pool: pg.Pool,
): Promise<string> {
  try {
    const res = await pool.query(
      `INSERT INTO integrations (team_id, provider, label, owner_group_id, credentials_enc, config, status, last_error, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', NULL, $7) RETURNING id`,
      [opts.teamId, provider, opts.label, opts.ownerGroupId, credentialEnc, JSON.stringify(config), opts.createdBy],
    );
    return res.rows[0].id as string;
  } catch (err) {
    rethrowDuplicateLabel(err, opts.label);
  }
}

async function updateIntegration(
  opts: SaveIntegrationBase & { id: string },
  credentialEnc: string,
  config: unknown,
  pool: pg.Pool,
): Promise<void> {
  try {
    const res = await pool.query(
      `UPDATE integrations SET label = $3, credentials_enc = $4, config = $5, status = 'active', last_error = NULL
       WHERE team_id = $1 AND id = $2`,
      [opts.teamId, opts.id, opts.label, credentialEnc, JSON.stringify(config)],
    );
    if (!res.rowCount) throw new Error("Integration not found");
  } catch (err) {
    rethrowDuplicateLabel(err, opts.label);
  }
}

/** Connect or reconfigure. `token` null = keep the stored token (mapping-only
 *  edits and adding repos don't force the caller to re-paste credentials). */
export async function saveGithubIntegration(
  opts: SaveIntegrationBase & { token: string | null; repos: GithubRepoMapping[] },
  pool: pg.Pool,
): Promise<{ id: string; login: string }> {
  const key = encryptionKey();
  const effectiveToken = opts.token ?? (opts.id ? await storedCredential(opts.id, pool) : null);
  if (!effectiveToken) throw new Error("GitHub token required — no stored credentials to reuse");
  const { login } = await validateGithubToken(effectiveToken);
  await assertRepoAccess(effectiveToken, opts.repos.map((r) => r.name));
  const config: GithubIntegrationConfig = { repos: opts.repos, sync_days: 60, login };
  const enc = encryptAesGcm(effectiveToken, key);
  const id = opts.id
    ? (await updateIntegration({ ...opts, id: opts.id }, enc, config, pool), opts.id)
    : await insertIntegration(opts, "github", enc, config, pool);
  return { id, login };
}

/** Does this source's mapping count toward the given group? Empty = all groups. */
export function countsTowardGroup(groupIds: string[], groupId: string): boolean {
  return groupIds.length === 0 || groupIds.includes(groupId);
}

// Non-admin managers may edit an integration's source LIST but never the
// cross-group attribution: stored group_ids win for existing sources, and new
// sources count toward the owner group only. Without this, a manager could
// PUT group_ids for groups they don't manage (or [] = every group) through
// the provider routes, bypassing the group route's applyDesired invariants.
export function preserveGroupMappings<T extends { group_ids: string[] }>(
  entries: T[],
  stored: T[],
  keyOf: (e: T) => string,
  ownerGroupId: string,
): T[] {
  const storedByKey = new Map(stored.map((s) => [keyOf(s), s.group_ids]));
  return entries.map((e) => ({ ...e, group_ids: storedByKey.get(keyOf(e)) ?? [ownerGroupId] }));
}

export async function deleteIntegration(teamId: string, integrationId: string, pool: pg.Pool): Promise<void> {
  // Fact rows carry last-writer-wins provenance, so a shared source's rows may
  // point at the integration being deleted even though another integration
  // still tracks it. Reassign those to a survivor before the FK cascade so the
  // other integration's report doesn't gap until its next hourly sync.
  const integ = await getIntegrationById(teamId, integrationId, pool);
  if (!integ) return;
  const survivors = (await listIntegrations(teamId, pool, integ.provider)).filter((i) => i.id !== integrationId);
  const reassign: Record<string, { table: string; column: string; keys: (i: IntegrationRow) => string[] }> = {
    github: { table: "github_pull_requests", column: "repo", keys: (i) => normalizeGithubRepos(i.config.repos).map((r) => r.name) },
    linear: { table: "linear_issues", column: "linear_team_key", keys: (i) => normalizeLinearTeams(i.config).map((t) => t.key) },
    jira: { table: "jira_issues", column: "jira_project_key", keys: (i) => normalizeJiraProjects(i.config).map((p) => p.key) },
  };
  const { table, column, keys } = reassign[integ.provider];
  for (const survivor of survivors) {
    const names = keys(survivor);
    if (names.length === 0) continue;
    await pool.query(
      `UPDATE ${table} SET integration_id = $1 WHERE team_id = $2 AND integration_id = $3 AND ${column} = ANY($4::text[])`,
      [survivor.id, teamId, integrationId, names],
    );
  }
  await pool.query("DELETE FROM integrations WHERE team_id = $1 AND id = $2", [teamId, integrationId]);
}

export type GithubSyncSummary = {
  repos: number;
  prs: number;
  aiAssisted: number;
};

async function loadForSync(
  integrationId: string,
  provider: string,
  pool: pg.Pool,
): Promise<{ teamId: string; credential: string; config: IntegrationRow["config"] }> {
  const res = await pool.query(
    "SELECT team_id, credentials_enc, config FROM integrations WHERE id = $1 AND provider = $2",
    [integrationId, provider],
  );
  if (!res.rowCount) throw new Error(`${provider} integration not configured`);
  return {
    teamId: res.rows[0].team_id,
    credential: decryptAesGcm(res.rows[0].credentials_enc, encryptionKey()),
    config: res.rows[0].config,
  };
}

async function markSyncOutcome(integrationId: string, err: Error | null, pool: pg.Pool): Promise<void> {
  if (err) {
    await pool.query(
      "UPDATE integrations SET status = 'error', last_error = $2 WHERE id = $1",
      [integrationId, err.message.slice(0, 500)],
    );
  } else {
    await pool.query(
      "UPDATE integrations SET status = 'active', last_error = NULL, last_sync_at = now() WHERE id = $1",
      [integrationId],
    );
  }
}

export async function runGithubSync(integrationId: string, pool: pg.Pool): Promise<GithubSyncSummary> {
  const { teamId, credential: token, config } = await loadForSync(integrationId, "github", pool);
  const cfg = config as GithubIntegrationConfig;

  try {
    let prs = 0;
    let aiAssisted = 0;
    for (const { name: repo } of normalizeGithubRepos(cfg.repos)) {
      const rows = await fetchRepoPulls(token, repo, cfg.sync_days ?? 60);
      for (const r of rows) {
        await pool.query(
          `INSERT INTO github_pull_requests (
             team_id, repo, number, title, author_login, state,
             created_at, merged_at, closed_at, first_commit_at, first_review_at,
             additions, deletions, commits_total, commits_ai, ai_assisted, integration_id, synced_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now())
           ON CONFLICT (team_id, repo, number) DO UPDATE SET
             title = $4, author_login = $5, state = $6,
             created_at = $7, merged_at = $8, closed_at = $9,
             first_commit_at = $10, first_review_at = $11,
             additions = $12, deletions = $13,
             commits_total = $14, commits_ai = $15, ai_assisted = $16,
             integration_id = $17,
             synced_at = now()`,
          [
            teamId, repo, r.number, r.title, r.authorLogin, r.state,
            r.createdAt, r.mergedAt, r.closedAt, r.firstCommitAt, r.firstReviewAt,
            r.additions, r.deletions, r.commitsTotal, r.commitsAi, r.aiAssisted, integrationId,
          ],
        );
      }
      prs += rows.length;
      aiAssisted += rows.filter((r) => r.aiAssisted).length;
    }
    await markSyncOutcome(integrationId, null, pool);
    return { repos: normalizeGithubRepos(cfg.repos).length, prs, aiAssisted };
  } catch (err) {
    await markSyncOutcome(integrationId, err as Error, pool);
    throw err;
  }
}

// ── Linear ────────────────────────────────────────────────────────────────

// A Linear team and which groups it counts toward in the insight report.
// Empty group_ids = counts toward every group (same semantics as repos).
export type LinearTeamMapping = { key: string; group_ids: string[] };

export type LinearIntegrationConfig = {
  teams: LinearTeamMapping[];
  sync_days: number;
  login?: string; // viewer name at save time — display only
  // Legacy shape (pre-mapping connects): plain team keys.
  team_keys?: string[];
};

export function normalizeLinearTeams(config: { teams?: unknown; team_keys?: unknown }): LinearTeamMapping[] {
  if (Array.isArray(config.teams)) {
    return config.teams
      .filter((t): t is { key: string; group_ids?: unknown } => !!t && typeof (t as { key?: unknown }).key === "string")
      .map((t) => ({
        key: t.key.trim(),
        group_ids: Array.isArray(t.group_ids) ? t.group_ids.filter((g): g is string => typeof g === "string") : [],
      }))
      .filter((t) => t.key);
  }
  if (Array.isArray(config.team_keys)) {
    return config.team_keys
      .filter((k): k is string => typeof k === "string" && !!k.trim())
      .map((k) => ({ key: k.trim(), group_ids: [] }));
  }
  return [];
}

export async function saveLinearIntegration(
  opts: SaveIntegrationBase & { apiKey: string | null; teams: LinearTeamMapping[] },
  pool: pg.Pool,
): Promise<{ id: string; login: string }> {
  const key = encryptionKey();
  const effective = opts.apiKey ?? (opts.id ? await storedCredential(opts.id, pool) : null);
  if (!effective) throw new Error("Linear API key required — no stored credentials to reuse");
  const viewer = await validateLinearKey(effective);
  const config: LinearIntegrationConfig = { teams: opts.teams, sync_days: 60, login: viewer.name };
  const enc = encryptAesGcm(effective, key);
  const id = opts.id
    ? (await updateIntegration({ ...opts, id: opts.id }, enc, config, pool), opts.id)
    : await insertIntegration(opts, "linear", enc, config, pool);
  return { id, login: viewer.name };
}

export type LinearSyncSummary = { issues: number; completed: number };

export async function runLinearSync(integrationId: string, pool: pg.Pool): Promise<LinearSyncSummary> {
  const { teamId, credential: apiKey, config } = await loadForSync(integrationId, "linear", pool);
  const cfg = config as LinearIntegrationConfig;

  try {
    const rows = await fetchLinearIssues(
      apiKey,
      normalizeLinearTeams(cfg).map((t) => t.key),
      cfg.sync_days ?? 60,
    );
    for (const r of rows) {
      await pool.query(
        `INSERT INTO linear_issues (
           team_id, identifier, title, state_name, state_type, linear_team_key,
           assignee, estimate, url, created_at, started_at, completed_at, canceled_at, integration_id, synced_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
         ON CONFLICT (team_id, identifier) DO UPDATE SET
           title = $3, state_name = $4, state_type = $5, linear_team_key = $6,
           assignee = $7, estimate = $8, url = $9,
           created_at = $10, started_at = $11, completed_at = $12, canceled_at = $13,
           integration_id = $14,
           synced_at = now()`,
        [
          teamId, r.identifier, r.title, r.stateName, r.stateType, r.linearTeamKey,
          r.assignee, r.estimate, r.url, r.createdAt, r.startedAt, r.completedAt, r.canceledAt, integrationId,
        ],
      );
    }
    await markSyncOutcome(integrationId, null, pool);
    return { issues: rows.length, completed: rows.filter((r) => r.stateType === "completed").length };
  } catch (err) {
    await markSyncOutcome(integrationId, err as Error, pool);
    throw err;
  }
}

// ── Jira ────────────────────────────────────────────────────────────────────

// A Jira project and which groups it counts toward in the insight report.
// Empty group_ids = counts toward every group (same semantics as repos/teams).
export type JiraProjectMapping = { key: string; group_ids: string[] };

export type JiraIntegrationConfig = {
  site: string; // https origin, e.g. https://acme.atlassian.net
  email: string; // account email for Basic auth (the api_token is the secret)
  projects: JiraProjectMapping[];
  sync_days: number;
  story_points_field?: string; // defaults to customfield_10016
  login?: string; // viewer display name at save time — display only
  // Legacy shape parity with Linear: plain project keys.
  project_keys?: string[];
};

export function normalizeJiraProjects(config: { projects?: unknown; project_keys?: unknown }): JiraProjectMapping[] {
  // Project keys are interpolated into JQL downstream — drop any that aren't
  // JQL-safe here so a malformed/injected key can never be stored or queried.
  if (Array.isArray(config.projects)) {
    return config.projects
      .filter((p): p is { key: string; group_ids?: unknown } => !!p && typeof (p as { key?: unknown }).key === "string")
      .map((p) => ({
        key: p.key.trim(),
        group_ids: Array.isArray(p.group_ids) ? p.group_ids.filter((g): g is string => typeof g === "string") : [],
      }))
      .filter((p) => isSafeProjectKey(p.key));
  }
  if (Array.isArray(config.project_keys)) {
    return config.project_keys
      .filter((k): k is string => typeof k === "string" && !!k.trim())
      .map((k) => ({ key: k.trim(), group_ids: [] }))
      .filter((p) => isSafeProjectKey(p.key));
  }
  return [];
}

/** Site+email needed alongside the token for Basic auth — read from config. */
export async function storedJiraConnection(
  integrationId: string,
  pool: pg.Pool,
): Promise<{ site: string; email: string } | null> {
  const res = await pool.query(
    "SELECT config FROM integrations WHERE id = $1 AND provider = 'jira'",
    [integrationId],
  );
  if (!res.rowCount) return null;
  const config = res.rows[0].config as JiraIntegrationConfig;
  if (!config.site || !config.email) return null;
  return { site: config.site, email: config.email };
}

/** Connect or reconfigure. `token` null = keep the stored token (mapping-only
 *  edits and adding projects don't force the caller to re-paste credentials). */
export async function saveJiraIntegration(
  opts: SaveIntegrationBase & {
    site: string | null;
    email: string | null;
    token: string | null;
    projects: JiraProjectMapping[];
  },
  pool: pg.Pool,
): Promise<{ id: string; login: string }> {
  const key = encryptionKey();
  const stored = opts.id ? await storedJiraConnection(opts.id, pool) : null;
  const effSite = opts.site ? normalizeSite(opts.site) : stored?.site;
  const effEmail = opts.email ?? stored?.email;
  const effToken = opts.token ?? (opts.id ? await storedCredential(opts.id, pool) : null);
  if (!effSite || !effEmail) throw new Error("Jira site and email are required");
  if (!effToken) throw new Error("Jira API token required — no stored credentials to reuse");
  const viewer = await validateJiraCredentials(effSite, effEmail, effToken);
  // Defence in depth: never persist a key that isn't JQL-safe, even if a
  // caller skipped normalizeJiraProjects. Reads + the query path filter too.
  const safeProjects = opts.projects.filter((p) => isSafeProjectKey(p.key));
  const config: JiraIntegrationConfig = {
    site: effSite, email: effEmail, projects: safeProjects, sync_days: 60,
    story_points_field: DEFAULT_STORY_POINTS_FIELD, login: viewer.name,
  };
  const enc = encryptAesGcm(effToken, key);
  const id = opts.id
    ? (await updateIntegration({ ...opts, id: opts.id }, enc, config, pool), opts.id)
    : await insertIntegration(opts, "jira", enc, config, pool);
  return { id, login: viewer.name };
}

export type JiraSyncSummary = { issues: number; completed: number };

export async function runJiraSync(integrationId: string, pool: pg.Pool): Promise<JiraSyncSummary> {
  const { teamId, credential: token, config } = await loadForSync(integrationId, "jira", pool);
  const cfg = config as JiraIntegrationConfig;

  try {
    const rows = await fetchJiraIssues(
      cfg.site,
      cfg.email,
      token,
      normalizeJiraProjects(cfg).map((p) => p.key),
      cfg.sync_days ?? 60,
      cfg.story_points_field ?? DEFAULT_STORY_POINTS_FIELD,
    );
    for (const r of rows) {
      await pool.query(
        `INSERT INTO jira_issues (
           team_id, identifier, title, state_name, state_type, jira_project_key,
           assignee, estimate, url, created_at, started_at, completed_at, canceled_at, integration_id, synced_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
         ON CONFLICT (team_id, identifier) DO UPDATE SET
           title = $3, state_name = $4, state_type = $5, jira_project_key = $6,
           assignee = $7, estimate = $8, url = $9,
           created_at = $10, started_at = $11, completed_at = $12, canceled_at = $13,
           integration_id = $14,
           synced_at = now()`,
        [
          teamId, r.identifier, r.title, r.stateName, r.stateType, r.projectKey,
          r.assignee, r.estimate, r.url, r.createdAt, r.startedAt, r.completedAt, r.canceledAt, integrationId,
        ],
      );
    }
    await markSyncOutcome(integrationId, null, pool);
    return { issues: rows.length, completed: rows.filter((r) => r.stateType === "completed").length };
  } catch (err) {
    await markSyncOutcome(integrationId, err as Error, pool);
    throw err;
  }
}

// Re-derive a mapping array from desired per-source booleans for one group.
// Empty group_ids means "all groups", so excluding a source from one group
// expands the default to the remaining groups first.
export function applyDesired<T extends { group_ids: string[] }>(
  entries: T[],
  desired: Map<string, boolean>,
  keyOf: (e: T) => string,
  groupId: string,
  allGroupIds: string[],
): { updated: T[]; error?: string } {
  let orphaned = false;
  const updated = entries.map((e) => {
    const want = desired.get(keyOf(e));
    if (want === undefined) return e;
    const isAll = e.group_ids.length === 0;
    const has = isAll || e.group_ids.includes(groupId);
    if (want === has) return e;
    if (want) {
      const next = [...e.group_ids, groupId];
      return { ...e, group_ids: allGroupIds.every((g) => next.includes(g)) ? [] : next };
    }
    const expanded = isAll ? allGroupIds : e.group_ids;
    const next = expanded.filter((g) => g !== groupId);
    if (next.length === 0) {
      orphaned = true;
      return e;
    }
    return { ...e, group_ids: next };
  });
  if (orphaned) {
    return {
      updated: entries,
      error: "A source must count toward at least one group — remove it from the integration instead of excluding it everywhere.",
    };
  }
  return { updated };
}

/** Provider-dispatched manual sync — routes and the group connect flow call
 *  this so they don't each re-implement the switch. */
export async function runSync(integrationId: string, provider: string, pool: pg.Pool): Promise<GithubSyncSummary | LinearSyncSummary | JiraSyncSummary> {
  if (provider === "github") return runGithubSync(integrationId, pool);
  if (provider === "linear") return runLinearSync(integrationId, pool);
  if (provider === "jira") return runJiraSync(integrationId, pool);
  throw new Error(`Unknown provider: ${provider}`);
}

/** Hourly scheduler entry: sync every active integration, all providers. */
export async function syncAllIntegrations(pool: pg.Pool): Promise<void> {
  const res = await pool.query(
    "SELECT id, provider, team_id FROM integrations WHERE status = 'active'",
  );
  for (const row of res.rows) {
    try {
      await runSync(row.id, row.provider, pool);
    } catch (err) {
      // Row is already marked status='error'; keep going for other teams.
      console.error(`[integrations] ${row.provider} sync failed for team ${row.team_id}: ${(err as Error).message}`);
    }
  }
}
