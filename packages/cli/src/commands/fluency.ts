import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Fluency } from "@claude-lens/entries";
import { listEntriesForDay } from "@claude-lens/entries/fs";
import type { Entry } from "@claude-lens/entries";

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function mondayOf(d: Date): string {
  const day = d.getDay() || 7;
  const monday = new Date(d);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(d.getDate() - day + 1);
  return fmtDate(monday);
}

function thisWeekMonday(): string {
  return mondayOf(new Date());
}

function lastWeekMonday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return mondayOf(d);
}

function weekDays(monday: string): string[] {
  const out: string[] = [];
  const d = new Date(`${monday}T00:00:00`);
  for (let i = 0; i < 7; i++) {
    const cur = new Date(d);
    cur.setDate(d.getDate() + i);
    out.push(fmtDate(cur));
  }
  return out;
}

function listEntriesForWeek(monday: string): Entry[] {
  const out: Entry[] = [];
  for (const day of weekDays(monday)) {
    for (const e of listEntriesForDay(day)) out.push(e);
  }
  return out;
}

function readTeamConnection(): { server_url?: string; team_token?: string; member_id?: string; member_name?: string } | null {
  const path = join(homedir(), ".cclens", "team.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

export async function fluency(args: string[]): Promise<void> {
  let monday = thisWeekMonday();
  let json = false;
  let push = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--week" && args[i + 1]) {
      monday = args[++i];
    } else if (a === "--this-week") {
      monday = thisWeekMonday();
    } else if (a === "--last-week") {
      monday = lastWeekMonday();
    } else if (a === "--json") {
      json = true;
    } else if (a === "--push") {
      push = true;
    } else if (a === "-h" || a === "--help") {
      console.log("Usage: fleetlens fluency [--week YYYY-MM-DD|--this-week|--last-week] [--json] [--push]");
      return;
    }
  }

  const entries = listEntriesForWeek(monday);
  if (entries.length === 0) {
    console.error(`No entries for week ${monday}. Run 'fleetlens start' to begin the perception sweep.`);
    process.exit(1);
  }

  const team = readTeamConnection();
  const card = Fluency.buildFluencyScorecard({
    member_id: team?.member_id ?? "local",
    member_name: team?.member_name ?? "you",
    week_monday: monday,
    entries,
  });

  if (json) {
    process.stdout.write(JSON.stringify(card, null, 2) + "\n");
  } else {
    renderTerminalScorecard(card);
  }

  if (push) {
    if (!team?.server_url || !team?.team_token) {
      console.error("--push requested but no team pairing found. Run 'fleetlens team join <url> <token>' first.");
      process.exit(1);
    }
    await pushScorecard(team.server_url, team.team_token, card);
  }
}

function renderTerminalScorecard(card: Fluency.FluencyScorecard): void {
  const W = (s: string) => process.stdout.write(s);
  const scoreOut11 = card.score.numerator;
  const delta = card.score_prev ? scoreOut11 - card.score_prev.numerator : 0;
  W(`\n  AI Fluency · week of ${card.week_monday}\n`);
  W(`  Score: ${scoreOut11.toFixed(1)} / 11`);
  if (card.score_prev) W(`   (${delta >= 0 ? "+" : ""}${delta.toFixed(1)} vs last week)`);
  W(`\n\n`);
  W(`  ${card.summary}\n\n`);
  for (const o of card.observations) {
    const ax = Fluency.FLUENCY_AXIS_BY_ID[o.axis];
    const glyph = o.rating === "+" ? "●" : o.rating === "~" ? "◐" : o.rating === "-" ? "○" : "·";
    W(`  ${glyph}  [${ax.id.padEnd(3)}] ${ax.title}\n`);
    if (o.evidence[0]) W(`         “${o.evidence[0].quote}” (${o.evidence[0].date} ${o.evidence[0].session_id.slice(0, 8)})\n`);
  }
  W(`\n  Risk profile: ${card.risk_triangle.dominant_corner.replace(/_/g, "-")}\n`);
  W(`  Strength axis: ${card.strength_axis}    Growth axis: ${card.growth_axis}\n\n`);
}

async function pushScorecard(serverUrl: string, token: string, card: Fluency.FluencyScorecard): Promise<void> {
  const url = `${serverUrl.replace(/\/+$/, "")}/api/ingest/fluency`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ scorecard: card }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`push failed: HTTP ${res.status} — ${body.slice(0, 200)}`);
    process.exit(1);
  }
  console.log(`pushed fluency scorecard for week ${card.week_monday} → ${url}`);
}
