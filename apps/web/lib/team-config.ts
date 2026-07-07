import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { cclensHome } from "@claude-lens/parser/fs";

// Mirrors packages/cli/src/team/config.ts. Kept in sync intentionally —
// apps/web reads/writes the same file the daemon does (~/.cclens/team.json)
// so the consent page reflects the daemon's actual sync behavior. The CLI
// owns the canonical type; this is a deliberate duplicate to avoid making
// apps/web depend on the cli package.
export type TeamConfig = {
  serverUrl: string;
  memberId: string;
  bearerToken: string;
  teamSlug: string;
  pairedAt: string;
  lastSyncedDay?: string;
  lastSyncedUsageSnapshotAt?: string;
};

const CONFIG_FILE = "team.json";

export function readTeamConfig(): TeamConfig | null {
  try {
    return JSON.parse(readFileSync(join(cclensHome(), CONFIG_FILE), "utf8"));
  } catch {
    return null;
  }
}

export function writeTeamConfig(config: TeamConfig): void {
  const dir = cclensHome();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, CONFIG_FILE), JSON.stringify(config, null, 2), { mode: 0o600 });
}

/** A "safe-for-UI" view: the bearer token is masked so it's never rendered
 *  in the DOM even by accident. */
export type TeamConfigView = Omit<TeamConfig, "bearerToken"> & {
  bearerTokenMasked: string;
};

export function maskBearer(token: string): string {
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export function toTeamConfigView(c: TeamConfig): TeamConfigView {
  const { bearerToken, ...rest } = c;
  return { ...rest, bearerTokenMasked: maskBearer(bearerToken) };
}
