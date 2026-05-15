import type { TeamInsightReport } from "../../app/team/[slug]/insights/types";
import { TextSparkline } from "../insights-primitives";

export function TrajectoriesSection({ r }: { r: TeamInsightReport }) {
  const memberOrder = r.variants.fingerprints.map((f) => f.member);

  return (
    <>
      <div className="trajectory-grid">
        <div className="trajectory-grid-head">
          <div className="trajectory-col-practice">Practice</div>
          {memberOrder.map((m) => (
            <div key={m} className="trajectory-col-member">{m}</div>
          ))}
        </div>

        {r.variants.trajectory_rows.map((row) => (
          <div key={row.practice} className="trajectory-row">
            <div className="trajectory-col-practice">
              <div className="trajectory-practice-label">{row.practice}</div>
              <div className="trajectory-practice-meta">
                {row.unit} · {row.direction_better === "higher" ? "↑ better" : "↓ better"}
              </div>
            </div>
            {memberOrder.map((m) => {
              const cell = row.per_member.find((p) => p.member === m);
              if (!cell || cell.weekly.every((v) => v === 0)) {
                return (
                  <div key={m} className="trajectory-cell empty">
                    <div className="sparkline-empty">—</div>
                  </div>
                );
              }
              const first = cell.weekly.find((v) => v > 0) ?? 0;
              const last = cell.weekly[cell.weekly.length - 1];
              const delta = first !== 0 ? ((last - first) / first) * 100 : 0;
              const direction = delta >= 0 ? "up" : "down";
              const better =
                (row.direction_better === "higher" && delta > 0) ||
                (row.direction_better === "lower" && delta < 0);
              const trendClass = delta === 0 ? "flat" : better ? "better" : "worse";
              return (
                <div key={m} className={`trajectory-cell ${trendClass}`}>
                  <div className="trajectory-cell-spark">
                    <TextSparkline values={cell.weekly} />
                  </div>
                  <div className="trajectory-cell-current">{cell.current_label ?? ""}</div>
                  <div className={`trajectory-cell-delta ${direction}`}>
                    {delta === 0
                      ? "±0%"
                      : `${delta > 0 ? "+" : ""}${Math.round(delta)}%`}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <section style={{ marginTop: 30 }}>
        <h3 className="variant-subhead">Observations</h3>
        {r.variants.trajectory_observations.map((o, i) => (
          <div key={i} className="trajectory-observation">
            <strong>{o.member}</strong> — {o.observation}
          </div>
        ))}
      </section>
    </>
  );
}
