const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

export type TableRow = {
  date: string;
  models: string;
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  totalTokens: number;
  cost: number | null;
};

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtCost(cost: number | null): string {
  if (cost === null) return "\u2014";
  return `$${cost.toFixed(2)}`;
}

function pad(s: string, width: number, align: "left" | "right" = "right"): string {
  if (align === "left") return s.padEnd(width);
  return s.padStart(width);
}

export function renderTable(rows: TableRow[], title: string): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(`${BOLD}${title}${RESET}`);
  lines.push("");

  const header = [
    pad("Date", 12, "left"),
    pad("Models", 20, "left"),
    pad("Input", 12),
    pad("Output", 12),
    pad("Cache Create", 14),
    pad("Cache Read", 14),
    pad("Total", 14),
    pad("Cost (USD)", 12),
  ].join("  ");

  lines.push(`${DIM}${header}${RESET}`);
  lines.push(`${DIM}${"─".repeat(header.length)}${RESET}`);

  let hasUnknownCost = false;
  for (const r of rows) {
    if (r.cost === null) hasUnknownCost = true;
    lines.push([
      pad(r.date, 12, "left"),
      pad(r.models, 20, "left"),
      pad(fmtNum(r.input), 12),
      pad(fmtNum(r.output), 12),
      pad(fmtNum(r.cacheCreate), 14),
      pad(fmtNum(r.cacheRead), 14),
      pad(fmtNum(r.totalTokens), 14),
      pad(fmtCost(r.cost), 12),
    ].join("  "));
  }

  // Total row
  const totals = rows.reduce(
    (acc, r) => ({
      input: acc.input + r.input,
      output: acc.output + r.output,
      cacheCreate: acc.cacheCreate + r.cacheCreate,
      cacheRead: acc.cacheRead + r.cacheRead,
      totalTokens: acc.totalTokens + r.totalTokens,
      cost: r.cost !== null && acc.cost !== null ? acc.cost + r.cost : acc.cost,
    }),
    { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, totalTokens: 0, cost: 0 as number | null },
  );

  lines.push(`${DIM}${"─".repeat(header.length)}${RESET}`);
  lines.push(
    `${BOLD}${[
      pad("Total", 12, "left"),
      pad("", 20, "left"),
      pad(fmtNum(totals.input), 12),
      pad(fmtNum(totals.output), 12),
      pad(fmtNum(totals.cacheCreate), 14),
      pad(fmtNum(totals.cacheRead), 14),
      pad(fmtNum(totals.totalTokens), 14),
      pad(fmtCost(totals.cost), 12),
    ].join("  ")}${RESET}`,
  );

  if (hasUnknownCost) {
    lines.push("");
    lines.push(`${DIM}  Note: some models had unknown pricing (shown as \u2014)${RESET}`);
  }

  lines.push("");
  return lines.join("\n");
}
