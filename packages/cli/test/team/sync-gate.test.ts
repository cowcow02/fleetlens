import { describe, it, expect, vi } from "vitest";
import { runTeamSync } from "../../src/team/sync.js";

describe("runTeamSync setupPending gate", () => {
  it("bails idle before any IO when setup is pending", async () => {
    const log = vi.fn();
    const outcome = await runTeamSync(log, {
      serverUrl: "http://127.0.0.1:9", // unreachable on purpose — must never be dialed
      memberId: "m", bearerToken: "t", teamSlug: "s", pairedAt: "2026-07-08T00:00:00Z",
      setupPending: true,
    });
    expect(outcome).toMatchObject({ paired: true, pushed: 0, queued: 0, setupPending: true });
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]![1]).toContain("setup pending");
  });
});
