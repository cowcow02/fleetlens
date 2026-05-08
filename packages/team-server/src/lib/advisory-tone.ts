/**
 * Advisory tone — 4 states used for recommendation cards (optimizer) and
 * flag counters (member plan block). Distinct from utilization-tone.ts:
 * utilization is "% used → too little / too much" (3 states); advisory is
 * "what should the operator do about this" (4 states, including a neutral
 * "info" for non-actionable notices).
 */

export type AdvisoryTone = "good" | "warn" | "danger" | "info";

export function advisoryColor(tone: AdvisoryTone): string {
  switch (tone) {
    case "danger":
      return "#a93b2c";
    case "warn":
      return "#b58400";
    case "good":
      return "#2c6e49";
    case "info":
      return "var(--mute)";
  }
}
