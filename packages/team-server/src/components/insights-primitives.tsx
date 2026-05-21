// Small visual primitives shared by every category section in the team
// insight report page. Kept deliberately simple — no client-state — so the
// page can render as a server component.

import type { CSSProperties, ReactNode } from "react";

export function SectionFrame({
  letter,
  title,
  subtitle,
  children,
}: {
  letter: string;
  title: ReactNode;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="insights-section" id={`section-${letter}`}>
      <div className="subsection-head">
        <h2>
          <span className="section-letter">{letter}</span> {title}
        </h2>
        {subtitle && <div className="kicker">{subtitle}</div>}
      </div>
      {children}
    </section>
  );
}

export function Subhead({ children }: { children: ReactNode }) {
  return <div className="harness-block-title" style={{ marginTop: 22, marginBottom: 10 }}>{children}</div>;
}

export function FactTile({
  label,
  value,
  sub,
  sensitive,
  span,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  sensitive?: boolean;
  span?: number;
}) {
  const style: CSSProperties = span ? { gridColumn: `span ${span}` } : {};
  return (
    <div className={`pulse-tile${sensitive ? " sensitive" : ""}`} style={style}>
      <div className="pulse-tile-label">
        {sensitive && <span className="sensitive-marker">⚠</span>}
        {label}
      </div>
      <div className="pulse-tile-value">{value}</div>
      {sub && <div className="pulse-tile-delta">{sub}</div>}
    </div>
  );
}

export function FactGrid({ children, cols = 3 }: { children: ReactNode; cols?: number }) {
  return (
    <div className="pulse-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {children}
    </div>
  );
}

export function FactRow({
  label,
  value,
  sub,
  sensitive,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  sensitive?: boolean;
}) {
  return (
    <div className={`fact-row${sensitive ? " sensitive" : ""}`}>
      <div className="fact-row-label">
        {sensitive && <span className="sensitive-marker">⚠</span>}
        {label}
      </div>
      <div className="fact-row-value">{value}</div>
      {sub && <div className="fact-row-sub">{sub}</div>}
    </div>
  );
}

export function MiniBar({
  segments,
  total,
}: {
  segments: { label: string; value: number; color?: string }[];
  total?: number;
}) {
  const sum = total ?? segments.reduce((s, x) => s + x.value, 0);
  if (sum === 0) return null;
  const palette = [
    "var(--accent)",
    "var(--positive)",
    "var(--warning)",
    "var(--mute)",
    "var(--ink-soft)",
    "var(--rule)",
  ];
  return (
    <>
      <div className="goal-mix-strip">
        {segments.map((s, i) => (
          <div
            key={s.label}
            className="goal-mix-seg"
            style={{ width: `${(s.value / sum) * 100}%`, background: s.color ?? palette[i % palette.length] }}
            title={`${s.label}: ${s.value}`}
          />
        ))}
      </div>
      <div className="goal-mix-legend">
        {segments.map((s, i) => (
          <span key={s.label}>
            <span
              className="stacked-bar-legend-swatch"
              style={{ background: s.color ?? palette[i % palette.length] }}
            />
            {s.label} · {s.value}
          </span>
        ))}
      </div>
    </>
  );
}

const SPARK_BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

export function TextSparkline({ values, scale }: { values: number[]; scale?: number }) {
  if (values.length === 0) return null;
  const max = scale ?? Math.max(...values);
  if (max === 0) return <span className="sparkline">{values.map(() => "▁").join("")}</span>;
  return (
    <span className="sparkline">
      {values
        .map((v) => SPARK_BLOCKS[Math.min(SPARK_BLOCKS.length - 1, Math.round((v / max) * (SPARK_BLOCKS.length - 1)))])
        .join("")}
    </span>
  );
}

export function SimpleTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="simple-table-wrap">
      <table className="simple-table">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SensitiveCallout({ note }: { note: string }) {
  return (
    <div className="sensitive-callout">
      <span className="sensitive-marker">⚠</span> {note}
    </div>
  );
}

export function NarrativeLine({ children, sensitive }: { children: ReactNode; sensitive?: boolean }) {
  return (
    <div className={`narrative-line${sensitive ? " sensitive" : ""}`}>
      {sensitive && <span className="sensitive-marker">⚠</span>}
      {children}
    </div>
  );
}

export function ChipRow({ items }: { items: string[] }) {
  return (
    <div className="chip-row">
      {items.map((s) => (
        <span key={s} className="chip">
          {s}
        </span>
      ))}
    </div>
  );
}

export function MemberBarRow({
  member,
  values,
  max,
  suffix,
  sensitive,
}: {
  member: string;
  values: { label: string; value: number; color?: string }[];
  max?: number;
  suffix?: string;
  sensitive?: boolean;
}) {
  const total = max ?? values.reduce((s, v) => s + v.value, 0);
  const palette = [
    "var(--accent)",
    "var(--positive)",
    "var(--warning)",
    "var(--mute)",
  ];
  return (
    <div className="member-bar-row">
      <div className="member-bar-name">
        {sensitive && <span className="sensitive-marker">⚠</span>}
        {member}
      </div>
      <div className="member-bar-track">
        {values.map((v, i) => (
          <div
            key={v.label}
            className="member-bar-seg"
            style={{ width: `${(v.value / (total || 1)) * 100}%`, background: v.color ?? palette[i % palette.length] }}
            title={`${v.label}: ${v.value}${suffix ?? ""}`}
          />
        ))}
      </div>
    </div>
  );
}
