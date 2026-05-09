import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { cclensPath } from "@claude-lens/parser/fs";

const STALE_MS = 15 * 60 * 1000;

export type FileCheckpoint = {
  byte_offset: number;
  last_event_ts: string | null;
  affects_days: string[];
};

export type PerceptionState = {
  sweep_in_progress: boolean;
  last_sweep_started_at: string | null;
  last_sweep_completed_at: string | null;
  file_checkpoints: Record<string, FileCheckpoint>;
};

let pathCached: string | null = null;

function statePath(): string {
  if (pathCached) return pathCached;
  pathCached = cclensPath("perception-state.json");
  return pathCached;
}

/** @internal Test-only. Do not use in production. */
export function __setStatePathForTest(p: string): void {
  pathCached = p;
}

export function readState(): PerceptionState {
  const p = statePath();
  if (!existsSync(p)) {
    return {
      sweep_in_progress: false,
      last_sweep_started_at: null,
      last_sweep_completed_at: null,
      file_checkpoints: {},
    };
  }
  const raw = readFileSync(p, "utf8");
  return JSON.parse(raw) as PerceptionState;
}

function writeState(s: PerceptionState): void {
  const p = statePath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2), "utf8");
  renameSync(tmp, p);
}

export function markSweepStart(): void {
  const s = readState();
  s.sweep_in_progress = true;
  s.last_sweep_started_at = new Date().toISOString();
  writeState(s);
}

export function markSweepEnd(): void {
  const s = readState();
  s.sweep_in_progress = false;
  s.last_sweep_completed_at = new Date().toISOString();
  writeState(s);
}

export function isSweepStale(): boolean {
  const s = readState();
  if (!s.sweep_in_progress) return false;
  if (!s.last_sweep_started_at) return true;
  const age = Date.now() - Date.parse(s.last_sweep_started_at);
  return age > STALE_MS;
}

export function updateCheckpoint(jsonlPath: string, cp: FileCheckpoint): void {
  const s = readState();
  s.file_checkpoints[jsonlPath] = cp;
  writeState(s);
}
