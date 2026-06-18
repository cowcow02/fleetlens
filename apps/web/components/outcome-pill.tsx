import Link from "next/link";
import type { DayOutcome } from "@claude-lens/entries";
import type { AgentKind } from "@claude-lens/parser";
import { AgentIcon } from "@/components/agent-icon";

export type EntryOutcome = Exclude<DayOutcome, "idle">;

type Style = { bg: string; fg: string; label: string; icon: string };

export const OUTCOME_STYLES: Record<DayOutcome, Style> = {
  shipped:     { bg: "rgba(72, 187, 120, 0.12)",  fg: "#48bb78", label: "Shipped",     icon: "🚀" },
  partial:     { bg: "rgba(66, 153, 225, 0.12)",  fg: "#4299e1", label: "Partial",     icon: "🔨" },
  blocked:     { bg: "rgba(245, 101, 101, 0.12)", fg: "#f56565", label: "Blocked",     icon: "🚧" },
  exploratory: { bg: "rgba(160, 174, 192, 0.12)", fg: "#a0aec0", label: "Exploratory", icon: "🧭" },
  trivial:     { bg: "rgba(203, 213, 224, 0.12)", fg: "#a0aec0", label: "Warmup",      icon: "💤" },
  idle:        { bg: "rgba(203, 213, 224, 0.12)", fg: "#a0aec0", label: "Idle",        icon: "—"  },
};

const PENDING_STYLE: Style = {
  bg: "rgba(160, 174, 192, 0.08)",
  fg: "var(--af-text-tertiary)",
  label: "pending",
  icon: "⋯",
};

const SIZES = {
  sm: { fontSize: 9,  padding: "1px 6px",  iconGap: 3, borderRadius: 99 },
  md: { fontSize: 10, padding: "2px 8px",  iconGap: 4, borderRadius: 99 },
  lg: { fontSize: 11, padding: "3px 10px", iconGap: 5, borderRadius: 99 },
} as const;

type Size = keyof typeof SIZES;
type Label = "icon" | "text" | "both";

type Props =
  | { outcome: DayOutcome | EntryOutcome; size?: Size; label?: Label; agent?: AgentKind; pending?: never }
  | {
      outcome: null;
      pending: true;
      sessionId?: string;
      localDay: string;
      size?: Size;
      agent?: AgentKind;
      // When the pill is rendered inside another anchor (e.g. a SessionCard
      // whose whole body is a <Link>), render a plain <span> instead of a
      // nested <Link> — nested <a> is invalid HTML and trips hydration. The
      // host is then responsible for the click → /digest navigation.
      noLink?: boolean;
    };

export function OutcomePill(props: Props) {
  const size = props.size ?? "md";
  const dim = SIZES[size];
  const agentIconSize = dim.fontSize + 1;

  if ("pending" in props && props.pending) {
    const style: React.CSSProperties = {
      display: "inline-flex",
      alignItems: "center",
      gap: dim.iconGap,
      padding: dim.padding,
      borderRadius: dim.borderRadius,
      fontSize: dim.fontSize,
      fontWeight: 600,
      background: PENDING_STYLE.bg,
      color: PENDING_STYLE.fg,
      border: "1px dashed var(--af-border-subtle)",
      textDecoration: "none",
      whiteSpace: "nowrap",
    };
    const inner = (
      <>
        {props.agent && <AgentIcon agent={props.agent} size={agentIconSize} />}
        <span aria-hidden style={{ lineHeight: 1 }}>{PENDING_STYLE.icon}</span>
        <span>{PENDING_STYLE.label}</span>
      </>
    );
    if (props.noLink) {
      return <span style={style}>{inner}</span>;
    }
    return (
      <Link
        href={`/digest/${props.localDay}`}
        style={style}
        title={`Generate ${props.localDay} digest →`}
      >
        {inner}
      </Link>
    );
  }

  const variant = OUTCOME_STYLES[props.outcome];
  const label = props.label ?? "both";
  const showIcon = label === "icon" || label === "both";
  const showText = label === "text" || label === "both";

  const style: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: dim.iconGap,
    padding: dim.padding,
    borderRadius: dim.borderRadius,
    fontSize: dim.fontSize,
    fontWeight: 600,
    background: variant.bg,
    color: variant.fg,
    whiteSpace: "nowrap",
  };

  return (
    <span style={style} title={variant.label}>
      {props.agent && <AgentIcon agent={props.agent} size={agentIconSize} />}
      {showIcon && <span aria-hidden style={{ lineHeight: 1 }}>{variant.icon}</span>}
      {showText && <span>{variant.label}</span>}
    </span>
  );
}

/** Sort priority for outcomes — higher = more "complete" outcome. */
const OUTCOME_PRIORITY: Record<DayOutcome, number> = {
  shipped: 6, partial: 5, blocked: 4, exploratory: 3, trivial: 2, idle: 1,
};

export function outcomePriority(outcome: DayOutcome | null | undefined): number {
  return outcome ? OUTCOME_PRIORITY[outcome] : 0;
}
