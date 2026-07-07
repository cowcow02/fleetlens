import { LOG_AMBER, LOG_GREEN } from "../../../../../components/log-colors";

// Daemon liveness derived from `memberships.last_seen_at` (advances on every
// non-dedup metrics push). Pairs with the uploaded sync log in the modal: an
// empty log next to a STALE heartbeat is the one case the log can't explain on
// its own — it means the transport itself is broken (daemon stopped, unpaired,
// or can't reach the server), not that sync is healthy. Kept pure + React-free
// so the "broken transport" branch is unit-testable without a DOM.
export type Liveness = { label: string; color: string; stale: boolean };

// Single owner of the liveness thresholds: the modal badge and the member-page
// header badge both render from liveness(), so they can never disagree. The
// roster's "currently active" dot is a tighter, different concept but must
// still reference a shared constant, not a magic number.
export const STALE_AFTER_MS = 30 * 60_000;
export const ROSTER_ACTIVE_MS = 15 * 60_000;

// >= STALE_AFTER_MS without a push == transport suspect. `now` is injectable
// for tests.
export function liveness(ms: number | null, now: number = Date.now()): Liveness {
  if (ms == null) return { label: "never", color: LOG_AMBER, stale: true };
  const age = now - ms;
  const stale = age >= STALE_AFTER_MS;
  let label: string;
  if (age < 60_000) label = "just now";
  else if (age < 3_600_000) label = `${Math.round(age / 60_000)}m ago`;
  else if (age < 86_400_000) label = `${Math.round(age / 3_600_000)}h ago`;
  else label = `${Math.round(age / 86_400_000)}d ago`;
  return { label, color: stale ? LOG_AMBER : LOG_GREEN, stale };
}
