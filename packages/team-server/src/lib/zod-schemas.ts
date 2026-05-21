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
  peakPct: z.number().min(0).max(200),
  source: z.enum(["real", "predicted"]),
  current: z.boolean(),
});

export const WireCyclePeaksSchema = z.object({
  fiveHour: z.array(WireCyclePeakSchema).max(60),
  sevenDay: z.array(WireCyclePeakSchema).max(60),
});

// Cap per-request to keep transactions bounded; the daemon batches.
export const UsageHistoryPayload = z.object({
  snapshots: z.array(UsageSnapshotSchema).min(1).max(1000),
  planTier: PlanTierKeySchema.optional(),
});

const DailyRollupSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  agentTimeMs: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
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
  usageSnapshot: UsageSnapshotSchema.optional(),
  planTier: PlanTierKeySchema.optional(),
  cyclePeaks: WireCyclePeaksSchema.optional(),
  // Bulk historical snapshots from the daemon's local usage.jsonl. Idempotent
  // at the row level via the (team_id, membership_id, captured_at) unique
  // key, so this stream is processed independently of the ingestId dedup
  // gate — retrying a batch with the same ingestId still applies new rows.
  snapshotHistory: z.array(UsageSnapshotSchema).max(1000).optional(),
}).passthrough();

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
