"use client";
import { useEffect, useState } from "react";

type ActiveInvite = {
  id: string;
  label: string | null;
  role: "admin" | "member";
  groupIds: string[];
  groupNames: string[];
  createdBy: { id: string; displayName: string | null };
  createdAt: string;
  expiresAt: string;
  token: string | null;
  joinUrl: string | null;
  redemptionCount: number;
};

function formatExpiresIn(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  const days = Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
  if (days <= 0) return "today";
  if (days === 1) return "in 1d";
  return `in ${days}d`;
}

export function ManagerInviteForm({
  teamSlug,
  groupSlug,
  availableGroups,
  preselectedGroupId,
}: {
  teamSlug: string;
  groupSlug: string;
  availableGroups: { id: string; slug: string; name: string }[];
  preselectedGroupId: string;
}) {
  const [invites, setInvites] = useState<ActiveInvite[] | null>(null);
  const [invitesError, setInvitesError] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [selected, setSelected] = useState<string[]>([preselectedGroupId]);
  const [expiresDays, setExpiresDays] = useState(90);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    setInvitesError(null);
    const res = await fetch(`/api/team/${teamSlug}/invites`);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setInvitesError(d.error || "Failed to load invites");
      setInvites([]);
      return;
    }
    const d = await res.json();
    const filtered = ((d.invites as ActiveInvite[]) ?? []).filter((inv) =>
      inv.groupIds.includes(preselectedGroupId),
    );
    setInvites(filtered);
  }

  async function copyLink(joinUrl: string | null) {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
    } catch {
      // No-op
    }
  }

  async function revokeLink(inviteId: string) {
    if (!confirm("Revoke this invite link? It will stop working immediately.")) return;
    const res = await fetch(`/api/team/${teamSlug}/invites/${inviteId}/revoke`, { method: "POST" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Failed to revoke");
      return;
    }
    await refresh();
  }

  async function submit() {
    setError(null);
    if (selected.length === 0) {
      setError("Pick at least one group");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/team/${teamSlug}/groups/${groupSlug}/invite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: label.trim() || undefined,
          groupIds: selected,
          expiresInDays: expiresDays,
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${r.status}`);
        return;
      }
      setLabel("");
      setSelected([preselectedGroupId]);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }

  return (
    <section className="settings-section">
      <p className="kicker" style={{ marginBottom: 16 }}>
        Active invite links that include this group. Anyone with a link can join until you revoke it.
      </p>

      {invitesError && <div className="form-error" style={{ marginBottom: 12 }}>{invitesError}</div>}
      {invites === null ? (
        <p className="kicker">Loading…</p>
      ) : invites.length === 0 ? (
        <p className="kicker">No active links yet.</p>
      ) : (
        <table className="member-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Groups</th>
              <th>Created by</th>
              <th>Expires</th>
              <th>Redemptions</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invites.map((inv) => (
              <tr key={inv.id}>
                <td>{inv.label ?? <span style={{ color: "var(--mute)" }}>(default)</span>}</td>
                <td>{inv.groupNames.length ? inv.groupNames.join(", ") : <span style={{ color: "var(--mute)" }}>—</span>}</td>
                <td>{inv.createdBy.displayName ?? <span style={{ color: "var(--mute)" }}>—</span>}</td>
                <td>{formatExpiresIn(inv.expiresAt)}</td>
                <td>{inv.redemptionCount}</td>
                <td style={{ textAlign: "right" }}>
                  <button onClick={() => copyLink(inv.joinUrl)} className="btn ghost" style={{ marginRight: 6 }} disabled={!inv.joinUrl}>Copy</button>
                  <button onClick={() => revokeLink(inv.id)} className="btn danger-ghost">Revoke</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 style={{ marginTop: 24 }}>+ New link</h3>

      <div className="form-group" style={{ maxWidth: 520, marginBottom: 10 }}>
        <label htmlFor="invite-label">Label (optional)</label>
        <input
          id="invite-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Q2 hires"
        />
      </div>

      <fieldset
        style={{
          border: "1px solid var(--rule)",
          padding: "10px 12px",
          margin: "0 0 10px 0",
          maxWidth: 520,
        }}
      >
        <legend
          className="mono"
          style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--mute)", padding: "0 6px" }}
        >
          PLACE IN GROUPS
        </legend>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {availableGroups.map((g) => (
            <label
              key={g.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 13,
                opacity: g.id === preselectedGroupId ? 0.7 : 1,
              }}
            >
              <input
                type="checkbox"
                checked={selected.includes(g.id)}
                disabled={g.id === preselectedGroupId}
                onChange={() => toggle(g.id)}
              />
              {g.name}
              {g.id === preselectedGroupId && (
                <span className="mono" style={{ fontSize: 9, letterSpacing: "0.14em", color: "var(--mute)" }}>
                  · LOCKED
                </span>
              )}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="form-group" style={{ maxWidth: 240, marginBottom: 10 }}>
        <label htmlFor="expires-days">Expires in (days)</label>
        <input
          id="expires-days"
          type="number"
          min={1}
          max={365}
          value={expiresDays}
          onChange={(e) => setExpiresDays(Math.max(1, Math.min(365, Number(e.target.value) || 90)))}
        />
      </div>

      <button onClick={submit} disabled={busy} className="btn">
        {busy ? "Creating…" : "Create link"}
      </button>

      {error && (
        <div className="form-error" style={{ marginTop: 16, maxWidth: 520 }}>
          {error}
        </div>
      )}
    </section>
  );
}
