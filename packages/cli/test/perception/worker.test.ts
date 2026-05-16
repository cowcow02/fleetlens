import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPerceptionSweep } from "../../src/perception/worker.js";
import { __setStatePathForTest } from "../../src/perception/state.js";
import { __setEntriesDirForTest } from "@claude-lens/entries/fs";

describe("runPerceptionSweep", () => {
  let tmp: string;
  let projectsRoot: string;
  let entriesDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "perc-sweep-"));
    projectsRoot = join(tmp, "projects");
    entriesDir = join(tmp, "entries");
    mkdirSync(projectsRoot, { recursive: true });
    mkdirSync(entriesDir, { recursive: true });
    __setStatePathForTest(join(tmp, "perception-state.json"));
    __setEntriesDirForTest(entriesDir);
  });

  it("writes Entries from a fixture JSONL mounted in tmp projects dir", async () => {
    const projectDir = join(projectsRoot, "-Users-test-repo-foo");
    mkdirSync(projectDir, { recursive: true });
    const sessionId = "abc-123-def-456";
    // Two-event minimal session: one user turn, one assistant reply, 30 s apart.
    const jsonl = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-04-20T10:00:00.000Z",
        cwd: "/Users/test/repo/foo",
        message: { role: "user", content: [{ type: "text", text: "hi" }] },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-04-20T10:00:30.000Z",
        cwd: "/Users/test/repo/foo",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "hello" }],
        },
      }),
    ].join("\n");
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), jsonl);

    const result = await runPerceptionSweep({ projectsRoot });

    expect(result.sessionsProcessed).toBe(1);
    expect(result.entriesWritten).toBeGreaterThanOrEqual(1);
    expect(result.errors).toBe(0);

    const written = readdirSync(entriesDir);
    expect(written.some(f => f.startsWith(sessionId))).toBe(true);
  });

  it("returns zero counts when projects dir is empty", async () => {
    const r = await runPerceptionSweep({ projectsRoot });
    expect(r).toEqual({ sessionsProcessed: 0, entriesWritten: 0, errors: 0 });
  });

  it("sets sweep_in_progress=false after completion", async () => {
    const { readState } = await import("../../src/perception/state.js");
    await runPerceptionSweep({ projectsRoot });
    expect(readState().sweep_in_progress).toBe(false);
    expect(readState().last_sweep_completed_at).toBeTruthy();
  });

  it("skips sweep when one is already in progress and not stale", async () => {
    const { markSweepStart, readState } = await import("../../src/perception/state.js");
    markSweepStart();
    const r = await runPerceptionSweep({ projectsRoot });
    expect(r).toEqual({ sessionsProcessed: 0, entriesWritten: 0, errors: 0 });
    expect(readState().sweep_in_progress).toBe(true);
  });
});
