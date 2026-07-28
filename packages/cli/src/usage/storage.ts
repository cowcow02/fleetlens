import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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

/** Freshest snapshot per agent tag (legacy untagged lines count as claude-code). */
export function latestSnapshotsByAgent(
  filePath: string,
): Record<string, UsageSnapshot> {
  const all = readSnapshots(filePath);
  const byAgent: Record<string, UsageSnapshot> = {};
  for (const s of all) {
    const agent = s.agent ?? "claude-code";
    byAgent[agent] = s;
  }
  return byAgent;
}
