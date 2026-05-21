export const FRESH_MS = 15 * 60_000;
export const STALE_MS = 60 * 60_000;

export type Health = "green" | "amber" | "red";

export type LastPushBlock =
  | { kind: "none" }
  | { kind: "ok"; at: string; payload: unknown }
  | { kind: "error"; at: string; error: string; payload: unknown };

export function deriveHealth(lastPush: LastPushBlock, nowMs: number = Date.now()): Health {
  if (lastPush.kind === "none") return "amber";
  if (lastPush.kind === "error") return "red";
  const ageMs = nowMs - Date.parse(lastPush.at);
  if (Number.isNaN(ageMs) || ageMs > STALE_MS) return "red";
  if (ageMs > FRESH_MS) return "amber";
  return "green";
}
