"use client";

import { useState } from "react";
import type { CredentialMasked } from "@claude-lens/entries/node";

export function ZaiCredentialsForm({ initial }: { initial: CredentialMasked }) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [configured, setConfigured] = useState(initial.zai?.configured ?? false);
  const [hint, setHint] = useState<string | null>(initial.zai?.hint ?? null);
  const [editing, setEditing] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSavedMsg(null);
    const res = await fetch("/api/settings/credentials", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: apiKey }),
    });
    const json = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok) {
      setSavedMsg(json?.error ?? `Error ${res.status}`);
      return;
    }
    setConfigured(json.zai?.configured ?? false);
    setHint(json.zai?.hint ?? null);
    setApiKey("");
    setEditing(false);
    setSavedMsg(json.zai?.configured ? "Z.ai API key saved." : "Z.ai API key removed.");
  }

  async function handleRemove() {
    setApiKey("");
    setSavedMsg(null);
    // Submit an empty key to trigger deleteZaiKey.
    const res = await fetch("/api/settings/credentials", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: "" }),
    });
    const json = await res.json().catch(() => null);
    if (res.ok) {
      setConfigured(false);
      setHint(null);
      setSavedMsg("Z.ai API key removed.");
    } else {
      setSavedMsg(json?.error ?? "Error removing key.");
    }
  }

  if (!editing && configured) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-gray-500">
          Z.ai API key configured ({hint}). Used by the daemon to poll your GLM Coding Plan
          usage — data stays on this machine; the key is stored at ~/.cclens/credentials.json
          (owner-read/write only).
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="af-btn" onClick={() => setEditing(true)}>
            Change key
          </button>
          <button type="button" className="af-btn" onClick={handleRemove}>
            Remove key
          </button>
        </div>
        {savedMsg && <p className="text-sm text-green-600">{savedMsg}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-sm text-gray-500">
        Enter your Z.ai API key to enable plan-usage tracking for the GLM Coding Plan.
        Get one from the{" "}
        <a href="https://z.ai/manage-apikey/apikey-list" target="_blank" rel="noreferrer" className="underline">
          Z.ai console
        </a>{" "}
        → API Keys.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="password"
          className="af-input flex-1"
          placeholder="Paste your API key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoFocus={!configured}
        />
        <button type="submit" disabled={saving} className="af-btn af-btn-primary">
          {saving ? "Saving…" : "Save"}
        </button>
        {configured && (
          <button type="button" className="af-btn" onClick={() => { setEditing(false); setApiKey(""); }}>
            Cancel
          </button>
        )}
      </div>
      {savedMsg && (
        <p className={`text-sm ${savedMsg.includes("Error") || savedMsg.includes("error") ? "text-red-600" : "text-green-600"}`}>
          {savedMsg}
        </p>
      )}
    </form>
  );
}
