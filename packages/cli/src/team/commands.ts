import type { TeamConfig, ServerCommand, CommandResult } from "@claude-lens/parser/fs";
import { buildRollupsForRange, buildIngestPayload, buildRichBlocksForDay, filterSyncedSessions, sessionTouchesDay, pushToTeamServer } from "./push.js";
import { createRepoResolver } from "./git-remote.js";

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
  const { probeArtifactSignals } = await import("../perception/file-probe.js");

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
    // Server-commanded backfills must respect the member's project selection
    // too — an admin's "re-push 30 days" is not consent to resend excluded
    // projects.
    sessions = filterSyncedSessions(await listSessions({ limit: 10_000 }), config.syncProjects);
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

  // Compute rich blocks + artifact signals per day, same as the regular sync —
  // the server only persists rollups that arrive as `richRollup` (rollup +
  // richExtras), so a rollup-only payload would be silently dropped.
  const resolveRepo = createRepoResolver();
  let pushed = 0;
  for (const rollup of rollups) {
    // Historical push: no live snapshot, no cyclePeaks, no planTier — those
    // belong on the latest rollup that the regular sync attaches.
    const daySessions = sessions.filter((s) => sessionTouchesDay(s, rollup.day));
    const richBlocks = buildRichBlocksForDay(rollup.day, daySessions, resolveRepo);
    let artifactSignals: ReturnType<typeof probeArtifactSignals> = null;
    try {
      artifactSignals = probeArtifactSignals({ day: rollup.day, extraRoots: [process.cwd()] });
    } catch {
      // Probe is best-effort; never block the backfill.
    }
    const payload = buildIngestPayload({
      rollup,
      richExtras: richBlocks?.rich,
      enrichedExtras: richBlocks?.enriched,
      artifactSignals: artifactSignals ?? undefined,
    });
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
