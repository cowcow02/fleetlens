import type { Recommendation } from "../lib/plan-optimizer";
import { PLAN_TIERS, type PlanTierKey } from "../lib/plan-tiers";
import { advisoryColor, type AdvisoryTone } from "../lib/advisory-tone";

type Props = {
  membershipId: string;
  memberName: string;
  memberEmail: string | null;
  currentPlan: { key: string; label: string; monthlyPriceUsd: number };
  usage: {
    avgSevenDayPct: number;
    worstSevenDayPeak: number;
    worstFiveHourPeak: number;
    worstOpusPeak: number;
    totalDaysObserved: number;
    lastSeen: string | null;
  };
  recommendation: Recommendation;
};

const ACTION_LABEL: Record<Recommendation["action"], string> = {
  insufficient_data: "Collecting data",
  review_manually: "Review manually",
  top_up_needed: "Top up needed",
  upgrade_urgent: "Upgrade urgent",
  upgrade: "Upgrade suggested",
  downgrade: "Downgrade",
  stay: "Plan well-matched",
};

// `downgrade` is `warn`, not `danger` — light use is an optimization
// opportunity for the admin, not a problem for the member. Red is
// reserved for the genuinely-bad states (at-the-cap throttling).
const ACTION_TONE: Record<Recommendation["action"], AdvisoryTone> = {
  insufficient_data: "info",
  review_manually: "info",
  top_up_needed: "danger",
  upgrade_urgent: "danger",
  upgrade: "warn",
  downgrade: "warn",
  stay: "good",
};

export function OptimizerCard(props: Props) {
  const { recommendation: r, usage, currentPlan, memberName, memberEmail } = props;
  const tone = ACTION_TONE[r.action];
  const targetTier = "targetTier" in r ? PLAN_TIERS[r.targetTier as PlanTierKey] : null;

  return (
    <div className="optimizer-card" style={cardStyle(tone)}>
      <div className="optimizer-card-head">
        <div>
          <div className="optimizer-card-name">{memberName}</div>
          {memberEmail && memberName !== memberEmail && (
            <div className="optimizer-card-email mono">{memberEmail}</div>
          )}
        </div>
        <div className="optimizer-card-tier mono">
          {currentPlan.label}
          {currentPlan.monthlyPriceUsd > 0 && (
            <span style={{ color: "var(--mute)", marginLeft: 6 }}>
              ${currentPlan.monthlyPriceUsd}/mo
            </span>
          )}
        </div>
      </div>

      <div className="optimizer-card-stats">
        <Stat label="7d avg" value={`${usage.avgSevenDayPct.toFixed(0)}%`} />
        <Stat label="7d peak" value={`${usage.worstSevenDayPeak.toFixed(0)}%`} />
        <Stat label="5h peak" value={`${usage.worstFiveHourPeak.toFixed(0)}%`} />
        <Stat
          label="Days obs"
          value={`${usage.totalDaysObserved} / 30`}
        />
      </div>

      <div className="optimizer-card-action" style={recBadge(tone)}>
        <span className="mono" style={{ letterSpacing: "0.1em", fontSize: 11 }}>
          {ACTION_LABEL[r.action].toUpperCase()}
        </span>
        {"confidence" in r && (
          <span className="mono" style={{ fontSize: 10, color: "var(--mute)", marginLeft: 8 }}>
            · {r.confidence}
          </span>
        )}
      </div>

      <div className="optimizer-card-rationale">{r.rationale}</div>

      {r.action === "downgrade" && (
        <div className="optimizer-card-savings mono">
          Saves ~${Math.round(r.estimatedSavingsUsd)}/month
          {targetTier && (
            <span style={{ color: "var(--mute)", marginLeft: 8 }}>
              → {targetTier.label} (${targetTier.monthlyPriceUsd}/mo)
            </span>
          )}
        </div>
      )}
      {(r.action === "upgrade" || r.action === "upgrade_urgent") && targetTier && (
        <div className="optimizer-card-savings mono" style={{ color: "var(--ink)" }}>
          → {targetTier.label} (${targetTier.monthlyPriceUsd}/mo)
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="optimizer-card-stat">
      <div className="optimizer-card-stat-label">{label}</div>
      <div className="optimizer-card-stat-value mono">{value}</div>
    </div>
  );
}

function cardStyle(tone: AdvisoryTone): React.CSSProperties {
  return {
    background: "var(--paper)",
    border: "1px solid var(--rule)",
    borderLeft: `3px solid ${advisoryColor(tone)}`,
    padding: "16px 18px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  };
}

function recBadge(tone: AdvisoryTone): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    color: advisoryColor(tone),
    fontWeight: 600,
  };
}
