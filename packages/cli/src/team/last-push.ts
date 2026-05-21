import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { cclensHome, type IngestPayload, type LastPushRecord } from "@claude-lens/parser/fs";

export type { LastPushRecord };

const LAST_PUSH_FILE = "team-last-push.json";

function write(record: LastPushRecord, dir?: string): void {
  const d = dir ?? cclensHome();
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, LAST_PUSH_FILE), JSON.stringify(record, null, 2), { mode: 0o600 });
}

export function writeLastPushSuccess(payload: IngestPayload, dir?: string): void {
  write({ pushedAt: new Date().toISOString(), ok: true, payload }, dir);
}

export function writeLastPushFailure(payload: IngestPayload, error: string, dir?: string): void {
  write({ pushedAt: new Date().toISOString(), ok: false, payload, error }, dir);
}

export function clearLastPush(dir?: string): void {
  const d = dir ?? cclensHome();
  try { unlinkSync(join(d, LAST_PUSH_FILE)); } catch {}
}
