import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TeamConfig } from "../../src/team/config.js";

const SAMPLE: TeamConfig = {
  serverUrl: "https://team.example.com",
  memberId: "mem_abc",
  bearerToken: "tok_secret",
  teamSlug: "acme",
  pairedAt: "2026-01-01T00:00:00.000Z",
};

// teamLeave calls readTeamConfig() / clearTeamConfig() with no dir arg, which
// defaults to ~/.cclens. We redirect by mocking the config module.
vi.mock("../../src/team/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/team/config.js")>();
  return {
    ...actual,
    readTeamConfig: vi.fn(),
    clearTeamConfig: vi.fn(),
  };
});

describe("teamLeave", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let cclensDir: string;
  let prevCclensHome: string | undefined;

  beforeEach(() => {
    // Redirect cclensHome() to a temp dir so clearLastPush (unmocked, hits real disk)
    // doesn't touch the user's real ~/.cclens during tests.
    cclensDir = mkdtempSync(join(tmpdir(), "cclens-leave-"));
    prevCclensHome = process.env.CCLENS_HOME;
    process.env.CCLENS_HOME = cclensDir;

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    if (prevCclensHome === undefined) delete process.env.CCLENS_HOME;
    else process.env.CCLENS_HOME = prevCclensHome;
    rmSync(cclensDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("logs 'Not paired' and returns when no config exists", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(null);

    const { teamLeave } = await import("../../src/team/leave.js");
    await teamLeave();

    expect(consoleLogSpy).toHaveBeenCalledWith("Not paired with any team.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("calls leave endpoint and clears config on success", async () => {
    const { readTeamConfig, clearTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(SAMPLE);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
    } as Response);

    const { teamLeave } = await import("../../src/team/leave.js");
    await teamLeave();

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://team.example.com/api/team/leave");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok_secret",
    });

    expect(clearTeamConfig).toHaveBeenCalledOnce();
    expect(consoleLogSpy).toHaveBeenCalledWith("Left team. Local data is unaffected.");
  });

  it("still clears config even if leave endpoint throws a network error", async () => {
    const { readTeamConfig, clearTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(SAMPLE);
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));

    const { teamLeave } = await import("../../src/team/leave.js");
    await teamLeave();

    // Should not throw — errors are swallowed
    expect(clearTeamConfig).toHaveBeenCalledOnce();
    expect(consoleLogSpy).toHaveBeenCalledWith("Left team. Local data is unaffected.");
  });

  it("still clears config even if leave endpoint returns non-ok status", async () => {
    const { readTeamConfig, clearTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(SAMPLE);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    const { teamLeave } = await import("../../src/team/leave.js");
    await teamLeave();

    expect(clearTeamConfig).toHaveBeenCalledOnce();
    expect(consoleLogSpy).toHaveBeenCalledWith("Left team. Local data is unaffected.");
  });

  it("removes team-last-push.json so the stale-pairing artifact disappears", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(SAMPLE);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
    } as Response);

    // Pre-seed both files in the redirected ~/.cclens.
    // writeTeamConfig is mocked (above) so we drop team.json directly to disk
    // just to mirror the real "paired user leaves" state on the filesystem.
    mkdirSync(cclensDir, { recursive: true });
    writeFileSync(join(cclensDir, "team.json"), JSON.stringify(SAMPLE), { mode: 0o600 });
    const lastPushPath = join(cclensDir, "team-last-push.json");
    writeFileSync(
      lastPushPath,
      JSON.stringify({
        pushedAt: "2026-05-20T12:00:00.000Z",
        ok: true,
        payload: { ingestId: "abc", observedAt: "2026-05-20T12:00:00.000Z" },
      }),
      { mode: 0o600 },
    );
    expect(existsSync(lastPushPath)).toBe(true);

    const { teamLeave } = await import("../../src/team/leave.js");
    await teamLeave();

    // We don't bother asserting writeTeamConfig was called too — that's
    // covered by the existing "calls leave endpoint and clears config" test.
    // The new invariant is just that the last-push artifact is gone.
    expect(existsSync(lastPushPath)).toBe(false);
  });
});
