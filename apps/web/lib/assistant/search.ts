import type { IndexDoc, SearchFilters, SearchHit, SearchSnippet } from "./types";

const SNIPPET_RADIUS = 120;
const MAX_SNIPPETS = 3;
const ROLE_WEIGHT: Record<string, number> = { user: 2, summary: 3, agent: 1 };
const TITLE_WEIGHT = 4;
/** Recency half-life: a hit ages to half its score every 60 days. */
const HALF_LIFE_MS = 60 * 86_400_000;

export type ParsedQuery = { terms: string[]; phrases: string[] };

export function parseQuery(q: string): ParsedQuery {
  const phrases: string[] = [];
  const rest = q.replace(/"([^"]+)"/g, (_, p: string) => {
    phrases.push(p.toLowerCase());
    return " ";
  });
  const terms = Array.from(
    new Set(
      rest
        .toLowerCase()
        .split(/[^\p{L}\p{N}_.\/-]+/u)
        .filter((t) => t.length >= 2),
    ),
  );
  return { terms, phrases };
}

function passesFilters(doc: IndexDoc, f?: SearchFilters): boolean {
  if (!f) return true;
  if (f.project && doc.project !== f.project) return false;
  if (f.agent && doc.agent !== f.agent) return false;
  if (f.after && doc.day < f.after) return false;
  if (f.before && doc.day > f.before) return false;
  return true;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let pos = haystack.indexOf(needle);
  while (pos !== -1) {
    count++;
    pos = haystack.indexOf(needle, pos + needle.length);
  }
  return count;
}

function snippetAround(text: string, matchPos: number, matchLen: number): string {
  const start = Math.max(0, matchPos - SNIPPET_RADIUS);
  const end = Math.min(text.length, matchPos + matchLen + SNIPPET_RADIUS);
  const core = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${core}${end < text.length ? "…" : ""}`;
}

export function searchDocs(
  docs: IndexDoc[],
  query: string,
  opts: { filters?: SearchFilters; limit?: number } = {},
): { hits: SearchHit[]; total: number } {
  const { terms, phrases } = parseQuery(query);
  if (terms.length === 0 && phrases.length === 0) return { hits: [], total: 0 };

  const nowMs = Date.now();
  const scored: SearchHit[] = [];

  for (const doc of docs) {
    if (!passesFilters(doc, opts.filters)) continue;

    const titleLower = doc.title.toLowerCase();
    const matched = new Set<string>();
    let score = 0;
    const snippets: SearchSnippet[] = [];

    // Phrases are hard requirements.
    let phrasesOk = true;
    for (const phrase of phrases) {
      let found = false;
      if (titleLower.includes(phrase)) {
        found = true;
        score += TITLE_WEIGHT * 2;
      }
      for (const chunk of doc.chunks) {
        const lower = chunk.text.toLowerCase();
        const pos = lower.indexOf(phrase);
        if (pos === -1) continue;
        found = true;
        score += (ROLE_WEIGHT[chunk.role] ?? 1) * 2;
        if (snippets.length < MAX_SNIPPETS) {
          snippets.push({ role: chunk.role, text: snippetAround(chunk.text, pos, phrase.length) });
        }
      }
      if (!found) {
        phrasesOk = false;
        break;
      }
      matched.add(`"${phrase}"`);
    }
    if (!phrasesOk) continue;

    for (const term of terms) {
      let termHits = 0;
      if (titleLower.includes(term)) {
        termHits += TITLE_WEIGHT;
      }
      for (const chunk of doc.chunks) {
        const lower = chunk.text.toLowerCase();
        const n = countOccurrences(lower, term);
        if (n === 0) continue;
        // log-dampen repeats so one chatty session doesn't dominate on frequency
        termHits += (ROLE_WEIGHT[chunk.role] ?? 1) * (1 + Math.log2(n));
        if (termHits > 0 && snippets.length < MAX_SNIPPETS) {
          const pos = lower.indexOf(term);
          snippets.push({ role: chunk.role, text: snippetAround(chunk.text, pos, term.length) });
        }
      }
      if (termHits > 0) {
        matched.add(term);
        score += termHits;
      }
    }

    if (matched.size === 0) continue;

    const docMs = doc.startIso ? Date.parse(doc.startIso) : NaN;
    const ageMs = Number.isNaN(docMs) ? HALF_LIFE_MS : Math.max(0, nowMs - docMs);
    const recency = Math.pow(0.5, ageMs / HALF_LIFE_MS);
    // Full-term coverage dominates, then relevance × recency.
    const allTerms = matched.size === terms.length + phrases.length ? 1 : 0;
    scored.push({
      sessionId: doc.sessionId,
      agent: doc.agent,
      project: doc.project,
      day: doc.day,
      title: doc.title,
      score: allTerms * 1_000_000 + score * (0.25 + 0.75 * recency),
      matchedTerms: Array.from(matched),
      snippets: snippets.slice(0, MAX_SNIPPETS),
    });
  }

  scored.sort((a, b) => b.score - a.score || b.day.localeCompare(a.day));
  const limit = opts.limit ?? 10;
  return { hits: scored.slice(0, limit), total: scored.length };
}
