import { readTeamConnection } from "@/lib/team-data";
import { formatRelative } from "@/lib/format";
import { ForceSyncButton } from "./force-sync-button";

const HEALTH_COLORS = {
  green: "var(--af-success, #10b981)",
  amber: "var(--af-warning, #f59e0b)",
  red: "var(--af-error, #ef4444)",
} as const;

function formatAgentTime(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

export function TeamConnectionSection() {
  const conn = readTeamConnection();
  if (!conn.paired) return null;

  const { team, member, lastPush, health } = conn;
  const cliAvailable = Boolean(process.env.FLEETLENS_CLI_BIN);

  return (
    <section id="team" className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-medium">Team connection</h2>
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: HEALTH_COLORS[health],
            display: "inline-block",
          }}
        />
        <span className="text-sm text-gray-500">{team.name}</span>
      </div>

      <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm text-gray-600">
        <dt>Server</dt><dd className="font-mono text-xs">{team.serverUrl}</dd>
        <dt>Paired</dt><dd>{new Date(member.pairedAt).toLocaleString()}</dd>
        <dt>Last sync</dt>
        <dd suppressHydrationWarning>
          {lastPush.kind === "none"
            ? "Waiting for the first sync — the daemon pushes every 5 minutes."
            : `${formatRelative(lastPush.at)} (${new Date(lastPush.at).toLocaleString()})`}
        </dd>
      </dl>

      {lastPush.kind === "ok" && (
        <div className="rounded border border-gray-200 p-4 space-y-2 text-sm">
          <div className="text-xs uppercase tracking-wide text-gray-500">Last push</div>
          {lastPush.payload.dailyRollup && (
            <div>
              <strong>{lastPush.payload.dailyRollup.day}:</strong>{" "}
              {formatAgentTime(lastPush.payload.dailyRollup.agentTimeMs)} agent time ·{" "}
              {lastPush.payload.dailyRollup.sessions} sessions ·{" "}
              {lastPush.payload.dailyRollup.toolCalls} tool calls ·{" "}
              {lastPush.payload.dailyRollup.turns} turns ·{" "}
              {formatTokens(
                lastPush.payload.dailyRollup.tokens.input +
                  lastPush.payload.dailyRollup.tokens.output +
                  lastPush.payload.dailyRollup.tokens.cacheRead +
                  lastPush.payload.dailyRollup.tokens.cacheWrite,
              )}{" "}
              tokens
            </div>
          )}
          {lastPush.payload.planTier && (
            <div>
              <strong>Plan tier:</strong> {lastPush.payload.planTier}
            </div>
          )}
          {!lastPush.payload.dailyRollup && !lastPush.payload.planTier && (
            <div className="text-gray-500">Live utilization snapshot only — no new daily activity.</div>
          )}
        </div>
      )}

      {lastPush.kind === "error" && (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          <div className="font-medium">Last sync failed</div>
          <div>{lastPush.error}</div>
        </div>
      )}

      <ForceSyncButton cliAvailable={cliAvailable} />

      <div className="rounded border border-gray-200 p-4 text-sm space-y-2">
        <div className="font-medium">What does NOT leave your machine</div>
        <ul className="list-disc list-inside text-gray-600 space-y-1">
          <li>Session transcripts, prompts, or assistant responses</li>
          <li>Project names, paths, or repo information</li>
          <li>File contents or tool-call payloads</li>
          <li>Anything from sessions older than the start-of-day rollup window</li>
        </ul>
      </div>

      <p className="text-xs text-gray-500">
        To disconnect from this team, run <code>fleetlens team leave</code> in your terminal.
      </p>
    </section>
  );
}
