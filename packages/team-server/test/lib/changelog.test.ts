import { describe, it, expect } from "vitest";
import { parseChangelog, ENTRIES, LATEST_VERSION } from "../../src/lib/changelog";

describe("parseChangelog", () => {
  it("parses a single entry with sections and bullets", () => {
    const raw = `## [1.0.0] — 2026-05-01

### Added
- New feature foo
- New feature bar

### Fixed
- Fix the qux
`;
    const entries = parseChangelog(raw);
    expect(entries).toHaveLength(1);
    expect(entries[0].version).toBe("1.0.0");
    expect(entries[0].date).toBe("2026-05-01");
    expect(entries[0].sections).toHaveLength(2);
    expect(entries[0].sections[0]).toEqual({
      kind: "Added",
      bullets: ["New feature foo", "New feature bar"],
    });
    expect(entries[0].sections[1].kind).toBe("Fixed");
    expect(entries[0].sections[1].bullets).toEqual(["Fix the qux"]);
  });

  it("parses multiple entries newest-first", () => {
    const raw = `## [0.2.0] — 2026-04-30

### Added
- Bar

## [0.1.0] — 2026-04-01

### Added
- Foo
`;
    const entries = parseChangelog(raw);
    expect(entries.map((e) => e.version)).toEqual(["0.2.0", "0.1.0"]);
  });

  it("tolerates entries without a date", () => {
    const raw = `## [0.3.0]

### Added
- Foo
`;
    const entries = parseChangelog(raw);
    expect(entries[0].date).toBeNull();
    expect(entries[0].version).toBe("0.3.0");
  });

  it("collapses wrapped bullet continuations into one line", () => {
    const raw = `## [0.1.0]

### Added
- This is a long bullet
  that wraps to a second line.
- Another bullet.
`;
    const entries = parseChangelog(raw);
    expect(entries[0].sections[0].bullets).toEqual([
      "This is a long bullet that wraps to a second line.",
      "Another bullet.",
    ]);
  });

  it("ignores prologue text before the first version heading", () => {
    const raw = `# Changelog

Some prose introduction.

- A stray bullet that should NOT become an entry.

## [0.1.0] — 2026-04-01

### Added
- Real entry
`;
    const entries = parseChangelog(raw);
    expect(entries).toHaveLength(1);
    expect(entries[0].sections[0].bullets).toEqual(["Real entry"]);
  });

  it("returns an empty array for empty or unrecognized input", () => {
    expect(parseChangelog("")).toEqual([]);
    expect(parseChangelog("just some text\nno headings\n")).toEqual([]);
  });

  it("supports both em-dash and hyphen as the date separator", () => {
    const raw = `## [0.2.0] - 2026-04-30
## [0.1.0] — 2026-04-01
`;
    const entries = parseChangelog(raw);
    expect(entries[0].date).toBe("2026-04-30");
    expect(entries[1].date).toBe("2026-04-01");
  });
});

describe("bundled team-edition data", () => {
  it("ENTRIES contains at least one entry with semver versions", () => {
    expect(ENTRIES.length).toBeGreaterThan(0);
    for (const e of ENTRIES) {
      expect(e.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("LATEST_VERSION matches the topmost entry", () => {
    expect(LATEST_VERSION).toBe(ENTRIES[0]?.version ?? null);
  });
});
