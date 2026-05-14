import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { shellEscape, readJsonlCwd } from "../src/tmux-runner.js";

describe("shellEscape", () => {
  test("passes through safe identifiers untouched", () => {
    expect(shellEscape("haiku")).toBe("haiku");
    expect(shellEscape("/Users/me/.local/bin/claude")).toBe("/Users/me/.local/bin/claude");
    expect(shellEscape("run-123-abc.sh")).toBe("run-123-abc.sh");
  });

  test("single-quotes anything outside the safe set", () => {
    expect(shellEscape("hello world")).toBe("'hello world'");
    expect(shellEscape("a&b|c")).toBe("'a&b|c'");
    expect(shellEscape("$var")).toBe("'$var'");
  });

  test("escapes embedded single quotes via the close-reopen trick", () => {
    // `'foo'bar'` inside a shell arg must close+reopen the surrounding quotes.
    expect(shellEscape("foo'bar")).toBe(`'foo'"'"'bar'`);
    expect(shellEscape("'leading")).toBe(`''"'"'leading'`);
    expect(shellEscape("trailing'")).toBe(`'trailing'"'"''`);
  });

  test("empty string is wrapped in empty single quotes", () => {
    expect(shellEscape("")).toBe("''");
  });
});

describe("readJsonlCwd", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fl-jsonl-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns cwd from the first meta line that carries it", () => {
    const path = join(dir, "session.jsonl");
    writeFileSync(
      path,
      [
        JSON.stringify({ type: "last-prompt" }),
        JSON.stringify({ type: "permission-mode" }),
        JSON.stringify({ type: "attachment", cwd: "/Users/me/proj", entrypoint: "cli" }),
      ].join("\n"),
    );
    expect(readJsonlCwd(path)).toBe("/Users/me/proj");
  });

  test("returns undefined when no scanned line has cwd", () => {
    const path = join(dir, "empty.jsonl");
    writeFileSync(path, [
      JSON.stringify({ type: "last-prompt" }),
      JSON.stringify({ type: "permission-mode" }),
    ].join("\n"));
    expect(readJsonlCwd(path)).toBeUndefined();
  });

  test("stops after maxLines and returns undefined if cwd is later", () => {
    const lines: string[] = [];
    for (let i = 0; i < 12; i++) lines.push(JSON.stringify({ type: "noise", i }));
    lines.push(JSON.stringify({ type: "attachment", cwd: "/late/path" }));
    const path = join(dir, "late.jsonl");
    writeFileSync(path, lines.join("\n"));
    expect(readJsonlCwd(path, 4)).toBeUndefined();
    expect(readJsonlCwd(path, 20)).toBe("/late/path");
  });

  test("survives malformed JSON lines", () => {
    const path = join(dir, "messy.jsonl");
    writeFileSync(path, [
      "not json at all",
      JSON.stringify({ type: "attachment", cwd: "/real/cwd" }),
    ].join("\n"));
    expect(readJsonlCwd(path)).toBe("/real/cwd");
  });

  test("returns undefined when file is missing", () => {
    expect(readJsonlCwd(join(dir, "does-not-exist.jsonl"))).toBeUndefined();
  });

  test("handles paths with dots — the regression the reviewer caught", () => {
    // Whether Claude Code encodes a `.` to `-` or preserves it in the project
    // dir name, the cwd field itself is always the literal cwd path. The
    // transcript-discovery logic in tmux-runner relies on this string equality
    // instead of round-tripping through any path encoder.
    mkdirSync(join(dir, "subdir"));
    const path = join(dir, "subdir", "s.jsonl");
    writeFileSync(path, JSON.stringify({ type: "attachment", cwd: "/Users/jane.doe/.cclens/runtime" }));
    expect(readJsonlCwd(path)).toBe("/Users/jane.doe/.cclens/runtime");
  });
});
