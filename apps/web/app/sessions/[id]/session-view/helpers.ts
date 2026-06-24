/**
 * Pure (no-React) helpers for the session-view module.
 *
 * - `formatDayKey` — render a `YYYY-MM-DD` day key as a short, locale-free
 *   label (e.g. "Jun 16"). Formatted straight from the key — not a Date —
 *   so SSR and client output match regardless of timezone.
 * - `flattenMegaRows` — turn the parser's MegaRow stream into a flat
 *   DisplayRow list, expanding turns whose firstPrimaryIndex is in the
 *   `expanded` set.
 * - `allRowsAsRawRows` — fallback for "All events" filter mode. Wraps each
 *   raw event in a synthetic PresentationRow so TranscriptList can render
 *   attachments/meta/thinking/tool_result without going through the
 *   meaningful-transformation logic.
 * - `formatDurationHeader` — concise ms→string for header stats; rolls up
 *   to "h m" once agent time exceeds an hour so workflow-fold totals stay
 *   readable.
 */
import type {
  MegaRow,
  PresentationRow,
  PresentationRowKind,
  SessionEvent,
} from "@claude-lens/parser";
import type { DisplayRow } from "./types";

const DAY_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatDayKey(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  if (!m || !d) return key;
  return `${DAY_MONTHS[m - 1]} ${d}`;
}

export function flattenMegaRows(
  megaRows: MegaRow[],
  expanded: Set<number>,
): DisplayRow[] {
  const out: DisplayRow[] = [];
  for (const m of megaRows) {
    if (m.kind === "turn") {
      if (expanded.has(m.firstPrimaryIndex)) {
        out.push({ kind: "turn-expanded-header", turn: m });
        for (const r of m.rows) {
          out.push({ kind: "presentation", row: r, indented: true });
        }
        out.push({ kind: "turn-expanded-footer", turn: m });
      } else {
        out.push({ kind: "turn-collapsed", turn: m });
      }
    } else {
      out.push({ kind: "presentation", row: m });
    }
  }
  return out;
}

export function allRowsAsRawRows(events: SessionEvent[]): PresentationRow[] {
  const out: PresentationRow[] = [];
  for (const e of events) {
    let kind: PresentationRowKind;
    switch (e.role) {
      case "user":
        kind = "user";
        break;
      case "agent":
      case "agent-thinking":
        kind = "agent";
        break;
      case "tool-call":
      case "tool-result":
        kind = "tool-group";
        break;
      case "system":
      case "meta":
        kind = "model";
        break;
    }
    if (kind === "tool-group") {
      out.push({
        kind: "tool-group",
        toolNames: [{ name: e.toolName ?? e.rawType, count: 1 }],
        count: 1,
        events: [e],
        tOffsetMs: e.tOffsetMs,
        gapMs: e.gapMs,
      });
    } else if (kind === "agent") {
      out.push({
        kind: "agent",
        event: e,
        groupedEvents: [e],
        tOffsetMs: e.tOffsetMs,
        gapMs: e.gapMs,
      });
    } else if (kind === "user") {
      out.push({
        kind: "user",
        event: e,
        tOffsetMs: e.tOffsetMs,
        gapMs: e.gapMs,
      });
    } else {
      out.push({
        kind: "model",
        event: e,
        tOffsetMs: e.tOffsetMs,
        gapMs: e.gapMs,
      });
    }
  }
  return out;
}

export function formatDurationHeader(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
