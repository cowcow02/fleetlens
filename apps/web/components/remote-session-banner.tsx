import { Server, Wifi } from "lucide-react";

/**
 * Header banner shown when a session detail page is rendering content
 * fetched from a remote fleet peer rather than this machine. Keeps
 * attribution honest — the user sees exactly which machine owns the
 * transcript they're reading.
 */
export function RemoteSessionBanner({
  runtimeLabel,
  runtimeHostname,
}: {
  runtimeLabel?: string;
  runtimeHostname?: string;
}) {
  return (
    <div
      style={{
        margin: "16px 40px 0",
        padding: "10px 14px",
        borderRadius: 6,
        background: "color-mix(in srgb, var(--af-accent) 9%, transparent)",
        border: "1px solid color-mix(in srgb, var(--af-accent) 28%, transparent)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 13,
        color: "var(--af-text-secondary)",
      }}
    >
      <span style={{ color: "var(--af-accent)", display: "inline-flex" }}>
        <Server size={14} />
      </span>
      <span>
        Streaming this session from{" "}
        <strong style={{ color: "var(--af-text-primary)" }}>{runtimeLabel ?? "another runtime"}</strong>
        {runtimeHostname && (
          <span style={{ color: "var(--af-text-tertiary)" }}> ({runtimeHostname})</span>
        )}{" "}
        over the fleet swarm. Transcript stays on the source machine; not cached to disk here.
      </span>
      <span
        style={{
          marginLeft: "auto",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 11,
          color: "#16a34a",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        <Wifi size={11} />
        live
      </span>
    </div>
  );
}
