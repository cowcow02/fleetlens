import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { cclensHome } from "@claude-lens/parser/fs";

const CONFIG_FILE = "team.json";

export type TeamConfig = {
  serverUrl: string;
  memberId: string;
  bearerToken: string;
  teamSlug: string;
  pairedAt: string;
  lastSyncedDay?: string;
};

export function readTeamConfig(dir?: string): TeamConfig | null {
  const d = dir ?? cclensHome();
  try {
    return JSON.parse(readFileSync(join(d, CONFIG_FILE), "utf8"));
  } catch {
    return null;
  }
}

export function writeTeamConfig(config: TeamConfig, dir?: string): void {
  const d = dir ?? cclensHome();
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, CONFIG_FILE), JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function clearTeamConfig(dir?: string): void {
  const d = dir ?? cclensHome();
  try { unlinkSync(join(d, CONFIG_FILE)); } catch {}
}
