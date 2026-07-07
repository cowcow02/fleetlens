/**
 * Artifact-authoring probe.
 *
 * Walks the personal machine's Claude config trees + the current working
 * project's `.claude/` dir to detect:
 *   - new skill files (`.claude/skills/*.md`) authored today
 *   - new sub-agent definitions (`.claude/agents/*.md`)
 *   - new slash commands (`.claude/commands/*.md`)
 *   - line-delta to CLAUDE.md authored by this member
 *
 * Outputs `DayArtifactSignals` for shipping in the daily ingest payload.
 *
 * Privacy: only counts and SHA-256 hashes of paths relative to the .claude
 * root leave the machine. Never the file content; never the raw path.
 *
 * The probe is intentionally idempotent and side-effect-free: calling it
 * twice on the same day produces the same output. Daemon callers can run
 * it on each push tick without worry.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import type { DayArtifactSignals } from "@claude-lens/parser/fs";

export type ProbeOptions = {
  /** Member's git author email — used to attribute CLAUDE.md edits in `git log`. */
  authorEmail?: string;
  /** Local day in YYYY-MM-DD; defaults to today. */
  day?: string;
  /** Extra `.claude/` roots beyond ~/.claude (e.g., active project dir). */
  extraRoots?: string[];
};

/** Compute a stable 32-char hash of a path string. Stable across machines
 *  because we hash the path *relative to the .claude root*, not absolute. */
export function pathHash(relPath: string): string {
  return createHash("sha256").update(relPath.split(sep).join("/")).digest("hex").slice(0, 32);
}

type ScanRoot = {
  /** Absolute filesystem path of the .claude root being scanned. */
  root: string;
  /** Label used for hashing — distinguishes user-global from project-local
   *  skills so identically-named files in different roots map to different
   *  catalog entries. */
  label: "user" | "project";
};

function defaultScanRoots(extraRoots: string[] = []): ScanRoot[] {
  const roots: ScanRoot[] = [];
  const home = join(homedir(), ".claude");
  if (existsSync(home)) roots.push({ root: home, label: "user" });
  for (const e of extraRoots) {
    const r = resolve(e, ".claude");
    if (existsSync(r) && r !== home) roots.push({ root: r, label: "project" });
  }
  return roots;
}

function listMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return []; }
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      out.push(...listMarkdownFiles(full));
    } else if (stat.isFile() && name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function firstSeenDateOf(file: string): string {
  // Prefer git's first-seen date (member-authoritative). Fall back to the
  // file's birthtime, which on macOS/Linux is created-at. The fallback keeps
  // the probe useful even outside a git repo.
  try {
    const out = execFileSync(
      "git",
      ["log", "--diff-filter=A", "--follow", "--format=%cs", "--", file],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], cwd: dirname(file) },
    ).trim().split("\n").filter(Boolean);
    if (out.length > 0) return out[out.length - 1]!; // earliest add
  } catch {
    // not in a git repo, or git missing
  }
  try {
    const s = statSync(file);
    // LOCAL day — git's %cs above is committer-local, and rollup days are
    // local everywhere else. toISOString() (UTC) drifted a day for any
    // activity within the UTC offset of midnight.
    return localDay(s.birthtime || s.mtime);
  } catch {
    return todayLocal();
  }
}

function dirname(p: string): string {
  const i = p.lastIndexOf(sep);
  return i < 0 ? "." : p.slice(0, i);
}

/** Read `git config user.email`. Best-effort; null when git isn't installed
 *  or we're not in a repo. */
function detectGitEmail(cwd: string): string | null {
  try {
    return execFileSync("git", ["config", "user.email"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      cwd,
    }).trim() || null;
  } catch {
    return null;
  }
}

function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayLocal(): string {
  return localDay(new Date());
}

/** Detect files newly authored on `day`. A file is "authored today" if its
 *  first-seen date equals `day`. Editing an existing file doesn't qualify
 *  here — that flows through `skillsEdited` instead. */
function scanAuthored(
  roots: ScanRoot[],
  subdir: "skills" | "agents" | "commands",
  day: string,
): { pathHash: string; firstSeenDate: string }[] {
  const out: { pathHash: string; firstSeenDate: string }[] = [];
  for (const r of roots) {
    const dir = join(r.root, subdir);
    if (!existsSync(dir)) continue;
    for (const f of listMarkdownFiles(dir)) {
      const firstSeen = firstSeenDateOf(f);
      if (firstSeen !== day) continue;
      const rel = relative(dir, f);
      out.push({ pathHash: pathHash(`${r.label}:${subdir}:${rel}`), firstSeenDate: firstSeen });
    }
  }
  return out;
}

/** Detect skill files edited today (not newly authored — those go in
 *  `skillsAuthored`). Returns mtimes-checked candidates; `lineDelta`
 *  defaults to 0 when we can't read it cheaply. */
function scanEdited(
  roots: ScanRoot[],
  day: string,
): { pathHash: string; lineDelta: number }[] {
  const out: { pathHash: string; lineDelta: number }[] = [];
  for (const r of roots) {
    const dir = join(r.root, "skills");
    if (!existsSync(dir)) continue;
    for (const f of listMarkdownFiles(dir)) {
      const firstSeen = firstSeenDateOf(f);
      if (firstSeen === day) continue; // already counted as authored
      let stat;
      try { stat = statSync(f); } catch { continue; }
      const mtimeDay = localDay(stat.mtime);
      if (mtimeDay !== day) continue;
      const rel = relative(dir, f);
      out.push({ pathHash: pathHash(`${r.label}:skills:${rel}`), lineDelta: 0 });
    }
  }
  return out;
}

/** Compute the net line delta to CLAUDE.md authored by this member on `day`.
 *  Uses `git log --numstat` and filters in JS rather than via `--author=` and
 *  `--since=` — both of those are surprisingly brittle (--author does
 *  substring match against the full identity; --since uses the runner's TZ).
 *  We embed `%cs %ae` in the format and do all filtering in JS.
 *
 *  When `authorEmail` is null, we accept all commits to CLAUDE.md in the
 *  given day — appropriate for the personal probe where the only person
 *  committing on this machine is the member. */
function claudemdLineDelta(extraRoots: string[], authorEmail: string | undefined, day: string): number {
  let delta = 0;
  const candidates: string[] = [];
  for (const e of extraRoots) {
    const f = resolve(e, "CLAUDE.md");
    if (existsSync(f)) candidates.push(f);
  }
  const homeClaudeMd = join(homedir(), "CLAUDE.md");
  if (existsSync(homeClaudeMd)) candidates.push(homeClaudeMd);
  for (const file of candidates) {
    try {
      const out = execFileSync(
        "git",
        ["log", "--numstat", "--format=COMMIT %cs %ae", "--", file],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], cwd: dirname(file) },
      );
      let currentDate = "";
      let currentEmail = "";
      for (const line of out.split("\n")) {
        if (line.startsWith("COMMIT ")) {
          const parts = line.slice("COMMIT ".length).trim().split(/\s+/);
          currentDate = parts[0] ?? "";
          currentEmail = parts.slice(1).join(" ");
        } else if (currentDate === day && line.trim().length > 0) {
          if (authorEmail && currentEmail !== authorEmail) continue;
          const parts = line.split(/\s+/);
          const added = Number(parts[0]);
          const removed = Number(parts[1]);
          if (Number.isFinite(added) && Number.isFinite(removed)) {
            delta += added - removed;
          }
        }
      }
    } catch {
      // ignore — not a git repo, or git unavailable
    }
  }
  return delta;
}

/** Run the probe. Returns null when there's nothing to ship (all-zero
 *  result) — callers may skip the `artifactSignals` field on idle days.
 *
 *  Note: CLAUDE.md detection runs even when no `.claude/` roots exist —
 *  CLAUDE.md lives at the project root, not inside `.claude/`, so it's a
 *  separate signal from the skills/agents/commands scans. */
export function probeArtifactSignals(opts: ProbeOptions = {}): DayArtifactSignals | null {
  const day = opts.day ?? todayLocal();
  const roots = defaultScanRoots(opts.extraRoots);
  const skillsAuthored = scanAuthored(roots, "skills", day);
  const subagentsAuthored = scanAuthored(roots, "agents", day);
  const slashCommandsAuthored = scanAuthored(roots, "commands", day);
  const skillsEdited = scanEdited(roots, day);
  const authorEmail =
    opts.authorEmail ?? detectGitEmail(opts.extraRoots?.[0] ?? process.cwd()) ?? undefined;
  const claudemd = claudemdLineDelta(opts.extraRoots ?? [], authorEmail, day);
  const empty =
    skillsAuthored.length === 0 &&
    subagentsAuthored.length === 0 &&
    slashCommandsAuthored.length === 0 &&
    skillsEdited.length === 0 &&
    claudemd === 0;
  if (empty) return null;
  return {
    skillsAuthored,
    skillsEdited,
    subagentsAuthored,
    slashCommandsAuthored,
    claudemdLineDelta: claudemd,
  };
}
