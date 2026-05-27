import { describe, expect, it } from "vitest";
import {
  decodeFleetCode,
  encodeFleetCode,
  generateFleetSecret,
  shortDeviceId,
} from "../src/fleet/code.js";

describe("fleet code", () => {
  it("round-trips a freshly-generated secret", () => {
    for (let i = 0; i < 32; i++) {
      const secret = generateFleetSecret();
      const code = encodeFleetCode(secret);
      expect(code).toMatch(/^flv1(-[A-Z0-9]{2,4}){7}$/);
      const decoded = decodeFleetCode(code);
      expect(decoded.equals(secret)).toBe(true);
    }
  });

  it("accepts codes regardless of case, spacing, and dashes", () => {
    const secret = generateFleetSecret();
    const code = encodeFleetCode(secret);
    const decoded = decodeFleetCode(code.toLowerCase().replace(/-/g, " "));
    expect(decoded.equals(secret)).toBe(true);
  });

  it("rejects codes with a tampered character (checksum fails)", () => {
    const secret = generateFleetSecret();
    const code = encodeFleetCode(secret);
    // Flip one body character to a different valid base32 char.
    const body = code.slice(5);
    const ch = body[0];
    const swap = ch === "0" ? "1" : "0";
    const tampered = "flv1-" + swap + body.slice(1);
    expect(() => decodeFleetCode(tampered)).toThrow(/checksum/);
  });

  it("rejects malformed prefixes and lengths", () => {
    expect(() => decodeFleetCode("flv2-ABCD")).toThrow(/start with/);
    expect(() => decodeFleetCode("flv1-ABCD")).toThrow(/base32 chars/);
  });

  it("produces a stable short device id for the same public key", () => {
    const pk = "a".repeat(64);
    expect(shortDeviceId(pk)).toBe(shortDeviceId(pk));
    expect(shortDeviceId(pk)).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  });
});
