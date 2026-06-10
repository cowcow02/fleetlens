"use client";

import { useEffect, useState } from "react";

type GithubStatus = {
  connected: boolean;
  login?: string | null;
  repos?: string[];
  status?: "active" | "error";
  last_error?: string | null;
  last_sync_at?: string | null;
  prs_synced?: number;
  prs_ai_assisted?: number;
};

export function IntegrationsPanel({ teamSlug }: { teamSlug: string }) {
  const [gh, setGh] = useState<GithubStatus | null>(null);
  const [token, setToken] = useState("");
  const [reposInput, setReposInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
    if (d.connected && d.repos) setReposInput(d.repos.join(", "));
  }

  async function connect() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const repos = reposInput.split(",").map((r) => r.trim()).filter(Boolean);
    const res = await fetch(`/api/team/settings/integrations/github?team=${teamSlug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, repos }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      return;
    }
    setToken("");
    setMessage(
      d.sync
        ? `Connected as ${d.login} — synced ${d.sync.prs} PRs (${d.sync.aiAssisted} AI-assisted) from ${d.sync.repos} repo${d.sync.repos === 1 ? "" : "s"}`
        : `Connected as ${d.login} — initial sync failed: ${d.sync_error}`,
    );
    await refresh();
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
    setMessage(`Synced ${d.prs} PRs (${d.aiAssisted} AI-assisted)`);
    await refresh();
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    await fetch(`/api/team/settings/integrations/github?team=${teamSlug}`, { method: "DELETE" });
    setBusy(false);
    setMessage("Disconnected. Synced PRs are kept.");
    setToken("");
    await refresh();
  }

  return (
    <section className="settings-section">
      <div className="subsection-head">
        <h2>Integrations</h2>
        <span className="kicker">
          GitHub — merge-confirmed delivery metrics for the insight report. Token is encrypted at rest, read-only scopes suffice.
        </span>
      </div>

      {gh?.connected ? (
        <div style={{ maxWidth: 640 }}>
          <p style={{ marginTop: 0 }}>
            Connected as <strong>{gh.login ?? "unknown"}</strong> · {gh.repos?.join(", ")}
          </p>
          <p className="mono" style={{ fontSize: 11, color: "var(--mute)", letterSpacing: "0.08em" }}>
            {gh.status === "error"
              ? `LAST SYNC FAILED: ${gh.last_error ?? "unknown error"}`
              : `LAST SYNC ${gh.last_sync_at ? new Date(gh.last_sync_at).toLocaleString() : "never"} · ${gh.prs_synced ?? 0} PRS STORED (${gh.prs_ai_assisted ?? 0} AI-ASSISTED)`}
          </p>
          <div style={{ display: "flex", gap: 12 }}>
            <button className="btn" onClick={syncNow} disabled={busy}>
              {busy ? "Working" : "Sync now"}
            </button>
            <button className="btn-link is-danger" onClick={disconnect} disabled={busy}>
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <div style={{ maxWidth: 640 }}>
          <div className="form-group">
            <label htmlFor="gh-token">GitHub token</label>
            <input
              id="gh-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="fine-grained PAT or org token with read access to the repos"
              autoComplete="off"
            />
          </div>
          <div className="form-group">
            <label htmlFor="gh-repos">Repositories</label>
            <input
              id="gh-repos"
              value={reposInput}
              onChange={(e) => setReposInput(e.target.value)}
              placeholder="owner/repo, owner/other-repo"
            />
            <p className="help-note" style={{ marginTop: 6 }}>
              Comma-separated owner/name. PRs from the last 60 days are synced hourly; AI assistance is detected from
              Co-Authored-By commit trailers.
            </p>
          </div>
          <button className="btn" onClick={connect} disabled={busy || !token || !reposInput.trim()}>
            {busy ? "Validating + syncing" : "Connect GitHub"}
          </button>
        </div>
      )}

      {error && <div className="form-error" style={{ marginTop: 10 }}>{error}</div>}
      {message && (
        <div className="mono" style={{ fontSize: 11, color: "var(--mute)", marginTop: 10, letterSpacing: "0.1em" }}>
          {message.toUpperCase()}
        </div>
      )}
    </section>
  );
}
