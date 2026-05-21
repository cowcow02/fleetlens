import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  realpathSync,
  readFileSync,
  unlinkSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import type { LLMResponse } from "./enrich.js";

export type TmuxRunArgs = {
  systemPrompt: string;
  model: string;
  userPrompt: string;
  reminder?: string;
  /** Hard ceiling on how long we'll wait for an assistant turn to complete. */
  timeoutMs?: number;
  /** Override the claude binary path. Defaults to PATH resolution. */
  claudeBin?: string;
  /** Override the tmux binary path. Defaults to PATH resolution. */
  tmuxBin?: string;
  /** Optional progress callback, fired as response text grows. */
  onProgress?: (info: { bytes: number; elapsedMs: number }) => void;
  /** Optional streaming-text callback, fires once per newly-appended slice
   *  of assistant text. Use this when the caller wants SSE-style deltas. */
  onDelta?: (chunk: string) => void;
  /** Optional abort signal. When fired, the tmux session is killed and the
   *  call rejects with TmuxRunError. Used by /api/ask to drop tmux on
   *  client disconnect so we don't keep burning tokens. */
  signal?: AbortSignal;
};

export class TmuxUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TmuxUnavailableError";
  }
}

export class TmuxRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TmuxRunError";
  }
}

/** Resolve a binary on PATH, returning undefined if missing. */
function which(bin: string): string | undefined {
  const r = spawnSync("/usr/bin/env", ["which", bin], { encoding: "utf8" });
  if (r.status === 0) return r.stdout.trim() || undefined;
  return undefined;
}

/** Probe for tmux + claude. Cheap — call at boot to pick a runtime path. */
export function tmuxRunnerAvailable(): { ok: true } | { ok: false; reason: string } {
  if (!which("tmux")) return { ok: false, reason: "tmux not on PATH" };
  if (!which("claude")) return { ok: false, reason: "claude not on PATH" };
  return { ok: true };
}

/** Shared runtime cwd. All tmux runs spawn here so we only mark one
 *  folder trusted in ~/.claude.json. */
function runtimeCwd(): string {
  const dir = join(homedir(), ".cclens", "runtime");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return realpathSync(dir);
}

/** Mark the runtime cwd as trusted in the user's global Claude Code config
 *  so the workspace-trust dialog doesn't intercept the first prompt. Safe
 *  no-op when the entry is already present. */
function ensureRuntimeCwdTrusted(cwd: string): void {
  const cfgPath = join(homedir(), ".claude.json");
  let cfg: Record<string, unknown>;
  try { cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>; }
  catch { return; }

  const projects = (cfg.projects ?? {}) as Record<string, Record<string, unknown>>;
  const cur = projects[cwd];
  if (cur && cur.hasTrustDialogAccepted === true) return;

  projects[cwd] = {
    ...(cur ?? {}),
    hasTrustDialogAccepted: true,
  };
  cfg.projects = projects;

  // Atomic write via tmp + rename so a concurrent claude reader can't
  // see a half-written file.
  const tmp = `${cfgPath}.cclens-tmp-${process.pid}`;
  try {
    writeFileSync(tmp, JSON.stringify(cfg, null, 2));
    renameSync(tmp, cfgPath);
  } catch {
    try { unlinkSync(tmp); } catch {}
  }
}

// Per-process mutex chain. Concurrent callers serialize through this
// promise so they don't race for the same transcript inside the shared
// runtime cwd. Realistic concurrency profile is low (digest pipelines
// already serialize via pipeline-lock; /api/ask is user-driven), so a
// simple FIFO chain is enough.
let mutex: Promise<unknown> = Promise.resolve();

/** Drive `claude` under a detached tmux session so the resulting JSONL
 *  carries `entrypoint: cli`. Returns the assistant text + token usage
 *  by tailing the transcript Claude Code writes under
 *  `~/.claude/projects/`. Serializes concurrent callers in-process. */
export function runClaudeUnderTmux(args: TmuxRunArgs): Promise<LLMResponse> {
  const next = mutex.then(() => runClaudeUnderTmuxImpl(args));
  // Keep the chain alive across rejections so a single thrown error doesn't
  // block subsequent callers behind a rejected promise.
  mutex = next.catch(() => undefined);
  return next;
}

async function runClaudeUnderTmuxImpl(args: TmuxRunArgs): Promise<LLMResponse> {
  const tmuxBin = args.tmuxBin ?? which("tmux");
  if (!tmuxBin) throw new TmuxUnavailableError("tmux not on PATH");
  const claudeBin = args.claudeBin ?? which("claude");
  if (!claudeBin) throw new TmuxUnavailableError("claude not on PATH");
  if (args.signal?.aborted) throw new TmuxRunError("aborted before spawn");

  const cwd = runtimeCwd();
  ensureRuntimeCwdTrusted(cwd);

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sessionName = `cclens-${runId}`;
  const systemFile = join(cwd, `system-${runId}.txt`);
  const userFile = join(cwd, `user-${runId}.txt`);
  const wrapper = join(cwd, `run-${runId}.sh`);

  // Write prompts to sidecar files so the wrapper can `cat` them. Avoids
  // heredoc-quoting bugs in bash 3.2 (macOS default) when prompt bodies
  // contain unmatched single quotes (e.g. inline `'echo 4'` strings).
  writeFileSync(systemFile, args.systemPrompt);
  writeFileSync(
    userFile,
    args.reminder ? `${args.userPrompt}\n\n---\n\n${args.reminder}` : args.userPrompt,
  );
  writeFileSync(
    wrapper,
    `#!/bin/bash\n` +
      `SYS="$(cat ${shellEscape(systemFile)})"\n` +
      `USR="$(cat ${shellEscape(userFile)})"\n` +
      `exec ${shellEscape(claudeBin)} \\\n` +
      `  --model ${shellEscape(args.model)} \\\n` +
      `  --strict-mcp-config --mcp-config '{"mcpServers":{}}' \\\n` +
      `  --disable-slash-commands \\\n` +
      `  --effort medium \\\n` +
      `  --append-system-prompt "$SYS" \\\n` +
      `  "$USR"\n`,
    { mode: 0o755 },
  );

  // Snapshot every existing transcript across all project dirs. After
  // spawn we look for a *new* file whose first line records our `cwd`
  // — that's robust to whatever encoding Claude Code uses for its
  // directory names.
  const existingBefore = snapshotAllTranscripts();

  const spawn = spawnSync(
    tmuxBin,
    ["new-session", "-d", "-s", sessionName, "-x", "140", "-y", "50", "-c", cwd, wrapper],
    { encoding: "utf8" },
  );
  if (spawn.status !== 0) {
    cleanup(cwd, runId, tmuxBin, sessionName);
    throw new TmuxRunError(`tmux new-session failed: ${spawn.stderr.trim()}`);
  }

  // Honour caller abort by killing the tmux session immediately.
  const onAbort = () => {
    try { spawnSync(tmuxBin, ["kill-session", "-t", sessionName], { stdio: "ignore" }); } catch {}
  };
  args.signal?.addEventListener("abort", onAbort, { once: true });

  const startMs = Date.now();
  const timeoutMs = args.timeoutMs ?? 120_000;
  let lastReportedKb = -1;
  let lastEmittedLength = 0;

  let transcriptPath: string | undefined;
  try {
    transcriptPath = await discoverTranscript(cwd, existingBefore, startMs, timeoutMs, args.signal);

    while (Date.now() - startMs < timeoutMs) {
      if (args.signal?.aborted) throw new TmuxRunError("aborted");
      const { assembled, inputTokens, outputTokens, modelUsed, done } = parseTranscript(transcriptPath, args.model);

      if (args.onProgress) {
        const kb = Math.floor(assembled.length / 1024);
        if (kb > lastReportedKb) {
          lastReportedKb = kb;
          args.onProgress({ bytes: assembled.length, elapsedMs: Date.now() - startMs });
        }
      }
      if (args.onDelta && assembled.length > lastEmittedLength) {
        const chunk = assembled.slice(lastEmittedLength);
        lastEmittedLength = assembled.length;
        try { args.onDelta(chunk); } catch { /* never block on consumer */ }
      }
      if (done && assembled.length > 0) {
        return {
          content: assembled,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          model: modelUsed,
        };
      }
      await sleep(500);
    }
    throw new TmuxRunError(`timeout after ${timeoutMs}ms waiting for assistant turn`);
  } finally {
    args.signal?.removeEventListener("abort", onAbort);
    cleanup(cwd, runId, tmuxBin, sessionName, transcriptPath);
  }
}

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const PROJECTS_ROOT = () => join(homedir(), ".claude", "projects");

/** Set of full paths of every `.jsonl` file under ~/.claude/projects/. */
function snapshotAllTranscripts(): Set<string> {
  const out = new Set<string>();
  const root = PROJECTS_ROOT();
  let subs: string[];
  try { subs = readdirSync(root); } catch { return out; }
  for (const sub of subs) {
    const dir = join(root, sub);
    let files: string[];
    try { files = readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (f.endsWith(".jsonl")) out.add(join(dir, f));
    }
  }
  return out;
}

/** Read the first few non-empty lines of a JSONL and return its `cwd`
 *  field (Claude Code writes it on every meta line). */
export function readJsonlCwd(path: string, maxLines = 8): string | undefined {
  let raw: string;
  try { raw = readFileSync(path, "utf8"); } catch { return undefined; }
  let count = 0;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    count++;
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      if (typeof o.cwd === "string") return o.cwd;
    } catch { /* skip malformed */ }
    if (count >= maxLines) break;
  }
  return undefined;
}

/** Scan ~/.claude/projects/* for a transcript that (a) wasn't in the
 *  pre-spawn snapshot and (b) records the same `cwd` we spawned in. */
async function discoverTranscript(
  targetCwd: string,
  existingBefore: Set<string>,
  startMs: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  while (Date.now() - startMs < timeoutMs) {
    if (signal?.aborted) throw new TmuxRunError("aborted");
    const root = PROJECTS_ROOT();
    let subs: string[];
    try { subs = readdirSync(root); } catch { subs = []; }
    for (const sub of subs) {
      const dir = join(root, sub);
      let files: string[];
      try { files = readdirSync(dir); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith(".jsonl")) continue;
        const full = join(dir, f);
        if (existingBefore.has(full)) continue;
        if (readJsonlCwd(full) === targetCwd) return full;
      }
    }
    await sleep(300);
  }
  throw new TmuxRunError(`timeout waiting for claude to create the session transcript (cwd: ${targetCwd})`);
}

type ParsedTurn = {
  assembled: string;
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
  done: boolean;
};

/** Reassemble the latest assistant turn from a transcript file. */
function parseTranscript(path: string, defaultModel: string): ParsedTurn {
  let raw: string;
  try { raw = readFileSync(path, "utf8"); } catch { return { assembled: "", inputTokens: 0, outputTokens: 0, modelUsed: defaultModel, done: false }; }
  let assembled = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let modelUsed = defaultModel;
  let done = false;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let o: Record<string, unknown>;
    try { o = JSON.parse(t) as Record<string, unknown>; } catch { continue; }
    if (o.type !== "assistant") continue;
    const m = o.message as Record<string, unknown> | undefined;
    if (!m) continue;
    const mm = (m as { model?: string }).model;
    if (mm) modelUsed = mm;
    const content = m.content as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "text" && typeof block.text === "string") {
          assembled += block.text;
        }
      }
    }
    const usage = m.usage as Record<string, unknown> | undefined;
    if (usage) {
      inputTokens =
        num(usage.input_tokens) +
        num(usage.cache_creation_input_tokens) +
        num(usage.cache_read_input_tokens);
      outputTokens = num(usage.output_tokens);
    }
    if ((m as { stop_reason?: string }).stop_reason === "end_turn") {
      done = true;
    }
  }
  return { assembled, inputTokens, outputTokens, modelUsed, done };
}

function cleanup(
  cwd: string,
  runId: string,
  tmuxBin: string,
  sessionName: string,
  transcriptPath?: string,
): void {
  // Kill claude before unlinking its transcript so it can't rewrite the file.
  try { spawnSync(tmuxBin, ["kill-session", "-t", sessionName], { stdio: "ignore" }); } catch {}
  if (process.env.FLEETLENS_TMUX_KEEP_WRAPPER !== "1") {
    // Drop the transcript so our own LLM runs don't surface in the dashboard.
    if (transcriptPath) {
      try { unlinkSync(transcriptPath); } catch {}
    }
    for (const f of [`system-${runId}.txt`, `user-${runId}.txt`, `run-${runId}.sh`]) {
      try { unlinkSync(join(cwd, f)); } catch {}
    }
  }
}

/** POSIX-safe single-quote escape. Exported for unit tests. */
export function shellEscape(s: string): string {
  if (/^[A-Za-z0-9_./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}
