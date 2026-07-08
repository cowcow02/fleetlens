import { describe, it, expect } from "vitest";
import { applyDesired } from "../../src/lib/integrations.js";

const ALL = ["g1", "g2", "g3"];
const entry = (name: string, group_ids: string[]) => ({ name, group_ids });
const keyOf = (e: { name: string }) => e.name;

describe("applyDesired", () => {
  it("no-ops entries the request doesn't mention", () => {
    const { updated, error } = applyDesired([entry("a", ["g2"])], new Map(), keyOf, "g1", ALL);
    expect(error).toBeUndefined();
    expect(updated).toEqual([entry("a", ["g2"])]);
  });

  it("adds the group to an explicit list, collapsing to all-groups when complete", () => {
    const { updated } = applyDesired(
      [entry("a", ["g2"]), entry("b", ["g2", "g3"])],
      new Map([["a", true], ["b", true]]),
      keyOf,
      "g1",
      ALL,
    );
    expect(updated[0].group_ids).toEqual(["g2", "g1"]);
    expect(updated[1].group_ids).toEqual([]); // g1+g2+g3 = everyone → all-groups
  });

  it("expands all-groups before removing the group", () => {
    const { updated } = applyDesired(
      [entry("a", [])],
      new Map([["a", false]]),
      keyOf,
      "g1",
      ALL,
    );
    expect(updated[0].group_ids.sort()).toEqual(["g2", "g3"]);
  });

  it("refuses to orphan a source from every group, leaving entries untouched", () => {
    const { updated, error } = applyDesired(
      [entry("a", ["g1"])],
      new Map([["a", false]]),
      keyOf,
      "g1",
      ALL,
    );
    expect(error).toMatch(/at least one group/);
    expect(updated).toEqual([entry("a", ["g1"])]);
  });
});
