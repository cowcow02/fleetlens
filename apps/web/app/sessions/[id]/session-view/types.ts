/**
 * Shared types for the session-view module split.
 *
 * - DisplayRow: a flat list item rendered by TranscriptList. Either a
 *   presentation row, a collapsed turn summary, or an expanded-turn
 *   header/footer with its inner rows interleaved between them.
 * - MinimapSeg: one segment in the minimap (a row, a whole turn, or an
 *   idle stripe).
 *
 * Also re-exports `rowPrimaryIndex` from the parser so consumers can
 * import it from one place alongside the types.
 */
import {
  rowPrimaryIndex as rowPrimaryIndexFromLib,
  type MegaRow,
  type PresentationRow,
  type TurnMegaRow,
} from "@claude-lens/parser";

export const rowPrimaryIndex = rowPrimaryIndexFromLib;

export type DisplayRow =
  | { kind: "presentation"; row: PresentationRow; indented?: boolean }
  | { kind: "turn-collapsed"; turn: TurnMegaRow }
  | { kind: "turn-expanded-header"; turn: TurnMegaRow }
  | { kind: "turn-expanded-footer"; turn: TurnMegaRow };

export type MinimapSeg =
  | {
      kind: "row";
      row: PresentationRow;
      primaryIndex: number;
      start: number;
      end: number;
    }
  | {
      kind: "turn";
      turn: TurnMegaRow;
      primaryIndex: number;
      start: number;
      end: number;
    }
  | { kind: "idle"; start: number; end: number; durationMs: number };

// Re-export underlying types so consumers needing them can import here.
export type { MegaRow, PresentationRow, TurnMegaRow };
