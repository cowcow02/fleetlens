"use client";

import { useEffect, useMemo, useState } from "react";
import { ConfirmModal } from "./confirm-modal";
import { Callout, CheckChip, PickerRow, StatusStrip } from "./ui";

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
    <div style={{ marginTop: 18, maxWidth: 680 }}>
      <div className="form-group">
        <label htmlFor="gh-repo-filter">
          Choose repositories to track
          <span className="optional" style={{ marginLeft: 8 }}>
            {selected.size} selected{repoOptions ? ` · ${repoOptions.length} visible to this token` : ""}
          </span>
        </label>
        <input
          id="gh-repo-filter"
          value={repoFilter}
          onChange={(e) => setRepoFilter(e.target.value)}
          placeholder="Filter by name…"
        />
      </div>
      <div className="picker-list">
        {filteredOptions.length === 0 && (
          <p className="help-note" style={{ border: "none", padding: "10px 12px", margin: 0 }}>
            No repositories match. The token only lists repos it was granted access to.
          </p>
        )}
        {filteredOptions.map((r) => (
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
        <button className="btn" onClick={() => listRepos(false)} disabled={busy || !token}>
          {busy ? "Checking token…" : "Next: choose repositories →"}
        </button>
      )}
      {repoOptions && repoPicker(connectSelected, "Connect")}
    </div>
  );

  const fmtSync = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never";

  const connectedView = gh?.connected && (
    <div>
      <StatusStrip
        ok={gh.status !== "error"}
        segments={[
          <span key="who">
            Connected as <strong>{gh.login ?? "unknown"}</strong>
          </span>,
          <span key="cadence" className="mono-meta">syncs hourly</span>,
          <span key="vol" className="mono-meta">
            {gh.prs_synced ?? 0} PRs · {gh.prs_ai_assisted ?? 0} AI-assisted
          </span>,
          <span key="last" className="mono-meta">last sync {fmtSync(gh.last_sync_at)}</span>,
        ]}
      />

      {gh.status === "error" && (
        <Callout tone="error">
          Last sync failed: {gh.last_error ?? "unknown error"}. If the token expired or lost repo access, reconnect
          with a fresh one — your repo list and group mapping are kept.
          <div style={{ marginTop: 10 }}>
            <button className="btn secondary" onClick={() => setReconnecting(true)} disabled={busy || reconnecting}>
              Reconnect with a new token
            </button>
          </div>
        </Callout>
      )}
      {reconnecting && (
        <div className="form-group" style={{ maxWidth: 420, marginTop: 14 }}>
          <label htmlFor="gh-token-re">New GitHub token</label>
          <input
            id="gh-token-re"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
          <div className="settings-row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => saveRepos(mapping, true)} disabled={busy || !token}>
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
            const status = gh.repos?.find((x) => x.name === r.name);
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
          <button className="btn" onClick={() => saveRepos(mapping, false)} disabled={busy}>
            {busy ? "Saving…" : "Save group mapping"}
          </button>
        )}
        {!adding && (
          <button
            className="btn secondary"
            onClick={() => {
              setAdding(true);
              listRepos(true);
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
      {adding && repoOptions && repoPicker(addSelected, "Add")}
    </div>
  );

  return (
    <section className="settings-section">
      <div className="subsection-head">
        <h2>Integrations</h2>
        <span className="kicker">GitHub · merge-confirmed delivery for insight reports</span>
      </div>

      {gh === null ? (
        <p className="help-note" style={{ border: "none", padding: 0 }}>Loading…</p>
      ) : gh.connected ? (
        connectedView
      ) : (
        connectFlow
      )}

      {error && <div className="form-error" style={{ marginTop: 14, maxWidth: 680 }}>{error}</div>}
      {message && <div className="action-note">{message}</div>}

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
