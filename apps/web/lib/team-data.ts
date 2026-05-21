import "server-only";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  cclensHome,
  readTeamConfig,
  type TeamConfig,
  type IngestPayload,
  type LastPushRecord,
} from "@claude-lens/parser/fs";
import { deriveHealth, type Health } from "./team-health";

export type TeamConnection =
  | { paired: false }
  | {
      paired: true;
      team: { name: string; slug: string; serverUrl: string };
      member: { role: string | null; pairedAt: string };
      lastPush:
        | { kind: "none" }
        | { kind: "ok"; at: string; payload: IngestPayload }
        | { kind: "error"; at: string; error: string; payload: IngestPayload };
      health: Health;
    };

const LAST_PUSH_FILE = "team-last-push.json";

function readLastPush(): LastPushRecord | null {
  const path = join(cclensHome(), LAST_PUSH_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LastPushRecord;
  } catch {
    return null;
  }
}

export function readTeamConnection(): TeamConnection {
  const config: TeamConfig | null = readTeamConfig();
  if (!config) return { paired: false };
  const lastPush = readLastPush();

  const lastPushBlock = !lastPush
    ? ({ kind: "none" } as const)
    : lastPush.ok
      ? ({ kind: "ok", at: lastPush.pushedAt, payload: lastPush.payload } as const)
      : ({
          kind: "error",
          at: lastPush.pushedAt,
          error: lastPush.error ?? "Unknown error",
          payload: lastPush.payload,
        } as const);

  return {
    paired: true,
    team: {
      name: config.teamName ?? config.teamSlug,
      slug: config.teamSlug,
      serverUrl: config.serverUrl,
    },
    member: {
      role: null,
      pairedAt: config.pairedAt,
    },
    lastPush: lastPushBlock,
    health: deriveHealth(lastPushBlock),
  };
}
