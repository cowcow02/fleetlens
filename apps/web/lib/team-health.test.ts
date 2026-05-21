import { describe, it, expect } from "vitest";
import { deriveHealth } from "./team-health";

const fresh = new Date(Date.now() - 5 * 60_000).toISOString();
const stale = new Date(Date.now() - 30 * 60_000).toISOString();
const ancient = new Date(Date.now() - 90 * 60_000).toISOString();

describe("deriveHealth", () => {
  it("returns amber when no push yet", () => {
    expect(deriveHealth({ kind: "none" })).toBe("amber");
  });
  it("returns green for fresh ok push (<15min)", () => {
    expect(deriveHealth({ kind: "ok", at: fresh, payload: null })).toBe("green");
  });
  it("returns amber for stale ok push (15-60min)", () => {
    expect(deriveHealth({ kind: "ok", at: stale, payload: null })).toBe("amber");
  });
  it("returns red for ancient ok push (>60min)", () => {
    expect(deriveHealth({ kind: "ok", at: ancient, payload: null })).toBe("red");
  });
  it("returns red for any error push regardless of age", () => {
    expect(deriveHealth({ kind: "error", at: fresh, error: "x", payload: null })).toBe("red");
  });
});
