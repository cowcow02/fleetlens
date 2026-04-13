#!/usr/bin/env node
/**
 * Generate 30 days of realistic mock usage snapshots and write to
 * ~/.cclens/usage.jsonl so the dashboard has something to visualize.
 *
 * Models a typical developer workflow:
 *   - Weekday 9am–6pm heavy use
 *   - Evenings light
 *   - Nights near-zero
 *   - Weekends quieter
 *   - ~20% chance of a "burst day" where intensity spikes
 *
 * Backs up any existing usage.jsonl to usage.jsonl.bak first.
 *
 * Usage:
 *   node scripts/generate-mock-usage.mjs [--days N]
 */

import {
  writeFileSync,
  existsSync,
  copyFileSync,
  mkdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MIN = 60 * 1000;
const FIVE_HOUR = 5 * HOUR;
const SEVEN_DAY = 7 * DAY;
const SNAPSHOT_INTERVAL = 5 * MIN;

// Parse --days arg
const daysArg = process.argv.indexOf("--days");
const DAYS = daysArg !== -1 ? parseInt(process.argv[daysArg + 1] ?? "30", 10) : 30;

const OUTPUT = process.env.CCLENS_USAGE_LOG ?? join(homedir(), ".cclens", "usage.jsonl");
const BACKUP = `${OUTPUT}.bak`;

mkdirSync(dirname(OUTPUT), { recursive: true });

// Back up existing file if present
if (existsSync(OUTPUT)) {
  copyFileSync(OUTPUT, BACKUP);
  console.log(`Backed up existing log to ${BACKUP}`);
}

const now = Date.now();
const start = now - DAYS * DAY;

/** Deterministic pseudo-random in [0, 1) seeded by an integer. */
function rand(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// Weekly intensity pattern — designed to show a range of leadership-
// relevant cycle shapes: ramping, normal, heavy, chill, crunch.
// Oldest first, most recent last.
const WEEKLY_PATTERN = [0.55, 1.0, 1.55, 0.75, 1.3];

/**
 * Activity level at absolute time t, in arbitrary units.
 * Returns a number in roughly [0, 3] representing token-burn intensity.
 */
function activityAt(t) {
  const d = new Date(t);
  const hour = d.getHours();
  const day = d.getDay(); // 0 Sun … 6 Sat
  const daySeed = Math.floor(t / DAY);

  // Which "week" of the 30-day range we're in (oldest → newest)
  const weekIndex = Math.min(
    WEEKLY_PATTERN.length - 1,
    Math.floor((t - start) / (7 * DAY)),
  );
  const weeklyFactor = WEEKLY_PATTERN[weekIndex];

  // Hour-of-day profile
  let hourFactor;
  if (hour >= 9 && hour < 12) hourFactor = 0.95;
  else if (hour >= 12 && hour < 13) hourFactor = 0.35; // lunch dip
  else if (hour >= 13 && hour < 18) hourFactor = 1.0;
  else if (hour >= 18 && hour < 22) hourFactor = 0.45;
  else if (hour === 22 || hour === 23) hourFactor = 0.15;
  else if (hour === 8) hourFactor = 0.5;
  else hourFactor = 0.03; // night

  // Day-of-week profile
  let dayFactor;
  if (day === 0) dayFactor = 0.25; // Sunday
  else if (day === 6) dayFactor = 0.35; // Saturday
  else if (day === 5) dayFactor = 0.85; // Friday slightly lower
  else dayFactor = 1.0;

  // 20% of days are "burst days" — spike intensity
  const burstMultiplier = rand(daySeed) < 0.2 ? 1.6 : 1.0;

  // 10% of days are "quiet days"
  const quietMultiplier = rand(daySeed + 7) < 0.1 ? 0.35 : 1.0;

  // Light per-minute noise
  const noise = 0.8 + rand(Math.floor(t / MIN)) * 0.4;

  return (
    weeklyFactor *
    hourFactor *
    dayFactor *
    burstMultiplier *
    quietMultiplier *
    noise
  );
}

// Build a cumulative activity array indexed by minute offset from `start`
// so we can compute "activity between t1 and t2" in O(1).
const totalMinutes = Math.ceil((now - start) / MIN);
const cumActivity = new Float64Array(totalMinutes + 1);
for (let i = 0; i < totalMinutes; i++) {
  cumActivity[i + 1] = cumActivity[i] + activityAt(start + i * MIN);
}

function activityBetween(t1, t2) {
  const m1 = Math.max(0, Math.floor((t1 - start) / MIN));
  const m2 = Math.min(totalMinutes, Math.floor((t2 - start) / MIN));
  if (m2 <= m1) return 0;
  return cumActivity[m2] - cumActivity[m1];
}

// Scale factors tuned so typical peaks fall in healthy ranges
// (avg ~30-40%, typical peaks 60-80%, occasional burst cycles 90-100%)
const FIVE_H_FULL = 110;    // activity units == 100% for 5h window
const SEVEN_D_FULL = 7500;  // activity units == 100% for 7d window

// Cycle alignment: anchor at `start` and advance by cycle duration.
// Real Claude Code cycles align to first-API-call anchors, but for a
// visualization mock this is a close-enough approximation.
function fiveCycleFor(t) {
  const cycleIndex = Math.floor((t - start) / FIVE_HOUR);
  const cycleStart = start + cycleIndex * FIVE_HOUR;
  const cycleEnd = cycleStart + FIVE_HOUR;
  return { cycleStart, cycleEnd };
}

function sevenCycleFor(t) {
  const cycleIndex = Math.floor((t - start) / SEVEN_DAY);
  const cycleStart = start + cycleIndex * SEVEN_DAY;
  const cycleEnd = cycleStart + SEVEN_DAY;
  return { cycleStart, cycleEnd };
}

const lines = [];
for (let t = start; t <= now; t += SNAPSHOT_INTERVAL) {
  const five = fiveCycleFor(t);
  const seven = sevenCycleFor(t);

  const fiveSum = activityBetween(five.cycleStart, t);
  const sevenSum = activityBetween(seven.cycleStart, t);

  // Accumulating utilization within each cycle, capped at 100
  const fiveUtil = Math.min(100, (fiveSum / FIVE_H_FULL) * 100);
  const sevenUtil = Math.min(100, (sevenSum / SEVEN_D_FULL) * 100);
  // Sonnet consumption roughly tracks 7d but lower since people mix models
  const sonnetUtil = Math.min(100, sevenUtil * (0.55 + rand(Math.floor(t / HOUR)) * 0.15));

  lines.push(
    JSON.stringify({
      captured_at: new Date(t).toISOString(),
      five_hour: {
        utilization: Math.round(fiveUtil * 10) / 10,
        resets_at: new Date(five.cycleEnd).toISOString(),
      },
      seven_day: {
        utilization: Math.round(sevenUtil * 10) / 10,
        resets_at: new Date(seven.cycleEnd).toISOString(),
      },
      seven_day_opus: null,
      seven_day_sonnet: {
        utilization: Math.round(sonnetUtil * 10) / 10,
        resets_at: new Date(seven.cycleEnd).toISOString(),
      },
      seven_day_oauth_apps: null,
      seven_day_cowork: null,
      extra_usage: {
        is_enabled: false,
        monthly_limit: null,
        used_credits: null,
        utilization: null,
      },
    }),
  );
}

writeFileSync(OUTPUT, lines.join("\n") + "\n");
console.log(`Wrote ${lines.length} mock snapshots (${DAYS} days) to ${OUTPUT}`);
console.log(`To restore real data: mv ${BACKUP} ${OUTPUT}`);
