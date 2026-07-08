import { describe, it, expect } from "vitest";
import { carryOverSyncProjects } from "../../src/team/join.js";
import type { TeamConfig } from "../../src/team/config.js";

const existing: TeamConfig = {
  serverUrl: "http://a", memberId: "m", bearerToken: "t", teamSlug: "team-a",
  pairedAt: "x", syncProjects: { autoIncludeNew: true, included: ["w"], excluded: ["p"] },
};

describe("carryOverSyncProjects", () => {
  it("carries the selection on a re-join to the same server+team", () => {
    expect(carryOverSyncProjects(existing, "http://a", "team-a")).toEqual(existing.syncProjects);
  });
  it("drops it for a different team or server, or no prior config", () => {
    expect(carryOverSyncProjects(existing, "http://a", "team-b")).toBeUndefined();
    expect(carryOverSyncProjects(existing, "http://b", "team-a")).toBeUndefined();
    expect(carryOverSyncProjects(null, "http://a", "team-a")).toBeUndefined();
  });
});
