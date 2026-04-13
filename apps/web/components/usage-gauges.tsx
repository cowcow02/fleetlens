import type { UsageSnapshot, UsageWindow } from "@/lib/usage-data";

type Row = { label: string; window: UsageWindow | null };

export function UsageGauges({ snapshot }: { snapshot: UsageSnapshot }) {
  const rows: Row[] = [
    { label: "5 hour", window: snapshot.five_hour },
    { label: "7 day (all)", window: snapshot.seven_day },
    { label: "7 day Opus", window: snapshot.seven_day_opus },
    { label: "7 day Sonnet", window: snapshot.seven_day_sonnet },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
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
  const tone = clamped >= 90 ? "bg-red-500" : clamped >= 70 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="rounded-lg border border-af-border bg-af-surface p-4">
      <div className="flex items-baseline justify-between">
        <div className="text-sm text-af-muted">{label}</div>
        <div className="text-2xl font-semibold tabular-nums">
          {hasData ? `${clamped.toFixed(1)}%` : "—"}
        </div>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-af-border/40">
        <div
          className={`h-full ${tone} transition-all`}
          style={{ width: hasData ? `${clamped}%` : "0%" }}
        />
      </div>
      {window?.resets_at && (
        <div className="mt-2 text-xs text-af-muted">
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
