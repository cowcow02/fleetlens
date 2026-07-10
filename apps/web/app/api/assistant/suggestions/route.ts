/**
 * Personalized empty-state suggestion chips.
 *
 * GET returns the best available set immediately and, when the cache is
 * stale, fires one background haiku call (traced via the entries LLM runner)
 * to regenerate — the client re-fetches while `refreshing` is true.
 *
 * Tiers: cached LLM chips → deterministic template-fill from the search
 * index → static fallback (index empty). AI off ⇒ deterministic only.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cclensPath } from "@claude-lens/parser/fs";
import { interactiveLockFresh, readSettings, runClaudeSubprocess } from "@claude-lens/entries/node";
import { ensureIndex, indexIsEmpty, indexStats, peekDocs } from "@/lib/assistant/index-store";
import {
  FALLBACK_SUGGESTIONS,
  SUGGESTION_SYSTEM_PROMPT,
  buildSuggestionContext,
  deterministicSuggestions,
  parseSuggestions,
  suggestionInputKey,
  type Suggestion,
} from "@/lib/assistant/suggestions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CACHE_TTL_MS = 24 * 3_600_000;

type Cache = {
  version: 1;
  generated_at: string;
  input_key: string;
  model: string;
  suggestions: Suggestion[];
};

function cachePath(): string {
  return cclensPath("assistant-suggestions.json");
}

function readCache(): Cache | null {
  try {
    const c = JSON.parse(readFileSync(cachePath(), "utf8")) as Cache;
    return c.version === 1 && Array.isArray(c.suggestions) && c.suggestions.length === 4 ? c : null;
  } catch {
    return null;
  }
}

function writeCache(c: Cache): void {
  const p = cachePath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(c, null, 2), "utf8");
  renameSync(tmp, p);
}

// Cross-route/cross-compile latch — see the globalThis note in index-store.
type Latch = { refreshing: Promise<void> | null; lastAttemptMs: number };
const latch: Latch = ((globalThis as Record<string, unknown>).__fleetlensAssistantSuggestions ??= {
  refreshing: null,
  lastAttemptMs: 0,
}) as Latch;

/** Minimum spacing between generation attempts. Success short-circuits via
 *  the fresh cache; this floor is what stops a persistently-unparseable
 *  model from being re-spawned by every polling client. */
const RETRY_FLOOR_MS = 5 * 60_000;

function kickRefresh(context: string, inputKey: string): void {
  if (latch.refreshing) return;
  if (Date.now() - latch.lastAttemptMs < RETRY_FLOOR_MS) return;
  // A digest pipeline mid-run owns the LLM budget; suggestions can wait for
  // the next visit rather than pile on.
  if (interactiveLockFresh(Date.now())) return;
  latch.lastAttemptMs = Date.now();
  latch.refreshing = (async () => {
    try {
      const res = await runClaudeSubprocess({
        systemPrompt: SUGGESTION_SYSTEM_PROMPT,
        model: "haiku",
        userPrompt: context,
      });
      const parsed = parseSuggestions(res.content);
      if (parsed) {
        writeCache({
          version: 1,
          generated_at: new Date().toISOString(),
          input_key: inputKey,
          model: res.model,
          suggestions: parsed,
        });
      }
    } catch {
      /* stay on the deterministic tier; next visit retries */
    }
  })().finally(() => {
    latch.refreshing = null;
  });
}

/** Always answers in milliseconds: chips come from cache/memory only. Index
 *  warm-up and LLM generation both happen off the request path; the client
 *  re-fetches while `refreshing` is true. */
export function GET() {
  const cache = readCache();

  // Never trigger the expensive first index build just for chips — the page
  // kicks that off explicitly with visible progress.
  if (indexIsEmpty()) {
    return Response.json({
      suggestions: cache?.suggestions ?? FALLBACK_SUGGESTIONS,
      source: cache ? "llm-stale" : "fallback",
      refreshing: false,
    });
  }

  const docs = peekDocs();
  if (docs.length === 0 || indexStats().building) {
    // Index warming up (or mid-rebuild): serve what we have and DON'T
    // generate — chips written from a partially-filled store describe a
    // user who barely codes. Kick the warm-up if nothing is running.
    if (docs.length === 0) void ensureIndex().catch(() => {});
    return Response.json({
      suggestions: cache?.suggestions ?? (docs.length ? deterministicSuggestions(docs, Date.now()) : FALLBACK_SUGGESTIONS),
      source: cache ? "llm-stale" : "fallback",
      refreshing: true,
    });
  }

  const deterministic = deterministicSuggestions(docs, Date.now());
  if (!readSettings().ai_features.enabled) {
    return Response.json({ suggestions: deterministic, source: "deterministic", refreshing: false });
  }

  const inputKey = suggestionInputKey(docs);
  const cacheFresh =
    cache !== null &&
    cache.input_key === inputKey &&
    Date.now() - Date.parse(cache.generated_at) < CACHE_TTL_MS;

  if (cacheFresh) {
    return Response.json({ suggestions: cache.suggestions, source: "llm", refreshing: false });
  }

  kickRefresh(buildSuggestionContext(docs, Date.now()), inputKey);
  return Response.json({
    // A stale LLM set still beats templates — it was written for this user.
    suggestions: cache?.suggestions ?? deterministic,
    source: cache ? "llm-stale" : "deterministic",
    refreshing: latch.refreshing !== null,
  });
}
