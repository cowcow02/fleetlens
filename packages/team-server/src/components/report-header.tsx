import { formatDateDay, formatDateLong } from "../lib/format";

type ReportHeaderProps = {
  teamName: string;
  weekStart: Date;
  weekEnd: Date;
  activeCount: number;
  memberTotal: number;
  agentHours: number;
  generatedAt?: Date | string;
  roster?: string[];
  // Week navigation. Pass either prop (string href or null to disable the
  // arrow at a boundary) to render the prev/next controls; omit both for a
  // static header (e.g. the PDF render).
  prevWeekHref?: string | null;
  nextWeekHref?: string | null;
};

export function ReportHeader({
  teamName,
  weekStart,
  weekEnd,
  activeCount,
  memberTotal,
  agentHours,
  generatedAt,
  roster,
  prevWeekHref,
  nextWeekHref,
}: ReportHeaderProps) {
  const showNav = prevWeekHref !== undefined || nextWeekHref !== undefined;
  let gen: string | null = null;
  if (generatedAt) {
    gen = typeof generatedAt === "string" ? generatedAt : formatDateLong(generatedAt);
  }
  const rosterLine = roster && roster.length > 0
    ? `${roster.slice(0, 5).join(" · ")}${roster.length > 5 ? ` · +${roster.length - 5}` : ""}`
    : null;

  return (
    <header className="report-header">
      <div className="report-header-eyebrow">
        <span>Fleetlens</span>
        <span>·</span>
        <span>Insight Report</span>
      </div>
      <h1 className="report-header-team">{teamName}</h1>
      <div className="report-header-period">
        {showNav &&
          (prevWeekHref ? (
            <a className="report-week-nav" href={prevWeekHref} aria-label="Previous week">◀</a>
          ) : (
            <span className="report-week-nav disabled" aria-hidden>◀</span>
          ))}
        <span>Week of {formatDateDay(weekStart)} – {formatDateDay(weekEnd)}, {weekEnd.getFullYear()}</span>
        {showNav &&
          (nextWeekHref ? (
            <a className="report-week-nav" href={nextWeekHref} aria-label="Next week">▶</a>
          ) : (
            <span className="report-week-nav disabled" aria-hidden>▶</span>
          ))}
      </div>
      <div className="report-header-stats">
        <div className="report-header-stat">
          <span className="report-header-stat-num">{activeCount}/{memberTotal}</span>
          <span className="report-header-stat-label">members active</span>
        </div>
        <div className="report-header-stat">
          <span className="report-header-stat-num">{agentHours.toFixed(1)}h</span>
          <span className="report-header-stat-label">combined agent time</span>
        </div>
        {rosterLine && <span className="report-header-roster">{rosterLine}</span>}
      </div>
      {gen && <div className="report-header-generated">Generated {gen}</div>}
    </header>
  );
}
