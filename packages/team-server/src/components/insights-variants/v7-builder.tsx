"use client";

import { useEffect, useMemo, useState } from "react";
import GridLayout, { WidthProvider, type Layout as LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { TeamInsightReport } from "../../app/team/[slug]/insights/types";
import {
  BLOCK_CATALOG,
  CATEGORY_LABELS,
  STARTER_BLOCKS,
  defaultSizeFor,
  groupBlocksByCategory,
  type BlockCategory,
  type BlockTier,
  type DashboardBlock,
} from "./v7-builder-blocks";

const ReactGridLayout = WidthProvider(GridLayout);

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

const GRID_COLS = 12;
const GRID_ROW_HEIGHT = 30;
const GRID_MARGIN: [number, number] = [12, 12];

type GridItem = { i: string; x: number; y: number; w: number; h: number; minW?: number; minH?: number };
type PersistedState = { ids: string[]; layout: GridItem[] };
type StoredFormat = string[] | PersistedState;

function storageKey(slug: string): string {
  return `fleetlens-builder-v7:${slug}`;
}

function parseBlocksParam(raw: string | undefined): string[] {
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

function nextRowY(items: GridItem[]): number {
  if (items.length === 0) return 0;
  return Math.max(...items.map((it) => it.y + it.h));
}

function autoLayoutForIds(ids: string[]): GridItem[] {
  const items: GridItem[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let rowMaxH = 0;

  for (const id of ids) {
    const block = BLOCK_CATALOG.find((b) => b.id === id);
    if (!block) continue;
    const { w, h, minW, minH } = defaultSizeFor(block);
    const useW = Math.min(GRID_COLS, w);
    // Wrap to next row when it won't fit horizontally
    if (cursorX + useW > GRID_COLS) {
      cursorX = 0;
      cursorY += rowMaxH;
      rowMaxH = 0;
    }
    items.push({ i: id, x: cursorX, y: cursorY, w: useW, h, minW, minH });
    cursorX += useW;
    rowMaxH = Math.max(rowMaxH, h);
  }
  return items;
}

function appendItem(items: GridItem[], id: string): GridItem[] {
  if (items.some((it) => it.i === id)) return items;
  const block = BLOCK_CATALOG.find((b) => b.id === id);
  if (!block) return items;
  const { w, h, minW, minH } = defaultSizeFor(block);
  const y = nextRowY(items);
  return [...items, { i: id, x: 0, y, w: Math.min(GRID_COLS, w), h, minW, minH }];
}

function removeItem(items: GridItem[], id: string): GridItem[] {
  return items.filter((it) => it.i !== id);
}

function syncLayoutToIds(layout: GridItem[], ids: string[]): GridItem[] {
  // Drop items not in ids; add new ids with default position
  const kept = layout.filter((it) => ids.includes(it.i));
  let result = kept;
  for (const id of ids) {
    if (!result.some((it) => it.i === id)) {
      result = appendItem(result, id);
    }
  }
  return result;
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
  const urlInitial = useMemo(() => parseBlocksParam(blocksParam), [blocksParam]);

  // Initial state — server-rendered with starter preset (hydrates after mount from localStorage).
  const initialIds = urlInitial.length > 0 ? urlInitial : STARTER_BLOCKS;
  const initialLayout = useMemo(() => autoLayoutForIds(initialIds), [initialIds]);

  const [committedIds, setCommittedIds] = useState<string[]>(initialIds);
  const [layout, setLayout] = useState<GridItem[]>(initialLayout);
  const [hydrated, setHydrated] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>(initialIds);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  // Hydrate from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (urlInitial.length === 0) {
      try {
        const stored = window.localStorage.getItem(storageKey(slug));
        if (stored) {
          const parsed = JSON.parse(stored) as StoredFormat;
          if (Array.isArray(parsed)) {
            // v7.1 format: just string[]. Convert to layout.
            const filtered = parsed.filter(
              (id): id is string => typeof id === "string" && BLOCK_CATALOG.some((b) => b.id === id),
            );
            if (filtered.length > 0) {
              setCommittedIds(filtered);
              setDraftIds(filtered);
              setLayout(autoLayoutForIds(filtered));
            }
          } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.ids)) {
            // v7.2 format: {ids, layout}
            const validIds = parsed.ids.filter(
              (id): id is string => typeof id === "string" && BLOCK_CATALOG.some((b) => b.id === id),
            );
            if (validIds.length > 0) {
              setCommittedIds(validIds);
              setDraftIds(validIds);
              const validLayout = Array.isArray(parsed.layout)
                ? parsed.layout.filter((it) => validIds.includes(it.i))
                : [];
              setLayout(syncLayoutToIds(validLayout, validIds));
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
      const payload: PersistedState = { ids: committedIds, layout };
      window.localStorage.setItem(storageKey(slug), JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [committedIds, layout, slug, hydrated]);

  function openSheet() {
    setDraftIds(committedIds);
    setHovered(null);
    setSheetOpen(true);
  }
  function closeSheet() {
    setSheetOpen(false);
  }
  function applySheet() {
    setCommittedIds(draftIds);
    setLayout((prev) => syncLayoutToIds(prev, draftIds));
    setSheetOpen(false);
  }
  function toggleDraft(id: string) {
    setDraftIds((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  }
  function loadStarter() {
    setDraftIds(STARTER_BLOCKS);
  }
  function selectAll() {
    setDraftIds(BLOCK_CATALOG.map((b) => b.id));
  }
  function clearAll() {
    setDraftIds([]);
  }
  function removeFromCommitted(id: string) {
    setCommittedIds((prev) => prev.filter((x) => x !== id));
    setLayout((prev) => removeItem(prev, id));
  }

  function handleLayoutChange(next: LayoutItem[]) {
    // GridLayout passes Layout[]; we only persist the fields we care about.
    setLayout((prev) => {
      const map = new Map(prev.map((it) => [it.i, it]));
      const merged: GridItem[] = next.map((it) => {
        const existing = map.get(it.i);
        return {
          i: it.i,
          x: it.x,
          y: it.y,
          w: it.w,
          h: it.h,
          minW: existing?.minW,
          minH: existing?.minH,
        };
      });
      return merged;
    });
  }

  const grouped = useMemo(() => groupBlocksByCategory(BLOCK_CATALOG), []);
  const hoveredBlock = hovered ? BLOCK_CATALOG.find((b) => b.id === hovered) ?? null : null;
  const draftSet = new Set(draftIds);
  const isEmpty = committedIds.length === 0;

  function blockById(id: string): DashboardBlock | null {
    return BLOCK_CATALOG.find((b) => b.id === id) ?? null;
  }

  // Build the layout that the grid renders: filter to committed ids, ensure all
  // committed ids have a layout entry.
  const renderedLayout: LayoutItem[] = useMemo(() => {
    const filtered = layout.filter((it) => committedIds.includes(it.i));
    const have = new Set(filtered.map((it) => it.i));
    const missing = committedIds.filter((id) => !have.has(id));
    const withMissing = [...filtered];
    let cursorY = nextRowY(withMissing);
    for (const id of missing) {
      const b = blockById(id);
      if (!b) continue;
      const { w, h, minW, minH } = defaultSizeFor(b);
      withMissing.push({ i: id, x: 0, y: cursorY, w, h, minW, minH });
      cursorY += h;
    }
    return withMissing;
  }, [committedIds, layout]);

  return (
    <div className="variant-frame">
      <header className="builder-header">
        <div className="builder-header-left">
          <h2 className="builder-header-title">Dashboard</h2>
          <div className="builder-header-sub">
            {committedIds.length} block{committedIds.length === 1 ? "" : "s"} ·{" "}
            <span className="builder-header-source">drag headers to move · resize from bottom-right corner · saved in your browser</span>
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
          <button
            type="button"
            className="builder-action"
            onClick={() => {
              setCommittedIds(STARTER_BLOCKS);
              setLayout(autoLayoutForIds(STARTER_BLOCKS));
            }}
          >
            ⇢ Load starter preset ({STARTER_BLOCKS.length} blocks)
          </button>
        </div>
      ) : (
        <ReactGridLayout
          className="builder-grid"
          layout={renderedLayout}
          cols={GRID_COLS}
          rowHeight={GRID_ROW_HEIGHT}
          margin={GRID_MARGIN}
          draggableHandle=".builder-widget-drag-handle"
          compactType="vertical"
          onLayoutChange={handleLayoutChange}
          isBounded={false}
          resizeHandles={["se"]}
        >
          {committedIds.map((id) => {
            const block = blockById(id);
            if (!block) return null;
            return (
              <div key={id} className="builder-widget">
                <header className="builder-widget-head builder-widget-drag-handle">
                  <div className="builder-widget-titlewrap">
                    <h3 className="builder-widget-title">{block.title}</h3>
                    <div className="builder-widget-meta">
                      <span className={`builder-tier tier-${block.tier}`}>
                        {TIER_SYMBOL[block.tier]} {TIER_LABEL[block.tier]}
                      </span>
                      <span className="builder-source">from {block.source_version}</span>
                    </div>
                  </div>
                  <div
                    className="builder-widget-controls"
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="builder-block-control danger"
                      title="Remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromCommitted(id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                </header>
                <div className="builder-widget-body">{block.render(r)}</div>
              </div>
            );
          })}
        </ReactGridLayout>
      )}

      {/* ─── Side sheet ─────────────────────────────────────────────── */}
      <div
        className={`builder-sheet-backdrop${sheetOpen ? " open" : ""}`}
        onClick={closeSheet}
        aria-hidden={!sheetOpen}
      />
      <aside
        className={`builder-sheet${sheetOpen ? " open" : ""}`}
        aria-hidden={!sheetOpen}
        aria-label="Customize dashboard"
      >
        <header className="builder-sheet-head">
          <div>
            <h2 className="builder-sheet-title">Customize dashboard</h2>
            <div className="builder-sheet-sub">
              {draftIds.length} of {BLOCK_CATALOG.length} blocks selected · hover any block to preview it with your team's data
            </div>
          </div>
          <div className="builder-sheet-quickactions">
            <button type="button" className="builder-action" onClick={loadStarter}>Starter</button>
            <button type="button" className="builder-action" onClick={selectAll}>All</button>
            <button type="button" className="builder-action danger" onClick={clearAll}>Clear</button>
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
            Apply saves your selection · drag and resize on the dashboard after closing
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
