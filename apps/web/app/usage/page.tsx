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
  getAgentMetadata,
  isAgentKind,
} from "@claude-lens/parser";
import {
  copilotQuotaPresentation,
  copilotUnitLabel,
  type CopilotMonthlyQuota,
  visibleUsageAgents,
} from "@/lib/usage-display";

export const dynamic = "force-dynamic";

function isKaihkAgent(kind: string): boolean {
  return kind === "kaihk" || kind.startsWith("kaihk-");
}

function isUsageAgentKind(s: string | undefined): s is AgentKind {
  if (!s) return false;
  // Prefix checks first: isAgentKind is `s is AgentKind` and AgentKind is
  // `string`, so its false branch narrows to `never`.
  if (s.startsWith("claude-code:") || isKaihkAgent(s)) return true;
  return isAgentKind(s);
}

function agentLabel(kind: AgentKind): string {
  if (kind === "kaihk") return "KaiHK";
  if (kind.startsWith("kaihk-")) return `KaiHK (${kind.slice("kaihk-".length)})`;
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
  // Tabs represent usage sources found on this machine. Claude stays as the
  // canonical empty state; every other provider needs a real saved sample.
  const agentsWithData = new Set(visibleUsageAgents(allSnapshots));

  const requested: AgentKind | undefined = isUsageAgentKind(params.agent) ? params.agent : undefined;
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
  const isCopilot = selected === "copilot";
  const isKaihk = isKaihkAgent(selected);
  const isCommandCode = selected === "command-code";
  const commandCodeAccent = agentAccent("command-code");
  const codexWeeklyOnly =
    selected === "codex" && latest?.five_hour?.utilization == null;

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
        {isCopilot && latest?.plan_type && (
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
            <span style={{ color: "var(--af-text-tertiary)" }}>allowance</span>
            <span style={{ color: "var(--af-text)", fontWeight: 600 }}>
              GitHub Copilot · {latest.plan_type}
            </span>
          </span>
        )}
        {isCommandCode && latest?.plan_type && (
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
              Command Code · {latest.plan_type}
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

      {codexWeeklyOnly && (
        <div
          className="af-card"
          style={{
            padding: "12px 16px",
            fontSize: 12,
            color: "var(--af-text-secondary)",
          }}
        >
          <strong style={{ color: "var(--af-text)" }}>Codex 5-hour limit removed.</strong>{" "}
          This account is reporting a single 7-day usage window, so Fleetlens hides the retired 5-hour meter.
        </div>
      )}

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
          {isCommandCode && (
            <>
              <CommandCodeRateLimitsCard
                fiveHour={latest.five_hour}
                weekly={latest.seven_day}
              />
              {latest.monthly && (
                <CommandCodeMonthlyCard
                  window={latest.monthly}
                  quota={latest.monthly_quota}
                  planType={latest.plan_type}
                />
              )}
            </>
          )}
          {(isCopilot || isKaihk) && latest.monthly && (
            <CopilotMonthlyCard
              window={latest.monthly}
              quota={latest.monthly_quota}
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
                : isCopilot || isKaihk
                  ? [
                      {
                        key: "monthly",
                        label: isKaihk
                          ? "KaiHK wallet spend"
                          : "Monthly AI-credit utilization",
                        // Monthly charts derive their exact start from the
                        // reset date; this value is only a nominal fallback.
                        windowMs: 30 * 24 * 60 * 60 * 1000,
                        colorVar: agentAccent(isKaihk ? selected : "copilot"),
                      },
                    ]
                : isCommandCode
                  ? [
                      {
                        key: "five_hour",
                        label: "5h utilization",
                        windowMs: 5 * 60 * 60 * 1000,
                        colorVar: "var(--af-success)",
                      },
                      {
                        key: "seven_day",
                        label: "Weekly utilization",
                        windowMs: 7 * 24 * 60 * 60 * 1000,
                        colorVar: commandCodeAccent,
                      },
                      {
                        key: "monthly",
                        label: "Monthly credit utilization",
                        windowMs: 30 * 24 * 60 * 60 * 1000,
                        colorVar: commandCodeAccent,
                      },
                    ]
                : codexWeeklyOnly
                  ? [
                      {
                        key: "seven_day",
                        label: "7d utilization (current limit)",
                        windowMs: 7 * 24 * 60 * 60 * 1000,
                        colorVar: "var(--af-accent)",
                      },
                    ]
                : undefined
            }
            hideSonnet={isGrok || isCopilot || isKaihk || isCommandCode || selected === "codex"}
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
            {isCopilot ? " · monthly AI-credit allowance (no 5h/7d windows)" : ""}
            {isKaihk ? " · spend vs the KaiHK wallet USD cap (no 5h/7d windows)" : ""}
            {isCommandCode ? " · monthly credits + 5-hour and weekly windows" : ""}
            {codexWeeklyOnly ? " · weekly-only Codex limit" : ""}
          </div>
        </>
      )}
    </div>
  );
}

function CopilotMonthlyCard({
  window,
  quota,
}: {
  window: { utilization: number | null; resets_at: string | null };
  quota?: CopilotMonthlyQuota | null;
}) {
  const pct = window.utilization;
  const unit = copilotUnitLabel(quota?.unit);
  const presentation = copilotQuotaPresentation(pct, quota);
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
        Monthly {unit}
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
        {presentation.headline}
      </div>
      {presentation.detail && (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--af-text-secondary)" }}>
          {presentation.detail}
        </div>
      )}
      {pct !== null && (
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
              width: `${Math.min(100, Math.max(0, pct))}%`,
              height: "100%",
              borderRadius: 999,
              background: agentAccent("copilot"),
            }}
          />
        </div>
      )}
      {presentation.limitNotReported ? (
        <p style={{ fontSize: 12, color: "var(--af-text-tertiary)", marginTop: 10, marginBottom: 0, lineHeight: 1.5 }}>
          Copilot did not expose a personal credit ceiling for this account. Organization-managed plans can
          draw from a shared pool, so this does not mean individual use is unlimited.{" "}
          <a
            href="https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-organizations-and-enterprises"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--af-accent)" }}
          >
            How GitHub pools AI credits ↗
          </a>
          {" · "}
          <a
            href="https://github.com/settings/billing"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--af-accent)" }}
          >
            Verify in GitHub billing ↗
          </a>
          {window.resets_at ? ` · Reported reset ${new Date(window.resets_at).toLocaleString()}.` : ""}
        </p>
      ) : (
        <p style={{ fontSize: 12, color: "var(--af-text-tertiary)", marginTop: 10, marginBottom: 0 }}>
          Copilot reports a monthly allowance; it does not expose Codex-style 5-hour or 7-day windows.
          {window.resets_at ? ` Resets ${new Date(window.resets_at).toLocaleString()}.` : ""}
        </p>
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

function CommandCodeRateLimitsCard({
  fiveHour,
  weekly,
}: {
  fiveHour: { utilization: number | null; resets_at: string | null };
  weekly: { utilization: number | null; resets_at: string | null };
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: 12,
      }}
    >
      <CommandCodeWindowCard
        label="5-hour window"
        window={fiveHour}
        hint="Rolling 5-hour rate limit on this plan."
      />
      <CommandCodeWindowCard
        label="Weekly window"
        window={weekly}
        hint="Rolling 7-day rate limit. Extra purchased credits bypass this cap."
      />
    </div>
  );
}

function CommandCodeWindowCard({
  label,
  window,
  hint,
}: {
  label: string;
  window: { utilization: number | null; resets_at: string | null };
  hint: string;
}) {
  const has = window.utilization != null;
  const pct = has ? Math.min(100, Math.max(0, window.utilization!)) : 0;
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
        {label}
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
        {has ? `${pct.toFixed(1)}%` : "—"}
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
            width: has ? `${pct}%` : "0%",
            height: "100%",
            borderRadius: 999,
            background: agentAccent("command-code"),
          }}
        />
      </div>
      <p style={{ fontSize: 12, color: "var(--af-text-tertiary)", marginTop: 10, marginBottom: 0 }}>
        {hint}
        {window.resets_at ? ` Resets ${new Date(window.resets_at).toLocaleString()}.` : ""}
      </p>
    </div>
  );
}

function CommandCodeMonthlyCard({
  window,
  quota,
  planType,
}: {
  window: { utilization: number | null; resets_at: string | null };
  quota?: CopilotMonthlyQuota | null;
  planType?: string | null;
}) {
  const pct = window.utilization;
  const presentation = copilotQuotaPresentation(pct, quota);
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
        Monthly credits
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
        {presentation.headline}
      </div>
      {presentation.detail && (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--af-text-secondary)" }}>
          {presentation.detail}
        </div>
      )}
      {pct !== null && (
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
              width: `${Math.min(100, Math.max(0, pct))}%`,
              height: "100%",
              borderRadius: 999,
              background: agentAccent("command-code"),
            }}
          />
        </div>
      )}
      <p style={{ fontSize: 12, color: "var(--af-text-tertiary)", marginTop: 10, marginBottom: 0 }}>
        Plan credit allocation for this billing cycle. Extra purchased credits sit on top and are not
        in this meter.
        {window.resets_at ? ` Resets ${new Date(window.resets_at).toLocaleString()}.` : ""}
      </p>
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
  if (agent === "kaihk" || agent.startsWith("kaihk-")) {
    return (
      <div className="af-card" style={{ padding: "48px 32px", textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--af-text)" }}>
          No KaiHK usage samples yet
        </div>
        <p
          style={{
            fontSize: 12,
            color: "var(--af-text-tertiary)",
            margin: "8px auto 0",
            maxWidth: 520,
            lineHeight: 1.5,
          }}
        >
          Fleetlens reads KaiHK spend from OpenCode providers whose base URL is
          api.kaihk.com. Add a key there, then start the daemon or run{" "}
          <code style={{ fontSize: 11 }}>fleetlens usage --save</code>.
        </p>
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
          fleetlens usage --save
        </pre>
      </div>
    );
  }
  if (agent === "copilot") {
    return (
      <div className="af-card" style={{ padding: "48px 32px", textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--af-text)" }}>
          No GitHub Copilot usage samples yet
        </div>
        <p
          style={{
            fontSize: 12,
            color: "var(--af-text-tertiary)",
            margin: "8px auto 0",
            maxWidth: 520,
            lineHeight: 1.5,
          }}
        >
          Run <code style={{ fontSize: 11 }}>copilot login</code>, then start the Fleetlens daemon.
          Fleetlens reads the monthly AI-credit quota through Copilot CLI&apos;s authenticated local SDK server.
        </p>
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
      </div>
    );
  }
  if (agent === "command-code") {
    return (
      <div className="af-card" style={{ padding: "48px 32px", textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--af-text)" }}>
          No Command Code usage samples yet
        </div>
        <p
          style={{
            fontSize: 12,
            color: "var(--af-text-tertiary)",
            margin: "8px auto 0",
            maxWidth: 520,
            lineHeight: 1.5,
          }}
        >
          The daemon polls Command Code&apos;s monthly credits plus 5-hour and
          weekly windows (the same billing API the <code style={{ fontSize: 11 }}>cmd</code>{" "}
          /usage overlay uses). Run <code style={{ fontSize: 11 }}>cmd login</code> if needed,
          then start the daemon.
        </p>
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
      </div>
    );
  }
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
