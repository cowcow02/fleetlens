import { writeTeamConfig } from "./config.js";

export async function joinTeam(args: string[]) {
  const [serverUrl, inviteToken] = args;
  if (!serverUrl || !inviteToken) {
    console.error("Usage: fleetlens team join <server-url> <invite-token>");
    process.exit(1);
  }

  // Auto-detect from git config
  const { execSync } = await import("node:child_process");
  let email: string | undefined;
  let displayName: string | undefined;
  try { email = execSync("git config user.email", { encoding: "utf8" }).trim(); } catch {}
  try { displayName = execSync("git config user.name", { encoding: "utf8" }).trim(); } catch {}

  const res = await fetch(`${serverUrl}/api/team/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inviteToken, email, displayName }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    console.error(`Join failed: ${(err as { error?: string }).error || res.statusText}`);
    process.exit(1);
  }

  const data = await res.json() as {
    serverBaseUrl?: string;
    member: { id: string; displayName?: string; email?: string };
    bearerToken: string;
    teamSlug: string;
  };
  writeTeamConfig({
    serverUrl: data.serverBaseUrl || serverUrl,
    memberId: data.member.id,
    bearerToken: data.bearerToken,
    teamSlug: data.teamSlug,
    pairedAt: new Date().toISOString(),
  });

  console.log(`Joined team "${data.teamSlug}" as ${data.member.displayName || data.member.email || "anonymous"}`);
  console.log("  Your daemon will start pushing metrics on the next cycle (~5 min).");
}
