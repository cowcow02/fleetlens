import { describe, it, expect } from "vitest";
import {
  formatTokens,
  formatGap,
  formatDuration,
  prettyProjectName,
} from "./format";

describe("formatTokens", () => {
  // Boundary at 0 and small values: plain integer printing.
  it("returns plain digit string for zero", () => {
    expect(formatTokens(0)).toBe("0");
  });

  it("returns plain digit string just below the 'k' threshold", () => {
    expect(formatTokens(999)).toBe("999");
  });

  it("switches to '<x>.<d>k' (1 decimal) at 1000", () => {
    expect(formatTokens(1000)).toBe("1.0k");
  });

  it("keeps 1-decimal 'k' for mid-range below 10_000", () => {
    // 5500 stays in the 1-decimal band; rounding to '6k' would only happen
    // after the 10_000 threshold is crossed.
    expect(formatTokens(5500)).toBe("5.5k");
  });

  it("rounds to '10.0k' at the upper edge of the 1-decimal band", () => {
    expect(formatTokens(9999)).toBe("10.0k");
  });

  it("switches to 0-decimal 'k' at 10_000", () => {
    expect(formatTokens(10_000)).toBe("10k");
  });

  it("keeps 'k' all the way up to just below 1M (no implicit rollover)", () => {
    expect(formatTokens(999_999)).toBe("1000k");
  });

  it("switches to 2-decimal 'M' at 1_000_000", () => {
    expect(formatTokens(1_000_000)).toBe("1.00M");
  });

  it("rounds to 2-decimal 'M' mid-band", () => {
    expect(formatTokens(2_500_000)).toBe("2.50M");
  });

  it("rounds to '10.00M' at the upper edge of the 2-decimal band", () => {
    expect(formatTokens(9_999_999)).toBe("10.00M");
  });

  it("switches to 1-decimal 'M' at 10_000_000 (no '10.00M' regression)", () => {
    expect(formatTokens(10_000_000)).toBe("10.0M");
  });

  it("returns negative integers verbatim (treated as plain number, below threshold)", () => {
    // Because the first branch is `n < 1000`, any negative number short-circuits
    // before the suffix branches. Lock that behaviour in.
    expect(formatTokens(-1000)).toBe("-1000");
  });
});

describe("formatGap", () => {
  it("emits raw 'ms' for zero", () => {
    expect(formatGap(0)).toBe("0ms");
  });

  it("emits raw 'ms' for sub-second values", () => {
    expect(formatGap(500)).toBe("500ms");
  });

  it("emits raw 'ms' at the just-below-1s boundary", () => {
    expect(formatGap(999)).toBe("999ms");
  });

  it("switches to '<x>.<d>s' (1 decimal) at exactly 1s", () => {
    expect(formatGap(1000)).toBe("1.0s");
  });

  it("keeps 1-decimal seconds below the minute boundary", () => {
    expect(formatGap(30_500)).toBe("30.5s");
  });

  it("switches to '<m>m <s>s' at 61s", () => {
    expect(formatGap(61_000)).toBe("1m 1s");
  });

  it("keeps minute-second formatting up to the just-below-hour boundary", () => {
    expect(formatGap(3_599_000)).toBe("59m 59s");
  });

  it("emits bare '<h>h' when remaining minutes are zero (no '1h 0m')", () => {
    // Regression guard: the function drops the minutes component when remM === 0.
    expect(formatGap(3_600_000)).toBe("1h");
  });

  it("emits '<h>h <m>m' when minutes are non-zero", () => {
    expect(formatGap(5_400_000)).toBe("1h 30m");
  });

  it("emits bare '<d>d' when remaining hours are zero (no '1d 0h')", () => {
    expect(formatGap(86_400_000)).toBe("1d");
  });

  it("emits bare '<d>d' for an exact multi-day gap", () => {
    expect(formatGap(172_800_000)).toBe("2d");
  });

  it("emits hours-component when day boundary is crossed unevenly", () => {
    // 1d + 5h = 86_400_000 + 5*3_600_000 = 104_400_000
    expect(formatGap(104_400_000)).toBe("1d 5h");
  });

  it("treats negative ms as raw 'ms' (first branch wins)", () => {
    // Locks the current short-circuit: any value < 1000 (including negatives)
    // takes the raw-ms branch.
    expect(formatGap(-5000)).toBe("-5000ms");
  });
});

describe("formatDuration", () => {
  it("returns em-dash for undefined", () => {
    expect(formatDuration(undefined)).toBe("—");
  });

  it("returns em-dash when called with no argument", () => {
    expect(formatDuration()).toBe("—");
  });

  it("emits raw 'ms' for zero", () => {
    expect(formatDuration(0)).toBe("0ms");
  });

  it("emits raw 'ms' at the just-below-1s boundary", () => {
    expect(formatDuration(999)).toBe("999ms");
  });

  it("switches to integer seconds at exactly 1s", () => {
    expect(formatDuration(1000)).toBe("1s");
  });

  it("rounds half-seconds upward via Math.round", () => {
    // 1500ms → round(1.5) = 2s (banker's-rounding caveat noted but Math.round
    // in JS rounds half-up positive, so 2s is correct).
    expect(formatDuration(1500)).toBe("2s");
  });

  it("emits '<m>m <s>s' for minute+second mixed values", () => {
    expect(formatDuration(65_000)).toBe("1m 5s");
  });

  it("drops seconds when they round to zero (no '1m 0s')", () => {
    expect(formatDuration(60_000)).toBe("1m");
  });

  it("drops minutes when they're zero (no '1h 0m')", () => {
    expect(formatDuration(3_600_000)).toBe("1h");
  });

  it("emits '<h>h <m>m' when minutes are non-zero", () => {
    expect(formatDuration(5_400_000)).toBe("1h 30m");
  });

  it("keeps minute precision in the sub-hour band (no premature hour rollover)", () => {
    // 3_570_000ms = 59m 30s exactly. The function should keep the 'm s' band,
    // NOT round to '60m' (which would otherwise look like '1h').
    expect(formatDuration(3_570_000)).toBe("59m 30s");
  });
});

describe("prettyProjectName", () => {
  it("returns the only segment when there's just one", () => {
    expect(prettyProjectName("myproject")).toBe("myproject");
  });

  it("shows the last two segments of a normal absolute path", () => {
    expect(prettyProjectName("/Users/me/Repo/orbit/agentic-knowledge-system"))
      .toBe("orbit/agentic-knowledge-system");
  });

  it("rewrites a `.worktrees/<name>` path as `<parent>/<name>` so worktrees keep repo context", () => {
    expect(prettyProjectName("/Users/me/Repo/orbit/.worktrees/feature-branch"))
      .toBe("orbit/feature-branch");
  });

  it("returns the last two segments when the path is long but those segments are short", () => {
    // The function does NOT count earlier path components — only the last two.
    // For a path whose last two segments together are well under maxLen,
    // no ellipsis prefix should appear.
    expect(prettyProjectName("a/very/long/path/that/exceeds/maximum/length/project"))
      .toBe("length/project");
  });

  it("respects a small custom maxLen by ellipsis-prefixing", () => {
    // last two segments = "long/path" (9 chars). maxLen=10 → no truncation needed,
    // so the bare "long/path" is returned. We assert the contract: result must
    // never exceed maxLen, except the function appends "…" when it overflows.
    const result = prettyProjectName("a/very/long/path", 10);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result).toBe("long/path");
  });

  it("ellipsis-prefixes when the last-two-segments name exceeds maxLen", () => {
    const long = "/repo/" + "x".repeat(40);
    const result = prettyProjectName(long, 20);
    expect(result.startsWith("…")).toBe(true);
    expect(result.length).toBe(20);
  });

  it("treats a leading slash as filtered empty segment", () => {
    // filter(Boolean) drops the empty-string at the head.
    expect(prettyProjectName("/orbit/agentic-knowledge-system"))
      .toBe("orbit/agentic-knowledge-system");
  });

  it("treats a trailing slash as filtered empty segment", () => {
    expect(prettyProjectName("orbit/agentic-knowledge-system/"))
      .toBe("orbit/agentic-knowledge-system");
  });
});
