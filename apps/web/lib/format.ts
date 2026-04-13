/** Shared formatting helpers for the UI. */

export function shortId(id: string): string {
  if (id.length <= 10) return id;
  return id.slice(0, 6) + "…" + id.slice(-4);
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1) + "k";
  if (n < 1_000_000) return Math.round(n / 1000) + "k";
  if (n < 10_000_000) return (n / 1_000_000).toFixed(2) + "M";
  return (n / 1_000_000).toFixed(1) + "M";
}

export function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const s = Math.round(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function formatOffset(ms?: number): string {
  if (ms === undefined || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return `${h}:${mm}:${ss}`;
}

export function formatGap(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) {
    const rem = Math.round(s % 60);
    return `${m}m ${rem}s`;
  }
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return remM ? `${h}h ${remM}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `${d}d ${remH}h` : `${d}d`;
}

export function formatDuration(ms?: number): string {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

/**
 * Per-MTok pricing by model family.
 * Sourced from LiteLLM / Anthropic API pricing (as of 2025).
 */
const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  haiku:  { input: 1,  output: 5,  cacheRead: 0.1,  cacheWrite: 1.25 },
  sonnet: { input: 3,  output: 15, cacheRead: 0.3,  cacheWrite: 3.75 },
  opus:   { input: 5,  output: 25, cacheRead: 0.5,  cacheWrite: 6.25 },
};

function modelRate(model?: string) {
  if (!model) return MODEL_PRICING.opus;
  const m = model.toLowerCase();
  if (m.includes("haiku")) return MODEL_PRICING.haiku;
  if (m.includes("sonnet")) return MODEL_PRICING.sonnet;
  return MODEL_PRICING.opus;
}

/**
 * Estimate USD cost from token usage using per-model pricing.
 */
export function estimateCost(
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number },
  model?: string,
): number {
  const r = modelRate(model);
  return (
    (usage.input / 1_000_000) * r.input +
    (usage.output / 1_000_000) * r.output +
    (usage.cacheRead / 1_000_000) * r.cacheRead +
    (usage.cacheWrite / 1_000_000) * r.cacheWrite
  );
}

/**
 * Estimate cost across multiple sessions, using each session's model for pricing.
 */
export function estimateCostMulti(
  sessions: Array<{ totalUsage: { input: number; output: number; cacheRead: number; cacheWrite: number }; model?: string }>,
): number {
  return sessions.reduce((sum, s) => sum + estimateCost(s.totalUsage, s.model), 0);
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return "<$0.01";
  if (usd < 1) return `$${usd.toFixed(2)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  if (usd < 1000) return `$${usd.toFixed(1)}`;
  return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/** URL-safe slug for a project dir. */
export function projectSlug(projectDir: string): string {
  return projectDir;
}

/**
 * Show the last two path segments as the project name.
 * If the result exceeds `maxLen`, prefix with "…".
 *
 * "/Users/me/Repo/kipwise/agentic-knowledge-system" → "kipwise/agentic-knowledge-system"
 * A very long result → "…se/agentic-knowledge-system"
 */
export function prettyProjectName(
  projectName: string,
  maxLen = 35,
): string {
  const parts = projectName.split("/").filter(Boolean);

  // Git worktree paths are `<repo>/.worktrees/<name>`. Showing the last
  // two segments (".worktrees/name") drops the most useful info — which
  // repo the worktree belongs to. Rebuild as `<repo>/<name>` so the
  // worktree reads as "this branch of that repo".
  const wtIdx = parts.lastIndexOf(".worktrees");
  if (wtIdx > 0 && wtIdx < parts.length - 1) {
    const parent = parts[wtIdx - 1]!;
    const worktree = parts[wtIdx + 1]!;
    const name = `${parent}/${worktree}`;
    if (name.length <= maxLen) return name;
    return "…" + name.slice(name.length - maxLen + 1);
  }

  const name =
    parts.length >= 2
      ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
      : parts[parts.length - 1] ?? projectName;
  if (name.length <= maxLen) return name;
  return "…" + name.slice(name.length - maxLen + 1);
}
