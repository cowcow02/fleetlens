"use client";

import { useMemo, useState } from "react";

type ProjectChoice = {
  name: string;        // canonical name — matches privateProjects[] entries
  pretty: string;      // display label
  sessions: number;    // last 30d
  worktreeCount: number;
};

export function TeamSyncForm({
  initial,
  projects,
}: {
  initial: { enrichmentOptIn: boolean; privateProjects: string[] };
  projects: ProjectChoice[];
}) {
  const [enrichmentOptIn, setEnrichmentOptIn] = useState(initial.enrichmentOptIn);
  const [privateProjects, setPrivateProjects] = useState<Set<string>>(
    new Set(initial.privateProjects),
  );
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!filter.trim()) return projects;
    const q = filter.toLowerCase();
    return projects.filter(
      (p) => p.pretty.toLowerCase().includes(q) || p.name.toLowerCase().includes(q),
    );
  }, [projects, filter]);

  function toggleProject(name: string) {
    setPrivateProjects((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setSavedMsg(null);
    const res = await fetch("/api/team-config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enrichmentOptIn,
        privateProjects: Array.from(privateProjects),
      }),
    });
    setSaving(false);
    setSavedMsg(res.ok ? "Saved. Daemon will pick up changes on next sync." : `Error: ${res.status}`);
  }

  const sharedCount = projects.length - privateProjects.size;

  return (
    <div className="space-y-6">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enrichmentOptIn}
          onChange={(e) => setEnrichmentOptIn(e.target.checked)}
          className="mt-1"
        />
        <div>
          <div className="font-medium">Share LLM-enriched fields</div>
          <p className="text-xs text-gray-500 mt-0.5">
            Sends per-day outcome / helpfulness / goal-minute distributions
            derived by your local AI features pipeline. No new model calls
            are made — fields already cached on disk ride along with the
            daily rollup.
          </p>
        </div>
      </label>

      <div className="space-y-2">
        <div className="font-medium text-sm">Private projects ({privateProjects.size} hidden, {sharedCount} shared)</div>
        <p className="text-xs text-gray-500">
          Projects you mark private stay local. Their session counts and
          working-shape distributions are stripped before the daemon pushes.
        </p>
        <input
          type="text"
          placeholder="Filter projects"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full border rounded px-2 py-1 text-sm bg-transparent"
        />
        <div className="border rounded max-h-64 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-800">
          {filtered.length === 0 ? (
            <div className="text-xs text-gray-500 p-3">
              No projects match.
            </div>
          ) : (
            filtered.map((p) => {
              const hidden = privateProjects.has(p.name);
              return (
                <label
                  key={p.name}
                  className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900"
                >
                  <input
                    type="checkbox"
                    checked={hidden}
                    onChange={() => toggleProject(p.name)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-mono truncate" title={p.name}>
                      {p.pretty}
                    </div>
                    <div className="text-xs text-gray-500">
                      {p.sessions} sessions (30d)
                      {p.worktreeCount > 0 ? ` · ${p.worktreeCount} worktrees` : ""}
                    </div>
                  </div>
                  <span className={`text-xs ${hidden ? "text-orange-600" : "text-gray-400"}`}>
                    {hidden ? "Hidden" : "Shared"}
                  </span>
                </label>
              );
            })
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-4 py-1.5 border rounded bg-black text-white text-sm disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {savedMsg && <span className="text-xs text-gray-600">{savedMsg}</span>}
      </div>
    </div>
  );
}
