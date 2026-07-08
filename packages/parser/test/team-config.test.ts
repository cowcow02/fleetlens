import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readTeamConfig, writeTeamConfig, clearTeamConfig, shouldSyncProject, type TeamConfig } from "../src/team-config.js";

const SAMPLE: TeamConfig = {
  serverUrl: "https://team.example.com",
  memberId: "mem_abc123",
  bearerToken: "tok_secret",
  teamSlug: "acme",
  teamName: "Acme Corp",
  pairedAt: "2026-01-01T00:00:00.000Z",
};

describe("team config", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cclens-team-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when file does not exist", () => {
    expect(readTeamConfig(dir)).toBeNull();
  });

  it("round-trips write + read with teamName", () => {
    writeTeamConfig(SAMPLE, dir);
    expect(readTeamConfig(dir)).toEqual(SAMPLE);
  });

  it("tolerates legacy configs without teamName", () => {
    const { teamName: _ignored, ...legacy } = SAMPLE;
    writeTeamConfig(legacy as TeamConfig, dir);
    const read = readTeamConfig(dir);
    expect(read).toBeTruthy();
    expect(read!.teamSlug).toBe("acme");
    expect(read!.teamName).toBeUndefined();
  });

  it("written file has mode 0600", () => {
    writeTeamConfig(SAMPLE, dir);
    const mode = statSync(join(dir, "team.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("clearTeamConfig removes file; subsequent read returns null", () => {
    writeTeamConfig(SAMPLE, dir);
    clearTeamConfig(dir);
    expect(readTeamConfig(dir)).toBeNull();
  });

  it("clearTeamConfig is a no-op when file does not exist", () => {
    expect(() => clearTeamConfig(dir)).not.toThrow();
  });
});

describe("shouldSyncProject", () => {
  const sp = { autoIncludeNew: true, included: ["work-repo"], excluded: ["personal-blog"] };
  it("syncs everything when syncProjects is absent", () => {
    expect(shouldSyncProject("anything", undefined)).toBe(true);
  });
  it("drops excluded projects", () => {
    expect(shouldSyncProject("personal-blog", sp)).toBe(false);
  });
  it("keeps included projects", () => {
    expect(shouldSyncProject("work-repo", sp)).toBe(true);
  });
  it("routes unknown projects by autoIncludeNew", () => {
    expect(shouldSyncProject("brand-new", sp)).toBe(true);
    expect(shouldSyncProject("brand-new", { ...sp, autoIncludeNew: false })).toBe(false);
  });
  it("excluded wins over included on a conflicting entry", () => {
    expect(shouldSyncProject("both", { autoIncludeNew: true, included: ["both"], excluded: ["both"] })).toBe(false);
  });
});

describe("TeamConfig round-trip with onboarding fields", () => {
  it("preserves setupPending and syncProjects", () => {
    const dir = mkdtempSync(join(tmpdir(), "cclens-test-"));
    const config: TeamConfig = {
      serverUrl: "http://x", memberId: "m", bearerToken: "t", teamSlug: "s",
      pairedAt: "2026-07-08T00:00:00Z",
      setupPending: true,
      syncProjects: { autoIncludeNew: false, included: ["a"], excluded: ["b"] },
    };
    writeTeamConfig(config, dir);
    expect(readTeamConfig(dir)).toEqual(config);
  });
});
