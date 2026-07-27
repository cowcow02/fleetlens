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

  if (agent === "copilot") {
    return [{ label: "Monthly", window: snapshot.monthly ?? null, windowMs: MONTHLY_MS }];
  }
  if (agent === "grok") {
    return [{ label: "7d", window: snapshot.seven_day ?? null, windowMs: SEVEN_DAYS_MS }];
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
  unit: "ai-credits" | "premium-requests";
  unlimited: boolean;
};

export function copilotUnitLabel(
  unit?: CopilotMonthlyQuota["unit"],
): "AI credits" | "premium requests" {
  return unit === "premium-requests" ? "premium requests" : "AI credits";
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
        : `${quota.used.toLocaleString("en-US")} ${unit} reported by Copilot`,
      limitNotReported: true,
    };
  }

  const detail = quota?.used !== null && quota?.used !== undefined
    && quota.limit !== null
    ? `${quota.used.toLocaleString("en-US")} of ${quota.limit.toLocaleString("en-US")} ${unit} used${
      quota.remaining !== null ? ` · ${quota.remaining.toLocaleString("en-US")} remaining` : ""
    }`
    : null;

  return {
    headline: utilization === null ? "—" : `${utilization.toFixed(1)}%`,
    detail,
    limitNotReported: false,
  };
}
