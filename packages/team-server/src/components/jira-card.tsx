"use client";

import { useState, useEffect } from "react";
import { ConfirmModal } from "./confirm-modal";
import { Callout, CheckChip, isAuthSyncError, StatusStrip } from "./ui";

type GroupOpt = { id: string; slug: string; name: string };

type ProjectMapping = { key: string; group_ids: string[] };
type ProjectStatus = ProjectMapping & {
  issues_synced: number;
  issues_completed: number;
  issues_in_progress: number;
};

type JiraConnection = {
  id: string;
  label: string;
  owner_group_id: string | null;
  owner_group_name: string | null;
  login?: string | null;
  site?: string | null;
  projects: ProjectStatus[];
  status?: "active" | "error";
  last_error?: string | null;
  last_sync_at?: string | null;
  issues_synced?: number;
  issues_completed?: number;
  issues_in_progress?: number;
};

type JiraStatus = {
  connected: boolean;
  connections: JiraConnection[];
};

type ProjectOption = { id: string; key: string; name: string };

const TOKEN_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";

export function JiraCard({ teamSlug, groups = [] }: { teamSlug: string; groups?: GroupOpt[] }) {
  const [jira, setJira] = useState<JiraStatus | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    const res = await fetch(`/api/team/settings/integrations/jira?team=${teamSlug}`);
    if (!res.ok) {
      setJira({ connected: false, connections: [] });
      return;
    }
    const d = (await res.json()) as JiraStatus;
    setJira({ connected: d.connected, connections: d.connections ?? [] });
  }

  if (jira === null) return null;
  const connections = jira.connections ?? [];

  return (
    <div style={{ borderTop: "1px solid var(--rule-soft)", paddingTop: 22, marginTop: 30 }}>
      <div className="provider-head">Jira · ticket velocity for insight reports</div>

      {connections.map((connection) => (
        <JiraConnectionCard
          key={connection.id}
          teamSlug={teamSlug}
          groups={groups}
          connection={connection}
          onRefresh={refresh}
        />
      ))}
      {(connections.length === 0 || showAdd) && (
        <JiraConnectForm
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
          + Add another Jira
        </button>
      )}
      {message && <div className="action-note">{message}</div>}
    </div>
  );
}

function JiraConnectForm({
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
  const [site, setSite] = useState("");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [label, setLabel] = useState("");
  const [ownerGroupId, setOwnerGroupId] = useState("");
  const [projectOptions, setProjectOptions] = useState<ProjectOption[] | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function listProjects() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/team/settings/integrations/jira/projects?team=${teamSlug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site, email, apiToken }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      return;
    }
    setProjectOptions(d.projects ?? []);
    setSelectedKeys(new Set());
  }

  async function connectSelected() {
    setBusy(true);
    setError(null);
    const projects = [...selectedKeys].map((key) => ({ key, group_ids: [] as string[] }));
    const res = await fetch(`/api/team/settings/integrations/jira?team=${teamSlug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site,
        email,
        apiToken,
        projects,
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
    setApiToken("");
    setProjectOptions(null);
    await onSaved(
      d.sync
        ? `Saved — synced ${d.sync.issues} issues (${d.sync.completed} completed). Ticket velocity is live in the insight reports.`
        : `Saved, but the first sync failed: ${d.sync_error}. Fix the credentials or project access, then press "Sync now".`,
    );
  }

  return (
    <div style={{ maxWidth: 680, marginTop: 14 }}>
      <p style={{ marginTop: 0, lineHeight: 1.6, maxWidth: 640 }}>
        Connect Jira to add <strong>ticket velocity</strong> to your insight reports: tickets completed per week,
        cycle and lead time, work in progress — and how much completed work ships through AI-assisted PRs (joined
        to the GitHub integration by ticket refs like ENG-315).
      </p>
      <ol className="steps-editorial">
        <li>
          <span>
            <a href={TOKEN_URL} target="_blank" rel="noreferrer">Create an API token in Atlassian ↗</a> — Profile
            → Security → API tokens. Read access via your account is enough.
          </span>
        </li>
        <li><span>Enter your Jira site, account email and the token, then pick the projects to track (e.g. ENG).</span></li>
      </ol>
      <div className="form-group" style={{ maxWidth: 420 }}>
        <label htmlFor="jira-label">Label <span className="optional">optional</span></label>
        <input
          id="jira-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Jira"
        />
      </div>
      <div className="form-group" style={{ maxWidth: 420 }}>
        <label htmlFor="jira-owner-group">Owner group</label>
        <select
          id="jira-owner-group"
          value={ownerGroupId}
          onChange={(e) => setOwnerGroupId(e.target.value)}
          style={{ padding: "9px 12px", border: "1px solid var(--rule)", background: "var(--bg)", fontSize: 14, fontFamily: "JetBrains Mono, monospace", color: "var(--ink)" }}
        >
          <option value="">Org-level</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>
      <div className="form-group" style={{ maxWidth: 420 }}>
        <label htmlFor="jira-site">Jira site</label>
        <input
          id="jira-site"
          type="text"
          value={site}
          onChange={(e) => setSite(e.target.value)}
          placeholder="your-team.atlassian.net"
          autoComplete="off"
        />
      </div>
      <div className="form-group" style={{ maxWidth: 420 }}>
        <label htmlFor="jira-email">Account email</label>
        <input
          id="jira-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          autoComplete="off"
        />
      </div>
      <div className="form-group" style={{ maxWidth: 420 }}>
        <label htmlFor="jira-token">API token</label>
        <input
          id="jira-token"
          type="password"
          value={apiToken}
          onChange={(e) => setApiToken(e.target.value)}
          placeholder="ATATT…"
          autoComplete="off"
        />
      </div>
      {!projectOptions && (
        <div className="settings-row">
          <button className="btn" onClick={listProjects} disabled={busy || !site || !email || !apiToken}>
            {busy ? "Checking credentials…" : "Next: choose Jira projects →"}
          </button>
          {onCancel && <button className="btn-link" onClick={onCancel} disabled={busy}>Cancel</button>}
        </div>
      )}
      {projectOptions && (
        <ProjectPicker
          projectOptions={projectOptions}
          selectedKeys={selectedKeys}
          setSelectedKeys={setSelectedKeys}
          busy={busy}
          confirmLabel={`Connect (${selectedKeys.size})`}
          onConfirm={connectSelected}
          onCancel={() => setProjectOptions(null)}
        />
      )}
      {error && <div className="form-error" style={{ marginTop: 14, maxWidth: 680 }}>{error}</div>}
    </div>
  );
}

function JiraConnectionCard({
  teamSlug,
  groups,
  connection,
  onRefresh,
}: {
  teamSlug: string;
  groups: GroupOpt[];
  connection: JiraConnection;
  onRefresh: () => Promise<void>;
}) {
  const [apiToken, setApiToken] = useState("");
  const [projectOptions, setProjectOptions] = useState<ProjectOption[] | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [editingProjects, setEditingProjects] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [mapping, setMapping] = useState<ProjectMapping[]>([]);
  const [mappingDirty, setMappingDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    setMapping((connection.projects ?? []).map((p) => ({ key: p.key, group_ids: p.group_ids })));
    setMappingDirty(false);
  }, [connection]);

  async function listProjects() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/team/settings/integrations/jira/projects?team=${teamSlug}`, {
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
    setProjectOptions(d.projects ?? []);
    setSelectedKeys(new Set(mapping.map((p) => p.key)));
  }

  async function save(payload: { site?: string; email?: string; apiToken?: string; projects: ProjectMapping[] }) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/team/settings/integrations/jira?team=${teamSlug}`, {
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
    setApiToken("");
    setProjectOptions(null);
    setEditingProjects(false);
    setReconnecting(false);
    setMessage(
      d.sync
        ? `Saved — synced ${d.sync.issues} issues (${d.sync.completed} completed). Ticket velocity is live in the insight reports.`
        : `Saved, but the first sync failed: ${d.sync_error}. Fix the credentials or project access, then press "Sync now".`,
    );
    await onRefresh();
  }

  function selectionToMappings(): ProjectMapping[] {
    return [...selectedKeys].map(
      (key) => mapping.find((p) => p.key === key) ?? { key, group_ids: [] },
    );
  }

  async function syncNow() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/team/settings/integrations/jira/sync?team=${teamSlug}&id=${connection.id}`, {
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
    const res = await fetch(`/api/team/settings/integrations/jira?team=${teamSlug}&id=${connection.id}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      return;
    }
    setConfirmDisconnect(false);
    setMessage("Disconnected. Issues synced by this connection were removed from reports.");
    setApiToken("");
    setProjectOptions(null);
    await onRefresh();
  }

  function toggleGroup(projectKey: string, groupId: string | "all") {
    setMapping((prev) =>
      prev.map((p) => {
        if (p.key !== projectKey) return p;
        if (groupId === "all") return { ...p, group_ids: [] };
        const current = p.group_ids.length === 0 ? groups.map((g) => g.id) : p.group_ids;
        const next = current.includes(groupId)
          ? current.filter((g) => g !== groupId)
          : [...current, groupId];
        const coversAll = groups.every((g) => next.includes(g.id));
        return { ...p, group_ids: coversAll || next.length === 0 ? [] : next };
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
          <strong>{connection.label || "Jira"}</strong>
          {connection.owner_group_name && <span className="badge-tag">{connection.owner_group_name}</span>}
        </div>
      </div>
      <StatusStrip
        ok={connection.status !== "error"}
        segments={[
          <span key="who">
            Connected as <strong>{connection.login ?? "unknown"}</strong>
            {connection.site ? <span className="mono-meta"> · {connection.site.replace(/^https?:\/\//, "")}</span> : null}
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
            Jira rejected the stored credentials on the last sync ({connection.last_error}). The API token was likely
            revoked — reconnect with a fresh one; your project selection is kept.
            <div style={{ marginTop: 10 }}>
              <button className="btn secondary" onClick={() => setReconnecting(true)} disabled={busy || reconnecting}>
                Reconnect with a new token
              </button>
            </div>
          </Callout>
        ) : (
          <Callout>
            Couldn&rsquo;t reach Jira on the last sync attempt ({connection.last_error ?? "network error"}) — usually
            a dropped connection or the machine being offline. It retries automatically every hour, or press
            &ldquo;Sync now&rdquo; to retry immediately.
          </Callout>
        ))}
      {reconnecting && (
        <div className="form-group" style={{ maxWidth: 420, marginTop: 14 }}>
          <label htmlFor={`jira-token-re-${connection.id}`}>New Jira API token</label>
          <input
            id={`jira-token-re-${connection.id}`}
            type="password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            autoComplete="off"
          />
          <div className="settings-row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => save({ apiToken, projects: mapping })} disabled={busy || !apiToken}>
              Save new token
            </button>
            <button className="btn-link" onClick={() => setReconnecting(false)} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

      <table className="member-table" style={{ marginTop: 18 }}>
        <thead>
          <tr>
            <th>Jira project</th>
            <th>Issues</th>
            <th>Counts toward</th>
          </tr>
        </thead>
        <tbody>
          {mapping.map((p) => {
            const status = connection.projects?.find((x) => x.key === p.key);
            const all = p.group_ids.length === 0;
            return (
              <tr key={p.key}>
                <td className="mono" style={{ fontSize: 13, paddingRight: 12 }}>{p.key}</td>
                <td className="mono" style={{ fontSize: 12, color: "var(--mute)", whiteSpace: "nowrap" }}>
                  {status
                    ? `${status.issues_completed} completed · ${status.issues_in_progress} in progress`
                    : "not synced yet"}
                </td>
                <td>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <CheckChip checked={all} onChange={() => toggleGroup(p.key, "all")}>
                      All groups
                    </CheckChip>
                    {groups.map((g) => (
                      <CheckChip
                        key={g.id}
                        checked={!all && p.group_ids.includes(g.id)}
                        implied={all}
                        onChange={() => toggleGroup(p.key, g.id)}
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
        &ldquo;Counts toward&rdquo; decides which group reports include each Jira project&rsquo;s ticket velocity
        — same model as the GitHub repos and Linear teams above. New projects default to all groups; changes
        apply on save.
      </p>

      <div className="settings-row" style={{ marginTop: 16, flexWrap: "wrap" }}>
        {mappingDirty && (
          <button className="btn" onClick={() => save({ projects: mapping })} disabled={busy}>
            {busy ? "Saving…" : "Save group mapping"}
          </button>
        )}
        {!editingProjects && (
          <button
            className="btn secondary"
            onClick={() => {
              setEditingProjects(true);
              listProjects();
            }}
            disabled={busy}
          >
            Change projects
          </button>
        )}
        <button className="btn secondary" onClick={syncNow} disabled={busy}>
          {busy ? "Working…" : "Sync now"}
        </button>
        <button className="btn-link is-danger" onClick={() => setConfirmDisconnect(true)} disabled={busy}>
          Disconnect
        </button>
      </div>
      {editingProjects && projectOptions && (
        <ProjectPicker
          projectOptions={projectOptions}
          selectedKeys={selectedKeys}
          setSelectedKeys={setSelectedKeys}
          busy={busy}
          confirmLabel="Save projects"
          onConfirm={() => save({ projects: selectionToMappings() })}
          onCancel={() => {
            setProjectOptions(null);
            setEditingProjects(false);
          }}
        />
      )}

      {error && <div className="form-error" style={{ marginTop: 14, maxWidth: 680 }}>{error}</div>}
      {message && <div className="action-note">{message}</div>}

      <ConfirmModal
        open={confirmDisconnect}
        title={`Disconnect ${connection.label || "Jira"}?`}
        body="The stored API token is deleted and issues synced by this connection are removed from reports (projects also tracked by another connection are kept). You can reconnect any time."
        confirmLabel="Disconnect"
        danger
        busy={busy}
        onConfirm={disconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </div>
  );
}

function ProjectPicker({
  projectOptions,
  selectedKeys,
  setSelectedKeys,
  busy,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  projectOptions: ProjectOption[];
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
          Choose Jira projects
          <span className="optional" style={{ marginLeft: 8 }}>
            tickets from these projects feed the velocity metrics
          </span>
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {projectOptions.map((p) => (
            <CheckChip
              key={p.id}
              checked={selectedKeys.has(p.key)}
              onChange={() => {
                const next = new Set(selectedKeys);
                if (next.has(p.key)) next.delete(p.key);
                else next.add(p.key);
                setSelectedKeys(next);
              }}
            >
              {p.key} · {p.name}
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
