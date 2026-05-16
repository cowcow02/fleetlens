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
    role: text("role").notNull().default("member"),
    groupIds: uuid("group_ids").array().notNull().default(sql`'{}'::uuid[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    roleCheck: check("invites_role_check", sql`${t.role} IN ('admin','member')`),
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
    sessions: integer("sessions").notNull().default(0),
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
    sessions: integer("sessions").notNull().default(0),
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
