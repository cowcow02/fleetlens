import { describe, it, expect } from "vitest";
import { normalizeGithubRepos, normalizeLinearTeams } from "../../src/lib/integrations.js";

describe("normalizeGithubRepos", () => {
  it("upgrades the legacy string[] shape to mappings with all-groups default", () => {
    expect(normalizeGithubRepos(["orbit/a", " orbit/b "])).toEqual([
      { name: "orbit/a", group_ids: [] },
      { name: "orbit/b", group_ids: [] },
    ]);
  });

  it("keeps explicit group mappings and drops malformed entries", () => {
    expect(
      normalizeGithubRepos([
        { name: "orbit/a", group_ids: ["g1", "g2"] },
        { name: "orbit/b" },
        { name: "" },
        { group_ids: ["g1"] },
        42,
        null,
      ]),
    ).toEqual([
      { name: "orbit/a", group_ids: ["g1", "g2"] },
      { name: "orbit/b", group_ids: [] },
    ]);
  });

  it("filters non-string group ids and handles non-array input", () => {
    expect(normalizeGithubRepos({ not: "an array" })).toEqual([]);
    expect(normalizeGithubRepos([{ name: "a/b", group_ids: ["g1", 7, null] }])).toEqual([
      { name: "a/b", group_ids: ["g1"] },
    ]);
  });
});

describe("normalizeLinearTeams", () => {
  it("upgrades the legacy team_keys shape", () => {
    expect(normalizeLinearTeams({ team_keys: ["KIP", " OPS "] })).toEqual([
      { key: "KIP", group_ids: [] },
      { key: "OPS", group_ids: [] },
    ]);
  });

  it("prefers explicit team mappings and drops malformed entries", () => {
    expect(
      normalizeLinearTeams({
        teams: [{ key: "KIP", group_ids: ["g1"] }, { key: "" }, { group_ids: ["g2"] }, null],
        team_keys: ["IGNORED"],
      }),
    ).toEqual([{ key: "KIP", group_ids: ["g1"] }]);
  });

  it("returns empty for missing config", () => {
    expect(normalizeLinearTeams({})).toEqual([]);
  });
});
