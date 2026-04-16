import Link from "next/link";

type BadgeSession = {
  id: string;
  teamName?: string;
  agentName?: string;
  isTeamLead?: boolean;
};

const BASE_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 4,
  padding: "2px 6px",
  fontSize: 10,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
} as const;

export function TeamBadge({
  session,
  linkable = true,
}: {
  session: BadgeSession;
  /** When false, the lead variant renders as a span instead of a Link — use
   *  inside parent `<Link>` contexts (e.g. a card wrapper) to avoid nested
   *  anchors. */
  linkable?: boolean;
}) {
  if (!session.teamName) return null;
  // Lead = explicit orchestration evidence. A bare teamName + missing
  // agentName isn't enough — see SessionMeta.isTeamLead. Sessions that
  // sit in that grey zone (tagged with a team but doing nothing teamy)
  // get no badge.
  const isLead = session.isTeamLead === true;
  const isMember = session.agentName !== undefined;
  if (!isLead && !isMember) return null;

  if (isLead && linkable) {
    return (
      <Link
        href={`/sessions/${session.id}`}
        style={{
          ...BASE_STYLE,
          fontWeight: 600,
          background: "var(--af-warning-subtle)",
          color: "var(--af-warning)",
          border: "1px solid var(--af-warning-subtle)",
          textDecoration: "none",
        }}
        title={`Team lead — ${session.teamName}`}
      >
        Team Lead
      </Link>
    );
  }

  if (isLead) {
    return (
      <span
        style={{
          ...BASE_STYLE,
          fontWeight: 600,
          background: "var(--af-warning-subtle)",
          color: "var(--af-warning)",
          border: "1px solid var(--af-warning-subtle)",
        }}
        title={`Team lead — ${session.teamName}`}
      >
        Team Lead
      </span>
    );
  }

  return (
    <span
      style={{
        ...BASE_STYLE,
        fontWeight: 500,
        background: "var(--af-surface-hover)",
        color: "var(--af-text-tertiary)",
        border: "1px solid var(--af-border-subtle)",
      }}
      title={`Team member — ${session.teamName} · ${session.agentName}`}
    >
      Team Member
    </span>
  );
}
