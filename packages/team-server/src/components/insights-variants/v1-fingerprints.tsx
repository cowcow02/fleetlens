"use client";

import type { TeamInsightReport } from "../../app/team/[slug]/insights/types";
import { TextSparkline } from "../insights-primitives";

export function FingerprintsSection({ r }: { r: TeamInsightReport }) {
  return (
    <>
      {r.variants.fingerprints.map((f) => (
        <article key={f.member} className="fingerprint-card">
          <header className="fingerprint-head">
            <div>
              <h2 className="fingerprint-name">{f.member}</h2>
              <div className="fingerprint-role">{f.role_hint}</div>
            </div>
            <div className="fingerprint-signature-move">
              <div className="fingerprint-tag">Signature move</div>
              <div className="fingerprint-signature-text">{f.signature_move}</div>
            </div>
          </header>

          <p className="fingerprint-paragraph">{f.signature_paragraph}</p>

          <section className="fingerprint-section">
            <div className="fingerprint-tag">This week</div>
            <div className="fingerprint-week-strip">
              <span><strong>{f.this_week.sessions}</strong> sessions</span>
              <span><strong>{f.this_week.hours.toFixed(1)}h</strong> agent time</span>
              <span><strong>{f.this_week.prs}</strong> PRs</span>
              <span>
                Median first-user → merge:{" "}
                <strong>{f.this_week.median_first_user_to_merge_min ? `${f.this_week.median_first_user_to_merge_min}min` : "—"}</strong>
              </span>
            </div>
            <ul className="fingerprint-signals">
              {f.this_week.notable_signals.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </section>

          <section className="fingerprint-section">
            <div className="fingerprint-tag">4-week arc · how the texture of their sessions has changed</div>
            <div className="fingerprint-arc-grid">
              <ArcRow label="Sessions per week" values={f.arc.sessions_per_week} format={(v) => String(v)} />
              <ArcRow label="Pre-flight skill loads / session" values={f.arc.skill_loads_per_session} format={(v) => v.toFixed(1)} />
              <ArcRow label="Orchestrated session share" values={f.arc.orchestrated_pct} format={(v) => `${v}%`} />
              <ArcRow label="Median session length" values={f.arc.median_session_min} format={(v) => (v ? `${v}m` : "—")} />
              <ArcRow label="First-user → merge" values={f.arc.first_user_to_merge_min} format={(v) => (v ? `${v}m` : "—")} />
              <ArcRow label="Cost per shipped PR" values={f.arc.cost_per_pr_usd} format={(v) => (v ? `$${v.toFixed(0)}` : "—")} />
            </div>
          </section>

          <section className="fingerprint-growth">
            <div className="fingerprint-tag">Growth</div>
            <p>{f.growth_synthesis}</p>
          </section>
        </article>
      ))}
    </>
  );
}

function ArcRow({
  label,
  values,
  format,
}: {
  label: string;
  values: number[];
  format: (v: number) => string;
}) {
  const nonZero = values.filter((v) => v > 0);
  const first = nonZero[0];
  const last = values[values.length - 1];
  const delta = first !== undefined && last !== undefined && first !== 0 ? Math.round(((last - first) / first) * 100) : 0;
  return (
    <div className="arc-row">
      <div className="arc-row-label">{label}</div>
      <div className="arc-row-spark"><TextSparkline values={values} /></div>
      <div className="arc-row-series">{values.map((v) => format(v)).join(" → ")}</div>
      {first !== undefined && first !== 0 && (
        <div className={`arc-row-delta ${delta >= 0 ? "positive" : "negative"}`}>
          {delta >= 0 ? "+" : ""}
          {delta}%
        </div>
      )}
    </div>
  );
}
