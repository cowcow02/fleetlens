import { readTeamConfig, writeTeamConfig, type TeamConfig, type SyncProjects } from "./config.js";
import { runTeamSync } from "./sync.js";
import { appendDaemonLogLine } from "../daemon-log.js";
import { ensureCurrentServer, openBrowser } from "../server.js";
import { startDaemonSilent } from "../commands/daemon.js";

// Route the pairing run's log through daemon.log so sync-log.ts picks its
// [sync] summary. Without this the first-pair backfill — the largest sync of a
// member's life — never reaches the team-side log, and the member's story
// starts at the next boot sync ("pushed 1 day") while the server already holds
// weeks of history.
const logToDaemonLog = appendDaemonLogLine;

// A re-join to the SAME server+team (e.g. after `team leave` then rejoining,
// or re-running `join` after an interrupted setup) keeps the member's prior
// project selection instead of resetting to "sync everything". A different
// server or team is a genuinely new pairing — nothing carries over.
export function carryOverSyncProjects(
  existing: TeamConfig | null,
  serverUrl: string,
  teamSlug: string,
): SyncProjects | undefined {
  if (existing && existing.serverUrl === serverUrl && existing.teamSlug === teamSlug) {
    return existing.syncProjects;
  }
  return undefined;
}

export async function joinTeam(args: string[]) {
  const noBrowser = args.includes("--no-browser");
  const [serverUrl, bearerToken] = args.filter((a) => !a.startsWith("--"));
  if (!serverUrl || !bearerToken) {
    console.error("Usage: fleetlens team join <server-url> <device-token> [--no-browser]");
    console.error("");
    console.error("Get the device token from the dashboard after signup,");
    console.error("or from Settings → My device token.");
    process.exit(1);
  }

  const res = await fetch(`${serverUrl}/api/team/whoami`, {
    method: "GET",
    headers: { Authorization: `Bearer ${bearerToken}` },
  });

  if (!res.ok) {
    console.error(`Pairing failed: ${res.status} ${res.statusText}`);
    console.error("The device token may be revoked or the server URL wrong.");
    process.exit(1);
  }

  const data = (await res.json()) as {
    membership: { id: string; role: string };
    team: { id: string; slug: string; name: string };
    user: { email: string; displayName: string | null };
  };

  const existing = readTeamConfig();
  const config: TeamConfig = {
    serverUrl,
    memberId: data.membership.id,
    bearerToken,
    teamSlug: data.team.slug,
    teamName: data.team.name,
    pairedAt: new Date().toISOString(),
    // Fence off any daemon.log history from a PREVIOUS team so the first push
    // doesn't sweep the prior team's [sync] lines onto this team's log. The
    // pair run's own [sync] line is written after this instant, so it still
    // uploads on the next sync.
    lastSyncedLogAt: new Date().toISOString(),
    syncProjects: carryOverSyncProjects(existing, serverUrl, data.team.slug),
    // Browser path: gate the daemon until the wizard's "Start syncing".
    ...(noBrowser ? {} : { setupPending: true }),
  };
  writeTeamConfig(config);

  console.log(`Paired with "${data.team.name}" as ${data.user.displayName || data.user.email}`);
  console.log(`  role: ${data.membership.role}`);

  if (noBrowser) {
    // Legacy headless path: sync everything immediately.
    // One sync path handles first-pair history, current live utilization, queued
    // retries, and daily activity. Threading `config` directly avoids a stale
    // disk-read race during the first paired moment.
    console.log("  Syncing local history…");
    const sync = await runTeamSync(logToDaemonLog, config, {
      forceUsageBackfill: true,
      trigger: "pair",
    });
    const backfill = sync.usageBackfill;
    if (backfill?.error) {
      console.log(`  ⚠ Usage history sync failed: ${backfill.error} — daemon will retry automatically.`);
    } else if ((backfill?.insertedSnapshots ?? 0) > 0) {
      console.log(
        `  ✓ Synced ${backfill!.insertedSnapshots} usage snapshot${backfill!.insertedSnapshots === 1 ? "" : "s"} from local history.`,
      );
    } else if ((backfill?.sentSnapshots ?? 0) > 0) {
      console.log(`  ✓ ${backfill!.sentSnapshots} usage snapshots already on server (deduped on capture time).`);
    } else {
      console.log("  · No local usage snapshots yet — daemon will start collecting.");
    }

    if (sync.error) {
      console.log(`  ⚠ Team sync failed: ${sync.error} — will retry on next daemon cycle.`);
    } else if (sync.pushed > 0) {
      console.log(`  ✓ Synced ${sync.pushed} activity payload${sync.pushed === 1 ? "" : "s"}.`);
    } else {
      console.log("  · No new session activity to push.");
    }
    console.log("  Daemon polls every 5 minutes — next push happens automatically.");
    return;
  }

  console.log("  Opening your browser to finish setup…");
  let url: string;
  try {
    const server = await ensureCurrentServer({});
    url = `http://localhost:${server.port}/team/onboarding`;
    const daemon = startDaemonSilent();
    if (!daemon.started && !daemon.alreadyRunning) {
      console.warn(`  ⚠ Daemon failed to start — ${daemon.error}`);
    }
  } catch (err) {
    console.error(`  ⚠ Could not start the dashboard: ${(err as Error).message}`);
    console.error("  Re-run 'fleetlens team join' after fixing it, or use --no-browser to sync everything from the terminal.");
    process.exit(1);
  }
  openBrowser(url);
  console.log(`  Continue in your browser: ${url}`);
  console.log("  Nothing syncs until you finish setup there.");
}
