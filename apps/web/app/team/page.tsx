/**
 * Team-sync consent page.
 *
 * Shows the user which team their daemon is paired with, what data flows
 * over the wire on the next push, and lets them toggle the two opt-outs
 * the bridge respects: per-project privacy and LLM-enriched extras.
 *
 * The page works against the same on-disk team-config.json the daemon
 * reads, so a change here propagates to the next `fleetlens team push`.
 */
import Link from "next/link";
import { groupByProject, type SessionMeta } from "@claude-lens/parser";
import { listSessions } from "@/lib/data";
import { readTeamConfig, toTeamConfigView } from "@/lib/team-config";
import { TeamSyncForm } from "./team-sync-form";
import { prettyProjectName } from "@/lib/format";

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

function recentDaysFilter<T extends SessionMeta>(sessions: T[], days: number): T[] {
  const cutoff = Date.now() - days * 86_400_000;
  return sessions.filter((s) => {
    if (!s.firstTimestamp) return false;
    const ms = Date.parse(s.firstTimestamp);
    return !Number.isNaN(ms) && ms >= cutoff;
  });
}

export default async function TeamPage() {
  const config = readTeamConfig();
  const allSessions = await listSessions();
  const recent = recentDaysFilter(allSessions, 30);
  const projects = groupByProject(recent)
    .map((p) => ({
      name: p.projectName,
      pretty: prettyProjectName(p.projectName),
      sessions: p.sessions.length,
      worktreeCount: p.worktreeCount,
    }))
    .sort((a, b) => b.sessions - a.sessions);

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
  const privateProjects = new Set(config.privateProjects ?? []);
  const enrichmentOptIn = !!config.enrichmentOptIn;
  const sharedCount = projects.filter((p) => !privateProjects.has(p.name)).length;

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Team sync</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage what your daemon shares with your team server.
        </p>
      </header>

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

      <section className="border rounded-lg p-5 space-y-4">
        <div>
          <h2 className="text-lg font-medium">What gets shared</h2>
          <p className="text-sm text-gray-500 mt-1">
            Toggles below take effect on the daemon&rsquo;s next push (usually
            within 5 minutes). See{" "}
            <Link
              href="https://github.com/cowcow02/fleetlens"
              className="underline"
            >
              the bridge design spec
            </Link>{" "}
            for the full data inventory.
          </p>
        </div>

        <TeamSyncForm
          initial={{ enrichmentOptIn, privateProjects: Array.from(privateProjects) }}
          projects={projects}
        />
      </section>

      <section className="border rounded-lg p-5 space-y-3">
        <h2 className="text-lg font-medium">Next push will carry</h2>
        <ul className="text-sm space-y-2">
          <li>
            <strong>Daily rollup</strong> — agent time, session count, tool
            calls, turns, token totals. Always shared.
          </li>
          <li>
            <strong>Rich rollup</strong> (Entry-derived counts) for{" "}
            <strong>{sharedCount}</strong> of {projects.length} active projects:
            working-shape distribution, top skills, subagents dispatched,
            long-autonomous turns, plan-mode usage, brainstorm warmups, tool
            errors, PRs/commits/pushes. Project labels only; never raw
            prompts or agent output.
          </li>
          <li>
            <strong>Plan utilization snapshot</strong> — current 5h + 7d
            utilization windows, per Anthropic&rsquo;s rate-limit API. Always
            shared when fresh.
          </li>
          <li>
            <strong>Enriched extras</strong> (outcome / helpfulness / goal
            minute mix):{" "}
            {enrichmentOptIn ? (
              <span className="text-green-700 dark:text-green-400">opted in</span>
            ) : (
              <span className="text-gray-500">disabled</span>
            )}
          </li>
        </ul>
        <p className="text-xs text-gray-500 pt-2">
          Never shared: first-user prompts, final-agent output, raw transcript
          text, tool inputs/outputs.
        </p>
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
