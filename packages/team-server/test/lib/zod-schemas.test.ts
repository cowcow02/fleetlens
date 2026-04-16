import { describe, it, expect } from "vitest";
import { IngestPayload, ClaimPayload, InvitePayload, JoinPayload } from "../../src/lib/zod-schemas.js";

const validIngest = {
  ingestId: "abc123",
  observedAt: "2024-01-15T10:00:00.000Z",
  dailyRollup: {
    day: "2024-01-15",
    agentTimeMs: 3600000,
    sessions: 5,
    toolCalls: 42,
    turns: 10,
    tokens: {
      input: 1000,
      output: 500,
      cacheRead: 200,
      cacheWrite: 100,
    },
  },
};

describe("IngestPayload", () => {
  it("passes with valid data", () => {
    expect(() => IngestPayload.parse(validIngest)).not.toThrow();
  });

  it("fails when required fields are missing", () => {
    expect(() => IngestPayload.parse({ ingestId: "x" })).toThrow();
  });

  it("preserves unknown top-level fields (passthrough)", () => {
    const result = IngestPayload.parse({ ...validIngest, futureField: "v2" });
    expect((result as any).futureField).toBe("v2");
  });

  it("preserves unknown fields inside dailyRollup (passthrough)", () => {
    const input = {
      ...validIngest,
      dailyRollup: { ...validIngest.dailyRollup, newMetric: 99 },
    };
    const result = IngestPayload.parse(input);
    expect((result.dailyRollup as any).newMetric).toBe(99);
  });

  it("preserves unknown fields inside tokens (passthrough)", () => {
    const input = {
      ...validIngest,
      dailyRollup: {
        ...validIngest.dailyRollup,
        tokens: { ...validIngest.dailyRollup.tokens, cacheWriteInference: 50 },
      },
    };
    const result = IngestPayload.parse(input);
    expect((result.dailyRollup.tokens as any).cacheWriteInference).toBe(50);
  });
});

describe("ClaimPayload", () => {
  it("passes with valid data", () => {
    expect(() =>
      ClaimPayload.parse({ bootstrapToken: "tok", teamName: "Acme" })
    ).not.toThrow();
  });

  it("fails with empty teamName", () => {
    expect(() =>
      ClaimPayload.parse({ bootstrapToken: "tok", teamName: "" })
    ).toThrow();
  });

  it("fails with teamName > 100 chars", () => {
    expect(() =>
      ClaimPayload.parse({ bootstrapToken: "tok", teamName: "a".repeat(101) })
    ).toThrow();
  });
});

describe("InvitePayload", () => {
  it("defaults expiresInDays to 7", () => {
    const result = InvitePayload.parse({});
    expect(result.expiresInDays).toBe(7);
  });

  it("rejects expiresInDays > 30", () => {
    expect(() => InvitePayload.parse({ expiresInDays: 31 })).toThrow();
  });
});

describe("JoinPayload", () => {
  it("passes with valid data", () => {
    expect(() =>
      JoinPayload.parse({ inviteToken: "tok123" })
    ).not.toThrow();
  });
});
