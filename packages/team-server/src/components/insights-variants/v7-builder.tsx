"use client";

import { useEffect, useMemo, useState } from "react";
import type { TeamInsightReport } from "../../app/team/[slug]/insights/types";
import {
  BLOCK_CATALOG,
  CATEGORY_LABELS,
  STARTER_BLOCKS,
  groupBlocksByCategory,
  type BlockCategory,
  type BlockTier,
  type DashboardBlock,
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

function storageKey(slug: string): string {
  return `fleetlens-builder-v7:${slug}`;
}

function parseBlocks(raw: string | undefined): string[] {
  if (!raw) return [];
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
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
  const urlInitial = useMemo(() => parseBlocks(blocksParam), [blocksParam]);

  // committed = what's actually shown in the dashboard
  // draft = what user is editing in the sheet
  const [committed, setCommitted] = useState<string[]>(urlInitial.length > 0 ? urlInitial : STARTER_BLOCKS);
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState<string[]>(committed);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  // On mount, hydrate from localStorage if URL didn't override
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (urlInitial.length === 0) {
      try {
        const stored = window.localStorage.getItem(storageKey(slug));
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            const filtered = parsed.filter(
              (id): id is string => typeof id === "string" && BLOCK_CATALOG.some((b) => b.id === id),
            );
            if (filtered.length > 0) {
              setCommitted(filtered);
              setDraft(filtered);
            }
          }
        }
      } catch {
        // ignore
      }
    }
    setHydrated(true);
  }, [slug, urlInitial]);

  // Persist on every change
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey(slug), JSON.stringify(committed));
    } catch {
      // ignore quota / disabled storage
    }
  }, [committed, slug, hydrated]);

  function openSheet() {
    setDraft(committed);
    setHovered(null);
    setSheetOpen(true);
  }
  function closeSheet() {
    setSheetOpen(false);
  }
  function applySheet() {
    setCommitted(draft);
    setSheetOpen(false);
  }
  function toggleDraft(id: string) {
    setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  }
  function reorderCommitted(id: string, direction: "up" | "down") {
    setCommitted((prev) => {
      const idx = prev.indexOf(id);
      if (idx === -1) return prev;
      const next = [...prev];
      const swap = direction === "up" ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }
  function removeFromCommitted(id: string) {
    setCommitted((prev) => prev.filter((x) => x !== id));
  }

  const grouped = useMemo(() => groupBlocksByCategory(BLOCK_CATALOG), []);
  const hoveredBlock = hovered ? BLOCK_CATALOG.find((b) => b.id === hovered) ?? null : null;
  const isEmpty = committed.length === 0;
  const draftSet = new Set(draft);

  function blockById(id: string): DashboardBlock | null {
    return BLOCK_CATALOG.find((b) => b.id === id) ?? null;
  }

  return (
    <div className="variant-frame">
      <header className="builder-header">
        <div className="builder-header-left">
          <h2 className="builder-header-title">Dashboard</h2>
          <div className="builder-header-sub">
            {committed.length} block{committed.length === 1 ? "" : "s"} ·{" "}
            <span className="builder-header-source">stored in your browser</span>
          </div>
        </div>
        <button type="button" className="builder-customize-button" onClick={openSheet}>
          <span className="builder-customize-icon">⚙</span>
          Customize
        </button>
      </header>

      {isEmpty ? (
        <div className="builder-empty">
          <p>Your dashboard is empty.</p>
          <button type="button" className="builder-action" onClick={() => setCommitted(STARTER_BLOCKS)}>
            ⇢ Load starter preset ({STARTER_BLOCKS.length} blocks)
          </button>
        </div>
      ) : (
        <div className="builder-dashboard">
          {committed.map((id, index) => {
            const block = blockById(id);
            if (!block) return null;
            const isFirst = index === 0;
            const isLast = index === committed.length - 1;
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
                    {!isFirst && (
                      <button type="button" className="builder-block-control" title="Move up" onClick={() => reorderCommitted(id, "up")}>↑</button>
                    )}
                    {!isLast && (
                      <button type="button" className="builder-block-control" title="Move down" onClick={() => reorderCommitted(id, "down")}>↓</button>
                    )}
                    <button type="button" className="builder-block-control danger" title="Remove" onClick={() => removeFromCommitted(id)}>×</button>
                  </div>
                </header>
                <div className="builder-dashboard-block-body">{block.render(r)}</div>
              </article>
            );
          })}
        </div>
      )}

      {/* ─── Side sheet ─────────────────────────────────────────────── */}
      <div className={`builder-sheet-backdrop${sheetOpen ? " open" : ""}`} onClick={closeSheet} aria-hidden={!sheetOpen} />
      <aside className={`builder-sheet${sheetOpen ? " open" : ""}`} aria-hidden={!sheetOpen} aria-label="Customize dashboard">
        <header className="builder-sheet-head">
          <div>
            <h2 className="builder-sheet-title">Customize dashboard</h2>
            <div className="builder-sheet-sub">
              {draft.length} of {BLOCK_CATALOG.length} blocks selected · hover any block to preview it with your team's data
            </div>
          </div>
          <div className="builder-sheet-quickactions">
            <button type="button" className="builder-action" onClick={() => setDraft(STARTER_BLOCKS)}>Starter</button>
            <button type="button" className="builder-action" onClick={() => setDraft(BLOCK_CATALOG.map((b) => b.id))}>All</button>
            <button type="button" className="builder-action danger" onClick={() => setDraft([])}>Clear</button>
          </div>
        </header>

        <div className="builder-sheet-body">
          <div className="builder-sheet-catalog">
            {(Object.keys(grouped) as BlockCategory[]).map((cat) => {
              const blocks = grouped[cat];
              if (blocks.length === 0) return null;
              return (
                <div key={cat} className="builder-cat-group">
                  <div className="builder-cat-label">{CATEGORY_LABELS[cat]}</div>
                  <div className="builder-block-grid">
                    {blocks.map((b) => {
                      const selected = draftSet.has(b.id);
                      const isHovered = hovered === b.id;
                      return (
                        <button
                          type="button"
                          key={b.id}
                          className={`builder-block-chip${selected ? " selected" : ""}${isHovered ? " hovered" : ""}`}
                          onMouseEnter={() => setHovered(b.id)}
                          onMouseLeave={() => setHovered((h) => (h === b.id ? null : h))}
                          onClick={() => toggleDraft(b.id)}
                        >
                          <div className="builder-block-chip-head">
                            <span className="builder-block-chip-title">{b.title}</span>
                            <span className="builder-block-chip-toggle">{selected ? "✓" : "+"}</span>
                          </div>
                          <div className="builder-block-chip-desc">{b.short_description}</div>
                          <div className="builder-block-chip-meta">
                            <span className={`builder-tier tier-${b.tier}`}>{TIER_SYMBOL[b.tier]} {TIER_LABEL[b.tier]}</span>
                            <span className="builder-source">from {b.source_version}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="builder-sheet-preview">
            {hoveredBlock ? (
              <>
                <div className="builder-preview-head">
                  <div className="builder-preview-eyebrow">Live preview · your team's data</div>
                  <h3 className="builder-preview-title">{hoveredBlock.title}</h3>
                  <div className="builder-preview-meta">
                    <span className={`builder-tier tier-${hoveredBlock.tier}`}>
                      {TIER_SYMBOL[hoveredBlock.tier]} {TIER_LABEL[hoveredBlock.tier]}
                    </span>
                    <span className="builder-source">from {hoveredBlock.source_version}</span>
                  </div>
                  <p className="builder-preview-desc">{hoveredBlock.short_description}</p>
                </div>
                <div className="builder-preview-body">{hoveredBlock.render(r)}</div>
              </>
            ) : (
              <div className="builder-preview-empty">
                <div className="builder-preview-empty-glyph">◌</div>
                <div>Hover any block on the left to preview it here.</div>
                <div className="builder-preview-empty-sub">
                  Previews render the block with this team's actual data so you can see what each block looks like before adding it.
                </div>
              </div>
            )}
          </div>
        </div>

        <footer className="builder-sheet-footer">
          <div className="builder-sheet-footer-info">
            Changes saved on Apply · selection persists in your browser
          </div>
          <div className="builder-sheet-footer-actions">
            <button type="button" className="builder-cta" onClick={closeSheet}>Cancel</button>
            <button type="button" className="builder-cta primary" onClick={applySheet}>Apply</button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

export { BLOCK_CATALOG } from "./v7-builder-blocks";
export type { DashboardBlock } from "./v7-builder-blocks";
