import { getAgentMetadata, isAgentKind } from "@claude-lens/parser";
import type { UsageSnapshot, UsageWindow } from "./api.js";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

/** Claude first, then priority peers, then alphabetical — matches menubar strip. */
const AGENT_PRIORITY = ["claude-code", "codex", "copilot", "zai", "grok"];

export type MultiUsageFormatOpts = {
  /** When true, header says "live" and reminds Ctrl+C. */
  watch?: boolean;
  /** Seconds between redraws (watch mode). */
  intervalSec?: number;
  /**
   * Terminal width in columns. Defaults to process.stdout.columns or 80.
   * Narrow phones (~30–47) use a stacked compact layout; medium scales the
   * bar; wide keeps the desktop bar row.
   */
  columns?: number;
};

type Layout = {
  mode: "narrow" | "medium" | "wide";
  barWidth: number;
  labelWidth: number;
  shortLabels: boolean;
  /** Total columns used for layout math (clamped). */
  columns: number;
};

/**
 * Meter row budget:
 *   "  " + label + bar + "  " + "  N.N%"
 * so barWidth = columns - 2 - labelWidth - 2 - 6.
 * Bars always eat the remaining width (no artificial 28/40 cap) so phones
 * and wide desktops both fill edge-to-edge.
 */
function barWidthFor(columns: number, labelWidth: number): number {
  // left pad 2 + label + gap 2 + pct field 6
  return Math.max(4, columns - labelWidth - 10);
}

/** Pure helper — exported for unit tests. */
export function layoutForColumns(columns: number): Layout {
  const cols = Number.isFinite(columns) && columns > 0 ? Math.floor(columns) : 80;
  // Very tight phones: no bar, short labels, inline pct (fits ~30 cols).
  if (cols < 36) {
    return {
      mode: "narrow",
      barWidth: 0,
      labelWidth: 4,
      shortLabels: true,
      columns: cols,
    };
  }
  // Phone / tablet: short labels, bar fills the rest of the line.
  if (cols < 72) {
    const labelWidth = 4;
    return {
      mode: "medium",
      barWidth: barWidthFor(cols, labelWidth),
      labelWidth,
      shortLabels: true,
      columns: cols,
    };
  }
  // Desktop: long labels, bar still fills remaining width.
  const labelWidth = 16;
  return {
    mode: "wide",
    barWidth: barWidthFor(cols, labelWidth),
    labelWidth,
    shortLabels: false,
    columns: cols,
  };
}

function resolveColumns(explicit?: number): number {
  if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  // Prefer the live TTY size; fall back to COLUMNS (ssh/mobile clients often
  // export it even when the ioctl width is stale or missing).
  const c = process.stdout.columns;
  if (typeof c === "number" && c > 0) return c;
  const env = parseInt(process.env.COLUMNS ?? "", 10);
  if (Number.isFinite(env) && env > 0) return env;
  return 80;
}

/**
 * Render a compact usage snapshot suitable for a terminal. Each row spans
 * two lines — one for the bar + label + percentage, one for the reset hint.
 * Uses Unicode eighth-blocks for sub-cell precision so even ~1% differences
 * are visually distinct.
 *
 * Single-agent (Claude) formatter kept for tests and --agent=claude-code.
 */
export function formatUsage(snapshot: UsageSnapshot, opts: MultiUsageFormatOpts = {}): string {
  const agent = snapshot.agent ?? "claude-code";
  return formatMultiAgentUsage({ [agent]: snapshot }, opts);
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

  const layout = layoutForColumns(resolveColumns(opts.columns));
  const lines: string[] = [];
  lines.push("");
  if (opts.watch) {
    const sec = opts.intervalSec ?? 2;
    lines.push(
      layout.mode === "narrow"
        ? `  ${BOLD}Usage${RESET} ${DIM}live ${sec}s · ^C quit${RESET}`
        : `  ${BOLD}Fleetlens Usage${RESET}  ${DIM}live · every ${sec}s · Ctrl+C to quit${RESET}`,
    );
  } else {
    lines.push(
      layout.mode === "narrow"
        ? `  ${BOLD}Usage${RESET}`
        : `  ${BOLD}Fleetlens Usage${RESET}`,
    );
  }
  lines.push("");

  for (const kind of kinds) {
    const snap = byAgent[kind]!;
    lines.push(...formatAgentBlock(kind, snap, layout));
  }

  lines.push("");
  return lines.join("\n");
}

function formatAgentBlock(
  kind: string,
  snapshot: UsageSnapshot,
  layout: Layout,
): string[] {
  const lines: string[] = [];
  const title =
    layout.shortLabels && isAgentKind(kind)
      ? (getAgentMetadata(kind)?.shortLabel ?? agentTitle(kind))
      : agentTitle(kind);
  const plan =
    snapshot.plan_type && layout.mode !== "narrow"
      ? `  ${DIM}${snapshot.plan_type}${RESET}`
      : "";
  lines.push(`  ${BOLD}${title}${RESET}${plan}`);

  let renderedMeter = false;
  for (const [label, window] of agentWindows(kind, snapshot, layout.shortLabels)) {
    if (!window || window.utilization === null) continue;
    renderedMeter = true;
    lines.push(...formatMeterRow(label, window.utilization, window.resets_at, layout));
  }

  // Claude-only extras that still matter in a multi view.
  if ((kind === "claude-code" || !kind) && snapshot.extra_usage?.is_enabled) {
    renderedMeter = true;
    const extra = snapshot.extra_usage;
    if (extra.utilization !== null) {
      const label = layout.shortLabels ? "xtra" : "Extra usage";
      lines.push(...formatMeterRow(label, extra.utilization, null, layout));
    }
    if (extra.used_credits !== null && extra.monthly_limit !== null) {
      const pad = layout.mode === "narrow" ? 2 : layout.labelWidth + 2;
      lines.push(
        `  ${" ".repeat(pad)}${DIM}${extra.used_credits} / ${extra.monthly_limit} credits${RESET}`,
      );
    }
  }

  if (kind === "zai" && snapshot.web_search_quota) {
    const used = snapshot.web_search_quota.used;
    if (used !== null && used !== undefined) {
      renderedMeter = true;
      const label = layout.shortLabels ? "web" : "Web search";
      lines.push(...formatMeterRow(label, used, null, layout, { wholePct: true }));
    }
  }

  if (kind === "copilot" && snapshot.monthly_quota) {
    const q = snapshot.monthly_quota;
    const unit = q.unit === "premium-requests" ? "premium requests" : "AI credits";
    const pad = layout.mode === "narrow" ? 2 : layout.labelWidth + 2;
    if (q.unlimited) {
      renderedMeter = true;
      const lab = layout.shortLabels ? "mo" : "Monthly";
      lines.push(`  ${lab.padEnd(layout.labelWidth)}${BOLD}Limit not reported${RESET}`);
      if (q.used !== null) {
        lines.push(
          `  ${" ".repeat(pad)}${DIM}${q.used.toLocaleString("en-US")} ${unit}${RESET}`,
        );
      }
    } else if (q.used !== null && q.limit !== null) {
      lines.push(
        `  ${" ".repeat(pad)}${DIM}${q.used} / ${q.limit} ${unit}${RESET}`,
      );
    }
  }

  if (!renderedMeter) {
    lines.push(`  ${DIM}(no utilization windows)${RESET}`);
  }

  // Per-agent age so a live Claude poll can't make stale Codex look "now".
  lines.push(
    `  ${DIM}sampled ${formatRelative(snapshot.captured_at)}${RESET}`,
  );
  lines.push("");
  return lines;
}

function formatMeterRow(
  label: string,
  utilization: number,
  resetsAt: string | null | undefined,
  layout: Layout,
  opts: { wholePct?: boolean } = {},
): string[] {
  const pctStr = opts.wholePct
    ? `${utilization.toFixed(0)}%`.padStart(5)
    : `${utilization.toFixed(1)}%`.padStart(6);
  const labelStr = label.padEnd(layout.labelWidth);

  if (layout.mode === "narrow" && layout.barWidth <= 0) {
    // Ultra-narrow: "  5h   2.0%  r4h" — no bar, reset inline when present.
    const reset = resetsAt
      ? `  ${DIM}r${formatRelativeShort(resetsAt)}${RESET}`
      : "";
    return [`  ${labelStr}${BOLD}${pctStr}${RESET}${reset}`];
  }

  // Full-width bar: label |████····|  3.0%  — bar consumes every leftover cell.
  const bar = renderBar(utilization, layout.barWidth);
  const lines = [`  ${labelStr}${bar}  ${BOLD}${pctStr}${RESET}`];
  if (resetsAt) {
    // Indent under the bar (after label), not under the whole row.
    lines.push(
      `  ${" ".repeat(layout.labelWidth)}${DIM}resets ${formatRelative(resetsAt)}${RESET}`,
    );
  }
  return lines;
}

function agentWindows(
  kind: string,
  snapshot: UsageSnapshot,
  shortLabels: boolean,
): Array<[string, UsageWindow | null | undefined]> {
  const L = shortLabels
    ? { five: "5h", seven: "7d", monthly: "mo", opus: "opus", sonnet: "son", oauth: "oath", cowork: "cowk" }
    : {
        five: "5 hour",
        seven: "7 day",
        monthly: "Monthly",
        opus: "7 day (Opus)",
        sonnet: "7 day (Sonnet)",
        oauth: "7 day (OAuth apps)",
        cowork: "7 day (Cowork)",
      };

  if (kind === "copilot") {
    return [[L.monthly, snapshot.monthly]];
  }
  if (kind === "grok") {
    return [[L.seven, snapshot.seven_day]];
  }
  // Codex accounts that dropped the 5h limit only report 7d.
  if (kind === "codex" && snapshot.five_hour?.utilization == null) {
    return [[L.seven, snapshot.seven_day]];
  }

  const rows: Array<[string, UsageWindow | null | undefined]> = [
    [L.five, snapshot.five_hour],
    [L.seven, snapshot.seven_day],
  ];
  if (kind === "claude-code" || !snapshot.agent) {
    if (snapshot.seven_day_opus?.utilization != null) {
      rows.push([L.opus, snapshot.seven_day_opus]);
    }
    if (snapshot.seven_day_sonnet?.utilization != null) {
      rows.push([L.sonnet, snapshot.seven_day_sonnet]);
    }
    if (snapshot.seven_day_oauth_apps?.utilization != null) {
      rows.push([L.oauth, snapshot.seven_day_oauth_apps]);
    }
    if (snapshot.seven_day_cowork?.utilization != null) {
      rows.push([L.cowork, snapshot.seven_day_cowork]);
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
function renderBar(utilization: number, barWidth: number): string {
  if (barWidth <= 0) return "";
  const clamped = Math.max(0, Math.min(100, utilization));
  const color = clamped >= 90 ? RED : clamped >= 70 ? YELLOW : GREEN;

  // Convert to eighth-cells (8 eighths per character × barWidth).
  const totalEighths = Math.round((clamped / 100) * barWidth * 8);
  const fullBlocks = Math.floor(totalEighths / 8);
  const remainder = totalEighths % 8;
  const partial = EIGHTHS[remainder];
  const filledCells = fullBlocks + (partial ? 1 : 0);
  const emptyCells = Math.max(0, barWidth - filledCells);

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

/** Compact duration for narrow phones (paired with an "r" prefix for resets). */
function formatRelativeShort(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const abs = Math.abs(Math.round((then - now) / 1000));
  if (abs < 60) return `${abs}s`;
  if (abs < 3600) return `${Math.floor(abs / 60)}m`;
  if (abs < 86400) return `${Math.floor(abs / 3600)}h`;
  return `${Math.floor(abs / 86400)}d`;
}
