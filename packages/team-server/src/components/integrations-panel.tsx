"use client";

import { useEffect, useMemo, useState } from "react";
import { ConfirmModal } from "./confirm-modal";
import { LinearCard } from "./linear-card";
import { JiraCard } from "./jira-card";
import { Callout, CheckChip, isAuthSyncError, PickerRow, StatusStrip } from "./ui";

type GroupOpt = { id: string; slug: string; name: string };

type RepoMapping = { name: string; group_ids: string[] };
type RepoStatus = RepoMapping & {
  prs_synced: number;
  prs_merged: number;
  prs_ai_assisted: number;
};

type GithubConnection = {
  id: string;
  label: string;
  owner_group_id: string | null;
  owner_group_name: string | null;
  login?: string | null;
  repos: RepoStatus[];
  status?: "active" | "error";
  last_error?: string | null;
  last_sync_at?: string | null;
  prs_synced?: number;
  prs_ai_assisted?: number;
};

type GithubStatus = {
  connected: boolean;
  connections: GithubConnection[];
};

type RepoOption = { full_name: string; private: boolean; pushed_at: string | null };

const TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";

export function IntegrationsPanel({ teamSlug, groups = [] }: { teamSlug: string; groups?: GroupOpt[] }) {
  const [gh, setGh] = useState<GithubStatus | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    const res = await fetch(`/api/team/settings/integrations/github?team=${teamSlug}`);
    if (!res.ok) {
      setGh({ connected: false, connections: [] });
      return;
    }
    const d = (await res.json()) as GithubStatus;
    setGh({ connected: d.connected, connections: d.connections ?? [] });
  }

  const connections = gh?.connections ?? [];

  return (
    <section className="settings-section">
      <div className="subsection-head">
        <h2>Integrations</h2>
        <span className="kicker">GitHub + Linear + Jira · delivery signals for insight reports</span>
      </div>

      <div className="provider-head">GitHub · merge-confirmed delivery</div>
      {gh === null ? (
        <p className="help-note" style={{ border: "none", padding: 0 }}>Loading…</p>
      ) : (
        <>
          {connections.map((connection) => (
            <GithubConnectionCard
              key={connection.id}
              teamSlug={teamSlug}
              groups={groups}
              connection={connection}
              onRefresh={refresh}
            />
          ))}
          {(connections.length === 0 || showAdd) && (
            <GithubConnectForm
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
              + Add another GitHub
            </button>
          )}
          {message && <div className="action-note">{message}</div>}
        </>
      )}

      <LinearCard teamSlug={teamSlug} groups={groups} />
      <JiraCard teamSlug={teamSlug} groups={groups} />
    </section>
  );
}

function GithubConnectForm({
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
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [ownerGroupId, setOwnerGroupId] = useState("");
  const [repoOptions, setRepoOptions] = useState<RepoOption[] | null>(null);
  const [repoFilter, setRepoFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredOptions = useMemo(() => {
    if (!repoOptions) return [];
    const q = repoFilter.trim().toLowerCase();
    return q ? repoOptions.filter((r) => r.full_name.toLowerCase().includes(q)) : repoOptions;
  }, [repoOptions, repoFilter]);

  async function listRepos() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/team/settings/integrations/github/repos?team=${teamSlug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      return;
    }
    setRepoOptions(d.repos ?? []);
    setSelected(new Set());
    setRepoFilter("");
  }

  async function connectSelected() {
    setBusy(true);
    setError(null);
    const repos = [...selected].map((name) => ({ name, group_ids: [] as string[] }));
    const res = await fetch(`/api/team/settings/integrations/github?team=${teamSlug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        repos,
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
    setToken("");
    setRepoOptions(null);
    await onSaved(
      d.sync
        ? `Saved — synced ${d.sync.prs} PRs (${d.sync.aiAssisted} AI-assisted). They're live in the insight reports now.`
        : `Saved, but the first sync failed: ${d.sync_error}. Fix the token or repo access, then press "Sync now".`,
    );
  }

  return (
    <div style={{ maxWidth: 680, marginTop: 14 }}>
      <p style={{ marginTop: 0, lineHeight: 1.6, maxWidth: 640 }}>
        Connect GitHub to add <strong>merge-confirmed delivery metrics</strong> to your insight reports: merged PRs
        per week, how many were AI-assisted, and how their cycle time compares with the rest. Without it, reports
        rely on transcript-side estimates.
      </p>
      <ol className="steps-editorial">
        <li>
          <span>
            <a href={TOKEN_URL} target="_blank" rel="noreferrer">Create a fine-grained access token on GitHub ↗</a>{" "}
            — under <em>Repository access</em> pick the repos your team ships to; under <em>Permissions</em> grant
            read-only <strong>Contents</strong>, <strong>Pull requests</strong> and <strong>Metadata</strong>.
            Nothing else.
          </span>
        </li>
        <li><span>Paste the token below. It&rsquo;s validated, encrypted, and never shown again.</span></li>
        <li><span>Tick the repositories to track — you&rsquo;ll be able to map them to groups afterwards.</span></li>
      </ol>
      <div className="form-group" style={{ maxWidth: 420 }}>
        <label htmlFor="gh-label">Label <span className="optional">optional</span></label>
        <input
          id="gh-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="GitHub"
        />
      </div>
      <div className="form-group" style={{ maxWidth: 420 }}>
        <label htmlFor="gh-owner-group">Owner group</label>
        <select
          id="gh-owner-group"
          value={ownerGroupId}
          onChange={(e) => setOwnerGroupId(e.target.value)}
          style={{ padding: "9px 12px", border: "1px solid var(--rule)", background: "var(--bg)", fontSize: 14, fontFamily: "JetBrains Mono, monospace", color: "var(--ink)" }}
        >
          <option value="">Org-level</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>
      <div className="form-group" style={{ maxWidth: 420 }}>
        <label htmlFor="gh-token">GitHub token</label>
        <input
          id="gh-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="github_pat_…"
          autoComplete="off"
        />
      </div>
      {!repoOptions && (
        <div className="settings-row">
          <button className="btn" onClick={listRepos} disabled={busy || !token}>
            {busy ? "Checking token…" : "Next: choose repositories →"}
          </button>
          {onCancel && <button className="btn-link" onClick={onCancel} disabled={busy}>Cancel</button>}
        </div>
      )}
      {repoOptions && (
        <RepoPicker
          repoOptions={filteredOptions}
          selected={selected}
          visibleCount={repoOptions.length}
          filter={repoFilter}
          setFilter={setRepoFilter}
          setSelected={setSelected}
          busy={busy}
          confirmLabel="Connect"
          onConfirm={connectSelected}
          onCancel={() => setRepoOptions(null)}
        />
      )}
      {error && <div className="form-error" style={{ marginTop: 14, maxWidth: 680 }}>{error}</div>}
    </div>
  );
}

function GithubConnectionCard({
  teamSlug,
  groups,
  connection,
  onRefresh,
}: {
  teamSlug: string;
  groups: GroupOpt[];
  connection: GithubConnection;
  onRefresh: () => Promise<void>;
}) {
  const [token, setToken] = useState("");
  const [repoOptions, setRepoOptions] = useState<RepoOption[] | null>(null);
  const [repoFilter, setRepoFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [mapping, setMapping] = useState<RepoMapping[]>([]);
  const [mappingDirty, setMappingDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    setMapping((connection.repos ?? []).map((r) => ({ name: r.name, group_ids: r.group_ids })));
    setMappingDirty(false);
  }, [connection]);

  const filteredOptions = useMemo(() => {
    if (!repoOptions) return [];
    const q = repoFilter.trim().toLowerCase();
    return q ? repoOptions.filter((r) => r.full_name.toLowerCase().includes(q)) : repoOptions;
  }, [repoOptions, repoFilter]);

  async function listRepos() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/team/settings/integrations/github/repos?team=${teamSlug}`, {
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
    const existing = new Set(mapping.map((r) => r.name));
    setRepoOptions(((d.repos ?? []) as RepoOption[]).filter((r) => !existing.has(r.full_name)));
    setSelected(new Set());
    setRepoFilter("");
  }

  async function saveRepos(repos: RepoMapping[], newToken?: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/team/settings/integrations/github?team=${teamSlug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: connection.id, repos, token: newToken || undefined }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      return false;
    }
    setToken("");
    setRepoOptions(null);
    setAdding(false);
    setReconnecting(false);
    setMessage(
      d.sync
        ? `Saved — synced ${d.sync.prs} PRs (${d.sync.aiAssisted} AI-assisted). They're live in the insight reports now.`
        : `Saved, but the first sync failed: ${d.sync_error}. Fix the token or repo access, then press "Sync now".`,
    );
    await onRefresh();
    return true;
  }

  async function addSelected() {
    const repos = [...mapping, ...[...selected].map((name) => ({ name, group_ids: [] as string[] }))];
    await saveRepos(repos);
  }

  async function syncNow() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/team/settings/integrations/github/sync?team=${teamSlug}&id=${connection.id}`, {
      method: "POST",
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      return;
    }
    setMessage(`Synced ${d.prs} PRs (${d.aiAssisted} AI-assisted).`);
    await onRefresh();
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/team/settings/integrations/github?team=${teamSlug}&id=${connection.id}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      return;
    }
    setConfirmDisconnect(false);
    setMessage("Disconnected. PRs synced by this connection were removed from reports.");
    setToken("");
    setRepoOptions(null);
    await onRefresh();
  }

  function toggleGroup(repoName: string, groupId: string | "all") {
    setMapping((prev) =>
      prev.map((r) => {
        if (r.name !== repoName) return r;
        if (groupId === "all") return { ...r, group_ids: [] };
        const current = r.group_ids.length === 0 ? groups.map((g) => g.id) : r.group_ids;
        const next = current.includes(groupId)
          ? current.filter((g) => g !== groupId)
          : [...current, groupId];
        const coversAll = groups.every((g) => next.includes(g.id));
        return { ...r, group_ids: coversAll || next.length === 0 ? [] : next };
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
          <strong>{connection.label || "GitHub"}</strong>
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
            {connection.prs_synced ?? 0} PRs · {connection.prs_ai_assisted ?? 0} AI-assisted
          </span>,
          <span key="last" className="mono-meta">last successful sync {fmtSync(connection.last_sync_at)}</span>,
        ]}
      />

      {connection.status === "error" &&
        (isAuthSyncError(connection.last_error) ? (
          <Callout tone="error">
            GitHub rejected the stored token on the last sync ({connection.last_error}). It likely expired or lost
            repo access — reconnect with a fresh one; your repo list and group mapping are kept.
            <div style={{ marginTop: 10 }}>
              <button className="btn secondary" onClick={() => setReconnecting(true)} disabled={busy || reconnecting}>
                Reconnect with a new token
              </button>
            </div>
          </Callout>
        ) : (
          <Callout>
            Couldn&rsquo;t reach GitHub on the last sync attempt ({connection.last_error ?? "network error"}) — usually
            a dropped connection or the machine being offline. It retries automatically every hour, or press
            &ldquo;Sync now&rdquo; to retry immediately.
          </Callout>
        ))}
      {reconnecting && (
        <div className="form-group" style={{ maxWidth: 420, marginTop: 14 }}>
          <label htmlFor={`gh-token-re-${connection.id}`}>New GitHub token</label>
          <input
            id={`gh-token-re-${connection.id}`}
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
          <div className="settings-row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => saveRepos(mapping, token)} disabled={busy || !token}>
              Save new token
            </button>
            <button className="btn-link" onClick={() => setReconnecting(false)} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

      <table className="member-table" style={{ marginTop: 18 }}>
        <thead>
          <tr>
            <th>Repository</th>
            <th>Pull requests</th>
            <th>Counts toward</th>
          </tr>
        </thead>
        <tbody>
          {mapping.map((r) => {
            const status = connection.repos?.find((x) => x.name === r.name);
            const all = r.group_ids.length === 0;
            return (
              <tr key={r.name}>
                <td className="mono" style={{ fontSize: 13 }}>{r.name}</td>
                <td className="mono" style={{ fontSize: 12, color: "var(--mute)", whiteSpace: "nowrap" }}>
                  {status
                    ? `${status.prs_merged} merged · ${status.prs_ai_assisted} AI-assisted`
                    : "not synced yet"}
                </td>
                <td>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <CheckChip checked={all} onChange={() => toggleGroup(r.name, "all")}>
                      All groups
                    </CheckChip>
                    {groups.map((g) => (
                      <CheckChip
                        key={g.id}
                        checked={!all && r.group_ids.includes(g.id)}
                        implied={all}
                        onChange={() => toggleGroup(r.name, g.id)}
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
        &ldquo;Counts toward&rdquo; decides which group reports include each repo&rsquo;s PRs — e.g. map a platform
        repo to the platform group so other groups&rsquo; delivery numbers aren&rsquo;t diluted. New repos default
        to all groups. Changes apply to the{" "}
        {groups.length > 0 ? (
          <>
            insight reports under{" "}
            {groups.map((g, i) => (
              <span key={g.id}>
                {i > 0 && ", "}
                <a href={`/team/${teamSlug}/groups/${g.slug}/insights`}>{g.name}</a>
              </span>
            ))}
          </>
        ) : (
          "group insight reports"
        )}{" "}
        as soon as you save.
      </p>

      {mapping.some((r) => r.group_ids.length > 0 && !r.group_ids.some((id) => groups.some((g) => g.id === id))) && (
        <Callout tone="error">
          Some repos are mapped only to deleted groups — their PRs currently count toward no report. Re-map them
          below and save.
        </Callout>
      )}

      <div className="settings-row" style={{ marginTop: 18, flexWrap: "wrap" }}>
        {mappingDirty && (
          <button className="btn" onClick={() => saveRepos(mapping)} disabled={busy}>
            {busy ? "Saving…" : "Save group mapping"}
          </button>
        )}
        {!adding && (
          <button
            className="btn secondary"
            onClick={() => {
              setAdding(true);
              listRepos();
            }}
            disabled={busy}
          >
            + Add repositories
          </button>
        )}
        <button className="btn secondary" onClick={syncNow} disabled={busy}>
          {busy ? "Working…" : "Sync now"}
        </button>
        <button className="btn-link is-danger" onClick={() => setConfirmDisconnect(true)} disabled={busy}>
          Disconnect
        </button>
      </div>
      {adding && repoOptions && (
        <RepoPicker
          repoOptions={filteredOptions}
          selected={selected}
          visibleCount={repoOptions.length}
          filter={repoFilter}
          setFilter={setRepoFilter}
          setSelected={setSelected}
          busy={busy}
          confirmLabel="Add"
          onConfirm={addSelected}
          onCancel={() => {
            setRepoOptions(null);
            setAdding(false);
          }}
        />
      )}

      {error && <div className="form-error" style={{ marginTop: 14, maxWidth: 680 }}>{error}</div>}
      {message && <div className="action-note">{message}</div>}

      <ConfirmModal
        open={confirmDisconnect}
        title={`Disconnect ${connection.label || "GitHub"}?`}
        body="The stored token is deleted and PRs synced by this connection are removed from reports (repos also tracked by another connection are kept). You can reconnect any time."
        confirmLabel="Disconnect"
        danger
        busy={busy}
        onConfirm={disconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </div>
  );
}

function RepoPicker({
  repoOptions,
  selected,
  visibleCount,
  filter,
  setFilter,
  setSelected,
  busy,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  repoOptions: RepoOption[];
  selected: Set<string>;
  visibleCount: number;
  filter: string;
  setFilter: (value: string) => void;
  setSelected: (value: Set<string>) => void;
  busy: boolean;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ marginTop: 18, maxWidth: 680 }}>
      <div className="form-group">
        <label htmlFor={`gh-repo-filter-${confirmLabel}`}>
          Choose repositories to track
          <span className="optional" style={{ marginLeft: 8 }}>
            {selected.size} selected · {visibleCount} visible to this token
          </span>
        </label>
        <input
          id={`gh-repo-filter-${confirmLabel}`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name…"
        />
      </div>
      <div className="picker-list">
        {repoOptions.length === 0 && (
          <p className="help-note" style={{ border: "none", padding: "10px 12px", margin: 0 }}>
            No repositories match. The token only lists repos it was granted access to.
          </p>
        )}
        {repoOptions.map((r) => (
          <PickerRow
            key={r.full_name}
            selected={selected.has(r.full_name)}
            onToggle={() => {
              const next = new Set(selected);
              if (next.has(r.full_name)) next.delete(r.full_name);
              else next.add(r.full_name);
              setSelected(next);
            }}
            name={r.full_name}
            tag={r.private ? "private" : undefined}
            meta={r.pushed_at ? `pushed ${new Date(r.pushed_at).toLocaleDateString()}` : undefined}
          />
        ))}
      </div>
      <p className="help-note">
        Pick the repos this team ships to — pull requests from these repos feed the delivery metrics. You can add or
        remove repos later without re-entering a token.
      </p>
      <div className="settings-row" style={{ marginTop: 14 }}>
        <button className="btn" onClick={onConfirm} disabled={busy || selected.size === 0}>
          {busy ? "Working…" : `${confirmLabel} ${selected.size > 0 ? `(${selected.size})` : ""}`}
        </button>
        <button className="btn-link" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
