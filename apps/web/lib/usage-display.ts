import type { AgentKind } from "@claude-lens/parser";

type UsageAgentEvidence = { agent?: AgentKind };

export function visibleUsageAgents(snapshots: UsageAgentEvidence[]): AgentKind[] {
  const agents = new Set<AgentKind>();
  for (const snapshot of snapshots) {
    agents.add(snapshot.agent ?? "claude-code");
  }
  agents.add("claude-code");
  return Array.from(agents);
}

/** Claude first, then the rest alphabetically — matches /usage tabs. */
export function sortUsageAgents(agents: AgentKind[]): AgentKind[] {
  return [...agents].sort((a, b) => {
    if (a === "claude-code") return -1;
    if (b === "claude-code") return 1;
    return a.localeCompare(b);
  });
}

export type SidebarUsageRow = {
  label: string;
  window: { utilization: number | null; resets_at: string | null } | null;
  windowMs: number;
};

const HOUR = 3_600_000;
const FIVE_HOURS_MS = 5 * HOUR;
const SEVEN_DAYS_MS = 7 * 24 * HOUR;
const MONTHLY_MS = 30 * 24 * HOUR;

/**
 * Which meters the sidebar shows for an agent. Mirrors /usage so switching
 * the sidebar agent doesn't invent windows that agent never reports.
 */
export function sidebarUsageRows(
  agent: AgentKind,
  snapshot: {
    five_hour?: { utilization: number | null; resets_at: string | null } | null;
    seven_day?: { utilization: number | null; resets_at: string | null } | null;
    seven_day_sonnet?: { utilization: number | null; resets_at: string | null } | null;
    monthly?: { utilization: number | null; resets_at: string | null } | null;
  } | null,
  opts: { showSonnet?: boolean } = {},
): SidebarUsageRow[] {
  if (!snapshot) return [];

  if (agent === "copilot" || agent === "kaihk" || agent.startsWith("kaihk-")) {
    // Calendar-month length (same rule as UsageChart.cycleStart for monthly).
    // A fixed 30d window mis-colors pace near ±15pp in Feb / 31-day months.
    const monthly = snapshot.monthly ?? null;
    let windowMs = MONTHLY_MS;
    if (monthly?.resets_at) {
      const endMs = new Date(monthly.resets_at).getTime();
      if (Number.isFinite(endMs)) {
        const reset = new Date(endMs);
        const startMs = Date.UTC(reset.getUTCFullYear(), reset.getUTCMonth() - 1, 1);
        windowMs = Math.max(HOUR, endMs - startMs);
      }
    }
    return [{ label: "Monthly", window: monthly, windowMs }];
  }
  if (agent === "grok") {
    return [{ label: "7d", window: snapshot.seven_day ?? null, windowMs: SEVEN_DAYS_MS }];
  }
  if (agent === "command-code") {
    const monthly = snapshot.monthly ?? null;
    let monthlyMs = MONTHLY_MS;
    if (monthly?.resets_at) {
      const endMs = new Date(monthly.resets_at).getTime();
      if (Number.isFinite(endMs)) {
        const reset = new Date(endMs);
        const startMs = Date.UTC(reset.getUTCFullYear(), reset.getUTCMonth() - 1, 1);
        monthlyMs = Math.max(HOUR, endMs - startMs);
      }
    }
    return [
      { label: "5h", window: snapshot.five_hour ?? null, windowMs: FIVE_HOURS_MS },
      { label: "wk", window: snapshot.seven_day ?? null, windowMs: SEVEN_DAYS_MS },
      { label: "Monthly", window: monthly, windowMs: monthlyMs },
    ];
  }
  // Codex accounts that dropped the 5h limit only report 7d.
  if (agent === "codex" && snapshot.five_hour?.utilization == null) {
    return [{ label: "7d", window: snapshot.seven_day ?? null, windowMs: SEVEN_DAYS_MS }];
  }

  const rows: SidebarUsageRow[] = [
    { label: "5h", window: snapshot.five_hour ?? null, windowMs: FIVE_HOURS_MS },
    { label: "7d", window: snapshot.seven_day ?? null, windowMs: SEVEN_DAYS_MS },
  ];
  if (agent === "claude-code" && opts.showSonnet) {
    rows.push({
      label: "Sonnet 7d",
      window: snapshot.seven_day_sonnet ?? null,
      windowMs: SEVEN_DAYS_MS,
    });
  }
  return rows;
}

export type CopilotMonthlyQuota = {
  used: number | null;
  limit: number | null;
  remaining: number | null;
  unit: "ai-credits" | "premium-requests" | "credits" | "usd";
  unlimited: boolean;
};

export function copilotUnitLabel(
  unit?: CopilotMonthlyQuota["unit"],
): "AI credits" | "premium requests" | "credits" | "USD" {
  if (unit === "premium-requests") return "premium requests";
  if (unit === "credits") return "credits";
  if (unit === "usd") return "USD";
  return "AI credits";
}

function formatQuotaUsd(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  if (Math.abs(n) >= 0.01) return `$${n.toFixed(2)}`;
  const trimmed = n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `$${trimmed || "0"}`;
}

export function copilotQuotaPresentation(
  utilization: number | null,
  quota?: CopilotMonthlyQuota | null,
): {
  headline: string;
  detail: string | null;
  limitNotReported: boolean;
} {
  const unit = copilotUnitLabel(quota?.unit);
  if (quota?.unlimited) {
    return {
      headline: "Limit not reported",
      detail: quota.used === null
        ? null
        : unit === "USD"
          ? `${formatQuotaUsd(quota.used)} reported`
          : `${quota.used.toLocaleString("en-US")} ${unit} reported by Copilot`,
      limitNotReported: true,
    };
  }

  const detail = quota?.used !== null && quota?.used !== undefined
    && quota.limit !== null
    ? unit === "USD"
      ? `${formatQuotaUsd(quota.used)} of ${formatQuotaUsd(quota.limit)} used${
        quota.remaining !== null ? ` · ${formatQuotaUsd(quota.remaining)} remaining` : ""
      }`
      : `${quota.used.toLocaleString("en-US")} of ${quota.limit.toLocaleString("en-US")} ${unit} used${
        quota.remaining !== null ? ` · ${quota.remaining.toLocaleString("en-US")} remaining` : ""
      }`
    : null;

  return {
    headline: utilization === null ? "—" : `${utilization.toFixed(1)}%`,
    detail,
    limitNotReported: false,
  };
}
