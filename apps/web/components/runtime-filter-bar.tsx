import Link from "next/link";
import { Laptop, Server, Wifi, WifiOff } from "lucide-react";
import type { RuntimeFilterOption } from "@/lib/data";

/**
 * Header chip strip for cross-runtime pages. Links each chip to the same
 * page with ?runtime=<id> in the query string. Server component — no
 * client JS. Lives in the page header; pages render it when a fleet is
 * configured AND at least one peer has been seen.
 */
export function RuntimeFilterBar({
  options,
  current,
  basePath,
}: {
  options: RuntimeFilterOption[];
  /** "all" | "local" | <deviceId>. Falsy → treat as "all". */
  current?: string;
  basePath: string;
}) {
  // If the only known runtime is the local one, the chip strip is
  // visual noise — hide it.
  if (options.length <= 1) return null;

  const normalized = !current || current === "" ? "all" : current;

  const chips = [
    { id: "all", label: `All runtimes`, isLocal: false, connected: null, hostname: undefined },
    ...options,
  ];

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        marginBottom: 14,
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: "var(--af-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginRight: 4,
          fontWeight: 600,
        }}
      >
        Runtime
      </span>
      {chips.map((c) => {
        const active = c.id === normalized;
        const href = c.id === "all" ? basePath : `${basePath}?runtime=${encodeURIComponent(c.id)}`;
        return (
          <Link
            key={c.id}
            href={href}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 999,
              fontSize: 12,
              border: active
                ? "1px solid color-mix(in srgb, var(--af-accent) 50%, transparent)"
                : "1px solid var(--af-border-subtle)",
              background: active
                ? "color-mix(in srgb, var(--af-accent) 14%, transparent)"
                : "transparent",
              color: active ? "var(--af-accent)" : "var(--af-text-secondary)",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            {chipIcon(c)}
            <span>{c.label}</span>
            {c.hostname && (
              <span style={{ opacity: 0.55, fontFamily: "var(--font-mono)", fontSize: 11 }}>
                {c.hostname}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function chipIcon(c: {
  id: string;
  isLocal: boolean;
  connected: boolean | null;
}): React.ReactNode {
  if (c.id === "all") return null;
  if (c.isLocal) return <Laptop size={12} />;
  if (c.connected) {
    return <Wifi size={12} style={{ color: "#16a34a" }} />;
  }
  if (c.connected === false) {
    return <WifiOff size={12} style={{ color: "var(--af-text-tertiary)" }} />;
  }
  return <Server size={12} />;
}
