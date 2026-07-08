"use client";
import { useState } from "react";

type Initial = {
  enabled: boolean;
  autoBackfillLastWeek: boolean;
  autoBackfillYesterday: boolean;
};

export function AiFeaturesForm({ initial }: { initial: Initial }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [autoBackfillLastWeek, setAutoBackfillLastWeek] = useState(initial.autoBackfillLastWeek);
  const [autoBackfillYesterday, setAutoBackfillYesterday] = useState(initial.autoBackfillYesterday);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSavedMsg(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ai_features: { enabled, autoBackfillLastWeek, autoBackfillYesterday },
      }),
    });
    setSaving(false);
    setSavedMsg(res.ok ? "Saved." : `Error: ${res.status}`);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
        <span>Enable AI digests and enrichment</span>
      </label>

      <label className={`flex items-start gap-2 ${enabled ? "" : "opacity-50"}`}>
        <input
          type="checkbox"
          checked={autoBackfillYesterday}
          disabled={!enabled}
          onChange={e => setAutoBackfillYesterday(e.target.checked)}
        />
        <span>
          Auto-backfill yesterday's digest on daemon start
          <span className="block text-xs text-gray-500 mt-0.5">
            Generates yesterday's enriched entries and day digest. Runs once
            per daemon boot. Without this, yesterday's digest only appears
            after you load the homepage.
          </span>
        </span>
      </label>

      <label className={`flex items-start gap-2 ${enabled ? "" : "opacity-50"}`}>
        <input
          type="checkbox"
          checked={autoBackfillLastWeek}
          disabled={!enabled}
          onChange={e => setAutoBackfillLastWeek(e.target.checked)}
        />
        <span>
          Auto-backfill last week's narrative on daemon start
          <span className="block text-xs text-gray-500 mt-0.5">
            Generates enriched entries, day digests, and the weekly digest for
            the most recently completed ISO week. Runs once per ISO week.
          </span>
        </span>
      </label>

      <button
        type="submit"
        disabled={saving}
        className="af-btn-primary"
      >
        {saving ? "Saving…" : "Save"}
      </button>
      {savedMsg && <p className="text-sm">{savedMsg}</p>}
    </form>
  );
}
