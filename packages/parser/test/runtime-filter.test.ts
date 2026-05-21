import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearCaches,
  isFleetlensRuntimeDir,
  listSessions,
  loadCalibrationEvents,
  walkJsonlFiles,
} from "../src/fs.js";

function runtimeDirName(): string {
  return path.join(os.homedir(), ".cclens", "runtime").replace(/[/.]/g, "-");
}

describe("Fleetlens runtime-dir filter", () => {
  let root: string;

  beforeEach(() => {
    clearCaches();
    root = mkdtempSync(path.join(os.tmpdir(), "fleetlens-runtime-filter-"));
  });

  afterEach(() => {
    clearCaches();
    rmSync(root, { recursive: true, force: true });
  });

  it("recognizes the encoded ~/.cclens/runtime dir name", () => {
    expect(isFleetlensRuntimeDir(runtimeDirName())).toBe(true);
    expect(isFleetlensRuntimeDir("-Users-me-Repo-foo")).toBe(false);
  });

  it("excludes runtime transcripts from walk, sessions, and calibration", async () => {
    const realProj = path.join(root, "-Users-me-Repo-foo");
    const runtimeProj = path.join(root, runtimeDirName());
    mkdirSync(realProj);
    mkdirSync(runtimeProj);

    const real = {
      type: "assistant",
      cwd: "/Users/me/Repo/foo",
      timestamp: "2026-05-01T00:00:00.000Z",
      message: {
        id: "msg_real",
        model: "claude-sonnet-4-5-20250929",
        usage: { input_tokens: 1000, output_tokens: 10 },
      },
    };
    const runtime = {
      type: "assistant",
      cwd: path.join(os.homedir(), ".cclens", "runtime"),
      timestamp: "2026-05-01T00:01:00.000Z",
      message: {
        id: "msg_runtime",
        model: "claude-sonnet-4-5-20250929",
        usage: { input_tokens: 2000, output_tokens: 20 },
      },
    };
    writeFileSync(path.join(realProj, "real.jsonl"), JSON.stringify(real) + "\n");
    writeFileSync(path.join(runtimeProj, "run.jsonl"), JSON.stringify(runtime) + "\n");

    const files = await walkJsonlFiles(root);
    expect(files.map((f) => f.projectDir)).toEqual(["-Users-me-Repo-foo"]);

    const sessions = await listSessions({ root });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.cwd).toBe("/Users/me/Repo/foo");

    const events = await loadCalibrationEvents(root);
    expect(events.map((e) => e.ts)).toEqual(["2026-05-01T00:00:00.000Z"]);
  });
});
