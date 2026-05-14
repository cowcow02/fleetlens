import { spawn } from "node:child_process";
import { mkdirSync, appendFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { LLMResponse } from "./enrich.js";
import { cclensPath } from "@claude-lens/parser/fs";
import {
  runClaudeUnderTmux,
  tmuxRunnerAvailable,
  TmuxRunError,
  TmuxUnavailableError,
} from "./tmux-runner.js";

export type RunSubprocessArgs = {
  systemPrompt: string;
  model: string;
  userPrompt: string;
  reminder?: string;
  onProgress?: (info: { bytes: number; elapsedMs: number }) => void;
};

// ── Trace file plumbing ──────────────────────────────────────────────────
// Every claude -p invocation gets a run_id and a per-run JSONL trace under
// cclensHome()/llm-runs/<run_id>.jsonl. First line is a _meta start record;
// subsequent lines are the raw stream-json events from claude verbatim;
// final line is a _meta end record with totals + exit code.

const RUNS_DIR = cclensPath("llm-runs");

function ensureRunsDir(): void {
  if (!existsSync(RUNS_DIR)) {
    try { mkdirSync(RUNS_DIR, { recursive: true }); } catch { /* race ok */ }
  }
}

function detectKindFromSystemPrompt(sp: string): string {
  const head = sp.slice(0, 600).toLowerCase();
  if (head.includes("weekly retrospective writer")) return "week_digest";
  if (head.includes("editorial perception layer for one session")) return "top_session";
  if (head.includes("single local day into a short, honest narrative")) return "day_digest";
  if (head.includes("month") && head.includes("digest")) return "month_digest";
  // Enrichment prompt opens with "analyzing one (session × local-day) slice".
  // Older marker keywords ("brief_summary", "per-entry") aren't in the head,
  // so without this match enrich calls used to land as "unknown".
  if (head.includes("session × local-day") || head.includes("(session × local-day)")) return "entry_enrich";
  if (head.includes("brief_summary") || head.includes("per-entry") || head.includes("per entry")) return "entry_enrich";
  return "unknown";
}

function newRunId(kind: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const short = randomUUID().slice(0, 8);
  return `${ts}_${kind}_${short}`;
}

function tracePath(runId: string): string {
  return join(RUNS_DIR, `${runId}.jsonl`);
}

function safeAppend(path: string, line: string): void {
  try { appendFileSync(path, line); } catch { /* never block the LLM call on a trace write */ }
}

function safeWrite(path: string, line: string): void {
  try { writeFileSync(path, line); } catch { /* same */ }
}

/** Front door for every LLM call in the entries pipeline. Tries the
 *  tmux-driven runner first (sessions written by tmux carry
 *  `entrypoint: cli`), falls back to `claude -p` when tmux/claude isn't
 *  on PATH or the tmux run errors. The `-p` path remains the safety net
 *  so callers always get a response. */
export async function runClaudeSubprocess(args: RunSubprocessArgs): Promise<LLMResponse> {
  if (process.env.FLEETLENS_FORCE_PRINT_MODE !== "1") {
    const avail = tmuxRunnerAvailable();
    if (avail.ok) {
      const startedAt = new Date().toISOString();
      const kind = detectKindFromSystemPrompt(args.systemPrompt);
      const runId = newRunId(kind);
      const trace = tracePath(runId);
      ensureRunsDir();
      safeWrite(trace, JSON.stringify({
        _meta: {
          type: "start", run_id: runId, kind, model: args.model, ts: startedAt,
          runtime: "tmux",
          user_prompt_chars: args.userPrompt.length,
          reminder_chars: args.reminder?.length ?? 0,
        },
      }) + "\n");
      safeAppend(trace, JSON.stringify({
        _meta: {
          type: "payload", run_id: runId,
          system_prompt: args.systemPrompt,
          user_prompt: args.userPrompt,
          reminder: args.reminder ?? null,
        },
      }) + "\n");
      try {
        const startMs = Date.now();
        const res = await runClaudeUnderTmux({
          systemPrompt: args.systemPrompt,
          model: args.model,
          userPrompt: args.userPrompt,
          reminder: args.reminder,
          onProgress: args.onProgress,
        });
        safeAppend(trace, JSON.stringify({
          _meta: {
            type: "end", run_id: runId, runtime: "tmux",
            ts: new Date().toISOString(),
            elapsed_ms: Date.now() - startMs,
            content_chars: res.content.length,
            input_tokens: res.input_tokens,
            output_tokens: res.output_tokens,
            model_used: res.model,
          },
        }) + "\n");
        return res;
      } catch (err) {
        // Either tmux disappeared after the boot probe (unlikely) or the
        // session timed out / fell over. Either way we'd rather degrade
        // to print mode than fail the caller.
        const isExpected = err instanceof TmuxUnavailableError || err instanceof TmuxRunError;
        safeAppend(trace, JSON.stringify({
          _meta: {
            type: "tmux_fallback", run_id: runId,
            ts: new Date().toISOString(),
            error: (err as Error).message,
            expected: isExpected,
          },
        }) + "\n");
        // fall through to print mode
      }
    }
  }
  return runClaudePrintMode(args);
}

/** Spawn `claude -p` with the given system prompt; resolve with the assembled
 *  text + token usage. Tees every stream-json event to a per-run trace file
 *  under ~/.cclens/llm-runs/<run_id>.jsonl so the call can be inspected live
 *  or post-mortem via `fleetlens runs --inspect <run_id>`. */
export function runClaudePrintMode(args: RunSubprocessArgs): Promise<LLMResponse> {
  return new Promise((resolve, reject) => {
    ensureRunsDir();
    const kind = detectKindFromSystemPrompt(args.systemPrompt);
    const runId = newRunId(kind);
    const trace = tracePath(runId);
    const startedAt = new Date().toISOString();

    safeWrite(trace, JSON.stringify({
      _meta: {
        type: "start",
        run_id: runId,
        kind,
        model: args.model,
        ts: startedAt,
        user_prompt_chars: args.userPrompt.length,
        reminder_chars: args.reminder?.length ?? 0,
      },
    }) + "\n");

    // Persist the exact prompts so a stuck or misbehaving call can be diagnosed
    // without re-running. This is local-only; if a future privacy switch is
    // needed, gate via env (FLEETLENS_TRACE_PROMPTS=0). All three are passed
    // verbatim to claude -p (system via --append-system-prompt, user+reminder
    // via stdin separated by "\n\n---\n\n").
    safeAppend(trace, JSON.stringify({
      _meta: {
        type: "payload",
        run_id: runId,
        system_prompt: args.systemPrompt,
        user_prompt: args.userPrompt,
        reminder: args.reminder ?? null,
      },
    }) + "\n");

    const claudeArgs = [
      "-p", "--output-format", "stream-json", "--verbose",
      "--model", args.model, "--tools", "",
      "--disable-slash-commands", "--no-session-persistence",
      "--setting-sources", "",
      // Drop the user's connected MCP manifest from each call. Without these
      // flags, claude -p preloads ~68K cache_creation tokens of tool defs
      // (Slack/Linear/Gmail/etc) per invocation, saturating the 5-hour
      // subscription budget within a few digests. With them: ~6K tokens.
      "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
      // Explicit effort. Sonnet 4.6 defaults to adaptive thinking with no
      // effort param — the model decides per-turn budget, and on structured
      // JSON synthesis it tends to allocate less. "medium" sets an explicit
      // floor without burning budget the way "high" or "xhigh" would.
      "--effort", "medium",
      "--append-system-prompt", args.systemPrompt,
    ];
    const proc = spawn("claude", claudeArgs, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });

    // Update _meta with the spawned PID so the runs CLI can correlate ps output.
    safeAppend(trace, JSON.stringify({ _meta: { type: "spawned", run_id: runId, pid: proc.pid } }) + "\n");

    const stdinPayload = args.reminder ? `${args.userPrompt}\n\n---\n\n${args.reminder}` : args.userPrompt;
    proc.stdin.write(stdinPayload);
    proc.stdin.end();

    let buffer = "", inputTokens = 0, outputTokens = 0, modelUsed = args.model, stderr = "";
    const startMs = Date.now();
    let lastReportedKb = -1;

    proc.stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        const t = line.trim();
        if (!t) continue;
        // Tee verbatim event line to the trace file.
        safeAppend(trace, t + "\n");
        try {
          const obj = JSON.parse(t) as Record<string, unknown>;
          if (obj.type === "assistant") {
            const msg = obj.message as Record<string, unknown> | undefined;
            const content = msg?.content as Array<Record<string, unknown>> | undefined;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === "text" && typeof block.text === "string") {
                  buffer += block.text;
                  if (args.onProgress) {
                    const kb = Math.floor(buffer.length / 1024);
                    if (kb > lastReportedKb) {
                      lastReportedKb = kb;
                      args.onProgress({ bytes: buffer.length, elapsedMs: Date.now() - startMs });
                    }
                  }
                }
              }
            }
            const mm = (msg as { model?: string } | undefined)?.model;
            if (mm) modelUsed = mm;
          }
          if (obj.type === "result") {
            const usage = obj.usage as { input_tokens?: number; output_tokens?: number } | undefined;
            if (usage) {
              inputTokens = usage.input_tokens ?? 0;
              outputTokens = usage.output_tokens ?? 0;
            }
          }
        } catch { /* skip non-JSON framing */ }
      }
    });
    proc.stderr.on("data", (c: Buffer) => { stderr += c.toString("utf8"); });
    proc.on("close", code => {
      const elapsedMs = Date.now() - startMs;
      const endRec = {
        _meta: {
          type: "end", run_id: runId,
          ts: new Date().toISOString(),
          elapsed_ms: elapsedMs,
          exit_code: code,
          content_chars: buffer.length,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          model_used: modelUsed,
          stderr_tail: stderr ? stderr.trim().slice(-500) : null,
        },
      };
      safeAppend(trace, JSON.stringify(endRec) + "\n");

      if (code !== 0 && !buffer) {
        reject(new Error(`claude exited ${code}: ${stderr.trim().slice(0, 300)}`));
        return;
      }
      resolve({ content: buffer, input_tokens: inputTokens, output_tokens: outputTokens, model: modelUsed });
    });
    proc.on("error", err => {
      safeAppend(trace, JSON.stringify({ _meta: { type: "spawn_error", run_id: runId, ts: new Date().toISOString(), error: err.message } }) + "\n");
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** Strip optional ```json fence + JSON.parse + Zod-validate. Used by all three digest synth callers. */
export function parseAndValidate<T>(content: string, schema: z.ZodType<T>): ParseResult<T> {
  const stripped = content.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```\s*$/, "").trim();
  try {
    const parsed = JSON.parse(stripped);
    const r = schema.safeParse(parsed);
    if (r.success) return { ok: true, value: r.data };
    return { ok: false, error: "schema: " + r.error.message };
  } catch (e) {
    return { ok: false, error: "json: " + (e as Error).message };
  }
}
