"use client";

import { useEffect, useRef, useState } from "react";
import { ProjectSyncPicker } from "@/components/project-sync-picker";
import type { SyncProjectRow } from "@/lib/sync-projects-data";
import type { SyncProjects } from "@/lib/team-config";

// Mirrors packages/cli/src/team/sync.ts's SyncProgressEvent. Arrives as JSON
// over SSE `event: progress` frames — kept as a local type rather than an
// import to avoid apps/web depending on the cli package for a wire shape.
type SyncProgressEvent =
  | { type: "phase"; phase: "usage-backfill" | "activity"; totalDays?: number }
  | { type: "usage"; inserted: number; alreadyKnown: number }
  | { type: "day"; day: string; index: number; total: number; outcome: "pushed" | "queued" | "dropped" }
  | { type: "done"; pushed: number; queued: number; pushedDays: string[] }
  | { type: "error"; message: string }
  // Route fallback when a stdout line isn't valid JSON (shouldn't happen in
  // practice, but the route emits it rather than dropping the line silently).
  | { type: "log"; line: string };

type LogRow = { key: number; text: string; tone?: "warn" | "error" | "dim" };

function selectedProjectNames(projects: SyncProjectRow[], selection: SyncProjects): string[] {
  return projects
    .filter((p) => {
      if (selection.excluded.includes(p.name)) return false;
      if (selection.included.includes(p.name)) return true;
      return selection.autoIncludeNew;
    })
    .map((p) => p.name);
}

function selectionCount(projects: SyncProjectRow[], selection: SyncProjects): number {
  return selectedProjectNames(projects, selection).length;
}

// Client-side clock, not server time — matches "generated when the event
// arrives" rather than any timestamp the CLI might embed in the payload.
function logTimestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

export function OnboardingWizard({
  teamName,
  teamUrl,
  serverHost,
  projects,
  initial,
  setupPending,
}: {
  teamName: string;
  teamUrl: string;
  serverHost: string;
  projects: SyncProjectRow[];
  initial: SyncProjects;
  setupPending: boolean;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selection, setSelection] = useState<SyncProjects>(initial);
  const [streaming, setStreaming] = useState(false);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [pushed, setPushed] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  async function startSync() {
    setStreaming(true);
    setFinished(false);
    setFailure(null);
    setRows([]);
    setPushed(null);
    let seq = 0;
    const log = (text: string, tone?: LogRow["tone"]) =>
      setRows((r) => [...r, { key: seq++, text: `${logTimestamp()} ${text}`, tone }]);

    let res: Response;
    try {
      res = await fetch("/api/team/onboarding/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selection),
      });
    } catch (err) {
      setFailure(`Request failed: ${(err as Error).message}`);
      setStreaming(false);
      return;
    }

    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => null);
      setFailure(body?.error ?? `Error ${res.status}`);
      setStreaming(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const frames = buf.split("\n\n");
      buf = frames.pop() ?? "";
      for (const frame of frames) {
        const lines = frame.split("\n");
        const eventLine = lines.find((l) => l.startsWith("event: "));
        const dataLine = lines.find((l) => l.startsWith("data: "));
        if (!dataLine) continue;
        let data: unknown;
        try {
          data = JSON.parse(dataLine.slice("data: ".length));
        } catch {
          continue;
        }
        if (eventLine?.slice("event: ".length) === "done") {
          const exitCode = (data as { exitCode: number | null }).exitCode;
          if (exitCode !== 0) {
            setFailure(`fleetlens team sync exited with code ${exitCode ?? "unknown"}`);
            log(`done — exit ${exitCode ?? "unknown"}`, "error");
          }
          continue;
        }
        const ev = data as SyncProgressEvent;
        switch (ev.type) {
          case "phase":
            log(ev.phase === "usage-backfill" ? "checking plan-usage history…" : `pushing ${ev.totalDays ?? "?"} day(s), newest first…`);
            break;
          case "usage":
            log(
              ev.inserted === 0 && ev.alreadyKnown === 0
                ? "no plan-usage snapshots yet — the daemon starts collecting them automatically"
                : `usage: +${ev.inserted} snapshot(s) (${ev.alreadyKnown} already on server)`,
            );
            break;
          case "day": {
            const text =
              ev.outcome === "pushed"
                ? `✓ ${ev.day} pushed (${ev.index}/${ev.total})`
                : ev.outcome === "queued"
                  ? `⚠ ${ev.day} queued for retry (${ev.index}/${ev.total})`
                  : `✗ ${ev.day} rejected by server (${ev.index}/${ev.total})`;
            log(text, ev.outcome === "dropped" ? "error" : ev.outcome === "queued" ? "warn" : undefined);
            break;
          }
          case "done":
            setPushed(ev.pushed);
            break;
          case "error":
            log(ev.message, "error");
            setFailure(ev.message);
            break;
          case "log":
            log(ev.line, "dim");
            break;
        }
      }
    }
    setStreaming(false);
    setFinished(true);
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <StepDots step={step} />
      {step === 1 && (
        <Step1
          teamName={teamName}
          serverHost={serverHost}
          setupPending={setupPending}
          onContinue={() => setStep(2)}
        />
      )}
      {step === 2 && (
        <Step2
          projects={projects}
          selection={selection}
          onChange={setSelection}
          onBack={() => setStep(1)}
          onContinue={() => setStep(3)}
        />
      )}
      {step === 3 && (
        <Step3
          projects={projects}
          selection={selection}
          teamName={teamName}
          serverHost={serverHost}
          rows={rows}
          streaming={streaming}
          finished={finished}
          pushed={pushed}
          failure={failure}
          teamUrl={teamUrl}
          onBack={() => setStep(2)}
          onStart={startSync}
        />
      )}
    </main>
  );
}

function StepDots({ step }: { step: 1 | 2 | 3 }) {
  const labels: Array<[1 | 2 | 3, string]> = [
    [1, "What happens"],
    [2, "Choose projects"],
    [3, "Sync"],
  ];
  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      {labels.map(([n, label], i) => (
        <span key={n} className="flex items-center gap-2">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full ${
              n === step ? "bg-black text-white dark:bg-white dark:text-black" : "border border-gray-300 dark:border-gray-700"
            }`}
          >
            {n}
          </span>
          <span className={n === step ? "font-medium text-gray-900 dark:text-gray-100" : ""}>{label}</span>
          {i < labels.length - 1 && <span className="text-gray-300 dark:text-gray-700">—</span>}
        </span>
      ))}
    </div>
  );
}

function Step1({
  teamName,
  serverHost,
  setupPending,
  onContinue,
}: {
  teamName: string;
  serverHost: string;
  setupPending: boolean;
  onContinue: () => void;
}) {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">You&rsquo;re pairing with &ldquo;{teamName}&rdquo;</h1>
      {setupPending && <p className="text-sm text-gray-500">Nothing syncs until you finish this wizard.</p>}

      <div className="rounded-lg border border-gray-200 p-4 text-sm dark:border-gray-800">
        <p className="mb-2 font-medium">Shared with {serverHost} every 5 minutes:</p>
        <ul className="list-inside list-disc space-y-1 text-gray-600 dark:text-gray-400">
          <li>Daily aggregate metrics (agent time, sessions, tool calls, turns, tokens)</li>
          <li>Per-project totals — project name, agent time, session count, and GitHub repo name when one is detected</li>
          <li>Daily working style — working-shape mix, concurrency peak and parallel minutes, long-autonomous runs, plan-mode and brainstorm usage, tool-error count</li>
          <li>Daily tooling and output counts — skills and sub-agents used (names + counts), PRs, commits, pushes</li>
          <li>Session outcome mixes from AI enrichment (shipped / partial / blocked …)</li>
          <li>Plan-utilization percentages and sync health logs</li>
        </ul>
      </div>

      <div className="rounded-lg border border-gray-200 p-4 text-sm dark:border-gray-800">
        <p className="mb-2 font-medium">Never leaves this machine:</p>
        <ul className="list-inside list-disc space-y-1 text-gray-600 dark:text-gray-400">
          <li>Transcripts, prompts, and code</li>
          <li>File contents and absolute paths</li>
          <li>Anything from projects you exclude in the next step</li>
        </ul>
      </div>

      <p className="text-xs text-gray-500">Plan utilization is account-level and isn&rsquo;t affected by project selection.</p>

      <button
        type="button"
        onClick={onContinue}
        className="rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
      >
        Continue
      </button>
    </section>
  );
}

function Step2({
  projects,
  selection,
  onChange,
  onBack,
  onContinue,
}: {
  projects: SyncProjectRow[];
  selection: SyncProjects;
  onChange: (v: SyncProjects) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Choose which projects sync</h1>
      <p className="text-sm text-gray-500">
        Syncing {selectionCount(projects, selection)} of {projects.length} project{projects.length === 1 ? "" : "s"}
      </p>
      <ProjectSyncPicker projects={projects} value={selection} onChange={onChange} />
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded border border-gray-300 px-4 py-2 text-sm dark:border-gray-700"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onContinue}
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          Continue
        </button>
      </div>
    </section>
  );
}

function Step3({
  projects,
  selection,
  teamName,
  serverHost,
  rows,
  streaming,
  finished,
  pushed,
  failure,
  teamUrl,
  onBack,
  onStart,
}: {
  projects: SyncProjectRow[];
  selection: SyncProjects;
  teamName: string;
  serverHost: string;
  rows: LogRow[];
  streaming: boolean;
  finished: boolean;
  pushed: number | null;
  failure: string | null;
  teamUrl: string;
  onBack: () => void;
  onStart: () => void;
}) {
  const succeeded = finished && !failure;
  // Nothing has happened yet (not even a failed attempt) — show the summary,
  // not the log/outcome panels below.
  const notStarted = !streaming && !finished && !failure;
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [rows]);

  if (notStarted) {
    const selected = selectedProjectNames(projects, selection);
    const excludedCount = projects.length - selected.length;
    const shown = selected.slice(0, 6);
    const more = selected.length - shown.length;
    return (
      <section className="space-y-4">
        <h1 className="text-xl font-semibold">
          Syncing {selected.length} of {projects.length} project{projects.length === 1 ? "" : "s"} to &ldquo;{teamName}&rdquo; (
          {serverHost})
        </h1>

        {shown.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {shown.map((name) => (
              <span
                key={name}
                className="rounded-full border border-gray-300 px-2 py-0.5 font-mono text-xs text-gray-600 dark:border-gray-700 dark:text-gray-400"
              >
                {name}
              </span>
            ))}
            {more > 0 && <span className="self-center text-xs text-gray-500">+{more} more</span>}
          </div>
        )}

        <div className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
          {excludedCount > 0 && (
            <p>
              {excludedCount} project{excludedCount === 1 ? " stays" : "s stay"} private on this machine.
            </p>
          )}
          <p>
            {selection.autoIncludeNew ? "New projects will sync automatically." : "New projects stay private until you add them."}
          </p>
        </div>

        <ul className="list-inside list-disc space-y-1 text-xs text-gray-500">
          <li>Aggregate metrics only — never transcripts, prompts, or file contents</li>
          <li>Pushes run every 5 minutes from now on</li>
          <li>You can change the selection anytime on the Team page</li>
        </ul>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded border border-gray-300 px-4 py-2 text-sm dark:border-gray-700"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onStart}
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            Start syncing
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Sync your history</h1>

      {rows.length > 0 && (
        <div
          ref={logRef}
          className="max-h-80 space-y-0.5 overflow-y-auto rounded-lg bg-gray-950 p-3 font-mono text-xs text-gray-200"
        >
          {rows.map((r) => (
            <div
              key={r.key}
              className={r.tone === "error" ? "text-red-400" : r.tone === "warn" ? "text-amber-400" : r.tone === "dim" ? "text-gray-500" : undefined}
            >
              {r.text}
            </div>
          ))}
        </div>
      )}

      {succeeded && (
        <div className="space-y-3 rounded-lg border border-green-300 bg-green-50 p-4 text-sm dark:border-green-800 dark:bg-green-950">
          <p className="font-medium text-green-800 dark:text-green-300">
            All synced — {pushed ?? 0} day{pushed === 1 ? "" : "s"} pushed
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {/* globals.css's un-layered `a { color: inherit }` beats layered
                utilities — button-styled anchors need the ! variants. */}
            <a
              href="/team"
              className="rounded bg-black px-4 py-2 text-sm font-medium text-white! dark:bg-white dark:text-black!"
            >
              View your team sync page
            </a>
            <a
              href={teamUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-gray-300 px-4 py-2 text-sm dark:border-gray-700"
            >
              Open the team dashboard ↗
            </a>
          </div>
          <a href="/" className="block text-xs text-gray-500! underline">
            Back to overview
          </a>
        </div>
      )}

      {failure && (
        <div className="space-y-2 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          <p>{failure}</p>
          <button
            type="button"
            onClick={onStart}
            disabled={streaming}
            className="rounded border border-red-400 px-3 py-1 text-xs disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={streaming}
          className="rounded border border-gray-300 px-4 py-2 text-sm disabled:opacity-50 dark:border-gray-700"
        >
          Back
        </button>
        {!succeeded && (
          <button
            type="button"
            onClick={onStart}
            disabled={streaming}
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {streaming ? "Syncing…" : "Start syncing"}
          </button>
        )}
      </div>
    </section>
  );
}
