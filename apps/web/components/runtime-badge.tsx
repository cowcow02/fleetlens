import { Laptop, Server } from "lucide-react";

/**
 * Inline badge for "which machine did this come from". Renders nothing
 * for local sessions (the default-hide pattern that AgentBadge uses for
 * Claude Code) so single-machine views stay visually unchanged.
 */
export function RuntimeBadge({
  runtimeId,
  runtimeLabel,
  runtimeHostname,
}: {
  runtimeId?: string;
  runtimeLabel?: string;
  runtimeHostname?: string;
}) {
  // Local / unspecified → no badge.
  if (!runtimeId || runtimeId === "local") return null;

  const label = runtimeLabel ?? runtimeId;
  const tooltip = runtimeHostname ? `${label} (${runtimeHostname})` : label;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        borderRadius: 4,
        padding: "2px 6px",
        fontSize: 10,
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
        fontWeight: 600,
        color: "var(--af-text-secondary)",
        background: "color-mix(in srgb, var(--af-text-secondary) 10%, transparent)",
        border: "1px solid color-mix(in srgb, var(--af-text-secondary) 24%, transparent)",
      }}
      title={`Runtime: ${tooltip}`}
    >
      <Server size={10} />
      {label}
    </span>
  );
}
