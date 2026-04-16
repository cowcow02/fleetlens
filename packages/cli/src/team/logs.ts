import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export async function teamLogs() {
  const logPath = join(homedir(), ".cclens", "daemon.log");
  try {
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    const teamLines = lines.filter(l => l.includes("team push") || l.includes("team "));
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
