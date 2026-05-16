import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { cclensPath } from "@claude-lens/parser/fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/runs?since=24h
 *
 * Mirrors `fleetlens runs --json`. Returns a snapshot of currently-running
 * LLM subprocesses (week_digest / top_session / day_digest / entry_enrich)
 * plus aggregated token spend in the requested window.
 */

const KIND_MARKERS: Array<{ kind: string; marker: RegExp }> = [
  { kind: "week_digest",  marker: /weekly retrospective writer/i },
  { kind: "top_session",  marker: /editorial perception layer for ONE session/i },
  { kind: "day_digest",   marker: /single local day into a short, honest narrative/i },
  { kind: "entry_enrich", marker: /per[- ]entry|enrich.{0,40}entry|brief_summary/i },
];

function detectKind(cmdline: string): string {
  for (const { kind, marker } of KIND_MARKERS) {
    if (marker.test(cmdline)) return kind;
  }
  return "unknown";
}

function parseModel(cmdline: string): string {
  const m = cmdline.match(/--model\s+(\S+)/);
  return m ? m[1]! : "?";
}

type ActiveRun = {
  pid: number;
  kind: string;
  model: string;
  elapsed_s: number;
  cpu_time: string;
};

function etimeToSec(s: string): number {
  const m = s.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return 0;
  const [, dStr, hStr, mStr, secStr] = m;
  return Number(dStr ?? 0) * 86400 + Number(hStr ?? 0) * 3600 + Number(mStr ?? 0) * 60 + Number(secStr ?? 0);
}

function listActiveRuns(): ActiveRun[] {
  let out: string;
  try {
    out = execSync("ps -axww -o pid,etime,time,command", { encoding: "utf-8" });
  } catch {
    return [];
  }
  const runs: ActiveRun[] = [];
  for (const line of out.split("\n")) {
    // Match both `claude -p` (print mode) and tmux-driven interactive
    // (no `-p`). The shared marker is `--append-system-prompt`, which
    // the LLM-runner pipeline always sets — interactive user sessions
    // launched from a terminal don't carry it.
    if (!line.includes("--append-system-prompt")) continue;
    if (!/\bclaude\b/.test(line)) continue;
    if (line.includes("grep")) continue;
    const m = line.trim().match(/^(\d+)\s+(\S+)\s+([\d:.]+)\s+(.+)$/);
    if (!m) continue;
    const [, pidStr, etimeStr, cputime, command] = m;
    runs.push({
      pid: Number(pidStr),
      kind: detectKind(command!),
      model: parseModel(command!),
      elapsed_s: etimeToSec(etimeStr!),
      cpu_time: cputime!,
    });
  }
  return runs.sort((a, b) => a.elapsed_s - b.elapsed_s);
}

const SPEND_PATH = cclensPath("llm-spend.jsonl");

type CompletedRun = {
  ts: string;
  kind: string;
  ref: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
};

function readSpend(sinceMs: number): CompletedRun[] {
  if (!existsSync(SPEND_PATH)) return [];
  const lines = readFileSync(SPEND_PATH, "utf-8").split("\n").filter(l => l.trim());
  const out: CompletedRun[] = [];
  for (const line of lines) {
    try {
      const r = JSON.parse(line);
      const ts = Date.parse(r.ts);
      if (Number.isNaN(ts) || ts < sinceMs) continue;
      out.push({
        ts: r.ts,
        kind: r.kind ?? "?",
        ref: r.ref ?? "",
        model: r.model ?? "?",
        input_tokens: r.input_tokens ?? 0,
        output_tokens: r.output_tokens ?? 0,
        cost_usd: r.cost_usd ?? 0,
      });
    } catch { /* skip */ }
  }
  return out;
}

function parseSince(s: string | null): number {
  if (!s) return Date.now() - 24 * 3_600_000;
  const m = s.match(/^(\d+)([smhd])$/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    const mult = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
    return Date.now() - n * mult;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return t;
  return Date.now() - 24 * 3_600_000;
}

const RUNS_DIR = cclensPath("llm-runs");

type TraceSummary = {
  run_id: string;
  kind: string;
  model: string;
  pid: number | null;
  started_at: string;
  ended_at: string | null;
  elapsed_ms: number | null;
  exit_code: number | null;
  status: "running" | "ok" | "error" | "unknown";
  content_chars: number | null;
  output_tokens: number | null;
};

function listRecentTraces(limit: number): TraceSummary[] {
  if (!existsSync(RUNS_DIR)) return [];
  const files = readdirSync(RUNS_DIR)
    .filter(f => f.endsWith(".jsonl"))
    .map(f => ({ id: f.replace(/\.jsonl$/, ""), path: join(RUNS_DIR, f), mtime: statSync(join(RUNS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);

  const out: TraceSummary[] = [];
  for (const f of files) {
    let start: { ts?: string; kind?: string; model?: string } | null = null;
    let spawned: { pid?: number } | null = null;
    let end: { ts?: string; elapsed_ms?: number; exit_code?: number; content_chars?: number; output_tokens?: number } | null = null;
    let spawnError: { ts?: string } | null = null;

    try {
      // Read first ~16KB (start + spawned + maybe payload) and last ~4KB (end record)
      const stat = statSync(f.path);
      const headSize = Math.min(16_384, stat.size);
      const tailSize = Math.min(4_096, stat.size);
      const buf = Buffer.alloc(headSize);
      const fd = openSync(f.path, "r");
      try {
        readSync(fd, buf, 0, headSize, 0);
      } finally {
        closeSync(fd);
      }
      const head = buf.toString("utf-8");
      // Parse every _meta record visible in head — start, spawned, AND end /
      // spawn_error. Previously end/spawn_error were only checked in the tail
      // block, which got skipped when the file fit entirely in headSize. That
      // left small completed traces (~10-15KB entry-enrich files) stuck at
      // status="running" forever, even though their end record was already in
      // the head buffer.
      for (const line of head.split("\n")) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line) as { _meta?: { type?: string; ts?: string; kind?: string; model?: string; pid?: number; elapsed_ms?: number; exit_code?: number; content_chars?: number; output_tokens?: number } };
          const t = obj._meta?.type;
          if (t === "start") start = obj._meta!;
          else if (t === "spawned") spawned = obj._meta!;
          else if (t === "end") end = obj._meta!;
          else if (t === "spawn_error") spawnError = obj._meta!;
        } catch { /* skip */ }
      }

      if (!end && !spawnError && stat.size > headSize) {
        const tailBuf = Buffer.alloc(tailSize);
        const fd2 = openSync(f.path, "r");
        try {
          readSync(fd2, tailBuf, 0, tailSize, stat.size - tailSize);
        } finally {
          closeSync(fd2);
        }
        const tail = tailBuf.toString("utf-8");
        for (const line of tail.split("\n").reverse()) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line) as { _meta?: { type?: string; ts?: string; elapsed_ms?: number; exit_code?: number; content_chars?: number; output_tokens?: number } };
            if (obj._meta?.type === "end") { end = obj._meta; break; }
            if (obj._meta?.type === "spawn_error") { spawnError = obj._meta; break; }
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }

    const status: TraceSummary["status"] =
      end ? (end.exit_code === 0 ? "ok" : "error")
        : spawnError ? "error"
          : start ? "running"
            : "unknown";

    out.push({
      run_id: f.id,
      kind: start?.kind ?? "?",
      model: start?.model ?? "?",
      pid: spawned?.pid ?? null,
      started_at: start?.ts ?? "",
      ended_at: end?.ts ?? null,
      elapsed_ms: end?.elapsed_ms ?? null,
      exit_code: end?.exit_code ?? null,
      status,
      content_chars: end?.content_chars ?? null,
      output_tokens: end?.output_tokens ?? null,
    });
  }
  return out;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const sinceMs = parseSince(url.searchParams.get("since"));
  const traceLimit = Number(url.searchParams.get("trace_limit") ?? "30");
  const active = listActiveRuns();
  const completed = readSpend(sinceMs);
  const traces = listRecentTraces(traceLimit);

  type Totals = { ops: number; input_tokens: number; output_tokens: number; cost_usd: number };
  const totals: Totals = { ops: completed.length, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
  const byKind: Record<string, Totals> = {};
  for (const r of completed) {
    totals.input_tokens += r.input_tokens;
    totals.output_tokens += r.output_tokens;
    totals.cost_usd += r.cost_usd;
    const k = byKind[r.kind] ?? { ops: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
    k.ops += 1;
    k.input_tokens += r.input_tokens;
    k.output_tokens += r.output_tokens;
    k.cost_usd += r.cost_usd;
    byKind[r.kind] = k;
  }

  return new Response(JSON.stringify({
    generated_at: new Date().toISOString(),
    active,
    completed_since_ms: sinceMs,
    totals,
    by_kind: byKind,
    completed,
    traces,
  }, null, 2), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
