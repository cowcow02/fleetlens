import { readFileSync, writeFileSync, unlinkSync, mkdirSync, renameSync } from "node:fs";
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
  /** ISO ts of the newest daemon.log line already uploaded to the team server
   *  as a sync-log line. Only advanced after a successful push, so a failed
   *  upload re-sends (the server dedups on (member, ts, msg)). */
  lastSyncedLogAt?: string;
  /** Days (YYYY-MM-DD) whose full payload the server rejected with a hard 4xx
   *  and which lastSyncedDay has already advanced past. Retried one-at-a-time
   *  (oldest first) each sync so a server upgrade self-heals the day instead of
   *  losing it forever. Capped + deduped by the writer. */
  droppedDays?: string[];
  /** Written by `team join`; nothing syncs while set. Cleared by the wizard's
   *  "Start syncing". Absent on configs from before the wizard ⇒ not gated. */
  setupPending?: boolean;
  syncProjects?: SyncProjects;
};

/** Member-side project selection for team sync. `included`/`excluded` capture
 *  the explicit wizard checkboxes; projects that appear AFTER selection fall
 *  through to `autoIncludeNew`. Absent syncProjects = sync everything. */
export type SyncProjects = {
  autoIncludeNew: boolean;
  included: string[];
  excluded: string[];
};

export function shouldSyncProject(projectKey: string, sp?: SyncProjects): boolean {
  if (!sp) return true;
  if (sp.excluded.includes(projectKey)) return false;
  if (sp.included.includes(projectKey)) return true;
  return sp.autoIncludeNew;
}

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
  // Atomic tmp+rename: the daemon, the web routes, and a wizard-spawned sync
  // may all write this file — a torn write must never be readable.
  const tmp = join(d, `${CONFIG_FILE}.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  renameSync(tmp, join(d, CONFIG_FILE));
}

export function clearTeamConfig(dir?: string): void {
  const d = dir ?? cclensHome();
  try { unlinkSync(join(d, CONFIG_FILE)); } catch {}
}
