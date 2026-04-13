import type { UsageSnapshot, UsageWindow } from "./api.js";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

const BAR_WIDTH = 40;
const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

/**
 * Render a compact usage snapshot suitable for a terminal. Each row spans
 * two lines — one for the bar + label + percentage, one for the reset hint.
 * Uses Unicode eighth-blocks for sub-cell precision so even ~1% differences
 * are visually distinct.
 */
export function formatUsage(snapshot: UsageSnapshot): string {
  const rows: [label: string, window: UsageWindow | null][] = [
    ["5 hour", snapshot.five_hour],
    ["7 day", snapshot.seven_day],
    ["7 day (Opus)", snapshot.seven_day_opus],
    ["7 day (Sonnet)", snapshot.seven_day_sonnet],
    ["7 day (OAuth apps)", snapshot.seven_day_oauth_apps],
    ["7 day (Cowork)", snapshot.seven_day_cowork],
  ];

  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${BOLD}Claude Code Usage${RESET}`);
  lines.push("");

  for (const [label, window] of rows) {
    if (!window || window.utilization === null) continue;
    const pct = window.utilization;
    const bar = renderBar(pct);
    const pctStr = `${pct.toFixed(1)}%`.padStart(6);
    const labelStr = label.padEnd(16);
    lines.push(`  ${labelStr}${bar}  ${BOLD}${pctStr}${RESET}`);
    if (window.resets_at) {
      lines.push(`  ${" ".repeat(16)}${DIM}resets ${formatRelative(window.resets_at)}${RESET}`);
    }
    lines.push("");
  }

  if (snapshot.extra_usage?.is_enabled) {
    const extra = snapshot.extra_usage;
    lines.push(`  ${BOLD}Extra usage${RESET}`);
    if (extra.utilization !== null) {
      lines.push(`  ${" ".repeat(16)}${extra.utilization.toFixed(1)}%`);
    }
    if (extra.used_credits !== null && extra.monthly_limit !== null) {
      lines.push(`  ${" ".repeat(16)}${extra.used_credits} / ${extra.monthly_limit} credits`);
    }
    lines.push("");
  }

  lines.push(`  ${DIM}captured ${formatRelative(snapshot.captured_at)}${RESET}`);
  lines.push("");
  return lines.join("\n");
}

/**
 * Render a progress bar with sub-cell precision using Unicode eighths.
 * Each full block is `█`, partial fill uses `▏▎▍▌▋▊▉` for 1/8 granularity.
 * Empty cells use a dim `·` so the filled portion visually pops.
 */
function renderBar(utilization: number): string {
  const clamped = Math.max(0, Math.min(100, utilization));
  const color = clamped >= 90 ? RED : clamped >= 70 ? YELLOW : GREEN;

  // Convert to eighth-cells (8 eighths per character × BAR_WIDTH).
  const totalEighths = Math.round((clamped / 100) * BAR_WIDTH * 8);
  const fullBlocks = Math.floor(totalEighths / 8);
  const remainder = totalEighths % 8;
  const partial = EIGHTHS[remainder];
  const filledCells = fullBlocks + (partial ? 1 : 0);
  const emptyCells = BAR_WIDTH - filledCells;

  const filled = "█".repeat(fullBlocks) + partial;
  const empty = "·".repeat(emptyCells);

  return `${color}${filled}${RESET}${DIM}${empty}${RESET}`;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((then - now) / 1000);
  const abs = Math.abs(diffSec);
  const past = diffSec < 0;

  let value: string;
  if (abs < 60) {
    value = `${abs}s`;
  } else if (abs < 3600) {
    value = `${Math.floor(abs / 60)}m`;
  } else if (abs < 86400) {
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    value = m > 0 ? `${h}h${m}m` : `${h}h`;
  } else {
    const d = Math.floor(abs / 86400);
    const h = Math.floor((abs % 86400) / 3600);
    value = h > 0 ? `${d}d${h}h` : `${d}d`;
  }

  return past ? `${value} ago` : `in ${value}`;
}
