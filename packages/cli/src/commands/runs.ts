import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { cclensPath } from "@claude-lens/parser/fs";

/**
 * `fleetlens runs` — inspect live LLM call activity + recent token spend.
 *
 * Modes:
 *   (default)              snapshot of active runs + recent spend
 *   --watch                live snapshot, redraw every 2s
 *   --inspect <run_id>     dump a specific run's full event timeline
 *                          (or "latest" for the most recent run)
 *   --follow               with --inspect, tail new events as they arrive
 *
 * Sources:
 *   - `ps` for currently-running `claude -p` subprocesses
 *   - `~/.cclens/llm-spend.jsonl` for completed-call totals
 *   - `~/.cclens/llm-runs/<run_id>.jsonl` for per-run event traces
 */
export async function runs(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const watch = args.includes("--watch");
  const follow = args.includes("--follow");
  const sinceIdx = args.indexOf("--since");
  const sinceArg = sinceIdx >= 0 ? args[sinceIdx + 1] : null;
  const inspectIdx = args.indexOf("--inspect");
  const inspectArg = inspectIdx >= 0 ? args[inspectIdx + 1] : null;

  if (inspectArg) {
    return inspect(inspectArg, follow, json);
  }

  const sinceMs = parseSince(sinceArg ?? "24h");

  if (watch) {
    if (json) {
      console.error("--json and --watch are mutually exclusive");
      process.exit(2);
    }
    process.stdout.write("\x1B[?25l");
    process.on("SIGINT", () => {
      process.stdout.write("\x1B[?25h\n");
      process.exit(0);
    });
    while (true) {
      const snap = collect(sinceMs);
      process.stdout.write("\x1B[2J\x1B[H");
      printText(snap);
      console.log("\n  refreshing every 2s · ^C to quit");
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const snap = collect(sinceMs);
  if (json) {
    console.log(JSON.stringify(snap, null, 2));
  } else {
    printText(snap);
  }
}

// ── Data shape ───────────────────────────────────────────────────────────

type ActiveRun = {
  pid: number;
  kind: string;
  model: string;
  /** Seconds since this process started. */
  elapsed_s: number;
  /** Total CPU time used (mostly tracks output-streaming progress). */
  cpu_time: string;
};

type CompletedRun = {
  ts: string;
  kind: string;
  ref: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
};

type Totals = {
  ops: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
};

type RunsSnapshot = {
  generated_at: string;
  active: ActiveRun[];
  completed_since_ms: number;
  completed: CompletedRun[];
  totals: Totals;
  by_kind: Record<string, Totals>;
};

// ── Active-run detection (from ps) ───────────────────────────────────────

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

/** Parse `ps -o etime` output to seconds. Format on Linux/macOS is one of:
 *   MM:SS                — under an hour
 *   HH:MM:SS             — under a day
 *   DD-HH:MM:SS          — multi-day */
function etimeToSec(s: string): number {
  const m = s.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return 0;
  const [, dStr, hStr, mStr, secStr] = m;
  const d = Number(dStr ?? 0);
  const h = Number(hStr ?? 0);
  const min = Number(mStr ?? 0);
  const sec = Number(secStr ?? 0);
  return d * 86400 + h * 3600 + min * 60 + sec;
}

function listActiveRuns(): ActiveRun[] {
  // `etime` is portable across macOS + Linux; `etimes` (seconds) is
  // Linux-only and errors out on Darwin.
  let out: string;
  try {
    out = execSync("ps -axww -o pid,etime,time,command", { encoding: "utf-8" });
  } catch {
    return [];
  }
  const runs: ActiveRun[] = [];
  for (const line of out.split("\n")) {
    if (!line.includes("claude -p")) continue;
    if (!line.includes("--append-system-prompt")) continue;
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

// ── Spend log reader ─────────────────────────────────────────────────────

const SPEND_PATH = cclensPath("llm-spend.jsonl");

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
    } catch {
      // skip malformed line
    }
  }
  return out;
}

// ── Snapshot composer ────────────────────────────────────────────────────

function collect(sinceMs: number): RunsSnapshot {
  const active = listActiveRuns();
  const completed = readSpend(sinceMs);
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
  return {
    generated_at: new Date().toISOString(),
    active,
    completed_since_ms: sinceMs,
    completed,
    totals,
    by_kind: byKind,
  };
}

// ── Text printer ─────────────────────────────────────────────────────────

function fmtElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${(s % 60).toString().padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60).toString().padStart(2, "0")}m`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function printText(snap: RunsSnapshot): void {
  // ── Active runs ──
  console.log("Active LLM calls");
  console.log("─".repeat(64));
  if (snap.active.length === 0) {
    console.log("  (none)");
  } else {
    console.log(`  ${"PID".padEnd(7)}${"KIND".padEnd(15)}${"MODEL".padEnd(8)}${"ELAPSED".padEnd(10)}CPU TIME`);
    for (const r of snap.active) {
      console.log(`  ${String(r.pid).padEnd(7)}${r.kind.padEnd(15)}${r.model.padEnd(8)}${fmtElapsed(r.elapsed_s).padEnd(10)}${r.cpu_time}`);
    }
  }

  // ── Recent spend totals ──
  const sinceLabel = ageLabel(Date.now() - snap.completed_since_ms);
  console.log(`\nCompleted in last ${sinceLabel}`);
  console.log("─".repeat(64));
  console.log(`  ${snap.totals.ops} calls · in=${fmtTokens(snap.totals.input_tokens)} out=${fmtTokens(snap.totals.output_tokens)} · $${snap.totals.cost_usd.toFixed(4)}`);

  if (Object.keys(snap.by_kind).length > 0) {
    console.log();
    console.log(`  ${"KIND".padEnd(15)}${"OPS".padEnd(7)}${"INPUT".padEnd(11)}${"OUTPUT".padEnd(11)}COST`);
    const kinds = Object.entries(snap.by_kind).sort((a, b) => b[1].cost_usd - a[1].cost_usd);
    for (const [k, t] of kinds) {
      console.log(`  ${k.padEnd(15)}${String(t.ops).padEnd(7)}${fmtTokens(t.input_tokens).padEnd(11)}${fmtTokens(t.output_tokens).padEnd(11)}$${t.cost_usd.toFixed(4)}`);
    }
  }

  // ── Recent calls (last 5) ──
  if (snap.completed.length > 0) {
    console.log("\nRecent completions");
    console.log("─".repeat(64));
    const recent = [...snap.completed].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, 5);
    for (const r of recent) {
      const t = new Date(r.ts).toLocaleTimeString("en-US", { hour12: false });
      const ref = r.ref.length > 28 ? `${r.ref.slice(0, 25)}…` : r.ref;
      console.log(`  ${t}  ${r.kind.padEnd(15)}${ref.padEnd(30)}out=${fmtTokens(r.output_tokens).padStart(7)}  $${r.cost_usd.toFixed(4)}`);
    }
  }

  // ── Trace files (latest 5) — for --inspect targeting ──
  const traces = listTraceFiles().slice(0, 5);
  if (traces.length > 0) {
    console.log("\nLatest trace files (run --inspect <run_id> to view)");
    console.log("─".repeat(64));
    for (const t of traces) {
      const age = Math.floor((Date.now() - t.mtimeMs) / 1000);
      const ageStr = age < 60 ? `${age}s` : age < 3600 ? `${Math.floor(age / 60)}m` : `${Math.floor(age / 3600)}h`;
      console.log(`  ${ageStr.padEnd(6)}  ${t.runId}`);
    }
    console.log("\n  example: fleetlens runs --inspect latest --follow");
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function parseSince(s: string): number {
  // Accepts "24h", "30m", "7d", or an ISO timestamp.
  const m = s.match(/^(\d+)([smhd])$/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    const mult = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
    return Date.now() - n * mult;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return t;
  // Default fallback: 24h
  return Date.now() - 24 * 3_600_000;
}

function ageLabel(ms: number): string {
  if (ms < 60_000) return "1m";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

// ── Trace-file readers + inspect command ─────────────────────────────────

const RUNS_DIR = cclensPath("llm-runs");

function listTraceFiles(): { runId: string; path: string; mtimeMs: number }[] {
  if (!existsSync(RUNS_DIR)) return [];
  const entries = readdirSync(RUNS_DIR).filter(f => f.endsWith(".jsonl"));
  return entries.map(f => {
    const path = join(RUNS_DIR, f);
    const st = statSync(path);
    return { runId: f.replace(/\.jsonl$/, ""), path, mtimeMs: st.mtimeMs };
  }).sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function resolveRunId(arg: string): { runId: string; path: string } | null {
  if (!existsSync(RUNS_DIR)) return null;
  if (arg === "latest") {
    const all = listTraceFiles();
    if (all.length === 0) return null;
    return { runId: all[0]!.runId, path: all[0]!.path };
  }
  // Exact match by run_id (or file basename)
  const exact = join(RUNS_DIR, `${arg}.jsonl`);
  if (existsSync(exact)) return { runId: arg, path: exact };
  // Prefix match — useful for short forms
  const all = listTraceFiles();
  const matches = all.filter(r => r.runId.includes(arg));
  if (matches.length === 1) return { runId: matches[0]!.runId, path: matches[0]!.path };
  if (matches.length > 1) {
    console.error(`ambiguous: ${matches.length} runs match "${arg}":`);
    for (const m of matches.slice(0, 5)) console.error(`  ${m.runId}`);
    return null;
  }
  return null;
}

function readTrace(path: string): unknown[] {
  return readFileSync(path, "utf-8").split("\n").filter(l => l.trim()).map(l => {
    try { return JSON.parse(l); } catch { return { _raw: l }; }
  });
}

async function inspect(arg: string, follow: boolean, json: boolean): Promise<void> {
  const r = resolveRunId(arg);
  if (!r) {
    console.error(`run not found: ${arg}`);
    if (existsSync(RUNS_DIR)) {
      const all = listTraceFiles().slice(0, 5);
      if (all.length > 0) {
        console.error(`\nrecent runs:`);
        for (const x of all) console.error(`  ${x.runId}`);
      }
    } else {
      console.error(`(no trace dir at ${RUNS_DIR})`);
    }
    process.exit(2);
  }

  if (json) {
    const events = readTrace(r.path);
    console.log(JSON.stringify({ run_id: r.runId, events }, null, 2));
    return;
  }

  // Human-readable timeline + optional follow
  const events = readTrace(r.path);
  printTrace(r.runId, events);
  if (!follow) return;

  // Follow mode: re-print only the new tail when the file grows.
  let lastSize = statSync(r.path).size;
  let lastIdx = events.length;
  console.log("\n  ⟶ following · ^C to quit\n");
  process.on("SIGINT", () => process.exit(0));
  // Use chokidar-free watch: poll mtime every 500ms.
  while (true) {
    await new Promise(res => setTimeout(res, 500));
    const st = statSync(r.path);
    if (st.size === lastSize) continue;
    lastSize = st.size;
    const all = readTrace(r.path);
    const newOnes = all.slice(lastIdx);
    lastIdx = all.length;
    for (const ev of newOnes) printTraceEvent(ev as Record<string, unknown>);
    // If end record arrived, stop following.
    if (newOnes.some(e => (e as { _meta?: { type?: string } })._meta?.type === "end")) {
      console.log("\n  ⟶ run completed");
      return;
    }
  }
}

function printTrace(runId: string, events: unknown[]): void {
  console.log(`Run ${runId}`);
  console.log("─".repeat(76));
  for (const ev of events) printTraceEvent(ev as Record<string, unknown>);
}

function printTraceEvent(ev: Record<string, unknown>): void {
  const meta = ev._meta as Record<string, unknown> | undefined;
  if (meta) {
    const mtype = meta.type as string;
    if (mtype === "start") {
      console.log(`  [${(meta.ts as string ?? "").slice(11, 19)}] START   kind=${meta.kind}  model=${meta.model}  user_chars=${meta.user_prompt_chars}`);
    } else if (mtype === "spawned") {
      console.log(`  [        ] PID ${meta.pid}`);
    } else if (mtype === "end") {
      const elapsed = (meta.elapsed_ms as number) / 1000;
      console.log(`  [${(meta.ts as string ?? "").slice(11, 19)}] END     exit=${meta.exit_code}  elapsed=${elapsed.toFixed(1)}s  output=${meta.content_chars} chars  in=${meta.input_tokens} out=${meta.output_tokens}`);
      if (meta.stderr_tail) {
        console.log(`             stderr: ${(meta.stderr_tail as string).slice(0, 200)}`);
      }
    } else if (mtype === "spawn_error") {
      console.log(`  [${(meta.ts as string ?? "").slice(11, 19)}] SPAWN_ERROR  ${meta.error}`);
    }
    return;
  }
  // claude stream-json events
  const t = ev.type as string;
  if (t === "system" && ev.subtype === "init") {
    console.log(`  · system init`);
    return;
  }
  if (t === "assistant") {
    const msg = ev.message as { content?: Array<Record<string, unknown>> } | undefined;
    if (msg?.content) {
      for (const block of msg.content) {
        if (block.type === "text" && typeof block.text === "string") {
          const chars = block.text.length;
          const preview = block.text.replace(/\s+/g, " ").slice(0, 100);
          console.log(`  · text (${chars} chars): ${preview}${block.text.length > 100 ? "…" : ""}`);
        } else if (block.type === "tool_use") {
          console.log(`  · tool_use: ${block.name ?? "?"}`);
        }
      }
    }
    return;
  }
  if (t === "result") {
    const usage = ev.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    if (usage) console.log(`  · result: in=${usage.input_tokens} out=${usage.output_tokens}`);
    else console.log(`  · result`);
    return;
  }
  // Unknown / passthrough — terse one-liner
  console.log(`  · ${t ?? "raw"}`);
}
