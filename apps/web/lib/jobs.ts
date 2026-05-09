import "server-only";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { cclensHome, cclensPath } from "@claude-lens/parser/fs";

export type JobKind =
  | "digest.day"
  | "digest.day.backfill"
  | "weekly.synth"
  | "monthly.synth"
  | "ask_claude";

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export type JobProgress = {
  phase: string;
  index?: number;
  total?: number;
  bytes?: number;
  text?: string;
};

export type Job = {
  id: string;
  kind: JobKind;
  label: string;
  target: string;
  status: JobStatus;
  startedAt: string;
  completedAt: string | null;
  progress: JobProgress | null;
  resultUrl: string | null;
  error: string | null;
  caller: "auto" | "user" | "cli";
};

function jobsFile(): string {
  return process.env.CCLENS_JOBS_FILE ?? cclensPath("jobs.jsonl");
}

function ensureDir(): void {
  const dir = cclensHome();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

let cache: { mtimeMs: number; map: Map<string, Job> } | null = null;

function loadAllJobs(): Map<string, Job> {
  ensureDir();
  const file = jobsFile();
  if (!existsSync(file)) return new Map();
  const mtime = statSync(file).mtimeMs;
  if (cache && cache.mtimeMs === mtime) return new Map(cache.map);

  const map = new Map<string, Job>();
  const text = readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line) as Job;
      map.set(j.id, j);
    } catch {
      // skip malformed line
    }
  }
  cache = { mtimeMs: mtime, map: new Map(map) };
  return map;
}

function appendJob(job: Job): void {
  ensureDir();
  appendFileSync(jobsFile(), JSON.stringify(job) + "\n", "utf8");
  cache = null;
}

export function newJobId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function registerJob(args: {
  id?: string;
  kind: JobKind;
  label: string;
  target: string;
  caller: Job["caller"];
}): string {
  const id = args.id ?? newJobId();
  const job: Job = {
    id,
    kind: args.kind,
    label: args.label,
    target: args.target,
    status: "queued",
    startedAt: new Date().toISOString(),
    completedAt: null,
    progress: null,
    resultUrl: null,
    error: null,
    caller: args.caller,
  };
  appendJob(job);
  return id;
}

export function updateJob(id: string, patch: Partial<Job>): void {
  const map = loadAllJobs();
  const cur = map.get(id);
  if (!cur) return;
  const next: Job = { ...cur, ...patch };
  appendJob(next);
}

export function completeJob(id: string, resultUrl: string | null = null): void {
  updateJob(id, {
    status: "done",
    completedAt: new Date().toISOString(),
    resultUrl,
    progress: null,
  });
}

export function failJob(id: string, error: string): void {
  updateJob(id, {
    status: "error",
    completedAt: new Date().toISOString(),
    error,
    progress: null,
  });
}

export function listRecentJobs(limit = 30): Job[] {
  const map = loadAllJobs();
  // Mark any "running" jobs whose startedAt is older than 30 minutes as
  // interrupted — these are leftover from a server restart.
  const now = Date.now();
  for (const [id, j] of map) {
    if (j.status === "running" || j.status === "queued") {
      const ageMs = now - Date.parse(j.startedAt);
      if (ageMs > 30 * 60_000) {
        map.set(id, { ...j, status: "error", error: "interrupted (server restart)" });
      }
    }
  }
  const all = Array.from(map.values());
  // Sort: active first (queued/running by startedAt desc), then completed by completedAt desc.
  all.sort((a, b) => {
    const aActive = a.status === "queued" || a.status === "running";
    const bActive = b.status === "queued" || b.status === "running";
    if (aActive !== bActive) return aActive ? -1 : 1;
    const aTs = aActive
      ? Date.parse(a.startedAt)
      : Date.parse(a.completedAt ?? a.startedAt);
    const bTs = bActive
      ? Date.parse(b.startedAt)
      : Date.parse(b.completedAt ?? b.startedAt);
    return bTs - aTs;
  });
  return all.slice(0, limit);
}

export function getJob(id: string): Job | null {
  return loadAllJobs().get(id) ?? null;
}
