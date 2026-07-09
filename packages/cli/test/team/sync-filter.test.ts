import { describe, it, expect } from "vitest";
import { filterSyncedSessions } from "../../src/team/push.js";
import type { SessionMeta } from "@claude-lens/parser";

const session = (projectName: string) => ({ projectName }) as SessionMeta;

describe("filterSyncedSessions", () => {
  const sp = { autoIncludeNew: false, included: ["work"], excluded: ["personal"] };
  it("passes everything through without a selection", () => {
    expect(filterSyncedSessions([session("/u/x/Repo/personal")], undefined)).toHaveLength(1);
  });
  it("filters by project key, worktree paths collapse to the parent repo", () => {
    const kept = filterSyncedSessions(
      [
        session("/u/x/Repo/work"),
        session("/u/x/Repo/work/.worktrees/feat-1"), // canonicalizes to …/work
        session("/u/x/Repo/personal"),
        session("/u/x/Repo/unknown"),
      ],
      sp,
    );
    expect(kept.map((s) => s.projectName)).toEqual([
      "/u/x/Repo/work",
      "/u/x/Repo/work/.worktrees/feat-1",
    ]);
  });

  it("filters custom worktree sessions by their parser-resolved project", () => {
    const kept = filterSyncedSessions(
      [
        { ...session("/u/x/scratch/feature-one"), projectName: "/u/x/Repo/work", worktreeName: "feature-one" },
        { ...session("/u/x/scratch/personal-feature"), projectName: "/u/x/Repo/personal", worktreeName: "personal-feature" },
      ],
      sp,
    );
    expect(kept.map((s) => s.worktreeName)).toEqual(["feature-one"]);
  });
});
