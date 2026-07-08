"use client";

import { useMemo, useState } from "react";
import type { SyncProjectRow } from "@/lib/sync-projects-data";
import type { SyncProjects } from "@/lib/team-config";
import { formatRelative } from "@/lib/format";

/** Compact agent-time label for a picker row — not `formatDuration`'s "1h 30m"
 *  form, which reads noisy next to sessions/last-active in a dense list. */
function formatAgentTimeShort(ms: number): string {
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round((ms / 3_600_000) * 10) / 10}h`;
}

export function ProjectSyncPicker({
  projects,
  value,
  onChange,
}: {
  projects: SyncProjectRow[];
  value: SyncProjects;
  onChange: (v: SyncProjects) => void;
}) {
  const [query, setQuery] = useState("");

  function checked(name: string): boolean {
    if (value.excluded.includes(name)) return false;
    if (value.included.includes(name)) return true;
    return value.autoIncludeNew;
  }

  function toggle(name: string, next: boolean) {
    const included = value.included.filter((n) => n !== name);
    const excluded = value.excluded.filter((n) => n !== name);
    (next ? included : excluded).push(name);
    onChange({ ...value, included, excluded });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, query]);

  function selectAll(next: boolean) {
    let included = [...value.included];
    let excluded = [...value.excluded];
    for (const p of filtered) {
      included = included.filter((n) => n !== p.name);
      excluded = excluded.filter((n) => n !== p.name);
      (next ? included : excluded).push(p.name);
    }
    onChange({ ...value, included, excluded });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter projects…"
          className="flex-1 rounded border border-gray-300 dark:border-gray-700 bg-transparent px-2 py-1 text-sm"
        />
        <button type="button" onClick={() => selectAll(true)} className="text-xs text-gray-500 underline hover:text-gray-700">
          Select all
        </button>
        <button type="button" onClick={() => selectAll(false)} className="text-xs text-gray-500 underline hover:text-gray-700">
          Deselect all
        </button>
      </div>

      <div className="max-h-96 divide-y divide-gray-200 overflow-y-auto rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
        {filtered.length === 0 && (
          <div className="p-3 text-sm text-gray-500">No projects match &ldquo;{query}&rdquo;.</div>
        )}
        {filtered.map((p) => (
          <label
            key={p.name}
            className="flex cursor-pointer items-center gap-3 p-3 text-sm hover:bg-gray-50 dark:hover:bg-gray-900"
          >
            <input type="checkbox" checked={checked(p.name)} onChange={(e) => toggle(p.name, e.target.checked)} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono">{p.name}</div>
              <div className="text-xs text-gray-500">
                {p.sessions} session{p.sessions === 1 ? "" : "s"} · {formatAgentTimeShort(p.agentTimeMs)}
                {p.lastActiveMs !== null && <> · {formatRelative(new Date(p.lastActiveMs).toISOString())}</>}
                {p.worktreeCount > 1 && <> · ×{p.worktreeCount} worktrees</>}
              </div>
            </div>
          </label>
        ))}
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.autoIncludeNew}
          onChange={(e) => onChange({ ...value, autoIncludeNew: e.target.checked })}
        />
        <span>
          Automatically sync projects that appear later
          <span className="mt-0.5 block text-xs text-gray-500">Unchecked projects never leave this machine.</span>
        </span>
      </label>
    </div>
  );
}
