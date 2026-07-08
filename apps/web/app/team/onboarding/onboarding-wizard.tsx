"use client";

import { useState } from "react";
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

type LogRow = { key: number; text: string; tone?: "info" | "warn" | "error" };

function selectionCount(projects: SyncProjectRow[], selection: SyncProjects): number {
  return projects.filter((p) => {
    if (selection.excluded.includes(p.name)) return false;
    if (selection.included.includes(p.name)) return true;
    return selection.autoIncludeNew;
  }).length;
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
    const log = (text: string, tone?: LogRow["tone"]) => setRows((r) => [...r, { key: seq++, text, tone }]);

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
          if (exitCode !== 0) setFailure(`fleetlens team sync exited with code ${exitCode ?? "unknown"}`);
          continue;
        }
        const ev = data as SyncProgressEvent;
        switch (ev.type) {
          case "phase":
            log(ev.phase === "usage-backfill" ? "Uploading usage history…" : `Pushing ${ev.totalDays ?? "?"} days of activity…`);
            break;
          case "usage":
            log(`✓ Usage history: ${ev.inserted} new snapshots (${ev.alreadyKnown} already on server)`);
            break;
          case "day": {
            const suffix = ev.outcome === "pushed" ? "✓" : ev.outcome === "queued" ? "⚠ queued for retry" : "✗ rejected";
            log(`${ev.day} ${suffix}`, ev.outcome === "dropped" ? "error" : ev.outcome === "queued" ? "warn" : undefined);
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
            log(ev.line);
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
          <li>Per-project totals — project name, agent time, session count</li>
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
  rows,
  streaming,
  finished,
  pushed,
  failure,
  teamUrl,
  onBack,
  onStart,
}: {
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
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Sync your history</h1>

      {rows.length > 0 && (
        <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-3 font-mono text-xs dark:border-gray-800">
          {rows.map((r) => (
            <div
              key={r.key}
              className={r.tone === "error" ? "text-red-600" : r.tone === "warn" ? "text-amber-600" : "text-gray-600 dark:text-gray-400"}
            >
              {r.text}
            </div>
          ))}
        </div>
      )}

      {succeeded && (
        <div className="space-y-2 rounded-lg border border-green-300 bg-green-50 p-4 text-sm dark:border-green-800 dark:bg-green-950">
          <p className="font-medium text-green-800 dark:text-green-300">
            All synced — {pushed ?? 0} day{pushed === 1 ? "" : "s"} pushed
          </p>
          <div className="flex gap-4 text-sm">
            <a href={teamUrl} target="_blank" rel="noreferrer" className="underline">
              Open your team dashboard →
            </a>
            <a href="/" className="underline">
              Go to your local dashboard
            </a>
          </div>
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
