/**
 * Date-range utilities used by both server components (for filtering)
 * and the client segmented control (for rendering). Lives in lib/
 * rather than alongside the client component so server components can
 * import it without the "use client" boundary poisoning.
 */

export type RangeKey = "7d" | "30d" | "90d" | "all";

/**
 * Parse a search-param value into a RangeKey (default: "90d").
 *
 * 90d is chosen as a sensible recent window for the heatmap and activity
 * chart — large enough to show trends, small enough that one stale agent
 * (Codex sessions back to last September, say) doesn't stretch the x-axis
 * across months of empty days. Users can still pick "all" explicitly.
 */
export function parseRange(value: string | string[] | undefined): RangeKey {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === "7d" || v === "30d" || v === "90d" || v === "all") return v;
  return "90d";
}

/**
 * Return the cutoff ms for a given range, or undefined for "all".
 * Calendar-day semantics: "30d" means the last 30 local calendar days
 * (today + 29 prior), not a rolling 30×24h window. Keeps the daily-bucket
 * bars and the filter boundary aligned, and keeps the answer stable
 * across page refreshes within the same day.
 */
export function cutoffMs(range: RangeKey, now = Date.now()): number | undefined {
  if (range === "all") return undefined;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d.getTime();
}
