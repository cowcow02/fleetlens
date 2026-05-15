import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We need to intercept writeTeamConfig so no real ~/.cclens/team.json is written.
// The module is mocked before import so joinTeam uses the mocked version.
vi.mock("../../src/team/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/team/config.js")>();
  return {
    ...actual,
    writeTeamConfig: vi.fn(),
  };
});

// joinTeam fires the unified sync after pairing. Stub it here so tests stay
// hermetic: no JSONL reads, no extra fetches against the mocked-fetch budget.
vi.mock("../../src/team/sync.js", () => ({
  runTeamSync: vi.fn(async () => ({
    paired: true,
    pushed: 0,
    queued: 0,
    queuedDrained: 0,
    usageBackfill: {
      paired: true,
      sentSnapshots: 0,
      insertedSnapshots: 0,
      skippedSnapshots: 0,
      batches: 0,
    },
  })),
}));

describe("joinTeam", () => {
  let dir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fleetlens-join-test-"));
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // process.exit throws so we can assert without killing the test process
    exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number | string | null | undefined) => {
      throw new Error("exit");
    }) as unknown as ReturnType<typeof vi.spyOn>;
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("exits with 1 when called with no args", async () => {
    const { joinTeam } = await import("../../src/team/join.js");
    await expect(joinTeam([])).rejects.toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when only URL is provided", async () => {
    const { joinTeam } = await import("../../src/team/join.js");
    await expect(joinTeam(["https://team.example.com"])).rejects.toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 on 401 response", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({}),
    } as Response);

    const { joinTeam } = await import("../../src/team/join.js");
    await expect(
      joinTeam(["https://team.example.com", "bad-token"]),
    ).rejects.toThrow("exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Pairing failed"),
    );
  });

  it("writes config and logs success on 200", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        membership: { id: "mem_abc", role: "member" },
        team: { id: "team_1", slug: "acme", name: "Acme Inc" },
        user: { email: "alice@acme.com", displayName: "Alice" },
      }),
    } as Response);

    const { joinTeam } = await import("../../src/team/join.js");
    await joinTeam(["https://team.example.com", "tok_good"]);

    const { writeTeamConfig } = await import("../../src/team/config.js");
    expect(writeTeamConfig).toHaveBeenCalledOnce();
    const call = vi.mocked(writeTeamConfig).mock.calls[0]![0];
    expect(call.serverUrl).toBe("https://team.example.com");
    expect(call.bearerToken).toBe("tok_good");
    expect(call.memberId).toBe("mem_abc");
    expect(call.teamSlug).toBe("acme");

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Acme Inc"),
    );
  });

  it("falls back to email when displayName is null", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        membership: { id: "mem_abc", role: "member" },
        team: { id: "team_1", slug: "acme", name: "Acme Inc" },
        user: { email: "alice@acme.com", displayName: null },
      }),
    } as Response);

    const { joinTeam } = await import("../../src/team/join.js");
    await joinTeam(["https://team.example.com", "tok_good"]);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("alice@acme.com"),
    );
  });

  it("calls the correct whoami endpoint with Bearer auth", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        membership: { id: "mem_abc", role: "member" },
        team: { id: "team_1", slug: "acme", name: "Acme" },
        user: { email: "a@b.com", displayName: "A" },
      }),
    } as Response);

    const { joinTeam } = await import("../../src/team/join.js");
    await joinTeam(["https://team.example.com", "tok_123"]);

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://team.example.com/api/team/whoami");
    expect((init as RequestInit).method).toBe("GET");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok_123",
    });
  });
});
