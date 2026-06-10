import { describe, it, expect, vi, beforeEach } from "vitest";
import { getLatestVersion } from "../../../src/lib/self-update/version-detector.js";

global.fetch = vi.fn() as unknown as typeof fetch;
const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;

function tagsPage(tags: string[], nextLast?: string) {
  return {
    ok: true,
    headers: new Headers(
      nextLast
        ? { link: `</v2/cowcow02/fleetlens-team-server/tags/list?last=${nextLast}&n=0>; rel="next"` }
        : {},
    ),
    json: async () => ({ name: "cowcow02/fleetlens-team-server", tags }),
  };
}

function mockTokenThenTags(tags: string[]) {
  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: "anon-token" }),
    })
    .mockResolvedValueOnce(tagsPage(tags));
}

beforeEach(() => fetchMock.mockReset());

describe("getLatestVersion", () => {
  it("returns the highest semver tag from GHCR tags list", async () => {
    mockTokenThenTags(["0.4.1", "0.4.2", "0.5.0", "latest", "abc1234"]);
    const result = await getLatestVersion();
    expect(result).toBe("0.5.0");
  });

  it("filters out non-semver tags (latest, shas, etc.)", async () => {
    mockTokenThenTags(["latest", "main", "abc1234", "dev-123"]);
    const result = await getLatestVersion();
    expect(result).toBeNull();
  });

  it("orders by semver, not lexically", async () => {
    mockTokenThenTags(["0.9.0", "0.10.0"]);
    const result = await getLatestVersion();
    expect(result).toBe("0.10.0");
  });

  it("returns null when tags array is empty", async () => {
    mockTokenThenTags([]);
    expect(await getLatestVersion()).toBeNull();
  });

  it("throws on non-OK HTTP response from the tags endpoint", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: "anon-token" }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(getLatestVersion()).rejects.toThrow(/500/);
  });

  it("throws when the token endpoint returns non-OK", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
    await expect(getLatestVersion()).rejects.toThrow(/token endpoint returned 403/);
  });

  it("uses the anonymous token as a Bearer header on the tags request", async () => {
    mockTokenThenTags(["0.5.0"]);
    await getLatestVersion();
    const [, tagsCallOpts] = fetchMock.mock.calls[1];
    expect((tagsCallOpts as RequestInit).headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer anon-token" }),
    );
  });

  it("follows Link pagination — newest release on the last page wins", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: "anon-token" }) })
      .mockResolvedValueOnce(tagsPage(["0.9.0", "abc1234", "0.10.0"], "0.10.0"))
      .mockResolvedValueOnce(tagsPage(["0.11.0", "def5678", "latest"], "latest"))
      .mockResolvedValueOnce(tagsPage(["0.12.0", "0.12.1"]));
    expect(await getLatestVersion()).toBe("0.12.1");
    // token + 3 pages
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [pageTwoUrl] = fetchMock.mock.calls[2];
    expect(String(pageTwoUrl)).toBe(
      "https://ghcr.io/v2/cowcow02/fleetlens-team-server/tags/list?last=0.10.0&n=0",
    );
  });

  it("stops following pages at the safety cap", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ token: "anon-token" }) });
    for (let i = 0; i < 60; i++) fetchMock.mockResolvedValueOnce(tagsPage([`0.${i}.0`], `0.${i}.0`));
    expect(await getLatestVersion()).toBe("0.49.0");
    expect(fetchMock).toHaveBeenCalledTimes(51); // token + 50 pages
  });
});
