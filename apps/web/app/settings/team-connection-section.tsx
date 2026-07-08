import { readTeamConnection } from "@/lib/team-data";
import { formatRelative, formatDuration, formatTokens } from "@/lib/format";
import { ForceSyncButton } from "./force-sync-button";

const HEALTH_COLORS = {
  green: "var(--af-success, #10b981)",
  amber: "var(--af-warning, #f59e0b)",
  red: "var(--af-error, #ef4444)",
} as const;

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
        <div className="rounded border border-gray-200 p-4 space-y-3 text-sm">
          <div className="text-xs uppercase tracking-wide text-gray-500">
            Last push
            {lastPush.payload.dailyRollup ? ` — ${lastPush.payload.dailyRollup.day}` : ""}
          </div>

          {lastPush.payload.dailyRollup && (
            <dl className="grid grid-cols-[10rem_1fr] gap-y-1 text-sm text-gray-700">
              <dt className="text-gray-500">Agent time</dt>
              <dd>{formatDuration(lastPush.payload.dailyRollup.agentTimeMs)}</dd>
              <dt className="text-gray-500">Session count</dt>
              <dd>{lastPush.payload.dailyRollup.sessions}</dd>
              <dt className="text-gray-500">Tool call count</dt>
              <dd>{lastPush.payload.dailyRollup.toolCalls}</dd>
              <dt className="text-gray-500">Turn count</dt>
              <dd>{lastPush.payload.dailyRollup.turns}</dd>
              <dt className="text-gray-500">Token total</dt>
              <dd>
                {formatTokens(
                  lastPush.payload.dailyRollup.tokens.input +
                    lastPush.payload.dailyRollup.tokens.output +
                    lastPush.payload.dailyRollup.tokens.cacheRead +
                    lastPush.payload.dailyRollup.tokens.cacheWrite,
                )}
              </dd>
              {lastPush.payload.planTier && (
                <>
                  <dt className="text-gray-500">Plan tier</dt>
                  <dd>{lastPush.payload.planTier}</dd>
                </>
              )}
            </dl>
          )}

          {!lastPush.payload.dailyRollup && lastPush.payload.planTier && (
            <dl className="grid grid-cols-[10rem_1fr] gap-y-1 text-sm text-gray-700">
              <dt className="text-gray-500">Plan tier</dt>
              <dd>{lastPush.payload.planTier}</dd>
            </dl>
          )}

          {!lastPush.payload.dailyRollup && !lastPush.payload.planTier && (
            <div className="text-gray-500">Live utilization snapshot only — no new daily activity.</div>
          )}

          <details className="text-xs">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
              Show raw JSON payload
            </summary>
            <pre className="mt-2 rounded border border-gray-200 bg-gray-50 p-3 font-mono text-[11px] whitespace-pre-wrap overflow-x-auto">
              {JSON.stringify(lastPush.payload, null, 2)}
            </pre>
          </details>
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
          <li>Absolute paths, file contents, or tool-call payloads</li>
          <li>Anything from projects excluded in Synced projects below</li>
          <li>Anything from sessions older than the start-of-day rollup window</li>
        </ul>
      </div>

      <p className="text-xs text-gray-500">
        To disconnect from this team, run <code>fleetlens team leave</code> in your terminal.
      </p>
    </section>
  );
}
