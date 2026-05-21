import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// `server-only` throws when imported outside a React Server Component
// context (e.g. vitest's plain node environment). Stub it so we can unit
// test the reader's pure logic.
vi.mock("server-only", () => ({}));

let testHome: string;
let restoreCclensHome: string | undefined;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), "cclens-team-data-"));
  restoreCclensHome = process.env.CCLENS_HOME;
  process.env.CCLENS_HOME = testHome;
  // module reads CCLENS_HOME at call time via cclensHome(), but the import
  // itself can be cached — reset modules so each test starts clean.
  vi.resetModules();
});

afterEach(() => {
  if (restoreCclensHome === undefined) delete process.env.CCLENS_HOME;
  else process.env.CCLENS_HOME = restoreCclensHome;
  rmSync(testHome, { recursive: true, force: true });
});

function writeConfig(extra: Record<string, unknown> = {}) {
  writeFileSync(
    join(testHome, "team.json"),
    JSON.stringify({
      serverUrl: "https://team.example.com",
      memberId: "m1",
      bearerToken: "t1",
      teamSlug: "acme",
      teamName: "Acme Corp",
      pairedAt: "2026-05-01T00:00:00.000Z",
      ...extra,
    }),
  );
}

function writeLastPush(record: object) {
  writeFileSync(join(testHome, "team-last-push.json"), JSON.stringify(record));
}

describe("readTeamConnection", () => {
  it("returns { paired: false } when no config exists", async () => {
    const { readTeamConnection } = await import("./team-data");
    expect(readTeamConnection()).toEqual({ paired: false });
  });

  it("returns paired with lastPush=none and health=amber when config exists but no push artifact", async () => {
    writeConfig();
    const { readTeamConnection } = await import("./team-data");
    const r = readTeamConnection();
    expect(r.paired).toBe(true);
    if (!r.paired) throw new Error("unreachable");
    expect(r.team.name).toBe("Acme Corp");
    expect(r.lastPush.kind).toBe("none");
    expect(r.health).toBe("amber");
  });

  it("falls back to teamSlug when teamName is absent", async () => {
    writeConfig({ teamName: undefined, teamSlug: "legacy-team" });
    const { readTeamConnection } = await import("./team-data");
    const r = readTeamConnection();
    if (!r.paired) throw new Error("unreachable");
    expect(r.team.name).toBe("legacy-team");
  });

  it("returns lastPush=ok and green when push is fresh (<15min)", async () => {
    writeConfig();
    const pushedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    writeLastPush({ pushedAt, ok: true, payload: { ingestId: "i", observedAt: pushedAt } });
    const { readTeamConnection } = await import("./team-data");
    const r = readTeamConnection();
    if (!r.paired) throw new Error("unreachable");
    expect(r.lastPush.kind).toBe("ok");
    expect(r.health).toBe("green");
  });

  it("returns amber when push is 15-60min old", async () => {
    writeConfig();
    const pushedAt = new Date(Date.now() - 30 * 60_000).toISOString();
    writeLastPush({ pushedAt, ok: true, payload: { ingestId: "i", observedAt: pushedAt } });
    const { readTeamConnection } = await import("./team-data");
    const r = readTeamConnection();
    if (!r.paired) throw new Error("unreachable");
    expect(r.health).toBe("amber");
  });

  it("returns red when push is >60min old", async () => {
    writeConfig();
    const pushedAt = new Date(Date.now() - 90 * 60_000).toISOString();
    writeLastPush({ pushedAt, ok: true, payload: { ingestId: "i", observedAt: pushedAt } });
    const { readTeamConnection } = await import("./team-data");
    const r = readTeamConnection();
    if (!r.paired) throw new Error("unreachable");
    expect(r.health).toBe("red");
  });

  it("returns lastPush=error and red when artifact records a failure", async () => {
    writeConfig();
    const pushedAt = new Date(Date.now() - 60_000).toISOString();
    writeLastPush({ pushedAt, ok: false, error: "Token revoked", payload: { ingestId: "i", observedAt: pushedAt } });
    const { readTeamConnection } = await import("./team-data");
    const r = readTeamConnection();
    if (!r.paired) throw new Error("unreachable");
    expect(r.lastPush.kind).toBe("error");
    if (r.lastPush.kind !== "error") throw new Error("unreachable");
    expect(r.lastPush.error).toBe("Token revoked");
    expect(r.health).toBe("red");
  });
});
