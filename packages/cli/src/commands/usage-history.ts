import { listSessions } from "@claude-lens/parser/fs";
import type { SessionMeta, Usage } from "@claude-lens/parser";
import { estimateCost } from "../pricing.js";
import { renderTable, type TableRow } from "../table.js";
import { getServerStatus } from "../server.js";

declare const CLI_VERSION: string;

export async function history(args: string[]): Promise<void> {
  const live = args.includes("--live");
  const sinceIdx = args.indexOf("-s");
  const daysIdx = args.indexOf("--days");

  let sinceDate: Date | null = null;
  if (sinceIdx !== -1 && args[sinceIdx + 1]) {
    const raw = args[sinceIdx + 1];
    sinceDate = new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`);
  } else if (daysIdx !== -1 && args[daysIdx + 1]) {
    const days = parseInt(args[daysIdx + 1], 10);
    sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);
    sinceDate.setHours(0, 0, 0, 0);
  }

  if (live) {
    await liveStats(sinceDate);
  } else {
    await printStats(sinceDate);
  }
}

async function printStats(sinceDate: Date | null): Promise<void> {
  const sessions = await listSessions({ limit: 10000 });

  const filtered = sinceDate
    ? sessions.filter((s) => s.firstTimestamp && new Date(s.firstTimestamp) >= sinceDate!)
    : sessions;

  const rows = aggregateByDay(filtered);
  const output = renderTable(rows, "Claude Code Token Usage Report \u2014 Daily");

  const today = new Date().toISOString().slice(0, 10);
  const todaySessions = filtered.filter((s) => s.firstTimestamp?.startsWith(today)).length;
  const status = getServerStatus();
  const serverLine = status.running
    ? `Server running on http://localhost:${status.port}`
    : "Server not running";

  console.log(output);
  console.log(`  ${todaySessions} sessions today \u00b7 ${serverLine}`);
  console.log("");
}

/**
 * Normalize a raw model id to a short, stable label used for BOTH dedup and
 * display so the two can never diverge (which produced "opus-4, opus-4" when
 * one regex collapsed the version digit and the other didn't). Strips a
 * trailing 8-digit date and the "claude-" prefix; keeps the version suffix.
 */
function displayModel(raw: string): string {
  return raw.replace(/-\d{8}$/, "").replace(/^claude-/, "");
}

function aggregateByDay(sessions: SessionMeta[]): TableRow[] {
  const byDay = new Map<string, { sessions: SessionMeta[]; models: Set<string> }>();

  for (const s of sessions) {
    const day = s.firstTimestamp?.slice(0, 10) ?? "unknown";
    if (!byDay.has(day)) byDay.set(day, { sessions: [], models: new Set() });
    const bucket = byDay.get(day)!;
    bucket.sessions.push(s);
    if (s.model) bucket.models.add(displayModel(s.model));
  }

  const sorted = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  return sorted.map(([date, { sessions, models }]) => {
    const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    // Sum the cost of priced sessions and remember if any session couldn't be
    // priced. One unpriced session (e.g. "<synthetic>") must NOT null the whole
    // day's recoverable spend \u2014 it just makes the day's cost a lower bound.
    let cost = 0;
    let anyPriced = false;
    let anyUnpriced = false;

    for (const s of sessions) {
      usage.input += s.totalUsage.input;
      usage.output += s.totalUsage.output;
      usage.cacheRead += s.totalUsage.cacheRead;
      usage.cacheWrite += s.totalUsage.cacheWrite;

      if (s.model) {
        const c = estimateCost(s.model, s.totalUsage);
        if (c !== null) {
          cost += c;
          anyPriced = true;
        } else {
          anyUnpriced = true;
        }
      }
    }

    const modelNames = [...models].join(", ");

    return {
      date,
      models: modelNames || "\u2014",
      input: usage.input,
      output: usage.output,
      cacheCreate: usage.cacheWrite,
      cacheRead: usage.cacheRead,
      totalTokens: usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
      cost: anyPriced ? cost : null,
      costPartial: anyPriced && anyUnpriced,
    };
  });
}

async function liveStats(sinceDate: Date | null): Promise<void> {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (data) => {
      if (data.toString() === "q" || data.toString() === "\x03") {
        process.stdout.write("\x1b[?25h"); // show cursor
        process.exit(0);
      }
    });
  }

  const refresh = async () => {
    const sessions = await listSessions({ limit: 10000 });
    const filtered = sinceDate
      ? sessions.filter((s) => s.firstTimestamp && new Date(s.firstTimestamp) >= sinceDate!)
      : sessions;

    const rows = aggregateByDay(filtered);
    const output = renderTable(rows, "Claude Code Token Usage Report \u2014 Live (q to quit)");

    process.stdout.write("\x1b[2J\x1b[H"); // clear + home
    process.stdout.write("\x1b[?25l"); // hide cursor
    process.stdout.write(output);

    const running = filtered.filter((s) => s.status === "running");
    if (running.length > 0) {
      process.stdout.write("  Active Sessions\n");
      for (const s of running.slice(0, 5)) {
        const project = s.projectName.split("/").slice(-2).join("/");
        const tokens = s.totalUsage.input + s.totalUsage.output;
        process.stdout.write(`    ${project.padEnd(30)} ${tokens.toLocaleString()} tokens\n`);
      }
      process.stdout.write("\n");
    }
  };

  await refresh();
  setInterval(refresh, 2000);
}
