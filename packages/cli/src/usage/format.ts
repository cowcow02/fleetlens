import { getAgentMetadata, isAgentKind } from "@claude-lens/parser";
import type { UsageSnapshot, UsageWindow } from "./api.js";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

const BAR_WIDTH = 40;
const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

/** Claude first, then priority peers, then alphabetical — matches menubar strip. */
const AGENT_PRIORITY = ["claude-code", "codex", "copilot", "zai", "grok"];

export type MultiUsageFormatOpts = {
  /** When true, header says "live" and reminds Ctrl+C. */
  watch?: boolean;
  /** Seconds between redraws (watch mode). */
  intervalSec?: number;
};

/**
 * Render a compact usage snapshot suitable for a terminal. Each row spans
 * two lines — one for the bar + label + percentage, one for the reset hint.
 * Uses Unicode eighth-blocks for sub-cell precision so even ~1% differences
 * are visually distinct.
 *
 * Single-agent (Claude) formatter kept for tests and --agent=claude-code.
 */
export function formatUsage(snapshot: UsageSnapshot): string {
  const agent = snapshot.agent ?? "claude-code";
  return formatMultiAgentUsage({ [agent]: snapshot });
}

/**
 * Multi-agent terminal view — same meters the menubar strip shows, as text.
 * Empty map → empty string (caller handles the "no data" message).
 */
export function formatMultiAgentUsage(
  byAgent: Record<string, UsageSnapshot>,
  opts: MultiUsageFormatOpts = {},
): string {
  const kinds = Object.keys(byAgent).sort(compareAgents);
  if (kinds.length === 0) return "";

  const lines: string[] = [];
  lines.push("");
  if (opts.watch) {
    const sec = opts.intervalSec ?? 2;
    lines.push(
      `  ${BOLD}Fleetlens Usage${RESET}  ${DIM}live · every ${sec}s · Ctrl+C to quit${RESET}`,
    );
  } else {
    lines.push(`  ${BOLD}Fleetlens Usage${RESET}`);
  }
  lines.push("");

  for (const kind of kinds) {
    const snap = byAgent[kind]!;
    lines.push(...formatAgentBlock(kind, snap));
  }

  const newest = kinds
    .map((k) => byAgent[k]!.captured_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  if (newest) {
    lines.push(`  ${DIM}newest sample ${formatRelative(newest)}${RESET}`);
  }
  lines.push("");
  return lines.join("\n");
}

function formatAgentBlock(kind: string, snapshot: UsageSnapshot): string[] {
  const lines: string[] = [];
  const title = agentTitle(kind);
  const plan = snapshot.plan_type ? `  ${DIM}${snapshot.plan_type}${RESET}` : "";
  lines.push(`  ${BOLD}${title}${RESET}${plan}`);

  for (const [label, window] of agentWindows(kind, snapshot)) {
    if (!window || window.utilization === null) continue;
    const pct = window.utilization;
    const bar = renderBar(pct);
    const pctStr = `${pct.toFixed(1)}%`.padStart(6);
    const labelStr = label.padEnd(16);
    lines.push(`  ${labelStr}${bar}  ${BOLD}${pctStr}${RESET}`);
    if (window.resets_at) {
      lines.push(`  ${" ".repeat(16)}${DIM}resets ${formatRelative(window.resets_at)}${RESET}`);
    }
  }

  // Claude-only extras that still matter in a multi view.
  if ((kind === "claude-code" || !kind) && snapshot.extra_usage?.is_enabled) {
    const extra = snapshot.extra_usage;
    if (extra.utilization !== null) {
      lines.push(
        `  ${"Extra usage".padEnd(16)}${renderBar(extra.utilization)}  ${BOLD}${extra.utilization.toFixed(1)}%${RESET}`,
      );
    }
    if (extra.used_credits !== null && extra.monthly_limit !== null) {
      lines.push(
        `  ${" ".repeat(16)}${DIM}${extra.used_credits} / ${extra.monthly_limit} credits${RESET}`,
      );
    }
  }

  if (kind === "zai" && snapshot.web_search_quota) {
    const used = snapshot.web_search_quota.used;
    if (used !== null && used !== undefined) {
      lines.push(
        `  ${"Web search".padEnd(16)}${renderBar(used)}  ${BOLD}${used.toFixed(0)}%${RESET}`,
      );
    }
  }

  if (kind === "copilot" && snapshot.monthly_quota && !snapshot.monthly_quota.unlimited) {
    const q = snapshot.monthly_quota;
    if (q.used !== null && q.limit !== null) {
      const unit = q.unit === "premium-requests" ? "premium requests" : "AI credits";
      lines.push(
        `  ${" ".repeat(16)}${DIM}${q.used} / ${q.limit} ${unit}${RESET}`,
      );
    }
  }

  lines.push("");
  return lines;
}

function agentWindows(
  kind: string,
  snapshot: UsageSnapshot,
): Array<[string, UsageWindow | null | undefined]> {
  if (kind === "copilot") {
    return [["Monthly", snapshot.monthly]];
  }
  if (kind === "grok") {
    return [["7 day", snapshot.seven_day]];
  }
  // Codex accounts that dropped the 5h limit only report 7d.
  if (kind === "codex" && snapshot.five_hour?.utilization == null) {
    return [["7 day", snapshot.seven_day]];
  }

  const rows: Array<[string, UsageWindow | null | undefined]> = [
    ["5 hour", snapshot.five_hour],
    ["7 day", snapshot.seven_day],
  ];
  if (kind === "claude-code" || !snapshot.agent) {
    if (snapshot.seven_day_opus?.utilization != null) {
      rows.push(["7 day (Opus)", snapshot.seven_day_opus]);
    }
    if (snapshot.seven_day_sonnet?.utilization != null) {
      rows.push(["7 day (Sonnet)", snapshot.seven_day_sonnet]);
    }
  }
  return rows;
}

function agentTitle(kind: string): string {
  if (isAgentKind(kind)) {
    return getAgentMetadata(kind)?.displayName ?? kind;
  }
  return kind;
}

function compareAgents(a: string, b: string): number {
  const ia = AGENT_PRIORITY.indexOf(a);
  const ib = AGENT_PRIORITY.indexOf(b);
  if (ia !== -1 || ib !== -1) {
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  }
  return a.localeCompare(b);
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
