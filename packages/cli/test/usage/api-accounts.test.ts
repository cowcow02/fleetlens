import { describe, expect, it } from "vitest";
import { fetchAllClaudeUsage, type UsageSnapshot } from "../../src/usage/api.js";
import type { ClaudeAccount } from "../../src/usage/accounts.js";
import type { OAuthCredentials } from "../../src/usage/token.js";

const cred = (token: string): OAuthCredentials => ({
  accessToken: token,
  expiresAt: Date.now() + 3_600_000,
});

function snap(partial: Partial<UsageSnapshot>): UsageSnapshot {
  return {
    captured_at: "2026-08-29T12:00:00.000Z",
    five_hour: { utilization: null, resets_at: null },
    seven_day: { utilization: null, resets_at: null },
    seven_day_opus: null,
    seven_day_sonnet: null,
    seven_day_oauth_apps: null,
    seven_day_cowork: null,
    extra_usage: null,
    ...partial,
  };
}

describe("fetchAllClaudeUsage", () => {
  it("polls every injected account and tags extra logins", async () => {
    const accounts: ClaudeAccount[] = [
      { configDir: "/tmp/.claude", slug: null, creds: cred("sk-a"), source: "file" },
      { configDir: "/tmp/.claude-work", slug: "work", creds: cred("sk-b"), source: "keychain" },
    ];
    const { snapshots, errors } = await fetchAllClaudeUsage({
      accounts,
      fetchOne: async (_creds, opts) =>
        snap({
          agent: opts?.agent,
          ...(opts?.account ? { account: opts.account } : {}),
          five_hour: { utilization: opts?.account ? 86 : 4, resets_at: null },
        }),
    });
    expect(errors).toEqual([]);
    expect(snapshots.map((s) => s.agent)).toEqual(["claude-code", "claude-code:work"]);
    expect(snapshots[0]!.account).toBeUndefined();
    expect(snapshots[1]!.account).toBe("work");
    expect(snapshots.map((s) => s.five_hour.utilization)).toEqual([4, 86]);
  });

  it("keeps successful accounts when one poll fails", async () => {
    const accounts: ClaudeAccount[] = [
      { configDir: "/tmp/.claude", slug: null, creds: cred("sk-a"), source: "file" },
      { configDir: "/tmp/.claude-work", slug: "work", creds: cred("sk-b"), source: "file" },
    ];
    const { snapshots, errors } = await fetchAllClaudeUsage({
      accounts,
      fetchOne: async (_creds, opts) => {
        if (opts?.account === "work") throw new Error("boom");
        return snap({ agent: "claude-code" });
      },
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.agent).toBe("claude-code");
    expect(errors).toEqual([{ slug: "work", code: "parse", message: "boom" }]);
  });
});
