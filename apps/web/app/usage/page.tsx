/**
 * Usage page — historical utilization analytics, per agent.
 *
 * One tab per agent that has snapshots on disk. Each tab renders the
 * same dashboard layout (burndown charts + previous-cycles trend) so
 * Claude Code and Codex are peers, not primary/secondary.
 *
 * Reads from ~/.cclens/usage.jsonl — the daemon writes both agents'
 * snapshots there, tagged with `agent`. Filtering happens at read time.
 */

import { Activity } from "lucide-react";
import Link from "next/link";
import {
  readUsageSnapshots,
  readUsageSnapshotsByAgent,
  latestUsageSnapshotByAgent,
  readCachedPlanTier,
  PLAN_TIER_LABELS,
} from "@/lib/usage-data";
import {
  readCalibrationDump,
  predictedSeriesFor,
  previousCyclesTrend,
} from "@/lib/calibration-data";
import { UsageChartsDashboard } from "@/components/usage-charts-dashboard";
import { PreviousCyclesTrend } from "@/components/previous-cycles-trend";
import {
  type AgentKind,
  agentMetadata,
  getAgentMetadata,
  isAgentKind,
} from "@claude-lens/parser";

export const dynamic = "force-dynamic";

function agentLabel(kind: AgentKind): string {
  return getAgentMetadata(kind)?.displayName ?? kind;
}

function agentAccent(kind: AgentKind): string {
  return getAgentMetadata(kind)?.accentColor ?? "var(--af-text-tertiary)";
}

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string }>;
}) {
  const params = await searchParams;
  const allSnapshots = readUsageSnapshots();
  const agentsWithData = new Set<AgentKind>();
  for (const s of allSnapshots) {
    const k = (s.agent ?? "claude-code") as AgentKind;
    agentsWithData.add(k);
  }
  // Always show Claude in the tab strip even if empty — it's the canonical
  // source. Codex appears only once it has at least one snapshot.
  agentsWithData.add("claude-code");
  // Always list Grok once registered — weekly pool snapshots appear after
  // the daemon's first poll; the tab still works empty.
  if (getAgentMetadata("grok")) agentsWithData.add("grok");

  const requested: AgentKind | undefined = isAgentKind(params.agent) ? params.agent : undefined;
  const selected: AgentKind =
    requested && agentsWithData.has(requested)
      ? requested
      : agentsWithData.has("claude-code")
        ? "claude-code"
        : (Array.from(agentsWithData)[0] as AgentKind);

  const snapshots = readUsageSnapshotsByAgent(selected);
  const latest = latestUsageSnapshotByAgent(selected);
  const tier = selected === "claude-code" ? readCachedPlanTier() : null;
  const calibration = selected === "claude-code" ? await readCalibrationDump() : null;
  const predicted = calibration ? predictedSeriesFor(calibration) : null;
  // A quarter of 7-day cycles. The bars are a grid of equal columns, so a
  // longer history just narrows them rather than overflowing.
  const cycles7d = calibration ? previousCyclesTrend(calibration, "7d", 12) : [];
  const isGrok = selected === "grok";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        maxWidth: 1400,
        padding: "20px 32px",
      }}
    >
      <header
        style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}
      >
        <h1
          style={{
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            margin: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Activity size={18} />
          Usage history
        </h1>
        <span style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>
          historical plan utilization · current usage in sidebar
        </span>
        {tier && selected === "claude-code" && (
          <span
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              padding: "4px 10px",
              border: "1px solid var(--af-border-subtle)",
              borderRadius: 999,
              fontFamily: "var(--font-mono)",
            }}
            title={tier.rateLimitTier ? `Anthropic rate_limit_tier: ${tier.rateLimitTier}` : undefined}
          >
            <span style={{ color: "var(--af-text-tertiary)" }}>plan</span>
            <span style={{ color: "var(--af-text)", fontWeight: 600 }}>
              {PLAN_TIER_LABELS[tier.planTier].label}
            </span>
            {PLAN_TIER_LABELS[tier.planTier].monthlyPriceUsd > 0 && (
              <span style={{ color: "var(--af-text-tertiary)" }}>
                · ${PLAN_TIER_LABELS[tier.planTier].monthlyPriceUsd}/mo
              </span>
            )}
          </span>
        )}
        {selected === "codex" && latest?.plan_type && (
          <span
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              padding: "4px 10px",
              border: "1px solid var(--af-border-subtle)",
              borderRadius: 999,
              fontFamily: "var(--font-mono)",
            }}
          >
            <span style={{ color: "var(--af-text-tertiary)" }}>plan</span>
            <span style={{ color: "var(--af-text)", fontWeight: 600 }}>
              Codex {latest.plan_type}
            </span>
          </span>
        )}
        {selected === "zai" && latest?.plan_type && (
          <span
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              padding: "4px 10px",
              border: "1px solid var(--af-border-subtle)",
              borderRadius: 999,
              fontFamily: "var(--font-mono)",
            }}
          >
            <span style={{ color: "var(--af-text-tertiary)" }}>plan</span>
            <span style={{ color: "var(--af-text)", fontWeight: 600 }}>
              {latest.plan_type}
            </span>
          </span>
        )}
      </header>

      {/* Agent tab strip — one Link per agent that has snapshots. */}
      <AgentTabs agents={Array.from(agentsWithData)} selected={selected} />

      {!latest ? (
        <EmptyState agent={selected} />
      ) : (
        <>
          {isGrok && latest.seven_day?.utilization != null && (
            <GrokWeeklyCard
              utilization={latest.seven_day.utilization}
              resetsAt={latest.seven_day.resets_at}
              planType={latest.plan_type}
            />
          )}
          {cycles7d.length > 0 && (
            <PreviousCyclesTrend windowLabel="7d" cycles={cycles7d} />
          )}
          <UsageChartsDashboard
            snapshots={snapshots}
            predicted={predicted ?? undefined}
            windows={
              isGrok
                ? [
                    {
                      // Grok has no 5h window — chart only the weekly pool.
                      key: "seven_day",
                      label: "7d utilization (weekly pool)",
                      windowMs: 7 * 24 * 60 * 60 * 1000,
                      colorVar: "var(--af-accent)",
                    },
                  ]
                : undefined
            }
            hideSonnet={isGrok}
          />
          {selected === "zai" && latest?.web_search_quota && (
            <WebSearchQuotaCard quota={latest.web_search_quota} />
          )}
          <div
            style={{
              fontSize: 11,
              color: "var(--af-text-tertiary)",
              fontFamily: "var(--font-mono)",
            }}
            suppressHydrationWarning
          >
            Last {agentLabel(selected)} poll: {new Date(latest.captured_at).toLocaleString()} ·{" "}
            {snapshots.length} snapshot{snapshots.length === 1 ? "" : "s"} on disk
            {isGrok ? " · weekly shared-pool % (no 5h window)" : ""}
          </div>
        </>
      )}
    </div>
  );
}

function WebSearchQuotaCard({
  quota,
}: {
  quota: { used: number | null; limit: number | null };
}) {
  // web_search_quota is a percentage meter (used = 0–100, limit = 100),
  // matching Z.ai's portal display — not a raw usage/remaining split.
  const pct = quota.used ?? 0;
  return (
    <div className="af-card" style={{ padding: "16px 18px" }}>
      <div
        style={{
          fontSize: 11,
          color: "var(--af-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontWeight: 600,
        }}
      >
        Monthly web search
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          marginTop: 8,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {Math.round(pct)}%
      </div>
      <div
        style={{
          marginTop: 10,
          height: 6,
          width: "100%",
          background: "var(--af-border-subtle)",
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, pct)}%`,
            background: "rgb(59, 130, 246)",
            borderRadius: 999,
            transition: "width 0.24s ease",
          }}
        />
      </div>
    </div>
  );
}

function AgentTabs({ agents, selected }: { agents: AgentKind[]; selected: AgentKind }) {
  // Claude first, then everything else alphabetically.
  const sorted = [...agents].sort((a, b) => {
    if (a === "claude-code") return -1;
    if (b === "claude-code") return 1;
    return a.localeCompare(b);
  });
  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        gap: 4,
        padding: 4,
        background: "var(--af-border-subtle)",
        borderRadius: 8,
        alignSelf: "flex-start",
      }}
    >
      {sorted.map((kind) => {
        const isActive = kind === selected;
        return (
          <Link
            key={kind}
            role="tab"
            aria-selected={isActive}
            href={`/usage?agent=${kind}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.01em",
              color: isActive ? "var(--af-text)" : "var(--af-text-tertiary)",
              background: isActive ? "var(--af-surface)" : "transparent",
              boxShadow: isActive ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
              textDecoration: "none",
              transition: "all 0.12s ease",
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: 999,
                background: agentAccent(kind),
                opacity: isActive ? 1 : 0.6,
              }}
            />
            {agentLabel(kind)}
          </Link>
        );
      })}
    </div>
  );
}

function GrokWeeklyCard({
  utilization,
  resetsAt,
  planType,
}: {
  utilization: number;
  resetsAt?: string | null;
  planType?: string | null;
}) {
  const pct = Math.round(Math.min(100, Math.max(0, utilization)));
  return (
    <div className="af-card" style={{ padding: "16px 18px" }}>
      <div
        style={{
          fontSize: 11,
          color: "var(--af-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontWeight: 600,
        }}
      >
        7-day weekly pool
        {planType ? (
          <span style={{ marginLeft: 8, fontWeight: 500, textTransform: "none" }}>
            · {planType}
          </span>
        ) : null}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          marginTop: 8,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {pct}%
      </div>
      <div
        style={{
          marginTop: 10,
          height: 8,
          borderRadius: 999,
          background: "var(--af-border-subtle)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            borderRadius: 999,
            background: agentAccent("grok"),
          }}
        />
      </div>
      <p style={{ fontSize: 12, color: "var(--af-text-tertiary)", marginTop: 10, marginBottom: 0 }}>
        Grok unified-billing shared weekly pool (same source as the Grok CLI).
        There is no 5-hour window — only this 7-day limit.
        {resetsAt ? (
          <>
            {" "}
            Resets {new Date(resetsAt).toLocaleString()}.
          </>
        ) : null}
      </p>
    </div>
  );
}

function EmptyState({ agent }: { agent: AgentKind }) {
  if (agent === "grok") {
    return (
      <div
        className="af-card"
        style={{
          padding: "48px 32px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "var(--af-text)",
          }}
        >
          No Grok weekly usage samples yet
        </div>
        <p
          style={{
            fontSize: 12,
            color: "var(--af-text-tertiary)",
            marginTop: 8,
            maxWidth: 440,
            marginLeft: "auto",
            marginRight: "auto",
            lineHeight: 1.5,
          }}
        >
          The daemon polls Grok&apos;s weekly shared-pool % (via the same billing API as
          the Grok CLI). Run <code style={{ fontSize: 11 }}>grok login</code> if needed,
          then start the daemon.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
          <pre
            style={{
              display: "inline-block",
              background: "var(--background)",
              border: "1px solid var(--af-border-subtle)",
              padding: "8px 16px",
              borderRadius: 6,
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              color: "var(--af-text)",
              margin: 0,
            }}
          >
            fleetlens daemon start
          </pre>
          <Link
            href="/sessions?agent=grok"
            className="af-btn af-btn-primary"
            style={{ display: "inline-flex", alignItems: "center", fontSize: 12, padding: "6px 14px" }}
          >
            View Grok sessions
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="af-card"
      style={{
        padding: "48px 32px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: "var(--af-text)",
        }}
      >
        No {agentLabel(agent)} usage data yet
      </div>
      <p
        style={{
          fontSize: 12,
          color: "var(--af-text-tertiary)",
          marginTop: 8,
        }}
      >
        {agent === "claude-code"
          ? "Start the polling daemon to begin collecting metrics every 5 minutes:"
          : agent === "zai"
            ? "Save a Z.ai API key in Settings; the daemon (or a settings save) writes utilization snapshots here."
            : "The daemon picks up this agent's rate-limit windows from disk on every poll cycle. Run a session and the data will appear here within minutes."}
      </p>
      {agent === "claude-code" && (
        <pre
          style={{
            display: "inline-block",
            marginTop: 14,
            background: "var(--background)",
            border: "1px solid var(--af-border-subtle)",
            padding: "8px 16px",
            borderRadius: 6,
            fontSize: 13,
            fontFamily: "var(--font-mono)",
            color: "var(--af-text)",
          }}
        >
          fleetlens daemon start
        </pre>
      )}
    </div>
  );
}
