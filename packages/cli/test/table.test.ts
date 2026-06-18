import { describe, it, expect } from "vitest";
import { renderTable, type TableRow } from "../src/table.js";

// Strip ANSI so assertions read the plain text. The ESC (\x1b) in the regex is
// intentional — it's the start of every SGR color sequence we're removing.
// eslint-disable-next-line no-control-regex
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

function row(over: Partial<TableRow>): TableRow {
  return {
    date: "2026-06-01",
    models: "opus-4-8",
    input: 0,
    output: 0,
    cacheCreate: 0,
    cacheRead: 0,
    totalTokens: 0,
    cost: 0,
    ...over,
  };
}

describe("renderTable cost aggregation", () => {
  it("sums all priced days when every day is priced — clean Total, no note", () => {
    const out = plain(renderTable([row({ cost: 10 }), row({ cost: 5 })], "t"));
    expect(out).toContain("$15.00");
    expect(out).not.toContain("≥");
    expect(out).not.toContain("Cost covers priced usage only");
  });

  it("Total is a marked lower bound when a day has no priced session", () => {
    const out = plain(renderTable([row({ cost: 10 }), row({ cost: null })], "t"));
    // priced subtotal counted, unpriced day shown as — , total marked ≥
    expect(out).toContain("≥$10.00");
    expect(out).toContain("—");
    expect(out).toContain("Cost covers priced usage only");
  });

  it("partial day renders ≥ on the row and the Total", () => {
    const out = plain(renderTable([row({ cost: 10, costPartial: true })], "t"));
    const lines = out.split("\n").filter((l) => l.includes("$10.00"));
    // both the day row and the Total row carry the ≥ marker
    expect(lines.length).toBe(2);
    for (const l of lines) expect(l).toContain("≥$10.00");
  });

  it("Total cost is — when no day has any priced session", () => {
    const out = plain(renderTable([row({ cost: null }), row({ cost: null })], "t"));
    // no $ amount anywhere, total falls back to —
    expect(out).not.toMatch(/\$\d/);
    expect(out).toContain("Cost covers priced usage only");
  });
});
