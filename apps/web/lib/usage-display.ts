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

export type CopilotMonthlyQuota = {
  used: number | null;
  limit: number | null;
  remaining: number | null;
  unit: "ai-credits" | "premium-requests";
  unlimited: boolean;
};

export function copilotQuotaPresentation(
  utilization: number | null,
  quota?: CopilotMonthlyQuota | null,
): {
  headline: string;
  detail: string | null;
  limitNotReported: boolean;
} {
  const unit = quota?.unit === "premium-requests" ? "premium requests" : "AI credits";
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
