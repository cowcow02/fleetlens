import type { UsageSnapshot, UsageWindow } from "@/lib/usage-data";
import { utilizationVar } from "@/lib/utilization-tone";

type Row = { label: string; window: UsageWindow | null };

export function UsageGauges({ snapshot }: { snapshot: UsageSnapshot }) {
  const rows: Row[] = [
    { label: "5 hour", window: snapshot.five_hour },
    { label: "7 day (all)", window: snapshot.seven_day },
    { label: "7 day Sonnet", window: snapshot.seven_day_sonnet },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: 12,
      }}
    >
      {rows.map((row) => (
        <Gauge key={row.label} {...row} />
      ))}
    </div>
  );
}

function Gauge({ label, window }: Row) {
  const pct = window?.utilization ?? null;
  const hasData = pct !== null;
  const clamped = hasData ? Math.max(0, Math.min(100, pct!)) : 0;
  const fillColor = utilizationVar(clamped);

  return (
    <div className="af-card" style={{ padding: "16px 18px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 11,
          color: "var(--af-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontWeight: 600,
        }}
      >
        <span>{label}</span>
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
        {hasData ? `${clamped.toFixed(1)}%` : "—"}
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
            width: hasData ? `${clamped}%` : "0%",
            background: fillColor,
            borderRadius: 999,
            transition: "width 0.24s ease",
          }}
        />
      </div>
      {window?.resets_at && (
        <div
          style={{
            fontSize: 11,
            color: "var(--af-text-tertiary)",
            marginTop: 8,
          }}
        >
          Resets {formatRelative(window.resets_at)}
        </div>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((then - now) / 1000);
  const abs = Math.abs(diffSec);
  const past = diffSec < 0;

  let value: string;
  if (abs < 60) {
    value = `${abs}s`;
  } else if (abs < 3600) {
    value = `${Math.floor(abs / 60)}m`;
  } else if (abs < 86400) {
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    value = m > 0 ? `${h}h${m}m` : `${h}h`;
  } else {
    const d = Math.floor(abs / 86400);
    const h = Math.floor((abs % 86400) / 3600);
    value = h > 0 ? `${d}d${h}h` : `${d}d`;
  }

  return past ? `${value} ago` : `in ${value}`;
}
