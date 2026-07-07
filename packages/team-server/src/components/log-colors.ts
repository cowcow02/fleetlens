// Terminal palette shared by every log surface (member sync-log modal, admin
// log viewer) and the daemon-liveness badge — one source so the same status
// never renders two different colors.
export const LOG_GREEN = "#6fcf8e";
export const LOG_BLUE = "#8ab4d8";
export const LOG_AMBER = "#e8b866";
export const LOG_ORANGE = "#f0a35a";
export const LOG_RED = "#f0857a";
export const LOG_FG = "#cfc9b8";
export const LOG_BG = "#14120e";
export const LOG_GUTTER = "#6b665a";

export function levelColor(level: string): string {
  if (level === "error") return LOG_RED;
  if (level === "warn") return LOG_AMBER;
  return LOG_FG;
}
