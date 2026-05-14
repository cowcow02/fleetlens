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

/** Drive `claude` under a detached tmux session so the resulting JSONL
 *  carries `entrypoint: cli`. Returns the assistant text + token usage
 *  by tailing the transcript Claude Code writes to
 *  `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`. */
export async function runClaudeUnderTmux(args: TmuxRunArgs): Promise<LLMResponse> {
  const tmuxBin = args.tmuxBin ?? which("tmux");
  if (!tmuxBin) throw new TmuxUnavailableError("tmux not on PATH");
  const claudeBin = args.claudeBin ?? which("claude");
  if (!claudeBin) throw new TmuxUnavailableError("claude not on PATH");

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
      `  --append-system-prompt "$SYS" \\\n` +
      `  "$USR"\n`,
    { mode: 0o755 },
  );

  // Snapshot existing transcripts so we can identify the new one this run
  // will produce.
  const projectDir = projectDirForCwd(cwd);
  const existingBefore = listJsonlFiles(projectDir);

  const spawn = spawnSync(
    tmuxBin,
    ["new-session", "-d", "-s", sessionName, "-x", "140", "-y", "50", "-c", cwd, wrapper],
    { encoding: "utf8" },
  );
  if (spawn.status !== 0) {
    cleanup(cwd, runId, tmuxBin, sessionName);
    throw new TmuxRunError(`tmux new-session failed: ${spawn.stderr.trim()}`);
  }
  if (process.env.FLEETLENS_TMUX_DEBUG === "1") {
    console.error(`[tmux-runner] spawned session=${sessionName} cwd=${cwd} projectDir=${projectDir}`);
    console.error(`[tmux-runner] existing JSONLs before run: ${existingBefore.size}`);
  }

  const startMs = Date.now();
  const timeoutMs = args.timeoutMs ?? 120_000;
  let lastReportedKb = -1;
  let lastEmittedLength = 0;
  let assembled = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let modelUsed = args.model;

  try {
    const transcriptPath = await pollForNewJsonl(projectDir, existingBefore, startMs, timeoutMs);

    while (Date.now() - startMs < timeoutMs) {
      const lines = safeReadLines(transcriptPath);
      let assistantDone = false;
      assembled = "";
      inputTokens = 0;
      outputTokens = 0;
      for (const raw of lines) {
        let o: Record<string, unknown>;
        try { o = JSON.parse(raw) as Record<string, unknown>; } catch { continue; }
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
          assistantDone = true;
        }
      }

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
      if (assistantDone && assembled.length > 0) {
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
    cleanup(cwd, runId, tmuxBin, sessionName);
  }
}

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Claude Code encodes cwd by replacing every `/` and `.` with `-`. */
function encodeCwd(cwd: string): string {
  return cwd.replace(/[\/.]/g, "-");
}

function projectDirForCwd(cwd: string): string {
  return join(homedir(), ".claude", "projects", encodeCwd(cwd));
}

function listJsonlFiles(dir: string): Set<string> {
  if (!existsSync(dir)) return new Set();
  try {
    return new Set(readdirSync(dir).filter((f) => f.endsWith(".jsonl")));
  } catch {
    return new Set();
  }
}

async function pollForNewJsonl(
  dir: string,
  existingBefore: Set<string>,
  startMs: number,
  timeoutMs: number,
): Promise<string> {
  let attempts = 0;
  while (Date.now() - startMs < timeoutMs) {
    const now = listJsonlFiles(dir);
    for (const f of now) {
      if (!existingBefore.has(f)) return join(dir, f);
    }
    attempts++;
    if (process.env.FLEETLENS_TMUX_DEBUG === "1" && attempts % 10 === 0) {
      console.error(`[tmux-runner] poll attempt ${attempts}: ${now.size} jsonls in ${dir}`);
    }
    await sleep(300);
  }
  throw new TmuxRunError(`timeout waiting for claude to create the session transcript (poll dir: ${dir})`);
}

function safeReadLines(path: string): string[] {
  try {
    return readFileSync(path, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function cleanup(cwd: string, runId: string, tmuxBin: string, sessionName: string): void {
  try { spawnSync(tmuxBin, ["kill-session", "-t", sessionName], { stdio: "ignore" }); } catch {}
  if (process.env.FLEETLENS_TMUX_KEEP_WRAPPER !== "1") {
    for (const f of [`system-${runId}.txt`, `user-${runId}.txt`, `run-${runId}.sh`]) {
      try { unlinkSync(join(cwd, f)); } catch {}
    }
  }
}

/** POSIX-safe single-quote escape. */
function shellEscape(s: string): string {
  if (/^[A-Za-z0-9_./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}
