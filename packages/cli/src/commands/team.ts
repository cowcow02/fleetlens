export async function team(args: string[]) {
  const sub = args[0];
  switch (sub) {
    case "join": {
      const { joinTeam } = await import("../team/join.js");
      await joinTeam(args.slice(1));
      break;
    }
    case "status": {
      const { teamStatus } = await import("../team/status.js");
      await teamStatus();
      break;
    }
    case "leave": {
      const { teamLeave } = await import("../team/leave.js");
      await teamLeave();
      break;
    }
    case "logs": {
      const { teamLogs } = await import("../team/logs.js");
      await teamLogs();
      break;
    }
    case "sync": {
      // --progress-json: the onboarding wizard's SSE relay spawns this and
      // reads NDJSON off stdout — human [level] lines would corrupt that
      // stream, so they're suppressed (daemon.log still gets them).
      const progressJson = args.includes("--progress-json");
      const { runTeamSync } = await import("../team/sync.js");
      const { appendDaemonLogLine } = await import("../daemon-log.js");
      // Log to the console AND daemon.log with trigger="manual" so a hand-run
      // sync's [sync] summary enters the member story like the daemon's ticks.
      const outcome = await runTeamSync(
        (level, msg) => {
          if (!progressJson) console.log(`[${level}] ${msg}`);
          appendDaemonLogLine(level, msg);
        },
        undefined,
        {
          trigger: "manual",
          onProgress: progressJson ? (ev) => console.log(JSON.stringify(ev)) : undefined,
        },
      );
      if (!outcome.paired) {
        console.error("Not paired. Run 'fleetlens team join <url> <device-token>' first.");
        process.exit(1);
      }
      if (outcome.setupPending) {
        if (progressJson) {
          console.log(JSON.stringify({ type: "error", message: "setup pending — selection not saved yet" }));
        } else {
          console.error("Setup pending — nothing synced. Finish onboarding in the dashboard (/team/onboarding) or re-run 'fleetlens team join'.");
        }
        process.exit(1);
      }
      // Top-level error always fails; backfill-only error fails only when nothing
      // else made progress, so a transient history hiccup doesn't mask a successful
      // daily-activity push for scripted callers.
      const inserted = outcome.usageBackfill?.insertedSnapshots ?? 0;
      const madeProgress = outcome.pushed > 0 || outcome.queuedDrained > 0 || inserted > 0;
      if (outcome.error || (outcome.usageBackfill?.error && !madeProgress)) process.exit(1);
      if (!progressJson) {
        const sent = outcome.usageBackfill?.sentSnapshots ?? 0;
        const usageChecked = sent > 0
          ? `, ${sent} usage snapshot${sent === 1 ? "" : "s"} checked`
          : "";
        console.log(
          `✓ ${outcome.pushed} activity payload${outcome.pushed === 1 ? "" : "s"} pushed` +
          usageChecked +
          (outcome.queuedDrained ? `, ${outcome.queuedDrained} queued retried` : "") +
          (outcome.queued ? `, ${outcome.queued} queued for retry (will fire next cycle)` : "")
        );
      }
      break;
    }
    case "backfill": {
      const { runTeamSync } = await import("../team/sync.js");
      const outcome = await runTeamSync(
        (level, msg) => console.log(`[${level}] ${msg}`),
        undefined,
        { forceUsageBackfill: true },
      );
      if (!outcome.paired) {
        console.error("Not paired. Run 'fleetlens team join <url> <device-token>' first.");
        process.exit(1);
      }
      if (outcome.error || outcome.usageBackfill?.error) process.exit(1);
      const inserted = outcome.usageBackfill?.insertedSnapshots ?? 0;
      console.log(
        `✓ ${inserted} new snapshot${inserted === 1 ? "" : "s"} loaded` +
        (outcome.usageBackfill?.skippedSnapshots
          ? `, ${outcome.usageBackfill.skippedSnapshots} already-known`
          : "") +
        (outcome.pushed
          ? `, ${outcome.pushed} activity payload${outcome.pushed === 1 ? "" : "s"} pushed`
          : "")
      );
      break;
    }
    default:
      console.log(`Usage: fleetlens team <join|status|leave|logs|sync|backfill>

  join <url> <device-token>    Pair daemon with a team server (auto-backfills usage history)
  status                       Show team pairing state and sync info
  leave                        Unpair from the team server
  logs                         Show recent team-related daemon log entries
  sync                         Push any un-synced days now (skip 5-min wait)
  backfill                     Re-upload local usage history to populate the team dashboard`);
  }
}
