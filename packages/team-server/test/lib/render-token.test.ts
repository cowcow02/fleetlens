import { describe, it, expect } from "vitest";
import { mintRenderToken, verifyRenderToken, type RenderScope } from "../../src/lib/render-token";

const scope: RenderScope = { slug: "acme", group: "platform", coaching: false, mock: false };

describe("render token", () => {
  it("round-trips for the same scope", () => {
    const t = mintRenderToken(scope);
    expect(verifyRenderToken(t, scope)).toBe(true);
  });

  it("rejects after expiry", () => {
    const t = mintRenderToken(scope, 1_000_000);
    expect(verifyRenderToken(t, scope, 1_000_000 + 89_999)).toBe(true);
    expect(verifyRenderToken(t, scope, 1_000_000 + 90_000)).toBe(false);
  });

  it("rejects a scope mismatch on any field", () => {
    const t = mintRenderToken(scope);
    expect(verifyRenderToken(t, { ...scope, group: "growth" })).toBe(false);
    expect(verifyRenderToken(t, { ...scope, slug: "other" })).toBe(false);
    expect(verifyRenderToken(t, { ...scope, coaching: true })).toBe(false);
    expect(verifyRenderToken(t, { ...scope, mock: true })).toBe(false);
    expect(verifyRenderToken(t, { ...scope, week: "2026-06-01" })).toBe(false);
  });

  it("binds week when minted with one", () => {
    const t = mintRenderToken({ ...scope, week: "2026-06-01" });
    expect(verifyRenderToken(t, { ...scope, week: "2026-06-01" })).toBe(true);
    expect(verifyRenderToken(t, scope)).toBe(false);
  });

  it("rejects a malformed FLEETLENS_ENCRYPTION_KEY loudly", () => {
    const prev = process.env.FLEETLENS_ENCRYPTION_KEY;
    process.env.FLEETLENS_ENCRYPTION_KEY = "not-hex";
    try {
      expect(() => mintRenderToken(scope)).toThrow(/64 hex/);
      process.env.FLEETLENS_ENCRYPTION_KEY = "ab".repeat(32);
      expect(verifyRenderToken(mintRenderToken(scope), scope)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.FLEETLENS_ENCRYPTION_KEY;
      else process.env.FLEETLENS_ENCRYPTION_KEY = prev;
    }
  });

  it("rejects missing, malformed, and tampered tokens", () => {
    expect(verifyRenderToken(undefined, scope)).toBe(false);
    expect(verifyRenderToken("", scope)).toBe(false);
    expect(verifyRenderToken("no-dot", scope)).toBe(false);
    expect(verifyRenderToken(".sig-without-exp", scope)).toBe(false);
    expect(verifyRenderToken("NaN.abc", scope)).toBe(false);
    const t = mintRenderToken(scope);
    expect(verifyRenderToken(`${t}x`, scope)).toBe(false);
    const [exp] = t.split(".");
    expect(verifyRenderToken(`${Number(exp) + 60_000}.${t.split(".")[1]}`, scope)).toBe(false);
  });
});
