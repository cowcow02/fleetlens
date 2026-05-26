import "server-only";

import { Fluency } from "@claude-lens/entries";
import { listEntriesForDay } from "@claude-lens/entries/fs";
import type { Entry } from "@claude-lens/entries";

/** Inclusive Monday → Sunday range for an ISO week monday. */
function weekDays(monday: string): string[] {
  const out: string[] = [];
  const d = new Date(`${monday}T00:00:00`);
  for (let i = 0; i < 7; i++) {
    const cur = new Date(d);
    cur.setDate(d.getDate() + i);
    out.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`,
    );
  }
  return out;
}

export function listEntriesForWeek(monday: string): Entry[] {
  const out: Entry[] = [];
  for (const day of weekDays(monday)) {
    for (const e of listEntriesForDay(day)) out.push(e);
  }
  return out;
}

/** Build a real scorecard from local entries, OR return null if zero entries
 *  for the week. Caller falls back to the mock when null. */
export function buildScorecardForWeek(
  monday: string,
  member: { id: string; name: string; email?: string },
): Fluency.FluencyScorecard | null {
  const entries = listEntriesForWeek(monday);
  if (entries.length === 0) return null;
  return Fluency.buildFluencyScorecard({
    member_id: member.id,
    member_name: member.name,
    member_email: member.email,
    week_monday: monday,
    entries,
  });
}
