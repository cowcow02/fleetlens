export const LANE_HEIGHT = 24;
export const LANE_GAP = 2;
export const LABEL_WIDTH = 100;
export const DEFAULT_VISIBLE_LANES = 4;

export function formatEdge(ms: number, multiDay: boolean): string {
  const d = new Date(ms);
  if (!multiDay) {
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} ${time}`;
}
