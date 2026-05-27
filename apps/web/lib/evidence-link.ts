/**
 * Build the URL hash for an evidence deep-link from a quote (+ optional
 * turn_index hint). The session view at /sessions/[id] parses this hash
 * and does a substring match against visibleEvents — that's more reliable
 * than turn_index alone because the observer counts turns within Entry
 * fields, not within the session's full user-turn stream (those diverge
 * whenever the entry isn't day-1 of the session).
 *
 * Format:
 *   #q=<urlencoded prefix>                  — quote-only (preferred)
 *   #turn-N&q=<urlencoded prefix>           — quote + turn hint
 *   #turn-N                                 — turn-only (legacy fallback)
 *
 * The session view tries quote-substring match first; if that fails (or no
 * quote was provided), it falls back to turn-N.
 */

/** Max chars of the quote that flow into the URL. Long enough to be unique
 *  in practice, short enough to keep URLs readable. */
const QUOTE_HASH_PREFIX_CHARS = 80;

/** Min chars for a useful substring match — guards against single-word
 *  quotes that would hit on every turn. */
const MIN_MATCHABLE_CHARS = 8;

export function buildEvidenceHash(quote: string, turnIndex?: number): string {
  const prefix = quotePrefix(quote);
  const parts: string[] = [];
  if (turnIndex !== undefined) parts.push(`turn-${turnIndex}`);
  if (prefix.length >= MIN_MATCHABLE_CHARS) parts.push(`q=${encodeURIComponent(prefix)}`);
  return parts.length === 0 ? "" : `#${parts.join("&")}`;
}

/** First ~80 chars of the quote with the truncation marker stripped. */
function quotePrefix(quote: string): string {
  // The observer truncates at 150 chars with a trailing "…"; strip it so we
  // match against the verbatim original.
  const stripped = quote.replace(/[……]\s*$/, "").trim();
  return stripped.slice(0, QUOTE_HASH_PREFIX_CHARS);
}
