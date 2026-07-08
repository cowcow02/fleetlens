"use client";
import { useEffect, useRef, useState } from "react";
import { ProjectSyncPicker } from "@/components/project-sync-picker";
import type { SyncProjectRow } from "@/lib/sync-projects-data";
import type { SyncProjects } from "@/lib/team-config";

const ts = () => new Date().toTimeString().slice(0, 8);

export function SyncedProjectsForm({
  projects,
  initial,
}: {
  projects: SyncProjectRow[];
  initial: SyncProjects;
}) {
  const [value, setValue] = useState<SyncProjects>(initial);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [log, setLog] = useState<{ text: string; tone: "default" | "warn" | "error" }[] | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const append = (text: string, tone: "default" | "warn" | "error" = "default") =>
    setLog((prev) => [...(prev ?? []), { text: `${ts()}  ${text}`, tone }]);

  // Same NDJSON→SSE stream the onboarding wizard consumes; a changed
  // selection re-pushes FULL history so the server matches it.
  async function streamResync() {
    setLog([]);
    append("re-pushing your full history under the new selection…");
    try {
      const res = await fetch("/api/team/onboarding/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(value),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        append(body?.error ?? `Error ${res.status}`, "error");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buf += decoder.decode(chunk, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          const data = frame.split("\n").find((l) => l.startsWith("data: "))?.slice(6);
          if (!data) continue;
          const ev = JSON.parse(data);
          if (ev.type === "phase" && ev.phase === "activity") append(`pushing ${ev.totalDays} day(s), newest first…`);
          else if (ev.type === "day")
            append(
              ev.outcome === "pushed"
                ? `✓ ${ev.day} pushed (${ev.index}/${ev.total})`
                : `${ev.outcome === "queued" ? "⚠" : "✗"} ${ev.day} ${ev.outcome} (${ev.index}/${ev.total})`,
              ev.outcome === "pushed" ? "default" : ev.outcome === "queued" ? "warn" : "error",
            );
          else if (ev.type === "done") append(`done — ${ev.pushed} day(s) pushed`);
          else if (ev.type === "error") append(ev.message ?? "sync error", "error");
        }
      }
      append("server now matches your selection");
    } catch (err) {
      append(`stream failed: ${(err as Error).message} — the daemon finishes the re-push within ~5 min`, "warn");
    }
  }

  async function handleSave() {
    setSaving(true);
    setSavedMsg(null);
    setLog(null);
    const res = await fetch("/api/team/sync-projects", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
    const body = res.ok ? await res.json().catch(() => null) : null;
    setSaving(false);
    setSavedMsg(res.ok ? (body?.resync ? "Saved — selection changed." : "Saved.") : `Error: ${res.status}`);
    if (body?.resync) void streamResync();
  }

  return (
    <div className="space-y-4">
      <ProjectSyncPicker projects={projects} value={value} onChange={setValue} />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1 border rounded bg-black text-white disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {savedMsg && <p className="text-sm">{savedMsg}</p>}
      </div>
      {log && (
        <div
          ref={logRef}
          className="max-h-60 overflow-y-auto rounded-lg bg-gray-950 p-3 font-mono text-xs text-gray-200"
        >
          {log.map((line, i) => (
            <div
              key={i}
              className={
                line.tone === "error" ? "text-red-400" : line.tone === "warn" ? "text-amber-400" : undefined
              }
            >
              {line.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
