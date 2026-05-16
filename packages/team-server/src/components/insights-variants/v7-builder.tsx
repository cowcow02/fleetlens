import type { TeamInsightReport } from "../../app/team/[slug]/insights/types";
import {
  BLOCK_CATALOG,
  CATEGORY_LABELS,
  STARTER_BLOCKS,
  groupBlocksByCategory,
  type BlockCategory,
  type DashboardBlock,
  type BlockTier,
} from "./v7-builder-blocks";

const TIER_LABEL: Record<BlockTier, string> = {
  deterministic: "Deterministic",
  "llm-enriched": "LLM-enriched",
  "external-plug-in": "External plug-in",
};

const TIER_SYMBOL: Record<BlockTier, string> = {
  deterministic: "▦",
  "llm-enriched": "✦",
  "external-plug-in": "◌",
};

function buildHref(slug: string, blocks: string[]): string {
  if (blocks.length === 0) return `/team/${slug}/insights?v=7`;
  return `/team/${slug}/insights?v=7&blocks=${encodeURIComponent(blocks.join(","))}`;
}

function parseBlocks(raw: string | undefined): string[] {
  if (!raw) return [];
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // Deduplicate while preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (BLOCK_CATALOG.some((b) => b.id === id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export function VariantBuilder({
  r,
  slug,
  blocksParam,
}: {
  r: TeamInsightReport;
  slug: string;
  blocksParam: string | undefined;
}) {
  const selectedIds = parseBlocks(blocksParam);
  const isEmpty = selectedIds.length === 0;
  const grouped = groupBlocksByCategory(BLOCK_CATALOG);

  return (
    <div className="variant-frame">
      <div className="variant-intro">
        <strong>v7 · Block-catalog builder.</strong> Lego-style: pick blocks from the catalog below.
        Selection is encoded in the URL (<code>?blocks=id1,id2,...</code>) so each team can bookmark
        their own dashboard. Inspired by Grafana panels, Tremor, and react-grid-layout — implemented
        as a server-rendered checklist (no client state). Each block carries a capturability tag and
        a source-version note (which earlier prototype it came from).
      </div>

      {/* ─── Catalog drawer ─────────────────────────────────────────── */}
      <section className="builder-catalog">
        <header className="builder-catalog-head">
          <div>
            <h2 className="builder-catalog-title">Catalog</h2>
            <div className="builder-catalog-count">
              {BLOCK_CATALOG.length} blocks · {selectedIds.length} selected
            </div>
          </div>
          <div className="builder-catalog-actions">
            <a className="builder-action" href={buildHref(slug, STARTER_BLOCKS)}>
              ⇢ Load starter preset ({STARTER_BLOCKS.length})
            </a>
            <a className="builder-action" href={buildHref(slug, BLOCK_CATALOG.map((b) => b.id))}>
              ⇢ Select all
            </a>
            <a className="builder-action danger" href={buildHref(slug, [])}>
              ✕ Clear
            </a>
          </div>
        </header>

        {(Object.keys(grouped) as BlockCategory[]).map((cat) => {
          const blocks = grouped[cat];
          if (blocks.length === 0) return null;
          return (
            <div key={cat} className="builder-cat-group">
              <div className="builder-cat-label">{CATEGORY_LABELS[cat]}</div>
              <div className="builder-block-grid">
                {blocks.map((b) => {
                  const selected = selectedIds.includes(b.id);
                  const nextIds = selected
                    ? selectedIds.filter((id) => id !== b.id)
                    : [...selectedIds, b.id];
                  return (
                    <a
                      key={b.id}
                      href={buildHref(slug, nextIds)}
                      className={`builder-block-chip${selected ? " selected" : ""}`}
                    >
                      <div className="builder-block-chip-head">
                        <span className="builder-block-chip-title">{b.title}</span>
                        <span className="builder-block-chip-toggle">{selected ? "✓" : "+"}</span>
                      </div>
                      <div className="builder-block-chip-desc">{b.short_description}</div>
                      <div className="builder-block-chip-meta">
                        <span className={`builder-tier tier-${b.tier}`} title={TIER_LABEL[b.tier]}>
                          {TIER_SYMBOL[b.tier]} {TIER_LABEL[b.tier]}
                        </span>
                        <span className="builder-source">from {b.source_version}</span>
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      {/* ─── Assembled dashboard ───────────────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Your <em>dashboard</em></h2>
          <div className="kicker">
            {isEmpty
              ? "No blocks selected yet — pick from the catalog above, or load the starter preset"
              : `${selectedIds.length} block${selectedIds.length === 1 ? "" : "s"} in your order`}
          </div>
        </header>

        {isEmpty ? (
          <div className="builder-empty">
            <p>Your dashboard is empty.</p>
            <p>
              <a className="builder-action" href={buildHref(slug, STARTER_BLOCKS)}>
                ⇢ Load the starter preset
              </a>{" "}
              ({STARTER_BLOCKS.length} blocks — hero takeaway + team pulse + strengths/dysfunctions +
              risks + diffusion + ticket phases + 1:1 prompts).
            </p>
          </div>
        ) : (
          <div className="builder-dashboard">
            {selectedIds.map((id) => {
              const block = BLOCK_CATALOG.find((b) => b.id === id);
              if (!block) return null;
              const index = selectedIds.indexOf(id);
              const upIds = [...selectedIds];
              if (index > 0) {
                [upIds[index - 1], upIds[index]] = [upIds[index], upIds[index - 1]];
              }
              const downIds = [...selectedIds];
              if (index < selectedIds.length - 1) {
                [downIds[index], downIds[index + 1]] = [downIds[index + 1], downIds[index]];
              }
              const removeIds = selectedIds.filter((x) => x !== id);
              return (
                <article key={id} className="builder-dashboard-block">
                  <header className="builder-dashboard-block-head">
                    <div>
                      <h3 className="builder-dashboard-block-title">{block.title}</h3>
                      <div className="builder-dashboard-block-meta">
                        <span className={`builder-tier tier-${block.tier}`}>
                          {TIER_SYMBOL[block.tier]} {TIER_LABEL[block.tier]}
                        </span>
                        <span className="builder-source">from {block.source_version}</span>
                      </div>
                    </div>
                    <div className="builder-dashboard-block-controls">
                      {index > 0 && (
                        <a className="builder-block-control" href={buildHref(slug, upIds)} title="Move up">↑</a>
                      )}
                      {index < selectedIds.length - 1 && (
                        <a className="builder-block-control" href={buildHref(slug, downIds)} title="Move down">↓</a>
                      )}
                      <a className="builder-block-control danger" href={buildHref(slug, removeIds)} title="Remove">×</a>
                    </div>
                  </header>
                  <div className="builder-dashboard-block-body">{block.render(r)}</div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <footer className="builder-footer-note">
        Shareable link · this URL encodes your block selection. Bookmark it, send it to a teammate,
        or save as the team's default. State lives in the URL — no DB write needed. Inspired by{" "}
        <a href="https://grafana.com/grafana/dashboards/" target="_blank" rel="noreferrer">Grafana panels</a>,{" "}
        <a href="https://www.tremor.so/" target="_blank" rel="noreferrer">Tremor</a>, and{" "}
        <a href="https://github.com/react-grid-layout/react-grid-layout" target="_blank" rel="noreferrer">react-grid-layout</a>.
      </footer>
    </div>
  );
}

export { BLOCK_CATALOG } from "./v7-builder-blocks";

export type { DashboardBlock } from "./v7-builder-blocks";
