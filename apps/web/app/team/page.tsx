/**
 * Team-sync status page.
 *
 * Shows which team this machine's daemon is paired with and what data flows
 * over the wire on the next push. All LLM-enriched fields are shared for
 * every synced project; which projects are synced is the member's own
 * choice (Settings' Synced-projects selection, seeded by the onboarding
 * wizard). The page reads the same on-disk team-config.json the daemon reads.
 */
import { readTeamConfig, toTeamConfigView } from "@/lib/team-config";
import { SyncedProjectsSection } from "./synced-projects-section";
import { SyncActivitySection } from "./sync-activity-section";

export const dynamic = "force-dynamic";

function lastSyncedDayLabel(d: string | undefined): string {
  if (!d) return "never";
  return d;
}

function lastSyncedSnapshotLabel(iso: string | undefined): string {
  if (!iso) return "never";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const ageMs = Date.now() - ms;
  // Future-dated timestamps (clock skew, mocked fixtures) fall back to the
  // absolute label so the UI never shows "-NNNs ago".
  if (ageMs < 0) return new Date(ms).toLocaleString();
  if (ageMs < 60_000) return `${Math.round(ageMs / 1_000)}s ago`;
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.round(ageMs / 3_600_000)}h ago`;
  return new Date(ms).toLocaleString();
}

export default function TeamPage() {
  const config = readTeamConfig();

  if (!config) {
    return (
      <main className="mx-auto max-w-3xl p-6 space-y-6">
        <h1 className="text-2xl font-semibold">Team sync</h1>
        <section className="border border-dashed rounded-lg p-6 text-sm space-y-3">
          <p className="font-medium">Not paired with any team.</p>
          <p className="text-gray-600">
            To pair this machine with a Fleetlens team server, run from a
            terminal:
          </p>
          <pre className="bg-gray-100 dark:bg-gray-900 p-3 rounded text-xs overflow-x-auto">
fleetlens team join &lt;server-url&gt; &lt;invite-token&gt;
          </pre>
          <p className="text-gray-600">
            Your team admin can generate an invite token from the team
            server&rsquo;s Settings page.
          </p>
        </section>
      </main>
    );
  }

  const view = toTeamConfigView(config);
  const sp = config.syncProjects;
  const syncSummary = sp
    ? sp.autoIncludeNew
      ? `Syncing: all projects except ${sp.excluded.length} excluded`
      : `Syncing: only ${sp.included.length} selected project${sp.included.length === 1 ? "" : "s"}`
    : null;

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Team sync</h1>
        <p className="text-sm text-gray-500 mt-1">
          What your daemon shares with your team server.
        </p>
      </header>

      {config.setupPending && (
        <div className="border border-amber-400/40 bg-amber-400/10 rounded-lg p-4 text-sm">
          Setup isn&rsquo;t finished — nothing is syncing yet.{" "}
          <a className="underline font-medium" href="/team/onboarding">Finish onboarding</a>
        </div>
      )}

      <section className="border rounded-lg p-5 space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-medium">Pairing</h2>
          <span className="text-xs uppercase tracking-wide text-green-700 dark:text-green-400">
            Connected
          </span>
        </div>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-gray-500">Team slug</dt>
          <dd className="font-mono">{view.teamSlug}</dd>
          <dt className="text-gray-500">Server</dt>
          <dd className="font-mono break-all">{view.serverUrl}</dd>
          <dt className="text-gray-500">Member ID</dt>
          <dd className="font-mono break-all text-xs">{view.memberId}</dd>
          <dt className="text-gray-500">Bearer token</dt>
          <dd className="font-mono text-xs">{view.bearerTokenMasked}</dd>
          <dt className="text-gray-500">Paired</dt>
          <dd>{new Date(view.pairedAt).toLocaleString()}</dd>
          <dt className="text-gray-500">Last day pushed</dt>
          <dd>{lastSyncedDayLabel(view.lastSyncedDay)}</dd>
          <dt className="text-gray-500">Last usage snapshot</dt>
          <dd>{lastSyncedSnapshotLabel(view.lastSyncedUsageSnapshotAt)}</dd>
        </dl>
      </section>

      <section className="border rounded-lg p-5">
        <SyncActivitySection />
      </section>

      <section className="border rounded-lg p-5">
        <SyncedProjectsSection />
      </section>

      <section className="border rounded-lg p-5 space-y-3">
        <h2 className="text-lg font-medium">What gets shared</h2>
        <p className="text-sm text-gray-500">
          {syncSummary ?? "Syncing: all projects (no selection set)."}
        </p>
        <ul className="text-sm space-y-2">
          <li>
            <strong>Daily rollup</strong> — agent time, session count, tool
            calls, turns, token totals.
          </li>
          <li>
            <strong>Rich rollup</strong> (Entry-derived counts) for each
            synced project: working-shape distribution, top skills, subagents
            dispatched, long-autonomous turns, plan-mode usage, brainstorm
            warmups, tool errors, PRs/commits/pushes. Project labels only;
            never raw prompts or agent output.
          </li>
          <li>
            <strong>Plan utilization snapshot</strong> — current 5h + 7d
            utilization windows, per Anthropic&rsquo;s rate-limit API.
          </li>
          <li>
            <strong>Enriched extras</strong> — outcome / helpfulness / goal
            minute mix, derived locally by your AI-features pipeline (no new
            model calls ride along with the push).
          </li>
        </ul>
        <div className="rounded border border-gray-200 dark:border-gray-800 p-4 text-sm space-y-2">
          <div className="font-medium">What does NOT leave your machine</div>
          <ul className="list-disc list-inside text-gray-600 space-y-1">
            <li>Session transcripts, prompts, or assistant responses</li>
            <li>Absolute paths, file contents, or tool-call payloads</li>
            <li>Anything from projects you exclude above</li>
            <li>Anything from sessions older than the start-of-day rollup window</li>
          </ul>
        </div>
      </section>

      <section className="border rounded-lg p-5 space-y-3">
        <h2 className="text-lg font-medium">Disconnect</h2>
        <p className="text-sm text-gray-600">
          To leave the team and stop all syncing, run:
        </p>
        <pre className="bg-gray-100 dark:bg-gray-900 p-3 rounded text-xs">
fleetlens team leave
        </pre>
      </section>
    </main>
  );
}
