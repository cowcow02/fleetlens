import { readFileSync, writeFileSync, appendFileSync, statSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const QUEUE_PATH = join(homedir(), ".cclens", "ingest-queue.jsonl");
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type QueueEntry = {
  payload: unknown;
  enqueuedAt: string; // ISO timestamp
};

export function enqueuePayload(payload: unknown, queuePath = QUEUE_PATH): void {
  mkdirSync(dirname(queuePath), { recursive: true });
  const entry: QueueEntry = { payload, enqueuedAt: new Date().toISOString() };
  appendFileSync(queuePath, JSON.stringify(entry) + "\n", "utf8");

  // Overflow check
  try {
    const { size } = statSync(queuePath);
    if (size > MAX_SIZE_BYTES) {
      pruneOldest(queuePath);
    }
  } catch {}
}

export function dequeuePayloads(queuePath = QUEUE_PATH): unknown[] {
  let lines: string[];
  try {
    lines = readFileSync(queuePath, "utf8").trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }

  const now = Date.now();
  const valid: QueueEntry[] = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as QueueEntry;
      if (now - new Date(entry.enqueuedAt).getTime() < MAX_AGE_MS) {
        valid.push(entry);
      }
    } catch {
      // Skip malformed
    }
  }

  // Clear the queue file
  writeFileSync(queuePath, "", "utf8");
  return valid.map((e) => e.payload);
}

function pruneOldest(queuePath: string): void {
  let lines: string[];
  try {
    lines = readFileSync(queuePath, "utf8").trim().split("\n").filter(Boolean);
  } catch {
    return;
  }

  // Keep the second half (newest entries)
  const keep = lines.slice(Math.floor(lines.length / 2));
  writeFileSync(queuePath, keep.join("\n") + "\n", "utf8");
}
