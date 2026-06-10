import { describe, it, expect } from "vitest";
import { normalizeGithubRepos } from "../../src/lib/integrations.js";

describe("normalizeGithubRepos", () => {
  it("upgrades the legacy string[] shape to mappings with all-groups default", () => {
    expect(normalizeGithubRepos(["kipwise/a", " kipwise/b "])).toEqual([
      { name: "kipwise/a", group_ids: [] },
      { name: "kipwise/b", group_ids: [] },
    ]);
  });

  it("keeps explicit group mappings and drops malformed entries", () => {
    expect(
      normalizeGithubRepos([
        { name: "kipwise/a", group_ids: ["g1", "g2"] },
        { name: "kipwise/b" },
        { name: "" },
        { group_ids: ["g1"] },
        42,
        null,
      ]),
    ).toEqual([
      { name: "kipwise/a", group_ids: ["g1", "g2"] },
      { name: "kipwise/b", group_ids: [] },
    ]);
  });

  it("filters non-string group ids and handles non-array input", () => {
    expect(normalizeGithubRepos({ not: "an array" })).toEqual([]);
    expect(normalizeGithubRepos([{ name: "a/b", group_ids: ["g1", 7, null] }])).toEqual([
      { name: "a/b", group_ids: ["g1"] },
    ]);
  });
});
