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
  // True when the day had priced sessions AND \u22651 unpriced session, so `cost`
  // is the priced subtotal (a lower bound), not the full spend for the day.
  costPartial?: boolean;
};

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtCost(cost: number | null, partial = false): string {
  if (cost === null) return "\u2014";
  return `${partial ? "\u2265" : ""}$${cost.toFixed(2)}`;
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

  let costIncomplete = false; // any day with no priced session (—) or a partial subtotal (≥)
  for (const r of rows) {
    if (r.cost === null || r.costPartial) costIncomplete = true;
    lines.push([
      pad(r.date, 12, "left"),
      pad(r.models, 20, "left"),
      pad(fmtNum(r.input), 12),
      pad(fmtNum(r.output), 12),
      pad(fmtNum(r.cacheCreate), 14),
      pad(fmtNum(r.cacheRead), 14),
      pad(fmtNum(r.totalTokens), 14),
      pad(fmtCost(r.cost, r.costPartial), 12),
    ].join("  "));
  }

  // Total row. Cost sums every day's priced amount (tokens always sum in full);
  // when any day was unpriced/partial it's a lower bound, marked ≥, so Total
  // cost and Total tokens don't silently imply different scopes.
  const totals = rows.reduce(
    (acc, r) => ({
      input: acc.input + r.input,
      output: acc.output + r.output,
      cacheCreate: acc.cacheCreate + r.cacheCreate,
      cacheRead: acc.cacheRead + r.cacheRead,
      totalTokens: acc.totalTokens + r.totalTokens,
      cost: acc.cost + (r.cost ?? 0),
      anyCost: acc.anyCost || r.cost !== null,
    }),
    { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, totalTokens: 0, cost: 0, anyCost: false },
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
      pad(totals.anyCost ? fmtCost(totals.cost, costIncomplete) : fmtCost(null), 12),
    ].join("  ")}${RESET}`,
  );

  if (costIncomplete) {
    lines.push("");
    lines.push(
      `${DIM}  Cost covers priced usage only \u2014 "\u2014" = no priced sessions that day, "\u2265" = lower bound (some sessions had unknown pricing).${RESET}`,
    );
  }

  lines.push("");
  return lines.join("\n");
}
