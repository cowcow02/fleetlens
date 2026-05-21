"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TeamInsightReport } from "../../app/team/[slug]/insights/types";
import {
  BLOCK_CATALOG,
  CATEGORY_LABELS,
  STARTER_BLOCKS,
  defaultWidthFor,
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

const COLUMN_COUNT = 4;
const COLUMN_GAP_PX = 14;

// Masonry row-track config: keep in sync with .builder-grid grid-auto-rows + row-gap.
const ROW_TRACK_PX = 8;
const ROW_GAP_PX = 14;

function widthLabel(w: number): string {
  return `${Math.round((w / COLUMN_COUNT) * 100)}%`;
}

type WidthMap = Record<string, number>;
type ExtrasMap = Record<string, string>; // id → user text for title/text extras
type PersistedState = { ids: string[]; widths: WidthMap; extras?: ExtrasMap };
type StoredFormat =
  | string[]
  | PersistedState
  | { ids: string[]; layout?: { i: string; w?: number }[]; breaks?: Record<string, true> };

type ExtraKind = "divider" | "title" | "text";

function extraKind(id: string): ExtraKind | null {
  if (id.startsWith("divider-")) return "divider";
  if (id.startsWith("title-")) return "title";
  if (id.startsWith("text-")) return "text";
  return null;
}

function newExtraId(kind: ExtraKind): string {
  return `${kind}-${Math.random().toString(36).slice(2, 9)}`;
}

function defaultWidthForExtra(kind: ExtraKind): number {
  if (kind === "divider") return 4;
  if (kind === "title") return 4;
  return 2; // text
}

function storageKey(slug: string): string {
  return `fleetlens-builder-v7:${slug}`;
}

function isKnownId(id: string): boolean {
  return BLOCK_CATALOG.some((b) => b.id === id) || extraKind(id) !== null;
}

function widthForId(id: string): number {
  const kind = extraKind(id);
  if (kind) return defaultWidthForExtra(kind);
  const block = BLOCK_CATALOG.find((b) => b.id === id);
  return block ? defaultWidthFor(block) : 2;
}

function parseBlocksParam(raw: string | undefined): string[] {
  if (!raw) return [];
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (isKnownId(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function defaultWidths(ids: string[]): WidthMap {
  const out: WidthMap = {};
  for (const id of ids) {
    out[id] = widthForId(id);
  }
  return out;
}

function mergeWidths(prev: WidthMap, ids: string[]): WidthMap {
  const out: WidthMap = {};
  for (const id of ids) {
    out[id] = prev[id] ?? widthForId(id);
  }
  return out;
}

function InsertMenu({ onInsert, position }: { onInsert: (kind: ExtraKind) => void; position: "top" | "bottom" }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`builder-insert builder-insert-${position}${open ? " open" : ""}`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {open ? (
        <div className="builder-insert-menu">
          <button type="button" onClick={() => { onInsert("divider"); setOpen(false); }}>── Divider</button>
          <button type="button" onClick={() => { onInsert("title"); setOpen(false); }}>T  Title</button>
          <button type="button" onClick={() => { onInsert("text"); setOpen(false); }}>¶  Text</button>
          <button type="button" className="builder-insert-cancel" onClick={() => setOpen(false)}>×</button>
        </div>
      ) : (
        <button
          type="button"
          className="builder-insert-trigger"
          title={position === "top" ? "Insert before this" : "Insert after this"}
          onClick={() => setOpen(true)}
        >
          +
        </button>
      )}
    </div>
  );
}

function SortableWidget({
  id,
  block,
  width,
  editMode,
  report,
  onRemove,
  onWidthChange,
  onInsertAfter,
  onInsertBefore,
}: {
  id: string;
  block: DashboardBlock;
  width: number;
  editMode: boolean;
  report: TeamInsightReport;
  onRemove: () => void;
  onWidthChange: (w: number) => void;
  onInsertAfter: (kind: ExtraKind) => void;
  onInsertBefore: (kind: ExtraKind) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !editMode,
  });

  const innerRef = useRef<HTMLDivElement | null>(null);
  const [resizing, setResizing] = useState(false);
  const [rowSpan, setRowSpan] = useState(20);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.getBoundingClientRect().height;
      const span = Math.max(1, Math.ceil((h + ROW_GAP_PX) / (ROW_TRACK_PX + ROW_GAP_PX)));
      setRowSpan((prev) => (prev === span ? prev : span));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  function setRefs(node: HTMLDivElement | null) {
    setNodeRef(node);
    innerRef.current = node;
  }

  function handleResizeStart(e: React.PointerEvent<HTMLDivElement>) {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    const widgetEl = innerRef.current;
    const gridEl = widgetEl?.closest(".builder-grid") as HTMLElement | null;
    if (!widgetEl || !gridEl) return;
    const gridRect = gridEl.getBoundingClientRect();
    const widgetRect = widgetEl.getBoundingClientRect();
    const colWidth = (gridRect.width - COLUMN_GAP_PX * (COLUMN_COUNT - 1)) / COLUMN_COUNT;
    setResizing(true);

    function compute(clientX: number) {
      const widthPx = clientX - widgetRect.left;
      const newW = Math.round((widthPx + COLUMN_GAP_PX / 2) / (colWidth + COLUMN_GAP_PX));
      return Math.max(1, Math.min(COLUMN_COUNT, newW));
    }
    function onMove(ev: PointerEvent) {
      onWidthChange(compute(ev.clientX));
    }
    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      setResizing(false);
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  const style: React.CSSProperties = {
    gridColumn: `span ${width}`,
    gridRow: `span ${rowSpan}`,
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 60 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };

  return (
    <div
      ref={setRefs}
      className={`builder-widget${isDragging ? " is-dragging" : ""}${resizing ? " is-resizing" : ""}`}
      style={style}
      data-width-label={widthLabel(width)}
    >
      <header
        className={`builder-widget-head${editMode ? " builder-widget-drag-handle" : ""}`}
        {...(editMode ? { ...attributes, ...listeners } : {})}
      >
        <div className="builder-widget-titlewrap">
          <h3 className="builder-widget-title">{block.title}</h3>
          {editMode && (
            <div className="builder-widget-meta">
              <span className="builder-width-badge">{widthLabel(width)}</span>
            </div>
          )}
        </div>
        {editMode && (
          <div
            className="builder-widget-controls"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="builder-block-control danger"
              title="Remove"
              onClick={onRemove}
            >
              ×
            </button>
          </div>
        )}
      </header>
      <div className="builder-widget-body">{block.render(report)}</div>
      {editMode && (
        <>
          <div
            className="builder-resize-handle"
            onPointerDown={handleResizeStart}
            title="Drag to resize"
          />
          <InsertMenu position="top" onInsert={onInsertBefore} />
          <InsertMenu position="bottom" onInsert={onInsertAfter} />
        </>
      )}
    </div>
  );
}

function SortableDivider({
  id,
  editMode,
  onRemove,
  onInsertAfter,
  onInsertBefore,
}: {
  id: string;
  editMode: boolean;
  onRemove: () => void;
  onInsertAfter: (kind: ExtraKind) => void;
  onInsertBefore: (kind: ExtraKind) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !editMode,
  });
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [rowSpan, setRowSpan] = useState(4);
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.getBoundingClientRect().height;
      const span = Math.max(1, Math.ceil((h + ROW_GAP_PX) / (ROW_TRACK_PX + ROW_GAP_PX)));
      setRowSpan((prev) => (prev === span ? prev : span));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editMode]);

  function setRefs(node: HTMLDivElement | null) {
    setNodeRef(node);
    innerRef.current = node;
  }

  const style: React.CSSProperties = {
    gridColumn: "span 4",
    gridRow: `span ${rowSpan}`,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : undefined,
  };
  return (
    <div
      ref={setRefs}
      style={style}
      className={`builder-divider${isDragging ? " is-dragging" : ""}`}
      {...(editMode ? { ...attributes, ...listeners } : {})}
    >
      <span className="builder-divider-line" />
      {editMode && (
        <>
          <button
            type="button"
            className="builder-block-control danger builder-divider-remove"
            title="Remove divider"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onRemove}
          >
            ×
          </button>
          <InsertMenu position="top" onInsert={onInsertBefore} />
          <InsertMenu position="bottom" onInsert={onInsertAfter} />
        </>
      )}
    </div>
  );
}

function SortableExtraText({
  id,
  kind,
  text,
  width,
  editMode,
  onTextChange,
  onWidthChange,
  onRemove,
  onInsertAfter,
  onInsertBefore,
}: {
  id: string;
  kind: "title" | "text";
  text: string;
  width: number;
  editMode: boolean;
  onTextChange: (text: string) => void;
  onWidthChange: (w: number) => void;
  onRemove: () => void;
  onInsertAfter: (kind: ExtraKind) => void;
  onInsertBefore: (kind: ExtraKind) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !editMode,
  });
  const [resizing, setResizing] = useState(false);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [rowSpan, setRowSpan] = useState(8);
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.getBoundingClientRect().height;
      const span = Math.max(1, Math.ceil((h + ROW_GAP_PX) / (ROW_TRACK_PX + ROW_GAP_PX)));
      setRowSpan((prev) => (prev === span ? prev : span));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, editMode, text]);

  const style: React.CSSProperties = {
    gridColumn: `span ${width}`,
    gridRow: `span ${rowSpan}`,
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 60 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };

  function setRefs(node: HTMLDivElement | null) {
    setNodeRef(node);
    innerRef.current = node;
  }

  function handleResizeStart(e: React.PointerEvent<HTMLDivElement>) {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    const widgetEl = innerRef.current;
    const gridEl = widgetEl?.closest(".builder-grid") as HTMLElement | null;
    if (!widgetEl || !gridEl) return;
    const gridRect = gridEl.getBoundingClientRect();
    const colStep = (gridRect.width - COLUMN_GAP_PX * (COLUMN_COUNT - 1)) / COLUMN_COUNT + COLUMN_GAP_PX;
    const startX = e.clientX;
    const startWidth = width;
    setResizing(true);
    function compute(clientX: number) {
      const deltaCols = Math.round((clientX - startX) / colStep);
      return Math.max(1, Math.min(COLUMN_COUNT, startWidth + deltaCols));
    }
    function onMove(ev: PointerEvent) { onWidthChange(compute(ev.clientX)); }
    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      setResizing(false);
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  return (
    <div
      ref={setRefs}
      className={`builder-extra builder-extra-${kind}${resizing ? " is-resizing" : ""}${isDragging ? " is-dragging" : ""}`}
      style={style}
      data-width-label={widthLabel(width)}
      {...(editMode ? { ...attributes, ...listeners } : {})}
    >
      {editMode ? (
        kind === "title" ? (
          <input
            type="text"
            className="builder-extra-input builder-extra-title-input"
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Section title"
          />
        ) : (
          <textarea
            className="builder-extra-input builder-extra-text-input"
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Add some context for this section…"
            rows={3}
          />
        )
      ) : (
        kind === "title" ? <h2 className="builder-extra-title-static">{text || "Section title"}</h2>
                         : <p className="builder-extra-text-static">{text}</p>
      )}
      {editMode && (
        <>
          <button
            type="button"
            className="builder-block-control danger builder-extra-remove"
            title="Remove"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onRemove}
          >
            ×
          </button>
          <div
            className="builder-resize-handle"
            onPointerDown={handleResizeStart}
            title="Drag to resize"
          />
          <InsertMenu position="top" onInsert={onInsertBefore} />
          <InsertMenu position="bottom" onInsert={onInsertAfter} />
        </>
      )}
    </div>
  );
}

export function VariantBuilder({
  r,
  slug,
  blocksParam,
  pdfMode = false,
}: {
  r: TeamInsightReport;
  slug: string;
  blocksParam: string | undefined;
  pdfMode?: boolean;
}) {
  const urlInitial = useMemo(() => parseBlocksParam(blocksParam), [blocksParam]);

  const initialIds = urlInitial.length > 0 ? urlInitial : STARTER_BLOCKS;
  const initialWidths = useMemo(() => defaultWidths(initialIds), [initialIds]);

  const [committedIds, setCommittedIds] = useState<string[]>(initialIds);
  const [widths, setWidths] = useState<WidthMap>(initialWidths);
  const [extras, setExtras] = useState<ExtrasMap>({});
  const [hydrated, setHydrated] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>(initialIds);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (urlInitial.length === 0) {
      try {
        const stored = window.localStorage.getItem(storageKey(slug));
        if (stored) {
          const parsed = JSON.parse(stored) as StoredFormat;
          if (Array.isArray(parsed)) {
            const filtered = parsed.filter(
              (id): id is string => typeof id === "string" && isKnownId(id),
            );
            if (filtered.length > 0) {
              setCommittedIds(filtered);
              setDraftIds(filtered);
              setWidths(defaultWidths(filtered));
            }
          } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.ids)) {
            const validIds = parsed.ids.filter(
              (id): id is string => typeof id === "string" && isKnownId(id),
            );
            if (validIds.length > 0) {
              setCommittedIds(validIds);
              setDraftIds(validIds);
              const widthsFromStore: WidthMap = {};
              if ("widths" in parsed && parsed.widths) {
                for (const id of validIds) {
                  const w = parsed.widths[id];
                  if (typeof w === "number" && w >= 1 && w <= 4) widthsFromStore[id] = w;
                }
              } else if ("layout" in parsed && Array.isArray(parsed.layout)) {
                for (const item of parsed.layout) {
                  if (validIds.includes(item.i) && typeof item.w === "number") {
                    widthsFromStore[item.i] = Math.max(1, Math.min(4, item.w));
                  }
                }
              }
              setWidths(mergeWidths(widthsFromStore, validIds));
              if ("extras" in parsed && parsed.extras) {
                const validExtras: ExtrasMap = {};
                for (const id of validIds) {
                  if (extraKind(id) && typeof parsed.extras[id] === "string") {
                    validExtras[id] = parsed.extras[id];
                  }
                }
                setExtras(validExtras);
              }
            }
          }
        }
      } catch {
        // ignore
      }
    }
    setHydrated(true);
  }, [slug, urlInitial]);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    try {
      const payload: PersistedState = { ids: committedIds, widths, extras };
      window.localStorage.setItem(storageKey(slug), JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [committedIds, widths, extras, slug, hydrated]);

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
    setWidths((prev) => mergeWidths(prev, draftIds));
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
    setWidths((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setExtras((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }
  function setItemWidth(id: string, w: number) {
    setWidths((prev) => ({ ...prev, [id]: w }));
  }
  function setExtraText(id: string, text: string) {
    setExtras((prev) => ({ ...prev, [id]: text }));
  }
  function insertExtraAt(kind: ExtraKind, at: number) {
    const id = newExtraId(kind);
    setCommittedIds((prev) => {
      const idx = Math.max(0, Math.min(prev.length, at));
      return [...prev.slice(0, idx), id, ...prev.slice(idx)];
    });
    setWidths((prev) => ({ ...prev, [id]: defaultWidthForExtra(kind) }));
    if (kind !== "divider") {
      setExtras((prev) => ({ ...prev, [id]: kind === "title" ? "Section title" : "Add some context for this section…" }));
    }
  }
  function insertExtra(kind: ExtraKind, afterId?: string) {
    if (!afterId) {
      insertExtraAt(kind, committedIds.length);
      return;
    }
    const idx = committedIds.indexOf(afterId);
    insertExtraAt(kind, idx < 0 ? committedIds.length : idx + 1);
  }
  function insertExtraBefore(kind: ExtraKind, beforeId: string) {
    const idx = committedIds.indexOf(beforeId);
    insertExtraAt(kind, idx < 0 ? 0 : idx);
  }

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setCommittedIds((prev) => {
      const from = prev.indexOf(String(active.id));
      const to = prev.indexOf(String(over.id));
      if (from < 0 || to < 0) return prev;
      return arrayMove(prev, from, to);
    });
  }

  const grouped = useMemo(() => groupBlocksByCategory(BLOCK_CATALOG), []);
  const hoveredBlock = hovered ? BLOCK_CATALOG.find((b) => b.id === hovered) ?? null : null;
  const draftSet = new Set(draftIds);
  const isEmpty = committedIds.length === 0;

  function blockById(id: string): DashboardBlock | null {
    return BLOCK_CATALOG.find((b) => b.id === id) ?? null;
  }

  return (
    <div className={`variant-frame${editMode ? " builder-editing" : ""}${pdfMode ? " builder-pdf" : ""}`}>
      {!pdfMode && <div className="builder-floating-actions">
        <button
          type="button"
          className="builder-edit-button"
          disabled={exporting}
          onClick={async () => {
            if (exporting) return;
            setExporting(true);
            setExportError(null);
            try {
              const state = typeof window !== "undefined" ? window.localStorage.getItem(storageKey(slug)) ?? "" : "";
              const res = await fetch(`/api/team/${encodeURIComponent(slug)}/insights/pdf?v=7`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ state }),
              });
              if (!res.ok) {
                const msg = await res.text().catch(() => "");
                setExportError(
                  res.status === 401
                    ? "Session expired — refresh the page and sign in again."
                    : `PDF generation failed (${res.status}). ${msg.slice(0, 200)}`,
                );
                return;
              }
              const blob = await res.blob();
              const disposition = res.headers.get("content-disposition") ?? "";
              const fileMatch = disposition.match(/filename="([^"]+)"/);
              const filename = fileMatch?.[1] ?? `${slug}-insight-report.pdf`;
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = filename;
              a.rel = "noopener";
              document.body.appendChild(a);
              a.click();
              setTimeout(() => {
                a.remove();
                URL.revokeObjectURL(url);
              }, 30_000);
            } catch (err) {
              setExportError(`PDF export failed: ${err instanceof Error ? err.message : String(err)}`);
            } finally {
              setExporting(false);
            }
          }}
          title="Render the dashboard server-side and download as PDF"
        >
          <span className="builder-customize-icon">{exporting ? "⌛" : "⤓"}</span>
          {exporting ? "Generating…" : "Export PDF"}
        </button>
        <button
          type="button"
          className={`builder-edit-button${editMode ? " active" : ""}`}
          onClick={() => setEditMode((v) => !v)}
        >
          <span className="builder-customize-icon">{editMode ? "✓" : "⇆"}</span>
          {editMode ? "Done" : "Edit layout"}
        </button>
        <button type="button" className="builder-customize-button" onClick={openSheet}>
          <span className="builder-customize-icon">⚙</span>
          Customize
        </button>
        {exportError && (
          <div className="builder-export-error" role="alert" onClick={() => setExportError(null)}>
            {exportError}
          </div>
        )}
      </div>}

      {isEmpty ? (
        <div className="builder-empty">
          <p>Your dashboard is empty.</p>
          <button
            type="button"
            className="builder-action"
            onClick={() => {
              setCommittedIds(STARTER_BLOCKS);
              setWidths(defaultWidths(STARTER_BLOCKS));
            }}
          >
            ⇢ Load starter preset ({STARTER_BLOCKS.length} blocks)
          </button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={committedIds} strategy={rectSortingStrategy}>
            {(() => {
              // Split into sections at divider IDs so masonry packing can't
              // back-fill across a section break.
              const sections: Array<
                { kind: "group"; ids: string[] } | { kind: "divider"; id: string }
              > = [];
              let current: string[] = [];
              for (const id of committedIds) {
                if (extraKind(id) === "divider") {
                  if (current.length) sections.push({ kind: "group", ids: current });
                  sections.push({ kind: "divider", id });
                  current = [];
                } else {
                  current.push(id);
                }
              }
              if (current.length) sections.push({ kind: "group", ids: current });
              return sections.map((section, idx) => {
                if (section.kind === "divider") {
                  return (
                    <SortableDivider
                      key={section.id}
                      id={section.id}
                      editMode={editMode}
                      onRemove={() => removeFromCommitted(section.id)}
                      onInsertAfter={(kind) => insertExtra(kind, section.id)}
                      onInsertBefore={(kind) => insertExtraBefore(kind, section.id)}
                    />
                  );
                }
                return (
                  <div key={`group-${idx}`} className="builder-grid">
                    {section.ids.map((id) => {
                      const kind = extraKind(id);
                      const w = widths[id] ?? widthForId(id);
                      if (kind === "title" || kind === "text") {
                        return (
                          <SortableExtraText
                            key={id}
                            id={id}
                            kind={kind}
                            text={extras[id] ?? ""}
                            width={w}
                            editMode={editMode}
                            onTextChange={(t) => setExtraText(id, t)}
                            onWidthChange={(next) => setItemWidth(id, next)}
                            onRemove={() => removeFromCommitted(id)}
                            onInsertAfter={(insertKind) => insertExtra(insertKind, id)}
                            onInsertBefore={(insertKind) => insertExtraBefore(insertKind, id)}
                          />
                        );
                      }
                      const block = blockById(id);
                      if (!block) return null;
                      return (
                        <SortableWidget
                          key={id}
                          id={id}
                          block={block}
                          width={w}
                          editMode={editMode}
                          report={r}
                          onRemove={() => removeFromCommitted(id)}
                          onWidthChange={(next) => setItemWidth(id, next)}
                          onInsertAfter={(insertKind) => insertExtra(insertKind, id)}
                          onInsertBefore={(insertKind) => insertExtraBefore(insertKind, id)}
                        />
                      );
                    })}
                  </div>
                );
              });
            })()}
          </SortableContext>
        </DndContext>
      )}

      {/* ─── Side sheet ─────────────────────────────────────────────── */}
      {!pdfMode && <>
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
            <button
              type="button"
              className="builder-action"
              onClick={() => {
                insertExtra("divider");
                setSheetOpen(false);
              }}
            >+ Divider</button>
            <button
              type="button"
              className="builder-action"
              onClick={() => {
                insertExtra("title");
                setSheetOpen(false);
              }}
            >+ Title</button>
            <button
              type="button"
              className="builder-action"
              onClick={() => {
                insertExtra("text");
                setSheetOpen(false);
              }}
            >+ Text</button>
            <span className="builder-sheet-quickactions-divider" />
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
            Apply saves your selection · use Edit layout on the dashboard to resize blocks
          </div>
          <div className="builder-sheet-footer-actions">
            <button type="button" className="builder-cta" onClick={closeSheet}>Cancel</button>
            <button type="button" className="builder-cta primary" onClick={applySheet}>Apply</button>
          </div>
        </footer>
      </aside>
      </>}
    </div>
  );
}

export { BLOCK_CATALOG } from "./v7-builder-blocks";
export type { DashboardBlock } from "./v7-builder-blocks";
