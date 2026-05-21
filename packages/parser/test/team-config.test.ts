import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readTeamConfig, writeTeamConfig, clearTeamConfig, type TeamConfig } from "../src/team-config.js";

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
