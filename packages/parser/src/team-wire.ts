/**
 * Wire-format types for team-server ingest + local last-push record.
 *
 * Single source of truth for the daemon → server payload shape and the
 * `~/.cclens/team-last-push.json` mirror. Lives in the parser package so
 * both the CLI (which writes them) and the web app (which reads them)
 * import the exact same definitions — avoids silent drift if a field is
 * added or renamed.
 */

export type DailyRollup = {
  day: string;
  agentTimeMs: number;
  // `sessions` is session-days: a cross-midnight session counts on every local
  // day it touched (so the per-day table shows it on both). `uniqueSessions`
  // is the start-day count, so SUM(uniqueSessions) over a range == the real
  // unique-session total — the figure roster/header/classifier aggregates want.
  sessions: number;
  uniqueSessions?: number;
  toolCalls: number;
  turns: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

export type WireUsageWindow = {
  utilization: number | null;
  resetsAt: string | null;
};

export type WireExtraUsage = {
  isEnabled: boolean;
  monthlyLimitUsd: number | null;
  usedCreditsUsd: number | null;
  utilization: number | null;
};

export type WireUsageSnapshot = {
  capturedAt: string;
  fiveHour: WireUsageWindow;
  sevenDay: WireUsageWindow;
  sevenDayOpus: WireUsageWindow | null;
  sevenDaySonnet: WireUsageWindow | null;
  sevenDayOauthApps: WireUsageWindow | null;
  sevenDayCowork: WireUsageWindow | null;
  extraUsage: WireExtraUsage | null;
};

export type WireCyclePeak = {
  endsAt: string;
  peakPct: number;
  source: "real" | "predicted";
  current: boolean;
};

export type WireCyclePeaks = {
  fiveHour: WireCyclePeak[];
  sevenDay: WireCyclePeak[];
};

// Bridge V2 marker. V1 daemons omit it and never set rich/enriched fields.
export const RICH_ROLLUP_SCHEMA_VERSION = 2 as const;

// Layer A — per-day deterministic Entry-derived counts and breakdowns.
// Always safe to share (counts + labels only; never first_user / final_agent
// text). Every project the member worked on is included — there is no
// per-project gating. See docs/superpowers/specs/2026-05-16-personal-to-team-bridge-design.md.
export type RichDailyRollup = DailyRollup & {
  // githubRepos: owner/name identities observed in git-push / gh-pr tool
  // OUTPUT for this project's sessions — lets the server canonicalize the
  // local directory name onto the actual remote. Optional and additive;
  // V2 servers without the field simply ignore it.
  projects: { project: string; agentTimeMs: number; sessions: number; githubRepos?: string[] }[];
  workingShapes: { shape: string; sessions: number; agentTimeMs: number }[];
  concurrencyPeak: number;
  parallelMinutes: number;
  longAutonomous: { count: number; totalMin: number; maxSingleMin: number };
  toolErrors: number;
  skillsLoaded: { name: string; sessions: number }[];
  subagentsDispatched: { type: string; count: number }[];
  brainstormWarmupSessions: number;
  planModeUsed: number;
  prs: number;
  commits: number;
  pushes: number;
};

// Layer B — LLM-derived per-day fields. Already cached locally; pushing them
// does not trigger fresh LLM work. Always shared (no member-side opt-out).
export type EnrichedDailyExtras = {
  outcomeMix: Partial<Record<"shipped" | "partial" | "exploratory" | "blocked" | "trivial", number>>;
  helpfulnessMix: Partial<Record<"essential" | "helpful" | "neutral" | "unhelpful", number>>;
  goalMix: Partial<Record<string, number>>;
};

// V2.1 — artifact-authoring signals from the personal-edition file-system
// probe. Captured per-day; ships alongside richRollup. Identifiers are
// SHA-256 hashes of paths relative to the .claude root — never raw paths or
// file contents. Drives the L4-builds path of the team-server's maturity
// classifier and feeds team_skill_catalog reconciliation for L4-coaches.
export type DayArtifactSignals = {
  skillsAuthored: { pathHash: string; firstSeenDate: string }[];
  skillsEdited: { pathHash: string; lineDelta: number }[];
  subagentsAuthored: { pathHash: string; firstSeenDate: string }[];
  slashCommandsAuthored: { pathHash: string; firstSeenDate: string }[];
  claudemdLineDelta: number;
};

export type IngestPayload = {
  ingestId: string;
  observedAt: string;
  // Set on V2+ payloads so the server can branch. Absent payloads are V1.
  schemaVersion?: typeof RICH_ROLLUP_SCHEMA_VERSION;
  // Every field below is optional so the daemon can push whichever subset is
  // relevant on each tick. The server applies whatever's present.
  dailyRollup?: DailyRollup;
  // Layer A — Entry-derived rollup; same day key as dailyRollup.
  richRollup?: RichDailyRollup;
  // Layer B — LLM-enriched extras, only when the member opted in.
  enrichedExtras?: EnrichedDailyExtras;
  // V2.1 — Layer C: file-system artifact signals (no LLM, no raw text).
  // Same day key as richRollup; safe to share, hashes only.
  artifactSignals?: DayArtifactSignals;
  usageSnapshot?: WireUsageSnapshot;
  // Anthropic-detected tier ("pro"|"pro-max"|"pro-max-20x"|"custom"). Server
  // upserts memberships.plan_tier when this is set so admins don't have to
  // hand-pick a tier the daemon already knows.
  planTier?: string;
  // Installed Fleetlens CLI version of the pushing daemon. The server stamps
  // memberships.cli_version from this so admins can see who's on an old client.
  cliVersion?: string;
  // Per-cycle peak utilization, computed locally by the daemon using the
  // SAME parser logic that drives the personal /usage trend strip. Pushing
  // the computed outcome (rather than raw events) keeps a single source of
  // truth and means team server never re-runs the math.
  cyclePeaks?: WireCyclePeaks;
  // Bulk historical snapshot batch (formerly POST /api/ingest/usage-history).
  // Server dedups at the row level via captured_at, so retries on the same
  // ingestId still apply new rows.
  snapshotHistory?: WireUsageSnapshot[];
  // Reports completion of server-issued commands the daemon executed since
  // the previous push. Server marks corresponding rows in `member_commands`
  // as completed. See docs/superpowers/specs/2026-05-21-team-issued-commands-design.md.
  commandResults?: CommandResult[];
};

export type LastPushRecord = {
  pushedAt: string;
  ok: boolean;
  payload: IngestPayload;
  error?: string;
};

// Commands issued by the team server, embedded in /api/ingest/metrics
// responses. Daemon parses, dispatches via the switch in
// packages/cli/src/team/commands.ts, reports back via `commandResults`
// on the next push. See docs/superpowers/specs/2026-05-21-team-issued-commands-design.md.
export type ServerCommand =
  | { id: string; type: "backfill-activity"; params: { days: number } };

export type CommandResult =
  | { id: string; ok: true; completedAt: string; summary?: Record<string, unknown> }
  | { id: string; ok: false; completedAt: string; error: string };

// Typed shape of the server's /api/ingest/metrics response. Fields are
// optional because the server may add new ones over time; callers should
// tolerate missing fields.
export type IngestResponse = {
  ok?: boolean;
  snapshotHistory?: { inserted: number; skipped: number };
  commands?: ServerCommand[];
};
