"use client";

import { useEffect, useState } from "react";
import { ConfirmModal } from "./confirm-modal";
import { Callout, CheckChip, isAuthSyncError, StatusStrip } from "./ui";

type GroupOpt = { id: string; slug: string; name: string };

type TeamMapping = { key: string; group_ids: string[] };
type TeamStatus = TeamMapping & {
  issues_synced: number;
  issues_completed: number;
  issues_in_progress: number;
};

type LinearConnection = {
  id: string;
  label: string;
  owner_group_id: string | null;
  owner_group_name: string | null;
  login?: string | null;
  teams: TeamStatus[];
  status?: "active" | "error";
  last_error?: string | null;
  last_sync_at?: string | null;
  issues_synced?: number;
  issues_completed?: number;
  issues_in_progress?: number;
};

type LinearStatus = {
  connected: boolean;
  connections: LinearConnection[];
};

type TeamOption = { id: string; key: string; name: string };

const KEY_URL = "https://linear.app/settings/api";

export function LinearCard({ teamSlug, groups = [] }: { teamSlug: string; groups?: GroupOpt[] }) {
  const [lin, setLin] = useState<LinearStatus | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    const res = await fetch(`/api/team/settings/integrations/linear?team=${teamSlug}`);
    if (!res.ok) {
      setLin({ connected: false, connections: [] });
      return;
    }
    const d = (await res.json()) as LinearStatus;
    setLin({ connected: d.connected, connections: d.connections ?? [] });
  }

  if (lin === null) return null;
  const connections = lin.connections ?? [];

  return (
    <div style={{ borderTop: "1px solid var(--rule-soft)", paddingTop: 22, marginTop: 30 }}>
      <div className="provider-head">Linear · ticket velocity for insight reports</div>

      {connections.map((connection) => (
        <LinearConnectionCard
          key={connection.id}
          teamSlug={teamSlug}
          groups={groups}
          connection={connection}
          onRefresh={refresh}
        />
      ))}
      {(connections.length === 0 || showAdd) && (
        <LinearConnectForm
          teamSlug={teamSlug}
          groups={groups}
          onSaved={async (notice) => {
            setMessage(notice);
            setShowAdd(false);
            await refresh();
          }}
          onCancel={connections.length > 0 ? () => setShowAdd(false) : undefined}
        />
      )}
      {connections.length > 0 && !showAdd && (
        <button className="btn secondary" onClick={() => setShowAdd(true)} style={{ marginTop: 14 }}>
          + Add another Linear
        </button>
      )}
      {message && <div className="action-note">{message}</div>}
    </div>
  );
}

function LinearConnectForm({
  teamSlug,
  groups,
  onSaved,
  onCancel,
}: {
  teamSlug: string;
  groups: GroupOpt[];
  onSaved: (message: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [ownerGroupId, setOwnerGroupId] = useState("");
  const [teamOptions, setTeamOptions] = useState<TeamOption[] | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function listTeams() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/team/settings/integrations/linear/teams?team=${teamSlug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      return;
    }
    setTeamOptions(d.teams ?? []);
    setSelectedKeys(new Set());
  }

  async function connectSelected() {
    setBusy(true);
    setError(null);
    const teams = [...selectedKeys].map((key) => ({ key, group_ids: [] as string[] }));
    const res = await fetch(`/api/team/settings/integrations/linear?team=${teamSlug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        teams,
        label: label.trim() || undefined,
        owner_group_id: ownerGroupId || null,
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      return;
    }
    setApiKey("");
    setTeamOptions(null);
    await onSaved(
      d.sync
        ? `Saved — synced ${d.sync.issues} issues (${d.sync.completed} completed). Ticket velocity is live in the insight reports.`
        : `Saved, but the first sync failed: ${d.sync_error}. Fix the key or team access, then press "Sync now".`,
    );
  }

  return (
    <div style={{ maxWidth: 680, marginTop: 14 }}>
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
        <label htmlFor="lin-label">Label <span className="optional">optional</span></label>
        <input
          id="lin-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Linear"
        />
      </div>
      <div className="form-group" style={{ maxWidth: 420 }}>
        <label htmlFor="lin-owner-group">Owner group</label>
        <select
          id="lin-owner-group"
          value={ownerGroupId}
          onChange={(e) => setOwnerGroupId(e.target.value)}
          style={{ padding: "9px 12px", border: "1px solid var(--rule)", background: "var(--bg)", fontSize: 14, fontFamily: "JetBrains Mono, monospace", color: "var(--ink)" }}
        >
          <option value="">Org-level</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>
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
        <div className="settings-row">
          <button className="btn" onClick={listTeams} disabled={busy || !apiKey}>
            {busy ? "Checking key…" : "Next: choose Linear teams →"}
          </button>
          {onCancel && <button className="btn-link" onClick={onCancel} disabled={busy}>Cancel</button>}
        </div>
      )}
      {teamOptions && (
        <TeamPicker
          teamOptions={teamOptions}
          selectedKeys={selectedKeys}
          setSelectedKeys={setSelectedKeys}
          busy={busy}
          confirmLabel={`Connect (${selectedKeys.size})`}
          onConfirm={connectSelected}
          onCancel={() => setTeamOptions(null)}
        />
      )}
      {error && <div className="form-error" style={{ marginTop: 14, maxWidth: 680 }}>{error}</div>}
    </div>
  );
}

function LinearConnectionCard({
  teamSlug,
  groups,
  connection,
  onRefresh,
}: {
  teamSlug: string;
  groups: GroupOpt[];
  connection: LinearConnection;
  onRefresh: () => Promise<void>;
}) {
  const [apiKey, setApiKey] = useState("");
  const [teamOptions, setTeamOptions] = useState<TeamOption[] | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [editingTeams, setEditingTeams] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [mapping, setMapping] = useState<TeamMapping[]>([]);
  const [mappingDirty, setMappingDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    setMapping((connection.teams ?? []).map((t) => ({ key: t.key, group_ids: t.group_ids })));
    setMappingDirty(false);
  }, [connection]);

  async function listTeams() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/team/settings/integrations/linear/teams?team=${teamSlug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: connection.id }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      return;
    }
    setTeamOptions(d.teams ?? []);
    setSelectedKeys(new Set(mapping.map((t) => t.key)));
  }

  async function save(payload: { apiKey?: string; teams: TeamMapping[] }) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/team/settings/integrations/linear?team=${teamSlug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: connection.id, ...payload }),
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
    await onRefresh();
  }

  function selectionToMappings(): TeamMapping[] {
    return [...selectedKeys].map(
      (key) => mapping.find((t) => t.key === key) ?? { key, group_ids: [] },
    );
  }

  async function syncNow() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/team/settings/integrations/linear/sync?team=${teamSlug}&id=${connection.id}`, {
      method: "POST",
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      return;
    }
    setMessage(`Synced ${d.issues} issues (${d.completed} completed).`);
    await onRefresh();
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/team/settings/integrations/linear?team=${teamSlug}&id=${connection.id}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      return;
    }
    setConfirmDisconnect(false);
    setMessage("Disconnected. Already-synced issues are kept but stop updating.");
    setApiKey("");
    setTeamOptions(null);
    await onRefresh();
  }

  function toggleGroup(teamKey: string, groupId: string | "all") {
    setMapping((prev) =>
      prev.map((t) => {
        if (t.key !== teamKey) return t;
        if (groupId === "all") return { ...t, group_ids: [] };
        const current = t.group_ids.length === 0 ? groups.map((g) => g.id) : t.group_ids;
        const next = current.includes(groupId)
          ? current.filter((g) => g !== groupId)
          : [...current, groupId];
        const coversAll = groups.every((g) => next.includes(g.id));
        return { ...t, group_ids: coversAll || next.length === 0 ? [] : next };
      }),
    );
    setMappingDirty(true);
  }

  const fmtSync = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never";

  return (
    <div style={{ border: "1px solid var(--rule)", padding: 16, marginTop: 14 }}>
      <div className="settings-row" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong>{connection.label || "Linear"}</strong>
          {connection.owner_group_name && <span className="badge-tag">{connection.owner_group_name}</span>}
        </div>
      </div>
      <StatusStrip
        ok={connection.status !== "error"}
        segments={[
          <span key="who">
            Connected as <strong>{connection.login ?? "unknown"}</strong>
          </span>,
          <span key="cadence" className="mono-meta">syncs hourly</span>,
          <span key="vol" className="mono-meta">
            {connection.issues_synced ?? 0} issues · {connection.issues_completed ?? 0} completed · {connection.issues_in_progress ?? 0} in progress
          </span>,
          <span key="last" className="mono-meta">last successful sync {fmtSync(connection.last_sync_at)}</span>,
        ]}
      />
      {connection.status === "error" &&
        (isAuthSyncError(connection.last_error) ? (
          <Callout tone="error">
            Linear rejected the stored API key on the last sync ({connection.last_error}). It was likely revoked —
            reconnect with a fresh one; your team selection is kept.
            <div style={{ marginTop: 10 }}>
              <button className="btn secondary" onClick={() => setReconnecting(true)} disabled={busy || reconnecting}>
                Reconnect with a new key
              </button>
            </div>
          </Callout>
        ) : (
          <Callout>
            Couldn&rsquo;t reach Linear on the last sync attempt ({connection.last_error ?? "network error"}) — usually
            a dropped connection or the machine being offline. It retries automatically every hour, or press
            &ldquo;Sync now&rdquo; to retry immediately.
          </Callout>
        ))}
      {reconnecting && (
        <div className="form-group" style={{ maxWidth: 420, marginTop: 14 }}>
          <label htmlFor={`lin-key-re-${connection.id}`}>New Linear API key</label>
          <input
            id={`lin-key-re-${connection.id}`}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />
          <div className="settings-row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => save({ apiKey, teams: mapping })} disabled={busy || !apiKey}>
              Save new key
            </button>
            <button className="btn-link" onClick={() => setReconnecting(false)} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

      <table className="member-table" style={{ marginTop: 18 }}>
        <thead>
          <tr>
            <th>Linear team</th>
            <th>Issues</th>
            <th>Counts toward</th>
          </tr>
        </thead>
        <tbody>
          {mapping.map((t) => {
            const status = connection.teams?.find((x) => x.key === t.key);
            const all = t.group_ids.length === 0;
            return (
              <tr key={t.key}>
                <td className="mono" style={{ fontSize: 13, paddingRight: 12 }}>{t.key}</td>
                <td className="mono" style={{ fontSize: 12, color: "var(--mute)", whiteSpace: "nowrap" }}>
                  {status
                    ? `${status.issues_completed} completed · ${status.issues_in_progress} in progress`
                    : "not synced yet"}
                </td>
                <td>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <CheckChip checked={all} onChange={() => toggleGroup(t.key, "all")}>
                      All groups
                    </CheckChip>
                    {groups.map((g) => (
                      <CheckChip
                        key={g.id}
                        checked={!all && t.group_ids.includes(g.id)}
                        implied={all}
                        onChange={() => toggleGroup(t.key, g.id)}
                      >
                        {g.name}
                      </CheckChip>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="help-note" style={{ maxWidth: 680 }}>
        &ldquo;Counts toward&rdquo; decides which group reports include each Linear team&rsquo;s ticket velocity
        — same model as the GitHub repos above. New teams default to all groups; changes apply on save.
      </p>

      <div className="settings-row" style={{ marginTop: 16, flexWrap: "wrap" }}>
        {mappingDirty && (
          <button className="btn" onClick={() => save({ teams: mapping })} disabled={busy}>
            {busy ? "Saving…" : "Save group mapping"}
          </button>
        )}
        {!editingTeams && (
          <button
            className="btn secondary"
            onClick={() => {
              setEditingTeams(true);
              listTeams();
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
      {editingTeams && teamOptions && (
        <TeamPicker
          teamOptions={teamOptions}
          selectedKeys={selectedKeys}
          setSelectedKeys={setSelectedKeys}
          busy={busy}
          confirmLabel="Save teams"
          onConfirm={() => save({ teams: selectionToMappings() })}
          onCancel={() => {
            setTeamOptions(null);
            setEditingTeams(false);
          }}
        />
      )}

      {error && <div className="form-error" style={{ marginTop: 14, maxWidth: 680 }}>{error}</div>}
      {message && <div className="action-note">{message}</div>}

      <ConfirmModal
        open={confirmDisconnect}
        title={`Disconnect ${connection.label || "Linear"}?`}
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

function TeamPicker({
  teamOptions,
  selectedKeys,
  setSelectedKeys,
  busy,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  teamOptions: TeamOption[];
  selectedKeys: Set<string>;
  setSelectedKeys: (value: Set<string>) => void;
  busy: boolean;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <div className="form-group">
        <label>
          Choose Linear teams
          <span className="optional" style={{ marginLeft: 8 }}>
            tickets from these teams feed the velocity metrics
          </span>
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {teamOptions.map((t) => (
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
        <button className="btn" onClick={onConfirm} disabled={busy || selectedKeys.size === 0}>
          {busy ? "Working…" : confirmLabel}
        </button>
        <button className="btn-link" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
