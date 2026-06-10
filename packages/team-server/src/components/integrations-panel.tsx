"use client";

import { useEffect, useMemo, useState } from "react";
import { ConfirmModal } from "./confirm-modal";

type GroupOpt = { id: string; slug: string; name: string };

type RepoStatus = {
  name: string;
  group_ids: string[];
  prs_synced: number;
  prs_merged: number;
  prs_ai_assisted: number;
};

type GithubStatus = {
  connected: boolean;
  login?: string | null;
  repos?: RepoStatus[];
  status?: "active" | "error";
  last_error?: string | null;
  last_sync_at?: string | null;
  prs_synced?: number;
  prs_ai_assisted?: number;
};

type RepoOption = { full_name: string; private: boolean; pushed_at: string | null };

const TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";

export function IntegrationsPanel({ teamSlug, groups = [] }: { teamSlug: string; groups?: GroupOpt[] }) {
  const [gh, setGh] = useState<GithubStatus | null>(null);

  // Connect / add-repos flow
  const [token, setToken] = useState("");
  const [repoOptions, setRepoOptions] = useState<RepoOption[] | null>(null);
  const [repoFilter, setRepoFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false); // picker opened from connected state
  const [reconnecting, setReconnecting] = useState(false);

  // Group-mapping edits on the connected view
  const [mapping, setMapping] = useState<{ name: string; group_ids: string[] }[]>([]);
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
    const res = await fetch(`/api/team/settings/integrations/github?team=${teamSlug}`);
    if (!res.ok) {
      setGh({ connected: false });
      return;
    }
    const d = (await res.json()) as GithubStatus;
    setGh(d);
    setMapping((d.repos ?? []).map((r) => ({ name: r.name, group_ids: r.group_ids })));
    setMappingDirty(false);
  }

  const filteredOptions = useMemo(() => {
    if (!repoOptions) return [];
    const q = repoFilter.trim().toLowerCase();
    return q ? repoOptions.filter((r) => r.full_name.toLowerCase().includes(q)) : repoOptions;
  }, [repoOptions, repoFilter]);

  async function listRepos(useStoredToken: boolean) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/team/settings/integrations/github/repos?team=${teamSlug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(useStoredToken ? {} : { token }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      return;
    }
    const existing = new Set((gh?.repos ?? []).map((r) => r.name));
    setRepoOptions(
      useStoredToken ? (d.repos as RepoOption[]).filter((r) => !existing.has(r.full_name)) : d.repos,
    );
    setSelected(new Set());
    setRepoFilter("");
  }

  async function saveRepos(repos: { name: string; group_ids: string[] }[], withToken: boolean) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/team/settings/integrations/github?team=${teamSlug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withToken ? { token, repos } : { repos }),
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
    await refresh();
    return true;
  }

  async function connectSelected() {
    const repos = [...selected].map((name) => ({ name, group_ids: [] as string[] }));
    await saveRepos(repos, true);
  }

  async function addSelected() {
    const repos = [...mapping, ...[...selected].map((name) => ({ name, group_ids: [] as string[] }))];
    await saveRepos(repos, false);
  }

  async function saveMapping() {
    await saveRepos(mapping, false);
  }

  async function syncNow() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/team/settings/integrations/github/sync?team=${teamSlug}`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      return;
    }
    setMessage(`Synced ${d.prs} PRs (${d.aiAssisted} AI-assisted).`);
    await refresh();
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    await fetch(`/api/team/settings/integrations/github?team=${teamSlug}`, { method: "DELETE" });
    setBusy(false);
    setConfirmDisconnect(false);
    setMessage("Disconnected. Already-synced PRs are kept but stop updating.");
    setToken("");
    setRepoOptions(null);
    await refresh();
  }

  function toggleGroup(repoName: string, groupId: string | "all") {
    setMapping((prev) =>
      prev.map((r) => {
        if (r.name !== repoName) return r;
        if (groupId === "all") return { ...r, group_ids: [] };
        // Empty group_ids means "all groups", so expand it before toggling —
        // clicking a checked box must UNCHECK it, not become "only this one".
        const current = r.group_ids.length === 0 ? groups.map((g) => g.id) : r.group_ids;
        const next = current.includes(groupId)
          ? current.filter((g) => g !== groupId)
          : [...current, groupId];
        // Everything checked — or nothing left (a repo can't count toward no
        // report) — collapses back to the all-groups default.
        const coversAll = groups.every((g) => next.includes(g.id));
        return { ...r, group_ids: coversAll || next.length === 0 ? [] : next };
      }),
    );
    setMappingDirty(true);
  }

  const repoPicker = (onConfirm: () => void, confirmLabel: string) => (
    <div style={{ marginTop: 14 }}>
      <div className="form-group" style={{ maxWidth: 420 }}>
        <label htmlFor="gh-repo-filter">
          Choose repositories to track ({selected.size} selected
          {repoOptions ? ` of ${repoOptions.length} visible to this token` : ""})
        </label>
        <input
          id="gh-repo-filter"
          value={repoFilter}
          onChange={(e) => setRepoFilter(e.target.value)}
          placeholder="Filter by name…"
        />
      </div>
      <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--rule)", padding: "6px 10px" }}>
        {filteredOptions.length === 0 && (
          <p className="help-note">No repositories match. The token only lists repos it was granted access to.</p>
        )}
        {filteredOptions.map((r) => (
          <label key={r.full_name} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "3px 0", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={selected.has(r.full_name)}
              onChange={() => {
                const next = new Set(selected);
                if (next.has(r.full_name)) next.delete(r.full_name);
                else next.add(r.full_name);
                setSelected(next);
              }}
            />
            <span className="mono" style={{ fontSize: 13 }}>{r.full_name}</span>
            {r.private && <span className="kicker">private</span>}
            {r.pushed_at && (
              <span className="kicker" style={{ marginLeft: "auto" }}>
                pushed {new Date(r.pushed_at).toLocaleDateString()}
              </span>
            )}
          </label>
        ))}
      </div>
      <p className="help-note" style={{ marginTop: 8 }}>
        Pick the repos this team ships to — pull requests from these repos feed the delivery metrics. You can add or
        remove repos later without re-entering a token.
      </p>
      <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
        <button className="btn" onClick={onConfirm} disabled={busy || selected.size === 0}>
          {busy ? "Working…" : `${confirmLabel} (${selected.size})`}
        </button>
        <button
          className="btn-link"
          onClick={() => {
            setRepoOptions(null);
            setAdding(false);
          }}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </div>
  );

  const connectFlow = (
    <div style={{ maxWidth: 680 }}>
      <p style={{ marginTop: 0, lineHeight: 1.55 }}>
        Connect GitHub to add <strong>merge-confirmed delivery metrics</strong> to your insight reports: merged PRs per
        week, how many were AI-assisted, and how their cycle time compares with the rest. Without it, reports rely on
        transcript-side estimates.
      </p>
      <ol style={{ lineHeight: 1.7, paddingLeft: 20 }}>
        <li>
          <a href={TOKEN_URL} target="_blank" rel="noreferrer">Create a fine-grained access token on GitHub ↗</a>{" "}
          — under <em>Repository access</em> pick the repos your team ships to; under <em>Permissions</em> grant
          read-only <strong>Contents</strong>, <strong>Pull requests</strong> and <strong>Metadata</strong>. Nothing else.
        </li>
        <li>Paste the token below. It&rsquo;s validated, encrypted, and never shown again.</li>
        <li>Tick the repositories to track — you&rsquo;ll be able to map them to groups afterwards.</li>
      </ol>
      <div className="form-group" style={{ maxWidth: 420 }}>
        <label htmlFor="gh-token">GitHub token</label>
        <input
          id="gh-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="github_pat_… or a classic token"
          autoComplete="off"
        />
      </div>
      {!repoOptions && (
        <button className="btn" onClick={() => listRepos(false)} disabled={busy || !token}>
          {busy ? "Checking token…" : "Next: choose repositories →"}
        </button>
      )}
      {repoOptions && repoPicker(connectSelected, "Connect")}
    </div>
  );

  const groupLabel = (id: string) => groups.find((g) => g.id === id)?.name ?? "unknown group";

  const connectedView = gh?.connected && (
    <div style={{ maxWidth: 760 }}>
      <p style={{ marginTop: 0 }}>
        Connected as <strong>{gh.login ?? "unknown"}</strong> · syncs every hour ·{" "}
        {gh.prs_synced ?? 0} PRs stored ({gh.prs_ai_assisted ?? 0} AI-assisted) · last sync{" "}
        {gh.last_sync_at ? new Date(gh.last_sync_at).toLocaleString() : "never"}
      </p>
      {gh.status === "error" && (
        <div className="form-error" style={{ marginBottom: 12 }}>
          Last sync failed: {gh.last_error ?? "unknown error"}. If the token expired or lost repo access, reconnect
          with a fresh one below — your repo list and group mapping are kept.
          <div style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => setReconnecting(true)} disabled={busy || reconnecting}>
              Reconnect with a new token
            </button>
          </div>
        </div>
      )}
      {reconnecting && (
        <div className="form-group" style={{ maxWidth: 420 }}>
          <label htmlFor="gh-token-re">New GitHub token</label>
          <input
            id="gh-token-re"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
          <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
            <button className="btn" onClick={() => saveRepos(mapping, true)} disabled={busy || !token}>
              Save new token
            </button>
            <button className="btn-link" onClick={() => setReconnecting(false)} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

      <table style={{ width: "100%", marginTop: 6 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Repository</th>
            <th style={{ textAlign: "left" }}>Synced</th>
            <th style={{ textAlign: "left" }}>Counts toward</th>
          </tr>
        </thead>
        <tbody>
          {mapping.map((r) => {
            const status = gh.repos?.find((x) => x.name === r.name);
            const all = r.group_ids.length === 0;
            return (
              <tr key={r.name}>
                <td className="mono" style={{ fontSize: 13, paddingRight: 12 }}>{r.name}</td>
                <td style={{ whiteSpace: "nowrap", paddingRight: 12 }}>
                  {status ? `${status.prs_merged} merged · ${status.prs_ai_assisted} AI` : "—"}
                </td>
                <td>
                  <label style={{ marginRight: 12, whiteSpace: "nowrap", cursor: "pointer" }}>
                    <input type="checkbox" checked={all} onChange={() => toggleGroup(r.name, "all")} /> All groups
                  </label>
                  {groups.map((g) => (
                    <label key={g.id} style={{ marginRight: 12, whiteSpace: "nowrap", cursor: "pointer", opacity: all ? 0.55 : 1 }}>
                      <input
                        type="checkbox"
                        checked={all || r.group_ids.includes(g.id)}
                        onChange={() => toggleGroup(r.name, g.id)}
                      />{" "}
                      {g.name}
                    </label>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="help-note" style={{ marginTop: 8 }}>
        &ldquo;Counts toward&rdquo; decides which group reports include each repo&rsquo;s PRs — e.g. map a platform
        repo to the platform group so other groups&rsquo; delivery numbers aren&rsquo;t diluted. New repos default to
        all groups. Changes apply to the{" "}
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
        <p className="form-error">
          Some repos are mapped only to deleted groups ({mapping
            .filter((r) => r.group_ids.length > 0 && !r.group_ids.some((id) => groups.some((g) => g.id === id)))
            .map((r) => `${r.name} → ${r.group_ids.map(groupLabel).join(", ")}`)
            .join("; ")}) — their PRs currently count toward no report.
        </p>
      )}

      <div style={{ display: "flex", gap: 14, marginTop: 12, flexWrap: "wrap" }}>
        {mappingDirty && (
          <button className="btn" onClick={saveMapping} disabled={busy}>
            {busy ? "Saving…" : "Save group mapping"}
          </button>
        )}
        {!adding && (
          <button
            className="btn"
            onClick={() => {
              setAdding(true);
              listRepos(true);
            }}
            disabled={busy}
          >
            + Add repositories
          </button>
        )}
        <button className="btn" onClick={syncNow} disabled={busy}>
          {busy ? "Working…" : "Sync now"}
        </button>
        <button className="btn-link is-danger" onClick={() => setConfirmDisconnect(true)} disabled={busy}>
          Disconnect
        </button>
      </div>
      {adding && repoOptions && repoPicker(addSelected, "Add")}
    </div>
  );

  return (
    <section className="settings-section">
      <div className="subsection-head">
        <h2>Integrations</h2>
        <span className="kicker">
          GitHub — merge-confirmed delivery metrics for the insight reports. Read-only token, encrypted at rest.
        </span>
      </div>

      {gh === null ? (
        <p className="help-note">Loading…</p>
      ) : gh.connected ? (
        connectedView
      ) : (
        connectFlow
      )}

      {error && <div className="form-error" style={{ marginTop: 10 }}>{error}</div>}
      {message && (
        <div className="mono" style={{ fontSize: 11, color: "var(--mute)", marginTop: 10, letterSpacing: "0.1em" }}>
          {message.toUpperCase()}
        </div>
      )}

      <ConfirmModal
        open={confirmDisconnect}
        title="Disconnect GitHub?"
        body="The stored token is deleted and hourly syncing stops. Already-synced PRs stay in the report history. You can reconnect any time."
        confirmLabel="Disconnect"
        danger
        busy={busy}
        onConfirm={disconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </section>
  );
}
