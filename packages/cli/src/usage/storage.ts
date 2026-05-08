import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
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

export function latestClaudeCodeSnapshot(filePath: string): UsageSnapshot | null {
  const all = readSnapshots(filePath);
  for (let i = all.length - 1; i >= 0; i--) {
    const s = all[i]!;
    if (!s.agent || s.agent === "claude-code") return s;
  }
  return null;
}
