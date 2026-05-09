import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { cclensPath } from "@claude-lens/parser/fs";

export type SpendRecord = {
  ts: string;
  caller: "daemon" | "cli" | "web";
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  kind: "entry_enrich" | "day_digest" | "week_digest" | "month_digest" | "top_session";
  ref: string;
};

let spendPathCached: string | null = null;

function spendPath(): string {
  if (spendPathCached) return spendPathCached;
  spendPathCached = cclensPath("llm-spend.jsonl");
  return spendPathCached;
}

/** @internal Test-only. */
export function __setSpendPathForTest(path: string): void {
  spendPathCached = path;
}

export function appendSpend(record: SpendRecord): void {
  const p = spendPath();
  mkdirSync(dirname(p), { recursive: true });
  // Concurrent appenders (daemon + CLI + web-route) are safe: POSIX guarantees
  // atomic O_APPEND writes under PIPE_BUF (≥4 KB on macOS/Linux). Each
  // SpendRecord line is ~200 bytes — well below — so interleaved writes land
  // as complete lines, never torn.
  appendFileSync(p, JSON.stringify(record) + "\n", { encoding: "utf8" });
}

export function monthToDateSpend(now: Date = new Date()): number {
  const p = spendPath();
  if (!existsSync(p)) return 0;
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  let total = 0;
  const raw = readFileSync(p, "utf8");
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let rec: SpendRecord;
    try {
      rec = JSON.parse(line) as SpendRecord;
    } catch {
      continue;
    }
    const ts = new Date(rec.ts);
    if (Number.isNaN(ts.getTime())) continue;
    if (ts.getUTCFullYear() !== year || ts.getUTCMonth() !== month) continue;
    total += rec.cost_usd;
  }
  return total;
}
