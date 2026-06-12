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
}: {
  teamSlug: string;
  groupSlug: string;
  isAdmin: boolean;
}) {
  const [github, setGithub] = useState<SourceRow[] | null>(null);
  const [linear, setLinear] = useState<SourceRow[] | null>(null);
  const [connected, setConnected] = useState({ github: false, linear: false });
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
    setConnected({ github: d.github.connected, linear: d.linear.connected });
    setGithub(d.github.repos.map((r: { name: string; counts: boolean; via_all_groups: boolean }) => ({
      id: r.name, label: r.name, counts: r.counts, via_all_groups: r.via_all_groups,
    })));
    setLinear(d.linear.teams.map((t: { key: string; counts: boolean; via_all_groups: boolean }) => ({
      id: t.key, label: t.key, counts: t.counts, via_all_groups: t.via_all_groups,
    })));
    setDirty(false);
  }

  function toggle(kind: "github" | "linear", id: string) {
    const set = kind === "github" ? setGithub : setLinear;
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

  if (github === null || linear === null) return null;
  const nothingConnected = !connected.github && !connected.linear;

  return (
    <section className="settings-section" style={{ marginTop: 40 }}>
      <div className="subsection-head">
        <h2>Data sources</h2>
        <span className="kicker">What counts toward this group&rsquo;s insight report</span>
      </div>

      {nothingConnected ? (
        <p className="help-note" style={{ border: "none", padding: 0 }}>
          No integrations connected yet.{" "}
          {isAdmin ? (
            <>
              <a href={`/team/${teamSlug}/settings`}>Connect GitHub or Linear in team settings</a> to add
              merge-confirmed delivery and ticket velocity to this group&rsquo;s report.
            </>
          ) : (
            "Ask a team admin to connect GitHub or Linear in team settings."
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
          <p className="help-note" style={{ maxWidth: 680 }}>
            Checked sources feed this group&rsquo;s delivery and ticket-velocity metrics. A dashed chip means the
            source currently counts toward every group (the default) — toggling it here scopes it explicitly.
            {isAdmin && (
              <>
                {" "}The cross-group matrix lives in <a href={`/team/${teamSlug}/settings`}>team settings → Integrations</a>.
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
    </section>
  );
}
