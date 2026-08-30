const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export type WatchViewport = {
  text: string;
  offset: number;
  maxOffset: number;
  pageSize: number;
};

export function renderWatchViewport(
  content: string,
  terminalRows: number,
  requestedOffset: number,
): WatchViewport {
  const rows = Math.max(1, Math.floor(terminalRows));
  const lines = content.split("\n");
  while (lines.at(-1) === "") lines.pop();

  if (lines.length <= rows) {
    return {
      text: `${lines.join("\n")}\n`,
      offset: 0,
      maxOffset: 0,
      pageSize: rows,
    };
  }

  const pageSize = Math.max(1, rows - 1);
  const maxOffset = Math.max(0, lines.length - pageSize);
  const offset = Math.max(0, Math.min(maxOffset, requestedOffset));
  const end = Math.min(lines.length, offset + pageSize);
  const status = `  ${DIM}${offset + 1}–${end} / ${lines.length} · ↑↓ scroll · PgUp/PgDn · Home/End · q quit${RESET}`;
  return {
    text: `${lines.slice(offset, end).join("\n")}\n${status}\n`,
    offset,
    maxOffset,
    pageSize,
  };
}

export function watchOffsetForKey(
  current: number,
  keyName: string,
  maxOffset: number,
  pageSize: number,
): number {
  if (keyName === "up") return Math.max(0, current - 1);
  if (keyName === "down") return Math.min(maxOffset, current + 1);
  if (keyName === "pageup") return Math.max(0, current - pageSize);
  if (keyName === "pagedown") return Math.min(maxOffset, current + pageSize);
  if (keyName === "home") return 0;
  if (keyName === "end") return maxOffset;
  return current;
}
