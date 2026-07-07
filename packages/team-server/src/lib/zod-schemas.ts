import { z } from "zod";

const UsageWindowSchema = z.object({
  utilization: z.number().nullable(),
  resetsAt: z.string().datetime({ offset: true }).nullable(),
}).passthrough();

const ExtraUsageSchema = z.object({
  isEnabled: z.boolean(),
  monthlyLimitUsd: z.number().nullable(),
  usedCreditsUsd: z.number().nullable(),
  utilization: z.number().nullable(),
}).passthrough();

export const UsageSnapshotSchema = z.object({
  capturedAt: z.string().datetime({ offset: true }),
  fiveHour: UsageWindowSchema,
  sevenDay: UsageWindowSchema,
  sevenDayOpus: UsageWindowSchema.nullable(),
  sevenDaySonnet: UsageWindowSchema.nullable(),
  sevenDayOauthApps: UsageWindowSchema.nullable(),
  sevenDayCowork: UsageWindowSchema.nullable(),
  extraUsage: ExtraUsageSchema.nullable(),
}).passthrough();

export type UsageSnapshot = z.infer<typeof UsageSnapshotSchema>;

// Mirrors `members.plan_tier` CHECK in 0002_plan_utilization.sql. Daemon
// either knows the tier (mapped from Anthropic's rate_limit_tier) or omits
// the field entirely. Server treats anything outside this enum as "skip
// upsert" so a future Anthropic tier code never silently downgrades us.
export const PlanTierKeySchema = z.enum(["pro", "pro-max", "pro-max-20x", "custom"]);

// Per-cycle peak utilization computed by the daemon (using the same parser
// logic that drives the personal /usage page). One entry per completed
// cycle plus the in-progress one. Server stores as-is; never recomputes.
export const WireCyclePeakSchema = z.object({
  endsAt: z.string().datetime({ offset: true }),
  // peakPct is plan-utilization percent. It LEGITIMATELY exceeds 100 — and
  // can exceed 200 — once a member is on overage/extra-usage, because the
  // daemon ships the *predicted* cycle peak (an extrapolation), not just the
  // last observed poll. The old `.max(200)` rejected those real payloads,
  // which (since cyclePeaks rides the daily-rollup push) 400'd the entire
  // push and left members with usage-only data. The peak_pct column is
  // `real`, so a large value stores fine; we keep a generous finite ceiling
  // only to still reject obvious corruption.
  peakPct: z.number().min(0).max(10000),
  source: z.enum(["real", "predicted"]),
  current: z.boolean(),
});

export const WireCyclePeaksSchema = z.object({
  fiveHour: z.array(WireCyclePeakSchema).max(60),
  sevenDay: z.array(WireCyclePeakSchema).max(60),
});

// Daemon-reported outcome of a previously-delivered member command. Matches
// the wire shape produced by the CLI side of the command channel.
export const CommandResultSchema = z.object({
  id: z.string(),
  ok: z.boolean(),
  completedAt: z.string().datetime({ offset: true }),
  summary: z.record(z.unknown()).optional(),
  error: z.string().optional(),
});

// Cap per-request to keep transactions bounded; the daemon batches.
export const UsageHistoryPayload = z.object({
  snapshots: z.array(UsageSnapshotSchema).min(1).max(1000),
  planTier: PlanTierKeySchema.optional(),
});

// A regex-valid `YYYY-MM-DD` can still be a non-existent calendar date
// (`2026-99-99`, `2026-02-30`). The `daily_rollups.day` column is `date`, so a
// bad value passes block validation but then throws mid-INSERT and rolls back
// OTHER already-accepted blocks — defeating partial-success. Validate the
// calendar date here so a bad day is a skipped block, not a transaction killer.
function isCalendarDate(s: string): boolean {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
export const DaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate, { message: "not a valid calendar date" });

export const DailyRollupSchema = z.object({
  day: DaySchema,
  agentTimeMs: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  // Optional for back-compat: CLIs predating the per-day split don't send it.
  uniqueSessions: z.number().int().nonnegative().optional(),
  toolCalls: z.number().int().nonnegative(),
  turns: z.number().int().nonnegative(),
  tokens: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    cacheRead: z.number().int().nonnegative(),
    cacheWrite: z.number().int().nonnegative(),
  }).passthrough(),
}).passthrough();

// Rich rollup — Entry-derived deterministic per-day breakdowns. JSONB-shaped
// payloads stay forgiving (.passthrough() + unknowns) so a daemon shipping
// future signals never blocks ingest; the server reads only the fields it
// knows about.
export const RichDailyRollupSchema = DailyRollupSchema.extend({
  projects: z.array(z.object({
    project: z.string(),
    agentTimeMs: z.number().int().nonnegative(),
    sessions: z.number().int().nonnegative(),
    // owner/name identities from git-push / gh-pr output — lets the report
    // canonicalize the local directory name onto the actual remote.
    // NOTE: these caps are NOT the source of the partial-data bug — the
    // daemon resolves only short `owner/name` strings and already
    // `.slice(0, 5)`s before the wire (see buildRichRollupBlocks in
    // packages/cli/src/team/push.ts), so real data never reaches the old
    // 5-element / 200-char limits. Widened purely as forward-looking
    // headroom (a project legitimately touching many remotes, or an unusual
    // long identity); this column is JSONB, so longer values store fine.
    githubRepos: z.array(z.string().max(512)).max(25).optional(),
  }).passthrough()),
  workingShapes: z.array(z.object({
    shape: z.string(),
    sessions: z.number().int().nonnegative(),
    agentTimeMs: z.number().int().nonnegative(),
  }).passthrough()),
  concurrencyPeak: z.number().int().nonnegative(),
  parallelMinutes: z.number().int().nonnegative(),
  longAutonomous: z.object({
    count: z.number().int().nonnegative(),
    totalMin: z.number().int().nonnegative(),
    maxSingleMin: z.number().int().nonnegative(),
  }).passthrough(),
  toolErrors: z.number().int().nonnegative(),
  skillsLoaded: z.array(z.object({
    name: z.string(),
    sessions: z.number().int().nonnegative(),
  }).passthrough()),
  subagentsDispatched: z.array(z.object({
    type: z.string(),
    count: z.number().int().nonnegative(),
  }).passthrough()),
  brainstormWarmupSessions: z.number().int().nonnegative(),
  planModeUsed: z.number().int().nonnegative(),
  prs: z.number().int().nonnegative(),
  commits: z.number().int().nonnegative(),
  pushes: z.number().int().nonnegative(),
}).passthrough();

export const EnrichedDailyExtrasSchema = z.object({
  outcomeMix: z.record(z.number().int().nonnegative()).optional().default({}),
  helpfulnessMix: z.record(z.number().int().nonnegative()).optional().default({}),
  goalMix: z.record(z.number().nonnegative()).optional().default({}),
}).passthrough();

// Artifact-authoring signals captured by the personal-edition file-system
// probe. All identifiers are SHA-256 hashes of paths relative to the .claude
// root so cross-member reconciliation can match without ever shipping file
// content. Daily-grain (per-team × per-member × per-day).
const AuthoredArtifactSchema = z.object({
  pathHash: z.string().min(8).max(128),
  firstSeenDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).passthrough();

const EditedArtifactSchema = z.object({
  pathHash: z.string().min(8).max(128),
  lineDelta: z.number().int(),
}).passthrough();

export const DayArtifactSignalsSchema = z.object({
  skillsAuthored: z.array(AuthoredArtifactSchema).max(100).default([]),
  skillsEdited: z.array(EditedArtifactSchema).max(200).default([]),
  subagentsAuthored: z.array(AuthoredArtifactSchema).max(50).default([]),
  slashCommandsAuthored: z.array(AuthoredArtifactSchema).max(50).default([]),
  claudemdLineDelta: z.number().int().default(0),
}).passthrough();

// One syncLog line. Exported standalone so processIngest can validate the
// block row-by-row.
export const SyncLogLineSchema = z.object({
  ts: z.string().datetime(),
  level: z.enum(["info", "warn", "error"]),
  msg: z.string().max(2000),
});

// Every field except ingestId/observedAt is optional so the daemon can push
// any subset on each tick:
//   - idle day  →  { snapshot, cyclePeaks, planTier }
//   - day rollover  →  { dailyRollup, snapshot, cyclePeaks, planTier }
//   - history backfill  →  { snapshotHistory: [...] }
//   - rich/enriched extras (V2) →  { richRollup, enrichedExtras }
// Server applies whichever fields are present. This consolidation replaces
// the older /api/ingest/usage-history route, which is preserved as a thin
// shim for older CLIs (see app/api/ingest/usage-history/route.ts).
//
// dailyRollup is also optional on idle days when the user hasn't run a
// Claude Code session — the server skips the daily_rollups upsert in that
// case but still applies the rest of the payload.
export const IngestPayload = z.object({
  ingestId: z.string(),
  observedAt: z.string().datetime(),
  // V2 marker. V1 daemons omit it and never set rich/enriched fields.
  schemaVersion: z.literal(2).optional(),
  dailyRollup: DailyRollupSchema.optional(),
  richRollup: RichDailyRollupSchema.optional(),
  enrichedExtras: EnrichedDailyExtrasSchema.optional(),
  // V2.1 — artifact-authoring signals from the file-system probe. The
  // payload is keyed to dailyRollup.day. Sent alongside richRollup on the
  // daily push tick; omitted on idle days.
  artifactSignals: DayArtifactSignalsSchema.optional(),
  usageSnapshot: UsageSnapshotSchema.optional(),
  planTier: PlanTierKeySchema.optional(),
  cyclePeaks: WireCyclePeaksSchema.optional(),
  // Installed Fleetlens CLI version of the reporting daemon — surfaced per
  // member in the team roster. Older clients omit it.
  cliVersion: z.string().max(64).optional(),
  // Bulk historical snapshots from the daemon's local usage.jsonl. Idempotent
  // at the row level via the (team_id, membership_id, captured_at) unique
  // key, so this stream is processed independently of the ingestId dedup
  // gate — retrying a batch with the same ingestId still applies new rows.
  snapshotHistory: z.array(UsageSnapshotSchema).max(1000).optional(),
  // Outcome of commands the server previously handed to this daemon. Capped
  // per request so a stuck daemon can't flood the ingest with stale results.
  commandResults: z.array(CommandResultSchema).max(50).optional(),
  // The member daemon's own sync-log lines since its last successful upload —
  // the client-side troubleshooting story, surfaced per-member. Row-level
  // dedup on (membership_id, ts, msg), so retries are idempotent. Capped;
  // processIngest validates rows individually (like snapshotHistory) so one
  // corrupt line can't drop the rest of the batch.
  syncLog: z.array(SyncLogLineSchema).max(500).optional(),
}).passthrough();

// Strict envelope: the identity / routing fields that MUST be valid for the
// push to be processed at all. processIngest validates each DATA block
// (dailyRollup, richRollup, usageSnapshot, cyclePeaks, planTier,
// snapshotHistory, …) independently via safeParse, so one malformed block is
// skipped (logged) rather than 400-ing the whole payload. The envelope stays
// all-or-nothing: a bad ingestId/observedAt is a genuine protocol error.
// commandResults is intentionally NOT in the envelope — it's data-channel
// feedback, not push identity, so it gets the same lenient per-block
// treatment (one stale result shouldn't reject a member's metrics push).
export const IngestEnvelope = z.object({
  ingestId: z.string(),
  observedAt: z.string().datetime(),
  schemaVersion: z.literal(2).optional(),
  cliVersion: z.string().max(64).optional(),
}).passthrough();

// commandResults as a standalone block schema so the per-block validator in
// processIngest can reuse it. (snapshotHistory and syncLog get row-by-row
// validation in ingest.ts instead of a block schema.)
export const CommandResultsSchema = z.array(CommandResultSchema).max(50);

export const ClaimPayload = z.object({
  bootstrapToken: z.string(),
  teamName: z.string().min(1).max(100),
  adminEmail: z.string().email().optional(),
  adminDisplayName: z.string().min(1).max(100).optional(),
});

export const InvitePayload = z.object({
  label: z.string().max(100).optional(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export const JoinPayload = z.object({
  inviteToken: z.string(),
  email: z.string().email().optional(),
  displayName: z.string().max(100).optional(),
});
