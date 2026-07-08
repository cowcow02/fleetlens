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
  // Last-persisted selection — the read-only summary renders from this, so a
  // cancelled edit or in-flight change never lies about what's syncing.
  const [saved, setSaved] = useState<SyncProjects>(initial);
  const [editing, setEditing] = useState(false);
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
          let ev;
          try {
            ev = JSON.parse(data);
          } catch {
            continue;
          }
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
    const body = await res.json().catch(() => null);
    setSaving(false);
    setSavedMsg(
      res.ok ? (body?.resync ? "Saved — selection changed." : "Saved.") : (body?.error ?? `Error: ${res.status}`),
    );
    if (res.ok) {
      setSaved(value);
      setEditing(false);
    }
    if (body?.resync) void streamResync();
  }

  const isSynced = (name: string) =>
    saved.excluded.includes(name) ? false : saved.included.includes(name) ? true : saved.autoIncludeNew;
  const synced = projects.filter((p) => isSynced(p.name));
  const privateCount = projects.length - synced.length;

  return (
    <div className="space-y-4">
      {!editing && (
        <div className="space-y-3">
          <p className="text-sm">
            Syncing <strong>{synced.length}</strong> of {projects.length} projects
            {saved.autoIncludeNew ? " — new projects sync automatically." : " — new projects stay private."}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {synced.slice(0, 8).map((p) => (
              <a
                key={p.name}
                href={`/projects/${encodeURIComponent(p.projectDir)}`}
                className="af-chip"
              >
                {p.name}
              </a>
            ))}
            {synced.length > 8 && (
              <span className="px-2 py-0.5 text-xs text-gray-500">+{synced.length - 8} more</span>
            )}
          </div>
          {privateCount > 0 && (
            <p className="text-xs text-gray-500">
              {privateCount} project{privateCount === 1 ? " stays" : "s stay"} private on this machine.
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setValue(saved);
                setSavedMsg(null);
                setEditing(true);
              }}
              className="af-btn"
            >
              Edit selection
            </button>
            {savedMsg && <p className="text-sm">{savedMsg}</p>}
          </div>
        </div>
      )}
      {editing && (
        <>
          <ProjectSyncPicker projects={projects} value={value} onChange={setValue} />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="af-btn-primary"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setValue(saved);
                setEditing(false);
                setSavedMsg(null);
              }}
              disabled={saving}
              className="af-btn"
            >
              Cancel
            </button>
            {savedMsg && <p className="text-sm">{savedMsg}</p>}
          </div>
        </>
      )}
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
