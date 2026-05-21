"use client";

import React, { useState } from "react";

type TeamRow = { id: string; name: string; slug: string; created_at: string };
type MemberRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  revoked_at: string | null;
  plan_tier: string;
};

export function SettingsPanel({
  team,
  members,
  teamSlug,
  groups,
  allowedSignupDomains: _allowedSignupDomains,
}: {
  team: TeamRow;
  members: MemberRow[];
  teamSlug: string;
  groups?: { id: string; slug: string; name: string }[];
  allowedSignupDomains: string[];
}) {
  const [teamName, setTeamName] = useState(team.name);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [reactivateTokenById, setReactivateTokenById] = useState<Record<string, string>>({});
  const [reactivateErrorById, setReactivateErrorById] = useState<Record<string, string>>({});
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  function toggleGroup(id: string) {
    setSelectedGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  }

  async function saveProfile() {
    setSaving(true);
    setMessage(null);
    const res = await fetch(`/api/team/settings?team=${teamSlug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: teamName }),
    });
    setSaving(false);
    setMessage(res.ok ? "Saved." : "Failed to save.");
  }

  async function createInvite(role: "admin" | "member") {
    setInviteError(null);
    setInviteUrl(null);
    const res = await fetch(`/api/team/invites?team=${teamSlug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, expiresInDays: 7, groupIds: selectedGroupIds }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setInviteError(d.error || "Failed to create invite");
      return;
    }
    const data = await res.json();
    setInviteUrl(data.joinUrl);
  }

  async function revokeMember(memberId: string) {
    if (!confirm("Revoke this member? They will lose access immediately.")) return;
    await fetch(`/api/team/members/${memberId}`, { method: "DELETE" });
    window.location.reload();
  }

  async function reactivateMember(member: MemberRow) {
    setReactivateErrorById((p) => ({ ...p, [member.id]: "" }));
    setReactivateTokenById((p) => ({ ...p, [member.id]: "" }));
    setReactivatingId(member.id);
    const res = await fetch(`/api/team/members/${member.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reactivate: true }),
    });
    setReactivatingId(null);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setReactivateErrorById((p) => ({ ...p, [member.id]: d.error || "Failed to reactivate" }));
      return;
    }
    const data = await res.json();
    if (data.deviceToken) {
      setReactivateTokenById((p) => ({ ...p, [member.id]: data.deviceToken }));
    } else {
      window.location.reload();
    }
  }

  return (
    <div>
      <section className="settings-section">
        <div className="subsection-head">
          <h2>Team profile</h2>
          <span className="kicker">Slug · {team.slug}</span>
        </div>
        <div className="settings-row" style={{ maxWidth: 520 }}>
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            style={{ flex: 1, padding: "9px 12px", border: "1px solid var(--rule)", background: "var(--bg)", fontSize: 14, fontFamily: "JetBrains Mono, monospace" }}
          />
          <button onClick={saveProfile} disabled={saving} className="btn">
            {saving ? "Saving" : "Save"}
          </button>
        </div>
        {message && (
          <div className="mono" style={{ fontSize: 11, color: "var(--mute)", marginTop: 10, letterSpacing: "0.1em" }}>
            {message.toUpperCase()}
          </div>
        )}
      </section>

      <section className="settings-section">
        <div className="subsection-head">
          <h2>Invite a member</h2>
          <span className="kicker">Share-link · 7-day expiry</span>
        </div>
        {groups && groups.length > 0 && (
          <fieldset
            style={{
              border: "1px solid var(--rule)",
              padding: "10px 12px",
              margin: "0 0 12px 0",
              maxWidth: 520,
            }}
          >
            <legend className="mono" style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--mute)", padding: "0 6px" }}>
              PLACE IN GROUPS (OPTIONAL)
            </legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {groups.map((g) => (
                <label key={g.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={selectedGroupIds.includes(g.id)}
                    onChange={() => toggleGroup(g.id)}
                  />
                  {g.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => createInvite("member")} className="btn">+ Member invite</button>
          <button onClick={() => createInvite("admin")} className="btn secondary">+ Admin invite</button>
        </div>
        {inviteError && <div className="form-error" style={{ marginTop: 12 }}>{inviteError}</div>}
        {inviteUrl && (
          <div className="help-box" style={{ marginTop: 16 }}>
            <p>Invite link created. Copy it and share out-of-band:</p>
            <code className="help-example">{inviteUrl}</code>
            <p className="help-note">Expires in 7 days. The invitee creates their password on first click.</p>
          </div>
        )}
      </section>

      {/* "Plan tiers" tier-picker dropdown removed — the daemon now reads
          each user's tier directly from /api/oauth/profile every 5 min
          and the server upserts memberships.plan_tier on receipt. Manual
          override is still possible by writing the column directly if a
          user has a custom plan that profile doesn't expose. */}

      <section className="settings-section">
        <div className="subsection-head">
          <h2>Members</h2>
          <span className="kicker">{members.filter((m) => !m.revoked_at).length} active</span>
        </div>
        <p style={{ marginTop: 12 }}>
          <a href={`/team/${teamSlug}/settings/groups`}>Manage groups &rarr;</a>
        </p>
        <table className="member-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <React.Fragment key={m.id}>
                <tr>
                  <td>{m.display_name || <span style={{ color: "var(--mute)" }}>—</span>}</td>
                  <td className="mono" style={{ fontSize: 12, color: "var(--mute)" }}>{m.email || "—"}</td>
                  <td className="mono" style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: m.role === "admin" ? "var(--accent)" : "var(--mute)" }}>
                    {m.role}
                  </td>
                  <td>
                    <span className={`status-badge ${m.revoked_at ? "revoked" : "active"}`}>
                      {m.revoked_at ? "Revoked" : "Active"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {!m.revoked_at && m.role !== "admin" && (
                      <button onClick={() => revokeMember(m.id)} className="btn danger-ghost">Revoke</button>
                    )}
                    {m.revoked_at && (
                      <button
                        onClick={() => reactivateMember(m)}
                        className="btn secondary"
                        disabled={reactivatingId === m.id}
                      >
                        {reactivatingId === m.id ? "Reactivating…" : "Reactivate"}
                      </button>
                    )}
                  </td>
                </tr>
                {(reactivateTokenById[m.id] || reactivateErrorById[m.id]) && (
                  <tr>
                    <td colSpan={5}>
                      {reactivateErrorById[m.id] && (
                        <div className="form-error">{reactivateErrorById[m.id]}</div>
                      )}
                      {reactivateTokenById[m.id] && (
                        <div className="help-box">
                          <p>
                            {m.display_name || m.email || "This member"} is active again as <strong>{m.role}</strong>. Send them this device token if they need to re-pair their daemon (shown once):
                          </p>
                          <code className="help-example" style={{ userSelect: "all" }}>{`fleetlens team join ${typeof window !== "undefined" ? window.location.origin : ""} ${reactivateTokenById[m.id]}`}</code>
                          <p className="help-note">
                            <button
                              className="btn ghost"
                              style={{ padding: "2px 8px", fontSize: 12 }}
                              onClick={() => window.location.reload()}
                            >
                              Done
                            </button>
                          </p>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
