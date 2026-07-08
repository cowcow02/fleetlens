"use client";

import { useEffect, useMemo, useState } from "react";
import { ConfirmModal } from "./confirm-modal";
import { Callout, CheckChip, isAuthSyncError, PickerRow, StatusStrip } from "./ui";

type Provider = "github" | "linear" | "jira";
type SourceRow = { key: string; counts: boolean; via_all_groups: boolean };
type GroupIntegration = {
  id: string;
  provider: Provider;
  label: string;
  owned: boolean;
  sources: SourceRow[];
  login?: string | null;
  site?: string | null;
  status?: "active" | "error";
  last_error?: string | null;
  last_sync_at?: string | null;
};

type RepoOption = { full_name: string; private: boolean; pushed_at: string | null };
type TeamOption = { id: string; key: string; name: string };
type ProjectOption = { id: string; key: string; name: string };

const GH_TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";
const LINEAR_KEY_URL = "https://linear.app/settings/api";
const JIRA_TOKEN_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";

export function GroupIntegrationsPanel({
  teamSlug,
  groupSlug,
  embedded = false,
}: {
  teamSlug: string;
  groupSlug: string;
  embedded?: boolean;
}) {
  const [integrations, setIntegrations] = useState<GroupIntegration[] | null>(null);
  const [connectProvider, setConnectProvider] = useState<Provider | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    setError(null);
    const res = await fetch(`/api/team/${teamSlug}/groups/${groupSlug}/integrations`);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || `HTTP ${res.status}`);
      setIntegrations([]);
      return;
    }
    const d = await res.json();
    setIntegrations(d.integrations ?? []);
  }

  const body = (
    <>
      {integrations === null ? (
        <p className="help-note" style={{ border: "none", padding: 0 }}>Loading…</p>
      ) : (
        <>
          {integrations.length === 0 ? (
            <p className="help-note" style={{ border: "none", padding: 0 }}>
              No integrations are connected for this group yet.
            </p>
          ) : (
            integrations.map((integration) => (
              <GroupIntegrationSection
                key={integration.id}
                teamSlug={teamSlug}
                groupSlug={groupSlug}
                integration={integration}
                onRefresh={refresh}
              />
            ))
          )}

          <div style={{ borderTop: "1px solid var(--rule-soft)", paddingTop: 18, marginTop: 18 }}>
            <div className="provider-head" style={{ marginBottom: 10 }}>Connect integrations for this group</div>
            <div className="settings-row" style={{ flexWrap: "wrap" }}>
              <button className="btn secondary" onClick={() => setConnectProvider("github")}>Connect GitHub for this group</button>
              <button className="btn secondary" onClick={() => setConnectProvider("linear")}>Connect Linear for this group</button>
              <button className="btn secondary" onClick={() => setConnectProvider("jira")}>Connect Jira for this group</button>
            </div>
            {connectProvider === "github" && (
              <GroupGithubConnect
                teamSlug={teamSlug}
                groupSlug={groupSlug}
                onSaved={async (notice) => {
                  setMessage(notice);
                  setConnectProvider(null);
                  await refresh();
                }}
                onCancel={() => setConnectProvider(null)}
              />
            )}
            {connectProvider === "linear" && (
              <GroupLinearConnect
                teamSlug={teamSlug}
                groupSlug={groupSlug}
                onSaved={async (notice) => {
                  setMessage(notice);
                  setConnectProvider(null);
                  await refresh();
                }}
                onCancel={() => setConnectProvider(null)}
              />
            )}
            {connectProvider === "jira" && (
              <GroupJiraConnect
                teamSlug={teamSlug}
                groupSlug={groupSlug}
                onSaved={async (notice) => {
                  setMessage(notice);
                  setConnectProvider(null);
                  await refresh();
                }}
                onCancel={() => setConnectProvider(null)}
              />
            )}
          </div>
        </>
      )}

      {error && <div className="form-error" style={{ marginTop: 12, maxWidth: 680 }}>{error}</div>}
      {message && <div className="action-note">{message}</div>}
    </>
  );

  if (embedded) return body;

  return (
    <section className="settings-section" style={{ marginTop: 40 }}>
      <div className="subsection-head">
        <h2>Integrations</h2>
        <span className="kicker">What counts toward this group&rsquo;s insight report</span>
      </div>
      {body}
    </section>
  );
}

function GroupIntegrationSection({
  teamSlug,
  groupSlug,
  integration,
  onRefresh,
}: {
  teamSlug: string;
  groupSlug: string;
  integration: GroupIntegration;
  onRefresh: () => Promise<void>;
}) {
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    setSources(integration.sources);
    setDirty(false);
  }, [integration]);

  function toggle(key: string) {
    setSources((prev) =>
      prev.map((s) => (s.key === key ? { ...s, counts: !s.counts, via_all_groups: false } : s)),
    );
    setDirty(true);
  }

  async function saveSources() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/team/${teamSlug}/groups/${groupSlug}/integrations/${integration.id}/sources`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: sources.map((s) => ({ key: s.key, counts: s.counts })) }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      await onRefresh();
      return;
    }
    setMessage("Saved — this group's insight report reflects this immediately.");
    await onRefresh();
  }

  async function syncNow() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/team/settings/integrations/${integration.provider}/sync?team=${teamSlug}&id=${integration.id}`, {
      method: "POST",
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      return;
    }
    setMessage(syncMessage(integration.provider, d));
    await onRefresh();
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/team/settings/integrations/${integration.provider}?team=${teamSlug}&id=${integration.id}`, {
      method: "DELETE",
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      return;
    }
    setConfirmDisconnect(false);
    setMessage("Disconnected. Data synced by this connection was removed from reports.");
    await onRefresh();
  }

  const fmtSync = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never";

  return (
    <div style={{ border: "1px solid var(--rule)", padding: 16, marginBottom: 14 }}>
      <div className="provider-head" style={{ marginBottom: 8 }}>
        {providerLabel(integration.provider)}{integration.label !== providerLabel(integration.provider) && <> · {integration.label}</>}
        {integration.owned && <span className="badge-tag" style={{ marginLeft: 8 }}>owned</span>}
      </div>

      {integration.owned && (
        <>
          <StatusStrip
            ok={integration.status !== "error"}
            segments={[
              <span key="who">
                Connected as <strong>{integration.login ?? "unknown"}</strong>
                {integration.site ? <span className="mono-meta"> · {integration.site.replace(/^https?:\/\//, "")}</span> : null}
              </span>,
              <span key="cadence" className="mono-meta">syncs hourly</span>,
              <span key="last" className="mono-meta">last successful sync {fmtSync(integration.last_sync_at)}</span>,
            ]}
          />
          {integration.status === "error" &&
            (isAuthSyncError(integration.last_error) ? (
              <Callout tone="error">
                {providerLabel(integration.provider)} rejected the stored credentials on the last sync ({integration.last_error}).
                Reconnect this integration below if the token was revoked.
              </Callout>
            ) : (
              <Callout>
                Couldn&rsquo;t reach {providerLabel(integration.provider)} on the last sync attempt ({integration.last_error ?? "network error"}).
                It retries automatically every hour, or press &ldquo;Sync now&rdquo; to retry immediately.
              </Callout>
            ))}
        </>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: integration.owned ? 14 : 0 }}>
        {sources.map((s) => (
          <CheckChip key={s.key} checked={s.counts && !s.via_all_groups} implied={s.via_all_groups} onChange={() => toggle(s.key)}>
            {s.key}
          </CheckChip>
        ))}
      </div>
      <p className="help-note" style={{ maxWidth: 680 }}>
        Checked sources feed this group&rsquo;s delivery and ticket-velocity metrics. A dashed chip means the source
        currently counts toward every group (the default) — toggling it here scopes it explicitly.
      </p>

      <div className="settings-row" style={{ marginTop: 14, flexWrap: "wrap" }}>
        {dirty && (
          <button className="btn" onClick={saveSources} disabled={busy}>
            {busy ? "Saving…" : "Save sources"}
          </button>
        )}
        {integration.owned && (
          <>
            <button className="btn secondary" onClick={syncNow} disabled={busy}>
              {busy ? "Working…" : "Sync now"}
            </button>
            <button className="btn-link is-danger" onClick={() => setConfirmDisconnect(true)} disabled={busy}>
              Disconnect
            </button>
          </>
        )}
      </div>

      {error && <div className="form-error" style={{ marginTop: 12, maxWidth: 680 }}>{error}</div>}
      {message && <div className="action-note">{message}</div>}

      <ConfirmModal
        open={confirmDisconnect}
        title={`Disconnect ${integration.label}?`}
        body="Stored credentials are deleted and data synced by this connection is removed from reports (sources also tracked by another connection are kept). You can reconnect any time."
        confirmLabel="Disconnect"
        danger
        busy={busy}
        onConfirm={disconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </div>
  );
}

function GroupGithubConnect({
  teamSlug,
  groupSlug,
  onSaved,
  onCancel,
}: {
  teamSlug: string;
  groupSlug: string;
  onSaved: (message: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
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
    const res = await fetch(`/api/team/${teamSlug}/groups/${groupSlug}/integrations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "github",
        label: label.trim() || undefined,
        token,
        repos: [...selected].map((name) => ({ name, group_ids: [] as string[] })),
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      return;
    }
    await onSaved(savedMessage("github", d));
  }

  return (
    <div style={{ maxWidth: 680, marginTop: 14 }}>
      <p style={{ marginTop: 0, lineHeight: 1.6, maxWidth: 640 }}>
        Connect GitHub for this group to add merge-confirmed delivery metrics to its insight report.
      </p>
      <ol className="steps-editorial">
        <li>
          <span>
            <a href={GH_TOKEN_URL} target="_blank" rel="noreferrer">Create a fine-grained access token on GitHub ↗</a>{" "}
            with read-only Contents, Pull requests and Metadata access.
          </span>
        </li>
        <li><span>Paste the token below, then choose repositories to track for this group.</span></li>
      </ol>
      <LabelInput id="group-gh-label" value={label} onChange={setLabel} placeholder="GitHub" />
      <div className="form-group" style={{ maxWidth: 420 }}>
        <label htmlFor="group-gh-token">GitHub token</label>
        <input
          id="group-gh-token"
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
          <button className="btn-link" onClick={onCancel} disabled={busy}>Cancel</button>
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

function GroupLinearConnect({
  teamSlug,
  groupSlug,
  onSaved,
  onCancel,
}: {
  teamSlug: string;
  groupSlug: string;
  onSaved: (message: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
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
    const res = await fetch(`/api/team/${teamSlug}/groups/${groupSlug}/integrations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "linear",
        label: label.trim() || undefined,
        apiKey,
        teams: [...selectedKeys].map((key) => ({ key, group_ids: [] as string[] })),
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      return;
    }
    await onSaved(savedMessage("linear", d));
  }

  return (
    <div style={{ maxWidth: 680, marginTop: 14 }}>
      <p style={{ marginTop: 0, lineHeight: 1.6, maxWidth: 640 }}>
        Connect Linear for this group to add ticket velocity metrics to its insight report.
      </p>
      <ol className="steps-editorial">
        <li>
          <span>
            <a href={LINEAR_KEY_URL} target="_blank" rel="noreferrer">Create a personal API key in Linear ↗</a> with read access.
          </span>
        </li>
        <li><span>Paste it below, then pick the Linear teams to track.</span></li>
      </ol>
      <LabelInput id="group-lin-label" value={label} onChange={setLabel} placeholder="Linear" />
      <div className="form-group" style={{ maxWidth: 420 }}>
        <label htmlFor="group-lin-key">Linear API key</label>
        <input
          id="group-lin-key"
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
          <button className="btn-link" onClick={onCancel} disabled={busy}>Cancel</button>
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

function GroupJiraConnect({
  teamSlug,
  groupSlug,
  onSaved,
  onCancel,
}: {
  teamSlug: string;
  groupSlug: string;
  onSaved: (message: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [site, setSite] = useState("");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [label, setLabel] = useState("");
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
    const res = await fetch(`/api/team/${teamSlug}/groups/${groupSlug}/integrations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "jira",
        label: label.trim() || undefined,
        site,
        email,
        apiToken,
        projects: [...selectedKeys].map((key) => ({ key, group_ids: [] as string[] })),
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      return;
    }
    await onSaved(savedMessage("jira", d));
  }

  return (
    <div style={{ maxWidth: 680, marginTop: 14 }}>
      <p style={{ marginTop: 0, lineHeight: 1.6, maxWidth: 640 }}>
        Connect Jira for this group to add ticket velocity metrics to its insight report.
      </p>
      <ol className="steps-editorial">
        <li>
          <span>
            <a href={JIRA_TOKEN_URL} target="_blank" rel="noreferrer">Create an API token in Atlassian ↗</a> with read access.
          </span>
        </li>
        <li><span>Enter your Jira site, account email and the token, then pick projects to track.</span></li>
      </ol>
      <LabelInput id="group-jira-label" value={label} onChange={setLabel} placeholder="Jira" />
      <div className="form-group" style={{ maxWidth: 420 }}>
        <label htmlFor="group-jira-site">Jira site</label>
        <input
          id="group-jira-site"
          type="text"
          value={site}
          onChange={(e) => setSite(e.target.value)}
          placeholder="your-team.atlassian.net"
          autoComplete="off"
        />
      </div>
      <div className="form-group" style={{ maxWidth: 420 }}>
        <label htmlFor="group-jira-email">Account email</label>
        <input
          id="group-jira-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          autoComplete="off"
        />
      </div>
      <div className="form-group" style={{ maxWidth: 420 }}>
        <label htmlFor="group-jira-token">API token</label>
        <input
          id="group-jira-token"
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
          <button className="btn-link" onClick={onCancel} disabled={busy}>Cancel</button>
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

function LabelInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="form-group" style={{ maxWidth: 420 }}>
      <label htmlFor={id}>Label <span className="optional">optional</span></label>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
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
        <label htmlFor="group-gh-repo-filter">
          Choose repositories to track
          <span className="optional" style={{ marginLeft: 8 }}>
            {selected.size} selected · {visibleCount} visible to this token
          </span>
        </label>
        <input
          id="group-gh-repo-filter"
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
      <div className="settings-row" style={{ marginTop: 14 }}>
        <button className="btn" onClick={onConfirm} disabled={busy || selected.size === 0}>
          {busy ? "Working…" : `${confirmLabel} ${selected.size > 0 ? `(${selected.size})` : ""}`}
        </button>
        <button className="btn-link" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
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
          <span className="optional" style={{ marginLeft: 8 }}>tickets from these teams feed the velocity metrics</span>
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
        <button className="btn-link" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
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
          <span className="optional" style={{ marginLeft: 8 }}>tickets from these projects feed the velocity metrics</span>
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
        <button className="btn-link" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

function providerLabel(provider: Provider) {
  return provider === "github" ? "GitHub" : provider === "jira" ? "Jira" : "Linear";
}

function syncMessage(provider: Provider, d: any) {
  if (provider === "github") return `Synced ${d.prs} PRs (${d.aiAssisted} AI-assisted).`;
  return `Synced ${d.issues} issues (${d.completed} completed).`;
}

function savedMessage(provider: Provider, d: any) {
  if (d.sync) {
    if (provider === "github") {
      return `Saved — synced ${d.sync.prs} PRs (${d.sync.aiAssisted} AI-assisted). They're live in the insight reports now.`;
    }
    return `Saved — synced ${d.sync.issues} issues (${d.sync.completed} completed). Ticket velocity is live in the insight reports.`;
  }
  return `Saved, but the first sync failed: ${d.sync_error}. Fix the credentials or source access, then press "Sync now".`;
}
