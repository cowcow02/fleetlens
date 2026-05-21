import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { cclensHome } from "./fs.js";

const CONFIG_FILE = "team.json";

export type TeamConfig = {
  serverUrl: string;
  memberId: string;
  bearerToken: string;
  teamSlug: string;
  /** Display name of the team. Optional for backwards compat with configs
   *  written before this field was introduced; readers should fall back to
   *  `teamSlug` for display when absent. Set by `joinTeam` from the whoami
   *  response. */
  teamName?: string;
  pairedAt: string;
  lastSyncedDay?: string;
  lastSyncedUsageSnapshotAt?: string;
  // Bridge V2 privacy controls — see Phase-1 spec §7.
  // When true, LLM-enriched per-day fields (outcome/helpfulness/goal mixes)
  // ride along with the daily ingest payload. Default off; only set after
  // the member explicitly opts in.
  enrichmentOptIn?: boolean;
  // Canonical project names the member never wants to share. Excluded from
  // richRollup.projects breakdown and any workingShapes/skills aggregation
  // sourced from entries on those projects.
  privateProjects?: string[];
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
