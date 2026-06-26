// Pure calibration math — no fs, no network. The Node-only loaders live in
// fs.ts. Splitting them keeps the team-server (which also wants per-member
// $-from-tokens math but reads from Postgres, not local JSONL) able to
// import this module without dragging in node:fs.

export type ModelFamily = "sonnet" | "opus" | "haiku";

export type CalibrationEvent = {
  ts: string;             // ISO timestamp (assistant turn timestamp)
  family: ModelFamily;    // model family for pricing
  input: number;
  output: number;
  cacheRead: number;
  cache_1h: number;
  cache_5m: number;
};

export type PlanTier = "pro" | "pro-max" | "pro-max-20x" | "custom";

// $ per 1M tokens, calibrated against ccusage CLI output (regressed from
// per-model single-day rows). ccusage doesn't break out 1h vs 5m cache
// writes — it uses one rate for both — so we mirror that here. Note that
// these don't always match Anthropic's published list prices: ccusage
// (via LiteLLM) maps claude-opus-4-{6,7} to a legacy rate that's 1/3 of
// the published Opus rate. Matching ccusage is the goal because that's
// what users compare against.
export const PRICES: Record<ModelFamily, { input: number; output: number; cacheRead: number; cache_1h: number; cache_5m: number }> = {
  sonnet: { input: 3.0, output: 15.0, cacheRead: 0.3, cache_1h: 3.75, cache_5m: 3.75 },
  opus:   { input: 5.0, output: 25.0, cacheRead: 0.5, cache_1h: 6.25, cache_5m: 6.25 },
  haiku:  { input: 1.0, output: 5.0,  cacheRead: 0.1, cache_1h: 1.25, cache_5m: 1.25 },
};

// $ per 1% utilization, by plan tier and window. Pro Max 20x derived
// empirically: healthy 7d cycles cluster at $11-$13/% (median $12), and
// healthy 5h cycles cluster at $1.6-$3/% (median ~$2). The two windows
// have very different rates because the 5h limit is a fraction of the
// 7d limit — using one rate for both produces 5-6x errors on 5h bursts.
//
// Other tiers are scaled by their subscription value multipliers; they
// need daemon-collected data to validate properly but are reasonable
// cold-start defaults.
export const RATE_PER_PCT_7D: Record<PlanTier, number> = {
  "pro": 1.2,
  "pro-max": 2.4,
  "pro-max-20x": 12.0,
  "custom": 12.0,
};
export const RATE_PER_PCT_5H: Record<PlanTier, number> = {
  "pro": 0.2,
  "pro-max": 0.4,
  "pro-max-20x": 2.0,
  "custom": 2.0,
};
// Back-compat alias used by older call sites — defaults to the 7d rate.
export const RATE_PER_PCT = RATE_PER_PCT_7D;

export function modelFamily(modelStr: string | undefined | null): ModelFamily | null {
  const m = (modelStr ?? "").toLowerCase();
  if (!m || m === "<synthetic>") return null;
  if (m.includes("haiku")) return "haiku";
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  return null;  // glm-*, gpt-*, etc — non-Anthropic, not priced
}

export function eventDollars(ev: CalibrationEvent): number {
  const p = PRICES[ev.family];
  return (
    ev.input * p.input +
    ev.output * p.output +
    ev.cacheRead * p.cacheRead +
    ev.cache_1h * p.cache_1h +
    ev.cache_5m * p.cache_5m
  ) / 1_000_000;
}


// ──────────────────────────────────────────────────────────────────
//          Snapshot-anchored utilization predictor
// ──────────────────────────────────────────────────────────────────
//
// The predictor builds a curve that passes EXACTLY through every observed
// OAuth snapshot. Between two snapshots in the same cycle, it interpolates
// linearly weighted by JSONL spend. Past the latest snapshot of an
// in-progress cycle (or in any daemon-gap before the first snapshot of a
// cycle) it falls back to a $/pp rate that blends the cycle's own observed
// rate with a robust median of recent prior cycles.
//
// This eliminates rate-modeling error on observed history (residual ~0)
// and only leaves the forward-extrapolation residual past the last poll.

// Minimal structural shape of a daemon snapshot — defined here so this module
// stays free of fs/network deps. Compatible with the richer UsageSnapshot
// types in cli/usage/api.ts and apps/web/lib/usage-data.ts.
export type RateSource = "user_calibrated" | "tier_default";

export type SnapshotForCalibration = {
  captured_at?: string | null;
  five_hour?: { utilization?: number | null; resets_at?: string | null } | null;
  seven_day?: { utilization?: number | null; resets_at?: string | null } | null;
};

export type CycleSnap = { ts: number; pct: number };

const HOUR_MS = 3_600_000;

// Cumulative $-spent indexed by event timestamp, so any (start, end) window
// query is O(log n) via binary search instead of O(n) linear scan. Worth it
// because the curve builder calls this 1000+ times per render.
export type SpendIndex = {
  ts: Float64Array;
  cum: Float64Array;
};

export function buildSpendIndex(events: CalibrationEvent[]): SpendIndex {
  const sorted = events
    .map((e) => ({ e, t: Date.parse(e.ts) }))
    .filter((x) => !Number.isNaN(x.t))
    .sort((a, b) => a.t - b.t);
  const ts = new Float64Array(sorted.length);
  const cum = new Float64Array(sorted.length + 1);
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    ts[i] = sorted[i].t;
    cum[i] = acc;
    acc += eventDollars(sorted[i].e);
  }
  cum[sorted.length] = acc;
  return { ts, cum };
}

function lowerBound(arr: Float64Array, target: number, hi: number): number {
  let lo = 0;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function dollarsInRange(idx: SpendIndex, startMs: number, endMs: number): number {
  if (endMs <= startMs) return 0;
  const n = idx.ts.length;
  const lo = lowerBound(idx.ts, startMs, n);
  const hi = lowerBound(idx.ts, endMs, n);
  return idx.cum[hi]! - idx.cum[lo]!;
}

// Group snapshots by cycle (key = hour-rounded resets_at) for one window.
export function groupSnapsByCycle(
  snapshots: SnapshotForCalibration[],
  pick: (s: SnapshotForCalibration) =>
    | { utilization?: number | null; resets_at?: string | null }
    | null
    | undefined,
): Map<number, CycleSnap[]> {
  const out = new Map<number, CycleSnap[]>();
  for (const s of snapshots) {
    if (!s.captured_at) continue;
    const w = pick(s);
    if (!w?.resets_at || typeof w.utilization !== "number") continue;
    const ts = Date.parse(s.captured_at);
    const reset = Date.parse(w.resets_at);
    if (Number.isNaN(ts) || Number.isNaN(reset)) continue;
    const k = Math.round(reset / HOUR_MS) * HOUR_MS;
    const arr = out.get(k) ?? [];
    arr.push({ ts, pct: w.utilization });
    out.set(k, arr);
  }
  for (const arr of out.values()) arr.sort((a, b) => a.ts - b.ts);
  return out;
}

// One observed `$/pp` rate per snap-pair within a cycle. Each pair-rate
// is a LOWER BOUND on the user's true solo `$/pp`: the user contributed
// `dollars` and Anthropic measured `travel` pp, but on a SHARED account
// teammates may have contributed additional pp without contributing to
// `dollars`. Higher pair-rates → moments when teammates were idle, closest
// to the user's true solo rate. We use an upper percentile of these rates
// (not the cycle average) for forward extrapolation, so shared-account
// pollution doesn't bias the rate downward.
export type SnapPairRate = {
  cycleEndMs: number;
  rate: number;
  travel: number;
  dollars: number;
  gapMs: number;
};

export type SnapPairOpts = {
  minTravelPct?: number;
  minDollars?: number;
  maxGapMs?: number;
};

export function collectSnapPairRates(
  snapsByCycle: Map<number, CycleSnap[]>,
  spend: SpendIndex,
  opts?: SnapPairOpts,
): SnapPairRate[] {
  const minTravel = opts?.minTravelPct ?? 1;
  const minDollars = opts?.minDollars ?? 1;
  const maxGap = opts?.maxGapMs ?? 24 * HOUR_MS;
  const out: SnapPairRate[] = [];
  for (const [cycleEnd, arr] of snapsByCycle) {
    for (let i = 1; i < arr.length; i++) {
      const a = arr[i - 1]!;
      const b = arr[i]!;
      const gap = b.ts - a.ts;
      const travel = b.pct - a.pct;
      if (gap <= 0 || gap > maxGap) continue;
      if (travel < minTravel) continue;
      const dollars = dollarsInRange(spend, a.ts, b.ts);
      if (dollars < minDollars) continue;
      out.push({ cycleEndMs: cycleEnd, rate: dollars / travel, travel, dollars, gapMs: gap });
    }
  }
  return out;
}

// Upper percentile of pair rates. p90 is robust against extreme outliers
// while still leaning toward solo-dominated moments. Returns null when
// there isn't enough data; caller should fall back to the tier default.
export function userSoloRate(pairs: SnapPairRate[], percentile = 0.9): number | null {
  if (pairs.length < 3) return null;
  const sorted = pairs.map((p) => p.rate).sort((a, b) => a - b);
  const idx = Math.min(Math.floor(sorted.length * percentile), sorted.length - 1);
  return sorted[idx]!;
}

// The predictor: returns predicted utilization (pp) at time `t`, given the
// cycle's observed snapshots, a forward-extrapolation rate, and cycle
// metadata.
//
// Behavior:
// - between two adjacent snaps a, b in the same cycle:
//     pred(t) = pct_a + (pct_b - pct_a) × ($_a→t / $_a→b)
//   so the curve passes through every observed point exactly.
// - past the latest snap of an in-progress cycle:
//     pred(t) = pct_last + ($_last→t / forwardRate)
// - before the first snap of a cycle (cold-start back-fill):
//     pred(t) = max(0, pct_first - ($_t→first / forwardRate))
// - cycle has no snaps at all: linear projection from cycle start using
//   forwardRate so cold-start back-fill draws a curve.
export function predictAnchored(
  spend: SpendIndex,
  cycleSnaps: CycleSnap[],
  forwardRate: number,
  cycleEndMs: number,
  cycleHours: number,
  t: number,
): number {
  const cycleStart = cycleEndMs - cycleHours * HOUR_MS;
  if (forwardRate <= 0) forwardRate = 1; // defensive

  if (cycleSnaps.length === 0) {
    return Math.max(0, dollarsInRange(spend, cycleStart, t) / forwardRate);
  }

  // aIdx = last snap with ts <= t
  let aIdx = -1;
  for (let i = 0; i < cycleSnaps.length; i++) {
    if (cycleSnaps[i]!.ts <= t) aIdx = i;
    else break;
  }

  if (aIdx >= 0 && aIdx + 1 < cycleSnaps.length) {
    // Spend-weighted linear interpolation between adjacent snaps.
    const a = cycleSnaps[aIdx]!;
    const b = cycleSnaps[aIdx + 1]!;
    if (b.pct === a.pct) return a.pct;
    const totalDollars = dollarsInRange(spend, a.ts, b.ts);
    if (totalDollars <= 0) {
      // Daemon recorded a pct change with zero JSONL spend (e.g. non-Anthropic
      // models, or events outside our scan, or pure team contribution). Fall
      // back to time-linear so the curve still passes through both anchors.
      const frac = (t - a.ts) / (b.ts - a.ts);
      return a.pct + (b.pct - a.pct) * frac;
    }
    const tDollars = dollarsInRange(spend, a.ts, t);
    return a.pct + (b.pct - a.pct) * (tDollars / totalDollars);
  }

  if (aIdx >= 0) {
    const last = cycleSnaps[aIdx]!;
    return last.pct + dollarsInRange(spend, last.ts, t) / forwardRate;
  }
  // t is before every observed snap of this cycle. Anchor the cycle start
  // at pct=0 (clean reset on the cycle boundary) and spend-weighted
  // interpolate to (first.ts, first.pct) — identical to the inter-snap
  // interpolation, just with an implicit (cycleStart, 0) endpoint. This
  // makes the chart visibly reset to 100% remaining at the boundary instead
  // of using a free-form back-extrapolation rate that misses the anchor.
  const first = cycleSnaps[0]!;
  if (t <= cycleStart) return 0;
  const totalDollars = dollarsInRange(spend, cycleStart, first.ts);
  if (totalDollars <= 0) {
    const frac = (t - cycleStart) / (first.ts - cycleStart);
    return first.pct * frac;
  }
  const tDollars = dollarsInRange(spend, cycleStart, t);
  return first.pct * (tDollars / totalDollars);
}
