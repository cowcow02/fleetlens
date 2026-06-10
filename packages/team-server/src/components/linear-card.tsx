"use client";

import { useEffect, useState } from "react";
import { ConfirmModal } from "./confirm-modal";
import { Callout, CheckChip, StatusStrip } from "./ui";

type LinearStatus = {
  connected: boolean;
  login?: string | null;
  team_keys?: string[];
  status?: "active" | "error";
  last_error?: string | null;
  last_sync_at?: string | null;
  issues_synced?: number;
  issues_completed?: number;
  issues_in_progress?: number;
};

type TeamOption = { id: string; key: string; name: string };

const KEY_URL = "https://linear.app/settings/api";

export function LinearCard({ teamSlug }: { teamSlug: string }) {
  const [lin, setLin] = useState<LinearStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [teamOptions, setTeamOptions] = useState<TeamOption[] | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [editingTeams, setEditingTeams] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    const res = await fetch(`/api/team/settings/integrations/linear?team=${teamSlug}`);
    if (!res.ok) {
      setLin({ connected: false });
      return;
    }
    setLin((await res.json()) as LinearStatus);
  }

  async function listTeams(useStoredKey: boolean) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/team/settings/integrations/linear/teams?team=${teamSlug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(useStoredKey ? {} : { apiKey }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      return;
    }
    setTeamOptions(d.teams);
    setSelectedKeys(new Set(lin?.team_keys ?? []));
  }

  async function save(withKey: boolean) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/team/settings/integrations/linear?team=${teamSlug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        withKey ? { apiKey, teamKeys: [...selectedKeys] } : { teamKeys: [...selectedKeys] },
      ),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      return;
    }
    setApiKey("");
    setTeamOptions(null);
    setEditingTeams(false);
    setReconnecting(false);
    setMessage(
      d.sync
        ? `Saved — synced ${d.sync.issues} issues (${d.sync.completed} completed). Ticket velocity is live in the insight reports.`
        : `Saved, but the first sync failed: ${d.sync_error}. Fix the key or team access, then press "Sync now".`,
    );
    await refresh();
  }

  async function syncNow() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/team/settings/integrations/linear/sync?team=${teamSlug}`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      return;
    }
    setMessage(`Synced ${d.issues} issues (${d.completed} completed).`);
    await refresh();
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    await fetch(`/api/team/settings/integrations/linear?team=${teamSlug}`, { method: "DELETE" });
    setBusy(false);
    setConfirmDisconnect(false);
    setMessage("Disconnected. Already-synced issues are kept but stop updating.");
    setApiKey("");
    setTeamOptions(null);
    await refresh();
  }

  const teamPicker = (withKey: boolean) => (
    <div style={{ marginTop: 14 }}>
      <div className="form-group">
        <label>
          Choose Linear teams
          <span className="optional" style={{ marginLeft: 8 }}>
            tickets from these teams feed the velocity metrics
          </span>
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(teamOptions ?? []).map((t) => (
            <CheckChip
              key={t.id}
              checked={selectedKeys.has(t.key)}
              onChange={() => {
                const next = new Set(selectedKeys);
                if (next.has(t.key)) next.delete(t.key);
                else next.add(t.key);
                setSelectedKeys(next);
              }}
            >
              {t.key} · {t.name}
            </CheckChip>
          ))}
        </div>
      </div>
      <div className="settings-row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => save(withKey)} disabled={busy || selectedKeys.size === 0}>
          {busy ? "Working…" : lin?.connected ? "Save teams" : `Connect (${selectedKeys.size})`}
        </button>
        <button
          className="btn-link"
          onClick={() => {
            setTeamOptions(null);
            setEditingTeams(false);
          }}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </div>
  );

  const fmtSync = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never";

  if (lin === null) return null;

  return (
    <div style={{ borderTop: "1px solid var(--rule-soft)", paddingTop: 22, marginTop: 30 }}>
      <div className="provider-head">Linear · ticket velocity for insight reports</div>

      {lin.connected ? (
        <div>
          <StatusStrip
            ok={lin.status !== "error"}
            segments={[
              <span key="who">
                Connected as <strong>{lin.login ?? "unknown"}</strong>
              </span>,
              <span key="teams" className="mono-meta">teams {lin.team_keys?.join(", ") || "—"}</span>,
              <span key="vol" className="mono-meta">
                {lin.issues_synced ?? 0} issues · {lin.issues_completed ?? 0} completed · {lin.issues_in_progress ?? 0} in progress
              </span>,
              <span key="last" className="mono-meta">last sync {fmtSync(lin.last_sync_at)}</span>,
            ]}
          />
          {lin.status === "error" && (
            <Callout tone="error">
              Last sync failed: {lin.last_error ?? "unknown error"}. If the API key was revoked, reconnect with a
              fresh one — your team selection is kept.
              <div style={{ marginTop: 10 }}>
                <button className="btn secondary" onClick={() => setReconnecting(true)} disabled={busy || reconnecting}>
                  Reconnect with a new key
                </button>
              </div>
            </Callout>
          )}
          {reconnecting && (
            <div className="form-group" style={{ maxWidth: 420, marginTop: 14 }}>
              <label htmlFor="lin-key-re">New Linear API key</label>
              <input
                id="lin-key-re"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
              />
              <div className="settings-row" style={{ marginTop: 8 }}>
                <button
                  className="btn"
                  onClick={() => {
                    setSelectedKeys(new Set(lin.team_keys ?? []));
                    save(true);
                  }}
                  disabled={busy || !apiKey}
                >
                  Save new key
                </button>
                <button className="btn-link" onClick={() => setReconnecting(false)} disabled={busy}>Cancel</button>
              </div>
            </div>
          )}
          <div className="settings-row" style={{ marginTop: 16, flexWrap: "wrap" }}>
            {!editingTeams && (
              <button
                className="btn secondary"
                onClick={() => {
                  setEditingTeams(true);
                  listTeams(true);
                }}
                disabled={busy}
              >
                Change teams
              </button>
            )}
            <button className="btn secondary" onClick={syncNow} disabled={busy}>
              {busy ? "Working…" : "Sync now"}
            </button>
            <button className="btn-link is-danger" onClick={() => setConfirmDisconnect(true)} disabled={busy}>
              Disconnect
            </button>
          </div>
          {editingTeams && teamOptions && teamPicker(false)}
        </div>
      ) : (
        <div style={{ maxWidth: 680 }}>
          <p style={{ marginTop: 0, lineHeight: 1.6, maxWidth: 640 }}>
            Connect Linear to add <strong>ticket velocity</strong> to your insight reports: tickets completed per
            week, cycle and lead time, work in progress — and how much completed work ships through AI-assisted PRs
            (joined to the GitHub integration by ticket refs like KIP-315).
          </p>
          <ol className="steps-editorial">
            <li>
              <span>
                <a href={KEY_URL} target="_blank" rel="noreferrer">Create a personal API key in Linear ↗</a> — Settings
                → Security &amp; access → API keys. Read access is enough.
              </span>
            </li>
            <li><span>Paste it below, then pick the Linear teams to track (e.g. KIP).</span></li>
          </ol>
          <div className="form-group" style={{ maxWidth: 420 }}>
            <label htmlFor="lin-key">Linear API key</label>
            <input
              id="lin-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="lin_api_…"
              autoComplete="off"
            />
          </div>
          {!teamOptions && (
            <button className="btn" onClick={() => listTeams(false)} disabled={busy || !apiKey}>
              {busy ? "Checking key…" : "Next: choose Linear teams →"}
            </button>
          )}
          {teamOptions && teamPicker(true)}
        </div>
      )}

      {error && <div className="form-error" style={{ marginTop: 14, maxWidth: 680 }}>{error}</div>}
      {message && <div className="action-note">{message}</div>}

      <ConfirmModal
        open={confirmDisconnect}
        title="Disconnect Linear?"
        body="The stored API key is deleted and hourly syncing stops. Already-synced issues stay in the report history. You can reconnect any time."
        confirmLabel="Disconnect"
        danger
        busy={busy}
        onConfirm={disconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </div>
  );
}
