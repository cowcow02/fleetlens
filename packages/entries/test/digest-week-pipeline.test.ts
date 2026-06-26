import { describe, it, expect } from "vitest";
import { mondayFor } from "../src/digest-week-pipeline.js";

describe("mondayFor", () => {
  it("returns the same date when the input is already a Monday", () => {
    // 2026-06-22 is a Monday — getDay() === 1, so offset === 0.
    expect(mondayFor("2026-06-22")).toBe("2026-06-22");
  });

  it("returns the previous Monday for a Tuesday", () => {
    expect(mondayFor("2026-06-23")).toBe("2026-06-22");
  });

  it("returns the same week's Monday for a Friday", () => {
    expect(mondayFor("2026-06-26")).toBe("2026-06-22");
  });

  it("returns the same week's Monday for a Sunday (dow=0, special -6 offset)", () => {
    // Regression guard for the Sunday branch: dow === 0 must take offset = -6,
    // not 1 - 0 = +1 (which would jump forward to the next Monday).
    expect(mondayFor("2026-06-28")).toBe("2026-06-22");
  });

  it("crosses a month boundary backward when needed", () => {
    // 2026-06-30 is Tuesday; the week's Monday is 2026-06-29 (still June).
    expect(mondayFor("2026-06-30")).toBe("2026-06-29");
    // 2026-07-01 is Wednesday; the week's Monday is 2026-06-29 (across the
    // June→July boundary).
    expect(mondayFor("2026-07-01")).toBe("2026-06-29");
  });

  it("crosses a year boundary backward when needed", () => {
    // 2026-01-02 is a Friday; its Monday is 2025-12-29 (previous year).
    expect(mondayFor("2026-01-02")).toBe("2025-12-29");
  });

  it("handles Feb 29 in a leap year (no day-arithmetic off-by-one)", () => {
    // 2024-02-29 is a Thursday; Monday of that week = 2024-02-26.
    expect(mondayFor("2024-02-29")).toBe("2024-02-26");
  });

  it("handles non-leap-year early-March correctly when input is itself a Monday", () => {
    expect(mondayFor("2026-03-02")).toBe("2026-03-02");
  });

  it("always returns ISO YYYY-MM-DD with zero-padded month and day", () => {
    // 2026-01-05 is Monday: ensure the formatter pads '01' and '05'.
    expect(mondayFor("2026-01-05")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mondayFor("2026-01-05")).toBe("2026-01-05");
  });
});
