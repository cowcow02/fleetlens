/**
 * Adaptive poll interval for the usage daemon.
 *
 * Normal steady state: poll every BASE_INTERVAL_MS (5 min).
 *
 * When we hit auth failures (expired token, 401, 429) we double the wait up
 * to MAX_INTERVAL_MS. This prevents a dead token from hammering the endpoint
 * every 5 min for hours — which is what caused the 2026-04-14 incident where
 * a stale token earned a solid 16h of alternating 401/429s from the server.
 *
 * Network errors do not change the interval — they're usually transient
 * (wake-from-sleep, WiFi reconnect) and resolve on their own.
 *
 * Any successful poll resets to BASE_INTERVAL_MS.
 */

export const BASE_INTERVAL_MS = 5 * 60 * 1000;
export const MAX_INTERVAL_MS = 60 * 60 * 1000;

export type PollOutcome = "success" | "auth" | "network";

export function nextIntervalMs(current: number, outcome: PollOutcome): number {
  if (outcome === "success") return BASE_INTERVAL_MS;
  if (outcome === "network") return current;
  return Math.min(Math.max(current, BASE_INTERVAL_MS) * 2, MAX_INTERVAL_MS);
}
