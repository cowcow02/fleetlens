"use client";

import { useEffect, useState } from "react";
import { CheckChip } from "./ui";

type SourceRow = { id: string; label: string; counts: boolean; via_all_groups: boolean };

// Group-scoped view of the org-level integration mappings: one toggle per
// repo / Linear team — "does this source count toward this group's report".
// Credentials and the cross-group matrix stay in org settings; this is the
// group manager's slice of the same data.
export function GroupDataSources({
  teamSlug,
  groupSlug,
  isAdmin,
  embedded = false,
}: {
  teamSlug: string;
  groupSlug: string;
  isAdmin: boolean;
  // When rendered inside the group settings modal the tab supplies its own
  // heading + spacing, so drop the standalone section chrome.
  embedded?: boolean;
}) {
  const [github, setGithub] = useState<SourceRow[] | null>(null);
  const [linear, setLinear] = useState<SourceRow[] | null>(null);
  const [jira, setJira] = useState<SourceRow[] | null>(null);
  const [connected, setConnected] = useState({ github: false, linear: false, jira: false });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    const res = await fetch(`/api/team/${teamSlug}/groups/${groupSlug}/data-sources`);
    if (!res.ok) return;
    const d = await res.json();
    setConnected({ github: d.github.connected, linear: d.linear.connected, jira: d.jira?.connected ?? false });
    setGithub(d.github.repos.map((r: { name: string; counts: boolean; via_all_groups: boolean }) => ({
      id: r.name, label: r.name, counts: r.counts, via_all_groups: r.via_all_groups,
    })));
    setLinear(d.linear.teams.map((t: { key: string; counts: boolean; via_all_groups: boolean }) => ({
      id: t.key, label: t.key, counts: t.counts, via_all_groups: t.via_all_groups,
    })));
    setJira((d.jira?.projects ?? []).map((p: { key: string; counts: boolean; via_all_groups: boolean }) => ({
      id: p.key, label: p.key, counts: p.counts, via_all_groups: p.via_all_groups,
    })));
    setDirty(false);
  }

  function toggle(kind: "github" | "linear" | "jira", id: string) {
    const set = kind === "github" ? setGithub : kind === "linear" ? setLinear : setJira;
    set((prev) =>
      (prev ?? []).map((r) => (r.id === id ? { ...r, counts: !r.counts, via_all_groups: false } : r)),
    );
    setDirty(true);
  }

  async function saveAll() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/team/${teamSlug}/groups/${groupSlug}/data-sources`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        github: (github ?? []).map((r) => ({ name: r.id, counts: r.counts })),
        linear: (linear ?? []).map((t) => ({ key: t.id, counts: t.counts })),
        jira: (jira ?? []).map((p) => ({ key: p.id, counts: p.counts })),
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || `HTTP ${res.status}`);
      await refresh();
      return;
    }
    setMessage("Saved — the group's insight report reflects this immediately.");
    await refresh();
  }

  if (github === null || linear === null || jira === null) return null;
  const nothingConnected = !connected.github && !connected.linear && !connected.jira;

  const body = (
    <>
      {nothingConnected ? (
        <p className="help-note" style={{ border: "none", padding: 0 }}>
          No integrations connected yet.{" "}
          {isAdmin ? (
            <>
              <a href={`/team/${teamSlug}/settings?tab=integrations`}>Connect GitHub, Linear or Jira in team settings</a> to add
              merge-confirmed delivery and ticket velocity to this group&rsquo;s report.
            </>
          ) : (
            "Ask a team admin to connect GitHub, Linear or Jira in team settings."
          )}
        </p>
      ) : (
        <>
          {connected.github && (
            <div style={{ marginBottom: 16 }}>
              <div className="provider-head" style={{ marginBottom: 8 }}>GitHub repositories</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {github.map((r) => (
                  <CheckChip key={r.id} checked={r.counts && !r.via_all_groups} implied={r.via_all_groups} onChange={() => toggle("github", r.id)}>
                    {r.label}
                  </CheckChip>
                ))}
              </div>
            </div>
          )}
          {connected.linear && (
            <div style={{ marginBottom: 16 }}>
              <div className="provider-head" style={{ marginBottom: 8 }}>Linear teams</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {linear.map((t) => (
                  <CheckChip key={t.id} checked={t.counts && !t.via_all_groups} implied={t.via_all_groups} onChange={() => toggle("linear", t.id)}>
                    {t.label}
                  </CheckChip>
                ))}
              </div>
            </div>
          )}
          {connected.jira && (
            <div style={{ marginBottom: 16 }}>
              <div className="provider-head" style={{ marginBottom: 8 }}>Jira projects</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {jira.map((p) => (
                  <CheckChip key={p.id} checked={p.counts && !p.via_all_groups} implied={p.via_all_groups} onChange={() => toggle("jira", p.id)}>
                    {p.label}
                  </CheckChip>
                ))}
              </div>
            </div>
          )}
          <p className="help-note" style={{ maxWidth: 680 }}>
            Checked sources feed this group&rsquo;s delivery and ticket-velocity metrics. A dashed chip means the
            source currently counts toward every group (the default) — toggling it here scopes it explicitly.
            {isAdmin && (
              <>
                {" "}The cross-group matrix lives in <a href={`/team/${teamSlug}/settings?tab=integrations`}>team settings → Integrations</a>.
              </>
            )}
          </p>
          {dirty && (
            <button className="btn" onClick={saveAll} disabled={busy} style={{ marginTop: 4 }}>
              {busy ? "Saving…" : "Save data sources"}
            </button>
          )}
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
        <h2>Data sources</h2>
        <span className="kicker">What counts toward this group&rsquo;s insight report</span>
      </div>
      {body}
    </section>
  );
}
