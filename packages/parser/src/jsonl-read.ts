/**
 * Bounded JSONL readers for agent adapters.
 *
 * Loading a 100–430 MB transcript as one string and JSON.parse-ing every
 * line (including multi-megabyte tool-result objects) aborts Node with
 * V8 FatalProcessOutOfMemory. Stream line-by-line, skip oversized files
 * and lines, and never hold the whole file in RAM.
 */

import { closeSync, createReadStream, openSync, readSync, statSync } from "node:fs";
import { promises as fs } from "node:fs";
import { createInterface } from "node:readline";

/** Skip transcripts bigger than this. 64 MiB of JSONL already expands to
 *  hundreds of MB of objects; the 100–430 MB rollouts that killed the
 *  usage daemon are well above this. */
export const MAX_JSONL_FILE_BYTES = 64 * 1024 * 1024;

/** Skip a single line bigger than this without JSON.parse. The OOM stack
 *  was JsonParser::BuildJsonObject on one huge tool-result object. */
export const MAX_JSONL_LINE_BYTES = 2 * 1024 * 1024;

/** Max in-flight file parses for list/calibration scans. Promise.all on
 *  thousands of JSONLs is how a fresh daemon spikes memory on boot. */
export const LIST_PARSE_CONCURRENCY = 4;

/** SessionDetail includes every event (and the raw line). Keep a tiny LRU
 *  so a sweep/list pass cannot pin hundreds of parsed sessions. */
export const DETAIL_CACHE_LIMIT = 4;

export class JsonlTooLargeError extends Error {
  readonly code = "JSONL_TOO_LARGE";
  constructor(
    readonly filePath: string,
    readonly sizeBytes: number,
  ) {
    super(`transcript too large to parse (${sizeBytes} bytes): ${filePath}`);
    this.name = "JsonlTooLargeError";
  }
}

export function jsonlFileTooLarge(sizeBytes: number): boolean {
  return sizeBytes > MAX_JSONL_FILE_BYTES;
}

function pushLine(line: string, out: unknown[]): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  if (Buffer.byteLength(trimmed) > MAX_JSONL_LINE_BYTES) return;
  try {
    out.push(JSON.parse(trimmed));
  } catch {
    // Skip malformed lines rather than failing the whole session.
  }
}

export async function readJsonlFile(filePath: string): Promise<unknown[]> {
  const st = await fs.stat(filePath);
  if (jsonlFileTooLarge(st.size)) throw new JsonlTooLargeError(filePath, st.size);
  const out: unknown[] = [];
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let n = 0;
  for await (const line of rl) {
    pushLine(line, out);
    // Yield so a long file cannot starve the daemon watchdog / HTTP poll.
    if (++n % 1000 === 0) await Promise.resolve();
  }
  return out;
}

export function readJsonlFileSync(filePath: string): unknown[] {
  const st = statSync(filePath);
  if (jsonlFileTooLarge(st.size)) throw new JsonlTooLargeError(filePath, st.size);
  const fd = openSync(filePath, "r");
  const buf = Buffer.allocUnsafe(64 * 1024);
  let carry = Buffer.alloc(0);
  const out: unknown[] = [];
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      const incoming = buf.subarray(0, n);
      const data = carry.length === 0 ? incoming : Buffer.concat([carry, incoming]);
      let start = 0;
      for (let i = 0; i < data.length; i++) {
        if (data[i] === 0x0a) {
          pushLine(data.subarray(start, i).toString("utf8"), out);
          start = i + 1;
        }
      }
      carry = start === 0 ? Buffer.from(data) : Buffer.from(data.subarray(start));
    }
    if (carry.length > 0) pushLine(carry.toString("utf8"), out);
  } finally {
    closeSync(fd);
  }
  return out;
}

export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  }
  const n = Math.min(Math.max(1, limit), items.length);
  if (items.length === 0) return out;
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

export function lruSet<K, V>(map: Map<K, V>, key: K, value: V, max = DETAIL_CACHE_LIMIT): void {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value as K | undefined;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

export function lruGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  const v = map.get(key);
  if (v === undefined) return undefined;
  map.delete(key);
  map.set(key, v);
  return v;
}
