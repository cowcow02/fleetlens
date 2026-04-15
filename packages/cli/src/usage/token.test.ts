import { describe, it, expect } from "vitest";
import { extractCredentials, isUsable } from "./token.js";

describe("extractCredentials", () => {
  it("pulls accessToken and expiresAt from the Claude Code blob shape", () => {
    const blob = JSON.stringify({
      claudeAiOauth: {
        accessToken: "sk-ant-oat-test",
        refreshToken: "sk-ant-ort-test",
        expiresAt: 1776246640700,
        scopes: ["user:profile"],
      },
    });
    expect(extractCredentials(blob)).toEqual({
      accessToken: "sk-ant-oat-test",
      expiresAt: 1776246640700,
    });
  });

  it("returns null when accessToken is missing", () => {
    const blob = JSON.stringify({ claudeAiOauth: { expiresAt: 1 } });
    expect(extractCredentials(blob)).toBeNull();
  });

  it("returns null when expiresAt is missing", () => {
    const blob = JSON.stringify({ claudeAiOauth: { accessToken: "x" } });
    expect(extractCredentials(blob)).toBeNull();
  });

  it("returns null when expiresAt is not a number", () => {
    const blob = JSON.stringify({
      claudeAiOauth: { accessToken: "x", expiresAt: "soon" },
    });
    expect(extractCredentials(blob)).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    expect(extractCredentials("{not json")).toBeNull();
  });

  it("returns null when the outer key is missing", () => {
    expect(extractCredentials("{}")).toBeNull();
  });
});

describe("isUsable", () => {
  const creds = { accessToken: "x", expiresAt: 1_000_000 };

  it("is true when expiresAt is comfortably in the future", () => {
    expect(isUsable(creds, 0)).toBe(true);
  });

  it("is false when now is past expiresAt", () => {
    expect(isUsable(creds, 2_000_000)).toBe(false);
  });

  it("is false within the default (60s) skew window before expiry", () => {
    expect(isUsable(creds, 999_999)).toBe(false);
    expect(isUsable(creds, 950_000)).toBe(false);
    expect(isUsable(creds, 939_999)).toBe(true);
  });

  it("honors a custom skew", () => {
    expect(isUsable(creds, 900_000, 50)).toBe(true);
    expect(isUsable(creds, 999_960, 50)).toBe(false);
  });
});
