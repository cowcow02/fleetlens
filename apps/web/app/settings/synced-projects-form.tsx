"use client";
import { useState } from "react";
import { ProjectSyncPicker } from "@/components/project-sync-picker";
import type { SyncProjectRow } from "@/lib/sync-projects-data";
import type { SyncProjects } from "@/lib/team-config";

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

  async function handleSave() {
    setSaving(true);
    setSavedMsg(null);
    const res = await fetch("/api/team/sync-projects", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
    setSaving(false);
    setSavedMsg(res.ok ? "Saved." : `Error: ${res.status}`);
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
    </div>
  );
}
