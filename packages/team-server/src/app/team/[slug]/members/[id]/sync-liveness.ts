// Daemon liveness derived from `memberships.last_seen_at` (advances on every
// non-dedup metrics push). Pairs with the uploaded sync log in the modal: an
// empty log next to a STALE heartbeat is the one case the log can't explain on
// its own — it means the transport itself is broken (daemon stopped, unpaired,
// or can't reach the server), not that sync is healthy. Kept pure + React-free
// so the "broken transport" branch is unit-testable without a DOM.
export type Liveness = { label: string; color: string; stale: boolean };

// > 30 min without a push == transport suspect. `now` is injectable for tests.
export function liveness(ms: number | null, now: number = Date.now()): Liveness {
  if (ms == null) return { label: "never", color: "#e8b866", stale: true };
  const age = now - ms;
  const stale = age >= 30 * 60_000;
  let label: string;
  if (age < 60_000) label = "just now";
  else if (age < 3_600_000) label = `${Math.round(age / 60_000)}m ago`;
  else if (age < 86_400_000) label = `${Math.round(age / 3_600_000)}h ago`;
  else label = `${Math.round(age / 86_400_000)}d ago`;
  return { label, color: stale ? "#e8b866" : "#6fcf8e", stale };
}
