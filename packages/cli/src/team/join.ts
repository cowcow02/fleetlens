import { writeTeamConfig, type TeamConfig } from "./config.js";
import { runTeamSync } from "./sync.js";

export async function joinTeam(args: string[]) {
  const [serverUrl, bearerToken] = args;
  if (!serverUrl || !bearerToken) {
    console.error("Usage: fleetlens team join <server-url> <device-token>");
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

  const config: TeamConfig = {
    serverUrl,
    memberId: data.membership.id,
    bearerToken,
    teamSlug: data.team.slug,
    teamName: data.team.name,
    pairedAt: new Date().toISOString(),
  };
  writeTeamConfig(config);

  console.log(`Paired with "${data.team.name}" as ${data.user.displayName || data.user.email}`);
  console.log(`  role: ${data.membership.role}`);

  // One sync path handles first-pair history, current live utilization, queued
  // retries, and daily activity. Threading `config` directly avoids a stale
  // disk-read race during the first paired moment.
  console.log("  Syncing local history…");
  const sync = await runTeamSync(undefined, config, { forceUsageBackfill: true });
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
}
