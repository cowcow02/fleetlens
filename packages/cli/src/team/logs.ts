import { readFileSync } from "node:fs";
import { cclensPath } from "@claude-lens/parser/fs";

export async function teamLogs() {
  const logPath = cclensPath("daemon.log");
  try {
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    // Match both the per-run `[sync]` summary line (the primary outcome) and the
    // older `team …` detail lines (backfill / command results) so this stays a
    // complete view of the sync story.
    const teamLines = lines.filter((l) => l.includes("[sync] ") || l.includes("team "));
    if (teamLines.length === 0) {
      console.log("No team-related log entries found.");
      return;
    }
    for (const line of teamLines.slice(-20)) {
      console.log(line);
    }
  } catch {
    console.log("No daemon log found. Is the daemon running?");
  }
}
