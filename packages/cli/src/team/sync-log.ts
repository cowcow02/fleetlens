import { readFileSync } from "node:fs";
import { cclensPath } from "@claude-lens/parser/fs";

export type SyncLogLine = { ts: string; level: string; msg: string };

const MAX_LINES = 300;

// Read the daemon's own sync-log lines from daemon.log since `watermark`, for
// upload to the team server. daemon.log lines are `${ISO} ${LEVEL} ${message}`
// (daemon-worker.ts). We keep only the team-sync lines (the "team " prefix,
// same filter as `fleetlens daemon logs`) so we upload the sync story, not the
// usage-poll noise. Chronological, so the newest line's ts is the new watermark.
export function readPendingSyncLog(watermark?: string): {
  lines: SyncLogLine[];
  watermark?: string;
} {
  let raw: string;
  try {
    raw = readFileSync(cclensPath("daemon.log"), "utf8");
  } catch {
    return { lines: [] };
  }

  const lines: SyncLogLine[] = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^(\S+) (INFO|WARN|ERROR) (.*)$/);
    if (!m) continue;
    const [, ts, levelRaw, msg] = m;
    if (!msg.includes("team ")) continue;
    if (watermark && ts <= watermark) continue;
    lines.push({ ts, level: levelRaw.toLowerCase(), msg });
  }

  const capped = lines.slice(-MAX_LINES);
  return { lines: capped, watermark: capped.length ? capped[capped.length - 1].ts : undefined };
}
