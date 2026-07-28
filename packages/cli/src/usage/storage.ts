import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  openSync,
  readSync,
  fstatSync,
  closeSync,
} from "node:fs";
import { dirname } from "node:path";
import type { UsageSnapshot } from "./api.js";

/**
 * Append-only JSONL log of usage snapshots. One line per poll.
 * Kept simple for easy downstream consumption (web dashboard,
 * third-party scripts) without a database dependency.
 */
export function appendSnapshot(filePath: string, snapshot: UsageSnapshot): void {
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, JSON.stringify(snapshot) + "\n", "utf8");
}

export function readSnapshots(filePath: string): UsageSnapshot[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf8");
  const snapshots: UsageSnapshot[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      snapshots.push(JSON.parse(line) as UsageSnapshot);
    } catch {
      // Skip corrupted lines rather than failing the whole read
    }
  }
  return snapshots;
}

export function latestSnapshot(filePath: string): UsageSnapshot | null {
  const all = readSnapshots(filePath);
  return all.length > 0 ? all[all.length - 1]! : null;
}

/**
 * Remove every snapshot for a given agent. Used when a source becomes
 * unconfigured (e.g. the Z.ai key is removed from Settings) so a stale
 * line doesn't keep the widget/dashboard showing obsolete usage forever.
 * The log is otherwise append-only; this is the one intentional rewrite,
 * scoped to a single agent and safe because the daemon is its only writer.
 */
export function pruneAgent(filePath: string, agent: string): void {
  if (!existsSync(filePath)) return;
  const kept = readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => {
      if (!line.trim()) return false;
      try {
        return JSON.parse(line).agent !== agent;
      } catch {
        return true; // keep unparseable lines; readSnapshots already skips them
      }
    });
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, kept.join("\n") + (kept.length ? "\n" : ""), "utf8");
}

export function latestClaudeCodeSnapshot(filePath: string): UsageSnapshot | null {
  const all = readSnapshots(filePath);
  for (let i = all.length - 1; i >= 0; i--) {
    const s = all[i]!;
    if (!s.agent || s.agent === "claude-code") return s;
  }
  return null;
}

/**
 * Freshest snapshot per agent tag (legacy untagged lines count as claude-code).
 *
 * Reads only a tail chunk of the log (default 256KB, enough for days of 5-min
 * multi-agent polls) and walks newest-first so --watch can redraw without
 * re-parsing multi-MB histories every tick. Falls back to a full read when
 * the file is smaller than the tail window.
 */
export function latestSnapshotsByAgent(
  filePath: string,
  opts: { tailBytes?: number } = {},
): Record<string, UsageSnapshot> {
  if (!existsSync(filePath)) return {};
  const tailBytes = opts.tailBytes ?? 262_144;
  const raw = readTail(filePath, tailBytes);
  const byAgent: Record<string, UsageSnapshot> = {};
  // Walk newest → oldest so the first hit per agent wins.
  const lines = raw.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line) continue;
    try {
      const s = JSON.parse(line) as UsageSnapshot;
      const agent = s.agent ?? "claude-code";
      if (byAgent[agent] === undefined) byAgent[agent] = s;
    } catch {
      // skip corrupt
    }
  }
  return byAgent;
}

function readTail(filePath: string, maxBytes: number): string {
  let fd: number | undefined;
  try {
    fd = openSync(filePath, "r");
    const size = fstatSync(fd).size;
    if (size <= 0) return "";
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, start);
    let text = buf.toString("utf8");
    // If we mid-line'd the start of the chunk, drop the partial first line.
    if (start > 0) {
      const nl = text.indexOf("\n");
      if (nl !== -1) text = text.slice(nl + 1);
    }
    return text;
  } catch {
    // Fallback: full read for tiny/racy files.
    try {
      return readFileSync(filePath, "utf8");
    } catch {
      return "";
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
