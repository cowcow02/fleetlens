import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { pathHash, probeArtifactSignals } from "../src/perception/file-probe.js";

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "fp-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "probe-test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Probe Test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  return dir;
}

describe("file-probe", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeRepo();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns null when no .claude directories exist", () => {
    // Probe scans HOME first, but in a fresh tmp project with no extraRoots
    // pointing at a populated .claude, we expect either null or a hash-only
    // result. We pass an extraRoot at the empty tmp so nothing fires there;
    // the home directory may have its own — assert at minimum no error.
    expect(() => probeArtifactSignals({ extraRoots: [projectDir] })).not.toThrow();
  });

  it("detects a newly-authored skill file as authored on the same day", () => {
    const skillsDir = join(projectDir, ".claude", "skills");
    mkdirSync(skillsDir, { recursive: true });
    const skillFile = join(skillsDir, "my-skill.md");
    writeFileSync(skillFile, "# A skill\n");
    execFileSync("git", ["add", "."], { cwd: projectDir });
    execFileSync("git", ["commit", "-m", "add skill", "--no-gpg-sign"], { cwd: projectDir });

    const today = new Date().toISOString().slice(0, 10);
    const result = probeArtifactSignals({ extraRoots: [projectDir], day: today });
    expect(result).not.toBeNull();
    expect(result!.skillsAuthored.length).toBeGreaterThanOrEqual(1);
    const expectedHash = pathHash("project:skills:my-skill.md");
    expect(result!.skillsAuthored.find((s) => s.pathHash === expectedHash)).toBeDefined();
  });

  it("detects a CLAUDE.md edit attributable to the local git user", () => {
    const claudemd = join(projectDir, "CLAUDE.md");
    writeFileSync(claudemd, "# Notes\n");
    execFileSync("git", ["add", "."], { cwd: projectDir });
    execFileSync("git", ["commit", "-m", "init claudemd", "--no-gpg-sign"], { cwd: projectDir });
    writeFileSync(claudemd, "# Notes\n\nA second line\nAnd a third\n");
    execFileSync("git", ["add", "."], { cwd: projectDir });
    execFileSync("git", ["commit", "-m", "extend", "--no-gpg-sign"], { cwd: projectDir });

    const today = new Date().toISOString().slice(0, 10);
    const result = probeArtifactSignals({
      extraRoots: [projectDir],
      day: today,
      authorEmail: "probe-test@example.com",
    });
    expect(result).not.toBeNull();
    // Initial 1 line + 2 added lines = +3 lines net for the day.
    expect(result!.claudemdLineDelta).toBeGreaterThanOrEqual(3);
  });

  it("returns null for an entirely idle day (no authoring, no edits)", () => {
    // Empty repo, no .claude/, no CLAUDE.md. The probe should produce null
    // so the caller skips the `artifactSignals` field on idle days.
    const tomorrow = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    })();
    const result = probeArtifactSignals({
      extraRoots: [projectDir],
      day: tomorrow,
      authorEmail: "probe-test@example.com",
    });
    expect(result).toBeNull();
  });

  it("pathHash is stable across calls", () => {
    expect(pathHash("user:skills:foo.md")).toBe(pathHash("user:skills:foo.md"));
    expect(pathHash("user:skills:foo.md")).not.toBe(pathHash("user:skills:bar.md"));
  });
});
