import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  date,
  integer,
  bigint,
  bigserial,
  jsonb,
  real,
  index,
  uniqueIndex,
  check,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userAccounts = pgTable("user_accounts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  isStaff: boolean("is_staff").notNull().default(false),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  retentionDays: integer("retention_days").notNull().default(365),
  resendApiKeyEnc: text("resend_api_key_enc"),
  customDomain: text("custom_domain"),
  settings: jsonb("settings").notNull().default({}),
  allowedSignupDomains: text("allowed_signup_domains").array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userAccountId: uuid("user_account_id")
      .notNull()
      .references(() => userAccounts.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    bearerTokenHash: text("bearer_token_hash"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    planTier: text("plan_tier").notNull().default("pro-max"),
    // Installed Fleetlens CLI version of this member's daemon, reported on each
    // ingest. Nullable — only populated once a member upgrades to a CLI that
    // sends it; older clients leave it null.
    cliVersion: text("cli_version"),
  },
  (t) => ({
    roleCheck: check("memberships_role_check", sql`${t.role} IN ('admin','member')`),
    planTierCheck: check(
      "memberships_plan_tier_check",
      sql`${t.planTier} IN ('pro','pro-max','pro-max-20x','custom')`,
    ),
    uniqUserTeam: uniqueIndex("memberships_user_account_id_team_id_key").on(t.userAccountId, t.teamId),
    teamActive: index("idx_memberships_team_active").on(t.teamId).where(sql`${t.revokedAt} IS NULL`),
    bearer: index("idx_memberships_bearer").on(t.bearerTokenHash).where(sql`${t.bearerTokenHash} IS NOT NULL`),
  }),
);

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").notNull().references(() => userAccounts.id),
    email: text("email"),
    tokenHash: text("token_hash").notNull().unique(),
    token: text("token"),
    label: text("label"),
    role: text("role").notNull().default("member"),
    groupIds: uuid("group_ids").array().notNull().default(sql`'{}'::uuid[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    roleCheck: check("invites_role_check", sql`${t.role} IN ('admin','member')`),
    activeByConfig: index("idx_invites_active_by_config").on(t.teamId, t.role).where(sql`${t.revokedAt} IS NULL AND ${t.email} IS NULL`),
  }),
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userAccountId: uuid("user_account_id")
      .notNull()
      .references(() => userAccounts.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("idx_sessions_user").on(t.userAccountId),
  }),
);

export const dailyRollups = pgTable(
  "daily_rollups",
  {
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull().references(() => memberships.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    agentTimeMs: bigint("agent_time_ms", { mode: "number" }).notNull().default(0),
    // session-days (counts a cross-midnight session on each touched day)
    sessions: integer("sessions").notNull().default(0),
    // start-day unique count; nullable for rows pushed before the per-day split
    uniqueSessions: integer("unique_sessions"),
    toolCalls: integer("tool_calls").notNull().default(0),
    turns: integer("turns").notNull().default(0),
    tokensInput: bigint("tokens_input", { mode: "number" }).notNull().default(0),
    tokensOutput: bigint("tokens_output", { mode: "number" }).notNull().default(0),
    tokensCacheRead: bigint("tokens_cache_read", { mode: "number" }).notNull().default(0),
    tokensCacheWrite: bigint("tokens_cache_write", { mode: "number" }).notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.teamId, t.membershipId, t.day] }),
    teamDay: index("idx_daily_rollups_team_day").on(t.teamId, sql`${t.day} DESC`),
  }),
);

export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => userAccounts.id),
    action: text("action").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamCreated: index("idx_events_team_created").on(t.teamId, sql`${t.createdAt} DESC`),
  }),
);

export const ingestLog = pgTable(
  "ingest_log",
  {
    ingestId: text("ingest_id").primaryKey(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull().references(() => memberships.id, { onDelete: "cascade" }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    received: index("idx_ingest_log_received").on(t.receivedAt),
  }),
);

// Human-viewable per-push sync log. One row per meaningful ingest (skips the
// pure no-op dedup replays) so admins can see each member's sync history in
// the UI without shelling into container stdout. `accepted` is a string[] of
// block names; `skipped` is a { blockName: reason } map; `status` = 'partial'
// when any block was dropped, else 'ok'. Pruned on a retention window — this
// table is append-only and grows ~1 row/push/member.
export const memberSyncLog = pgTable(
  "member_sync_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull().references(() => memberships.id, { onDelete: "cascade" }),
    ingestId: text("ingest_id").notNull(),
    cliVersion: text("cli_version"),
    accepted: jsonb("accepted").notNull().default([]),
    skipped: jsonb("skipped").notNull().default({}),
    status: text("status").notNull(),
    dedup: boolean("dedup").notNull().default(false),
    histInserted: integer("hist_inserted").notNull().default(0),
    histReceived: integer("hist_received").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    member: index("idx_member_sync_log_member").on(t.membershipId, sql`${t.createdAt} DESC`),
    created: index("idx_member_sync_log_created").on(t.createdAt),
  }),
);

// The member's own daemon sync log, uploaded via the metrics push — the
// client-side troubleshooting story surfaced per-member. Row-level dedup on
// (membership_id, ts, msg).
export const memberDaemonLog = pgTable(
  "member_daemon_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull().references(() => memberships.id, { onDelete: "cascade" }),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    level: text("level").notNull(),
    msg: text("msg").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dedup: uniqueIndex("uq_member_daemon_log_dedup").on(t.membershipId, t.ts, t.msg),
    member: index("idx_member_daemon_log_member").on(t.membershipId, sql`${t.ts} DESC`),
  }),
);

// Durable mirror of the server's own console output so the raw application log
// survives a reboot. `seq` is assigned by the in-memory buffer (log-buffer.ts)
// and flushed here in batches; the viewer hydrates from this on boot.
export const serverLog = pgTable(
  "server_log",
  {
    seq: bigint("seq", { mode: "number" }).primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    level: text("level").notNull(),
    msg: text("msg").notNull(),
  },
  (t) => ({
    ts: index("idx_server_log_ts").on(sql`${t.ts} DESC`),
  }),
);

export const serverConfig = pgTable("server_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const updateCheckCache = pgTable("update_check_cache", {
  key: text("key").primaryKey(),
  currentVersion: text("current_version"),
  latestVersion: text("latest_version"),
  updateAvailable: boolean("update_available").notNull().default(false),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull().defaultNow(),
  lastUpdateAttempt: jsonb("last_update_attempt"),
});

export const membershipCyclePeaks = pgTable(
  "membership_cycle_peaks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    // '5h' or '7d'. Constraint enforced at SQL level.
    window: text("window").notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    peakPct: real("peak_pct").notNull(),
    // 'real' = daemon observed the cycle; 'predicted' = JSONL-derived estimate
    // (cold-start path). Constraint enforced at SQL level.
    source: text("source").notNull(),
    isCurrent: boolean("is_current").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("membership_cycle_peaks_pk").on(
      t.teamId,
      t.membershipId,
      t.window,
      t.endsAt,
    ),
    teamWindow: index("idx_membership_cycle_peaks_team_window").on(
      t.teamId,
      t.window,
      sql`${t.endsAt} DESC`,
    ),
  }),
);

export const planUtilization = pgTable(
  "plan_utilization",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    fiveHourUtilization: real("five_hour_utilization"),
    fiveHourResetsAt: timestamp("five_hour_resets_at", { withTimezone: true }),
    sevenDayUtilization: real("seven_day_utilization"),
    sevenDayResetsAt: timestamp("seven_day_resets_at", { withTimezone: true }),
    sevenDayOpusUtilization: real("seven_day_opus_utilization"),
    sevenDaySonnetUtilization: real("seven_day_sonnet_utilization"),
    sevenDayOauthAppsUtilization: real("seven_day_oauth_apps_utilization"),
    sevenDayCoworkUtilization: real("seven_day_cowork_utilization"),
    extraUsageEnabled: boolean("extra_usage_enabled").notNull().default(false),
    extraUsageMonthlyLimitUsd: real("extra_usage_monthly_limit_usd"),
    extraUsageUsedCreditsUsd: real("extra_usage_used_credits_usd"),
    extraUsageUtilization: real("extra_usage_utilization"),
  },
  (t) => ({
    uniqSnapshot: uniqueIndex("plan_utilization_snapshot_key").on(
      t.teamId,
      t.membershipId,
      t.capturedAt,
    ),
    teamCaptured: index("idx_plan_utilization_team_captured").on(
      t.teamId,
      sql`${t.capturedAt} DESC`,
    ),
    teamMemberCaptured: index("idx_plan_utilization_team_member_captured").on(
      t.teamId,
      t.membershipId,
      sql`${t.capturedAt} DESC`,
    ),
  }),
);

export const richDailyRollups = pgTable(
  "rich_daily_rollups",
  {
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull().references(() => memberships.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    agentTimeMs: bigint("agent_time_ms", { mode: "number" }).notNull().default(0),
    // session-days; uniqueSessions is the start-day count (see daily_rollups)
    sessions: integer("sessions").notNull().default(0),
    uniqueSessions: integer("unique_sessions"),
    prs: integer("prs").notNull().default(0),
    commits: integer("commits").notNull().default(0),
    pushes: integer("pushes").notNull().default(0),
    concurrencyPeak: integer("concurrency_peak").notNull().default(0),
    parallelMinutes: integer("parallel_minutes").notNull().default(0),
    longAutoCount: integer("long_auto_count").notNull().default(0),
    longAutoTotalMin: integer("long_auto_total_min").notNull().default(0),
    longAutoMaxSingleMin: integer("long_auto_max_single_min").notNull().default(0),
    toolErrors: integer("tool_errors").notNull().default(0),
    brainstormWarmupSessions: integer("brainstorm_warmup_sessions").notNull().default(0),
    planModeUsed: integer("plan_mode_used").notNull().default(0),
    projects: jsonb("projects").notNull().default([]),
    workingShapes: jsonb("working_shapes").notNull().default([]),
    skillsLoaded: jsonb("skills_loaded").notNull().default([]),
    subagentsDispatched: jsonb("subagents_dispatched").notNull().default([]),
    outcomeMix: jsonb("outcome_mix"),
    helpfulnessMix: jsonb("helpfulness_mix"),
    goalMix: jsonb("goal_mix"),
    tokensInput: bigint("tokens_input", { mode: "number" }).notNull().default(0),
    tokensOutput: bigint("tokens_output", { mode: "number" }).notNull().default(0),
    tokensCacheRead: bigint("tokens_cache_read", { mode: "number" }).notNull().default(0),
    tokensCacheWrite: bigint("tokens_cache_write", { mode: "number" }).notNull().default(0),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.teamId, t.membershipId, t.day] }),
    teamDay: index("idx_rich_daily_rollups_team_day").on(t.teamId, sql`${t.day} DESC`),
  }),
);

// Per-member, per-day artifact-authoring signals shipped from the personal
// edition's file-system probe. Captures the "builds" path of the L4 maturity
// classifier without ever shipping file contents — only opaque path hashes
// (SHA-256 of the path relative to the .claude root) and line deltas.
export const dayArtifactSignals = pgTable(
  "day_artifact_signals",
  {
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull().references(() => memberships.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    // [{ path_hash, first_seen_date }, ...]
    skillsAuthored: jsonb("skills_authored").notNull().default([]),
    // [{ path_hash, line_delta }, ...]
    skillsEdited: jsonb("skills_edited").notNull().default([]),
    // [{ name_hash, first_seen_date }, ...]
    subagentsAuthored: jsonb("subagents_authored").notNull().default([]),
    // [{ name_hash, first_seen_date }, ...]
    slashCommandsAuthored: jsonb("slash_commands_authored").notNull().default([]),
    // Net line delta to CLAUDE.md attributed to this member on this day.
    claudemdLineDelta: integer("claudemd_line_delta").notNull().default(0),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.teamId, t.membershipId, t.day] }),
    teamDay: index("idx_day_artifact_signals_team_day").on(t.teamId, sql`${t.day} DESC`),
  }),
);

// Server-side reconciliation of team-wide artifact authorship. Populated by
// the ingest pipeline whenever new dayArtifactSignals arrive. Originator is
// "first member observed publishing this path_hash" and is monotonic — once
// claimed, it stays claimed (handles late-arriving daemons gracefully).
export const teamSkillCatalog = pgTable(
  "team_skill_catalog",
  {
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    pathHash: text("path_hash").notNull(),
    kind: text("kind").notNull(), // 'skill' | 'subagent' | 'slash-command'
    originatorMembershipId: uuid("originator_membership_id")
      .references(() => memberships.id, { onDelete: "set null" }),
    originatorFirstSeen: date("originator_first_seen"),
    adopterMembershipIds: uuid("adopter_membership_ids").array().notNull().default(sql`'{}'::uuid[]`),
    loadsTotal: integer("loads_total").notNull().default(0),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.teamId, t.pathHash] }),
    teamKind: index("idx_team_skill_catalog_team_kind").on(t.teamId, t.kind),
    kindCheck: check(
      "team_skill_catalog_kind_check",
      sql`${t.kind} IN ('skill', 'subagent', 'slash-command')`,
    ),
  }),
);

export const groups = pgTable(
  "groups",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamSlug: uniqueIndex("groups_team_slug_key").on(t.teamId, t.slug),
  }),
);

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull().references(() => memberships.id, { onDelete: "cascade" }),
    isManager: boolean("is_manager").notNull().default(false),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    addedBy: uuid("added_by").references(() => userAccounts.id, { onDelete: "set null" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.groupId, t.membershipId] }),
    byMembership: index("idx_group_members_membership").on(t.membershipId),
    managers: index("idx_group_members_managers").on(t.groupId).where(sql`${t.isManager} = true`),
  }),
);

export const memberCommands = pgTable(
  "member_commands",
  {
    id: text("id").primaryKey(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull().references(() => memberships.id, { onDelete: "cascade" }),
    commandType: text("command_type").notNull(),
    params: jsonb("params").notNull().default(sql`'{}'::jsonb`),
    issuedById: uuid("issued_by_id").notNull().references(() => userAccounts.id),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    result: jsonb("result"),
  },
  (t) => ({
    pendingIdx: index("idx_member_commands_pending")
      .on(t.membershipId, t.completedAt)
      .where(sql`${t.completedAt} IS NULL`),
    teamRecentIdx: index("idx_member_commands_team_recent")
      .on(t.teamId, sql`${t.issuedAt} DESC`),
  }),
);

// External-system integrations, one row per (team, provider). Credentials are
// AES-256-GCM blobs under FLEETLENS_ENCRYPTION_KEY (same scheme as the Resend
// key) — never stored or returned in plaintext. `config` is provider-shaped:
// github → { repos: ["owner/name", …], sync_days: 60 }.
export const teamIntegrations = pgTable(
  "team_integrations",
  {
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    credentialsEnc: text("credentials_enc").notNull(),
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("active"),
    lastError: text("last_error"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => userAccounts.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.teamId, t.provider] }),
    providerCheck: check(
      "team_integrations_provider_check",
      sql`${t.provider} IN ('github', 'jira', 'linear')`,
    ),
    statusCheck: check(
      "team_integrations_status_check",
      sql`${t.status} IN ('active', 'error')`,
    ),
  }),
);

// PR facts synced from the GitHub integration, upserted on every sync. The
// AI-assisted flag comes from Co-Authored-By trailers in the PR's commits —
// an undercount when squash-merges strip trailers; the session↔commit-SHA
// join is the planned precise upgrade.
export const githubPullRequests = pgTable(
  "github_pull_requests",
  {
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    repo: text("repo").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    authorLogin: text("author_login"),
    state: text("state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    firstCommitAt: timestamp("first_commit_at", { withTimezone: true }),
    firstReviewAt: timestamp("first_review_at", { withTimezone: true }),
    additions: integer("additions").notNull().default(0),
    deletions: integer("deletions").notNull().default(0),
    commitsTotal: integer("commits_total").notNull().default(0),
    commitsAi: integer("commits_ai").notNull().default(0),
    aiAssisted: boolean("ai_assisted").notNull().default(false),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.teamId, t.repo, t.number] }),
    teamMerged: index("idx_github_prs_team_merged").on(t.teamId, sql`${t.mergedAt} DESC`),
    stateCheck: check(
      "github_pull_requests_state_check",
      sql`${t.state} IN ('open', 'merged', 'closed')`,
    ),
  }),
);

// Issues synced from the Linear integration, upserted on every sync. Native
// Linear timestamps (startedAt/completedAt) drive cycle/lead time — the full
// per-status transition history (v6 phase spine) is a later expansion.
export const linearIssues = pgTable(
  "linear_issues",
  {
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    identifier: text("identifier").notNull(), // e.g. KIP-315
    title: text("title").notNull(),
    stateName: text("state_name").notNull(),
    // Linear's canonical buckets: triage|backlog|unstarted|started|completed|canceled
    stateType: text("state_type").notNull(),
    linearTeamKey: text("linear_team_key").notNull(),
    assignee: text("assignee"),
    estimate: integer("estimate"),
    url: text("url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.teamId, t.identifier] }),
    teamCompleted: index("idx_linear_issues_team_completed").on(t.teamId, sql`${t.completedAt} DESC`),
  }),
);

// Issues synced from the Jira Cloud integration, upserted on every sync. Jira
// has no native "started" timestamp, so started_at is derived from the
// changelog's first transition into an In-Progress (statusCategory
// "indeterminate") status. state_type reuses linear_issues' vocabulary
// (unstarted|started|completed|canceled) so the shared velocity/work-timeline
// aggregation treats both ticket sources uniformly.
export const jiraIssues = pgTable(
  "jira_issues",
  {
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    identifier: text("identifier").notNull(), // e.g. ENG-315
    title: text("title").notNull(),
    stateName: text("state_name").notNull(),
    stateType: text("state_type").notNull(),
    jiraProjectKey: text("jira_project_key").notNull(),
    assignee: text("assignee"),
    estimate: integer("estimate"),
    url: text("url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.teamId, t.identifier] }),
    teamCompleted: index("idx_jira_issues_team_completed").on(t.teamId, sql`${t.completedAt} DESC`),
  }),
);
