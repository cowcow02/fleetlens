import { describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { cclensHome } from "@claude-lens/parser/fs";

// Regression guard: credentials.test.ts once ran rmSync(cclensPath("usage.jsonl"))
// against the developer's real ~/.cclens and destroyed months of usage history.
// Any entries test that writes under cclensHome() must land in a temp dir.
describe("entries test environment", () => {
  it("never resolves cclensHome() to the real ~/.cclens", () => {
    expect(cclensHome()).not.toBe(join(homedir(), ".cclens"));
  });
});
