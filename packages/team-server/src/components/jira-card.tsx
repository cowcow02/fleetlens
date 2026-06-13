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

type JiraStatus = {
  connected: boolean;
  login?: string | null;
  site?: string | null;
  projects?: ProjectStatus[];
  status?: "active" | "error";
  last_error?: string | null;
  last_sync_at?: string | null;
  issues_synced?: number;
  issues_completed?: number;
  issues_in_progress?: number;
};

type ProjectOption = { id: string; key: string; name: string };

const TOKEN_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";

export function JiraCard({ teamSlug, groups = [] }: { teamSlug: string; groups?: GroupOpt[] }) {
  const [jira, setJira] = useState<JiraStatus | null>(null);
  // Connect inputs — Jira Basic auth needs site + email + token (vs Linear's
  // single key).
  const [site, setSite] = useState("");
  const [email, setEmail] = useState("");
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
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    const res = await fetch(`/api/team/settings/integrations/jira?team=${teamSlug}`);
    if (!res.ok) {
      setJira({ connected: false });
      return;
    }
    const d = (await res.json()) as JiraStatus;
    setJira(d);
    setMapping((d.projects ?? []).map((p) => ({ key: p.key, group_ids: p.group_ids })));
    setMappingDirty(false);
  }

  async function listProjects(useStored: boolean) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/team/settings/integrations/jira/projects?team=${teamSlug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(useStored ? {} : { site, email, apiToken }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      return;
    }
    setProjectOptions(d.projects);
    setSelectedKeys(new Set(mapping.map((p) => p.key)));
  }

  async function save(payload: { site?: string; email?: string; apiToken?: string; projects: ProjectMapping[] }) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/team/settings/integrations/jira?team=${teamSlug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
    await refresh();
  }

  // Keep existing group mappings for projects that stay selected; new projects
  // default to all groups.
  function selectionToMappings(): ProjectMapping[] {
    return [...selectedKeys].map(
      (key) => mapping.find((p) => p.key === key) ?? { key, group_ids: [] },
    );
  }

  async function syncNow() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/team/settings/integrations/jira/sync?team=${teamSlug}`, { method: "POST" });
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
    await fetch(`/api/team/settings/integrations/jira?team=${teamSlug}`, { method: "DELETE" });
    setBusy(false);
    setConfirmDisconnect(false);
    setMessage("Disconnected. Already-synced issues are kept but stop updating.");
    setApiToken("");
    setProjectOptions(null);
    await refresh();
  }

  function toggleGroup(projectKey: string, groupId: string | "all") {
    setMapping((prev) =>
      prev.map((p) => {
        if (p.key !== projectKey) return p;
        if (groupId === "all") return { ...p, group_ids: [] };
        // Empty group_ids means "all groups", so expand before toggling —
        // clicking a checked box must UNCHECK it, not become "only this one".
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

  const projectPicker = (withCreds: boolean) => (
    <div style={{ marginTop: 14 }}>
      <div className="form-group">
        <label>
          Choose Jira projects
          <span className="optional" style={{ marginLeft: 8 }}>
            tickets from these projects feed the velocity metrics
          </span>
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(projectOptions ?? []).map((p) => (
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
        <button
          className="btn"
          onClick={() =>
            save(withCreds ? { site, email, apiToken, projects: selectionToMappings() } : { projects: selectionToMappings() })
          }
          disabled={busy || selectedKeys.size === 0}
        >
          {busy ? "Working…" : jira?.connected ? "Save projects" : `Connect (${selectedKeys.size})`}
        </button>
        <button
          className="btn-link"
          onClick={() => {
            setProjectOptions(null);
            setEditingProjects(false);
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

  if (jira === null) return null;

  return (
    <div style={{ borderTop: "1px solid var(--rule-soft)", paddingTop: 22, marginTop: 30 }}>
      <div className="provider-head">Jira · ticket velocity for insight reports</div>

      {jira.connected ? (
        <div>
          <StatusStrip
            ok={jira.status !== "error"}
            segments={[
              <span key="who">
                Connected as <strong>{jira.login ?? "unknown"}</strong>
                {jira.site ? <span className="mono-meta"> · {jira.site.replace(/^https?:\/\//, "")}</span> : null}
              </span>,
              <span key="cadence" className="mono-meta">syncs hourly</span>,
              <span key="vol" className="mono-meta">
                {jira.issues_synced ?? 0} issues · {jira.issues_completed ?? 0} completed · {jira.issues_in_progress ?? 0} in progress
              </span>,
              <span key="last" className="mono-meta">last successful sync {fmtSync(jira.last_sync_at)}</span>,
            ]}
          />
          {jira.status === "error" &&
            (isAuthSyncError(jira.last_error) ? (
              <Callout tone="error">
                Jira rejected the stored credentials on the last sync ({jira.last_error}). The API token was likely
                revoked — reconnect with a fresh one; your project selection is kept.
                <div style={{ marginTop: 10 }}>
                  <button className="btn secondary" onClick={() => setReconnecting(true)} disabled={busy || reconnecting}>
                    Reconnect with a new token
                  </button>
                </div>
              </Callout>
            ) : (
              <Callout>
                Couldn&rsquo;t reach Jira on the last sync attempt ({jira.last_error ?? "network error"}) — usually
                a dropped connection or the machine being offline. It retries automatically every hour, or press
                &ldquo;Sync now&rdquo; to retry immediately.
              </Callout>
            ))}
          {reconnecting && (
            <div className="form-group" style={{ maxWidth: 420, marginTop: 14 }}>
              <label htmlFor="jira-token-re">New Jira API token</label>
              <input
                id="jira-token-re"
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
                const status = jira.projects?.find((x) => x.key === p.key);
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
                  listProjects(true);
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
          {editingProjects && projectOptions && projectPicker(false)}
        </div>
      ) : (
        <div style={{ maxWidth: 680 }}>
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
            <button className="btn" onClick={() => listProjects(false)} disabled={busy || !site || !email || !apiToken}>
              {busy ? "Checking credentials…" : "Next: choose Jira projects →"}
            </button>
          )}
          {projectOptions && projectPicker(true)}
        </div>
      )}

      {error && <div className="form-error" style={{ marginTop: 14, maxWidth: 680 }}>{error}</div>}
      {message && <div className="action-note">{message}</div>}

      <ConfirmModal
        open={confirmDisconnect}
        title="Disconnect Jira?"
        body="The stored API token is deleted and hourly syncing stops. Already-synced issues stay in the report history. You can reconnect any time."
        confirmLabel="Disconnect"
        danger
        busy={busy}
        onConfirm={disconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </div>
  );
}
