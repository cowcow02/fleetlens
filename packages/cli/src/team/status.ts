import { readTeamConfig } from "./config.js";

export async function teamStatus() {
  const config = readTeamConfig();
  if (!config) {
    console.log("Not paired with any team.");
    console.log("Use 'fleetlens team join <url> <token>' to pair.");
    return;
  }

  console.log(`Team:    ${config.teamSlug}`);
  console.log(`Server:  ${config.serverUrl}`);
  console.log(`Member:  ${config.memberId}`);
  console.log(`Paired:  ${config.pairedAt}`);

  // Quick health check — expect 400 (validation) if reachable, 401 if token revoked
  try {
    const res = await fetch(`${config.serverUrl}/api/ingest/metrics`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.bearerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 401) {
      console.log("Status:  ! Token revoked — run 'fleetlens team leave' then re-join");
    } else {
      console.log("Status:  Connected");
    }
  } catch {
    console.log("Status:  ! Cannot reach server");
  }
}
