import type { DiffusionStatus, TeamInsightReport } from "../../app/team/[slug]/insights/types";

const STATUS_LABEL: Record<DiffusionStatus, string> = {
  originator: "O",
  regular: "R",
  tried: "T",
  not_yet: "·",
};

const STATUS_FULL: Record<DiffusionStatus, string> = {
  originator: "Originated",
  regular: "Regular",
  tried: "Tried once",
  not_yet: "Not yet",
};

export function VariantDiffusion({ r }: { r: TeamInsightReport }) {
  const practices = r.variants.diffusion_practices;
  const grid = r.variants.diffusion_grid;

  return (
    <div className="variant-frame">
      <div className="variant-intro">
        <strong>v3 · Practice diffusion grid.</strong> Twelve agent-collaboration practices ×
        each active member. Cell shows whether the member originated, regularly uses, has tried once,
        or hasn't picked up yet. Below the grid: diffusion events this week (who picked up whose move,
        days from origin to first pickup).
      </div>

      <div className="diffusion-legend">
        <span><span className="diffusion-chip status-originator">O</span> Originated</span>
        <span><span className="diffusion-chip status-regular">R</span> Regular</span>
        <span><span className="diffusion-chip status-tried">T</span> Tried once</span>
        <span><span className="diffusion-chip status-not_yet">·</span> Not yet</span>
      </div>

      <div className="diffusion-grid-wrap">
        <table className="diffusion-grid">
          <thead>
            <tr>
              <th className="diffusion-corner">&nbsp;</th>
              {practices.map((p) => (
                <th key={p.key} className="diffusion-col-head" title={p.short_desc}>
                  <div className="diffusion-col-label">{p.label}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row) => (
              <tr key={row.member}>
                <th className="diffusion-row-head">{row.member}</th>
                {practices.map((p) => {
                  const status = row.cells[p.key] ?? "not_yet";
                  return (
                    <td key={p.key} className={`diffusion-cell status-${status}`} title={`${p.label} · ${STATUS_FULL[status]}`}>
                      {STATUS_LABEL[status]}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section style={{ marginTop: 30 }}>
        <h3 className="variant-subhead">Diffusion events this week</h3>
        {r.variants.diffusion_arrows.length === 0 ? (
          <div className="narrative-line" style={{ color: "var(--mute)" }}>
            No new pickups this week.
          </div>
        ) : (
          r.variants.diffusion_arrows.map((a, i) => {
            const practice = practices.find((p) => p.key === a.practice_key);
            return (
              <div key={i} className="diffusion-event-card">
                <div className="diffusion-event-head">
                  <strong>{a.from_member}</strong> → <strong>{a.to_member}</strong>
                  {" · "}
                  <code>{practice?.label ?? a.practice_key}</code>
                  {" · "}
                  <span className="mono">{a.date}</span>
                </div>
                <div className="diffusion-event-body">{a.note}</div>
              </div>
            );
          })
        )}
      </section>

      <section style={{ marginTop: 30 }}>
        <h3 className="variant-subhead">Coverage by practice</h3>
        <div className="diffusion-coverage-list">
          {practices.map((p) => {
            const cells = grid.map((row) => row.cells[p.key] ?? "not_yet");
            const counts = {
              originator: cells.filter((c) => c === "originator").length,
              regular: cells.filter((c) => c === "regular").length,
              tried: cells.filter((c) => c === "tried").length,
              not_yet: cells.filter((c) => c === "not_yet").length,
            };
            const inUse = counts.originator + counts.regular + counts.tried;
            return (
              <div key={p.key} className="diffusion-coverage-row">
                <div className="diffusion-coverage-label">
                  <strong>{p.label}</strong>
                  <span className="diffusion-coverage-desc">{p.short_desc}</span>
                </div>
                <div className="diffusion-coverage-stats">
                  <span>{inUse} of {grid.length} members</span>
                  <span className="diffusion-coverage-counts">
                    {counts.originator ? `O×${counts.originator} ` : ""}
                    {counts.regular ? `R×${counts.regular} ` : ""}
                    {counts.tried ? `T×${counts.tried} ` : ""}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
