import type { TeamConfig, ServerCommand, CommandResult } from "@claude-lens/parser/fs";
import { buildRollupsForRange, buildIngestPayload, pushToTeamServer } from "./push.js";

export type { ServerCommand, CommandResult };

type LogFn = (level: "info" | "warn", message: string) => void;

export async function dispatchCommand(
  command: ServerCommand,
  config: TeamConfig,
  log: LogFn,
): Promise<CommandResult> {
  switch (command.type) {
    case "backfill-activity":
      return runActivityBackfill(command, config, log);
    default:
      // Defensive: a future server might send a command type this CLI doesn't
      // know yet. Report failure so the server can surface it.
      return {
        id: (command as { id: string }).id,
        ok: false,
        completedAt: new Date().toISOString(),
        error: `Unknown command type: ${(command as { type: string }).type}`,
      };
  }
}

async function runActivityBackfill(
  command: Extract<ServerCommand, { type: "backfill-activity" }>,
  config: TeamConfig,
  log: LogFn,
): Promise<CommandResult> {
  const { listSessions } = await import("@claude-lens/parser/fs");
  const { toLocalDay } = await import("@claude-lens/parser");

  const days = command.params.days;
  const todayMs = Date.now();
  // "last N days" is inclusive of today: targetDay = today − (N − 1).
  // buildRollupsForRange filters b.date >= targetDay, so days=30 yields
  // exactly 30 calendar days (today + 29 prior), and days=1 yields today only.
  const targetDayMs = todayMs - (days - 1) * 24 * 60 * 60 * 1000;
  const targetDay = toLocalDay(targetDayMs);

  log("info", `command ${command.id}: backfill-activity from ${targetDay} (${days} days)`);

  let sessions;
  try {
    sessions = await listSessions({ limit: 10_000 });
  } catch (err) {
    return {
      id: command.id,
      ok: false,
      completedAt: new Date().toISOString(),
      error: `Failed to read sessions: ${(err as Error).message}`,
    };
  }

  const rollups = buildRollupsForRange(sessions, targetDay);
  if (rollups.length === 0) {
    return {
      id: command.id,
      ok: true,
      completedAt: new Date().toISOString(),
      summary: { pushed: 0, fromDay: targetDay },
    };
  }

  let pushed = 0;
  for (const rollup of rollups) {
    // Historical-only push: no live snapshot, no cyclePeaks, no planTier.
    // Those belong on the latest rollup that the regular sync attaches.
    const payload = buildIngestPayload(rollup);
    const result = await pushToTeamServer(config, payload);
    if (!result.ok) {
      return {
        id: command.id,
        ok: false,
        completedAt: new Date().toISOString(),
        error: `Push failed on ${rollup.day} (HTTP ${result.status}); pushed ${pushed}/${rollups.length} before failing`,
      };
    }
    pushed++;
  }

  log("info", `command ${command.id}: backfill-activity ok — pushed ${pushed} day${pushed === 1 ? "" : "s"}`);
  return {
    id: command.id,
    ok: true,
    completedAt: new Date().toISOString(),
    summary: { pushed, fromDay: targetDay },
  };
}
