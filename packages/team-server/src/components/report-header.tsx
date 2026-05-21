type ReportHeaderProps = {
  teamName: string;
  weekStart: Date;
  weekEnd: Date;
  activeCount: number;
  memberTotal: number;
  agentHours: number;
  generatedAt?: Date | string;
  roster?: string[];
};

function fmtDay(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}
function fmtYear(d: Date): string {
  return d.getFullYear().toString();
}
function fmtFull(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function ReportHeader({
  teamName,
  weekStart,
  weekEnd,
  activeCount,
  memberTotal,
  agentHours,
  generatedAt,
  roster,
}: ReportHeaderProps) {
  const gen = generatedAt
    ? typeof generatedAt === "string"
      ? generatedAt
      : fmtFull(generatedAt)
    : null;
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
        Week of {fmtDay(weekStart)} – {fmtDay(weekEnd)}, {fmtYear(weekEnd)}
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
