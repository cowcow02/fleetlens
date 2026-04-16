import { readTeamConfig, clearTeamConfig } from "./config.js";

export async function teamLeave() {
  const config = readTeamConfig();
  if (!config) {
    console.log("Not paired with any team.");
    return;
  }

  // Notify server — ignore errors (server may be unreachable)
  try {
    await fetch(`${config.serverUrl}/api/team/leave`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.bearerToken}` },
      signal: AbortSignal.timeout(5000),
    });
  } catch {}

  clearTeamConfig();
  console.log("Left team. Local data is unaffected.");
}
