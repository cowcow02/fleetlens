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
  sessions: number;
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

export type IngestPayload = {
  ingestId: string;
  observedAt: string;
  // Every field below is optional so the daemon can push whichever subset is
  // relevant on each tick. The server applies whatever's present.
  dailyRollup?: DailyRollup;
  usageSnapshot?: WireUsageSnapshot;
  // Anthropic-detected tier ("pro"|"pro-max"|"pro-max-20x"|"custom"). Server
  // upserts memberships.plan_tier when this is set so admins don't have to
  // hand-pick a tier the daemon already knows.
  planTier?: string;
  // Per-cycle peak utilization, computed locally by the daemon using the
  // SAME parser logic that drives the personal /usage trend strip. Pushing
  // the computed outcome (rather than raw events) keeps a single source of
  // truth and means team server never re-runs the math.
  cyclePeaks?: WireCyclePeaks;
  // Bulk historical snapshot batch (formerly POST /api/ingest/usage-history).
  // Server dedups at the row level via captured_at, so retries on the same
  // ingestId still apply new rows.
  snapshotHistory?: WireUsageSnapshot[];
};

export type LastPushRecord = {
  pushedAt: string;
  ok: boolean;
  payload: IngestPayload;
  error?: string;
};
