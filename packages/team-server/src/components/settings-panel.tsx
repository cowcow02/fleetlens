"use client";

import React, { useEffect, useState } from "react";
import { type ActiveInvite, formatExpiresIn } from "./invite-shared";
import { InviteLinkModal, type InviteLinkValues } from "./invite-link-modal";
import { ConfirmModal } from "./confirm-modal";

type TeamRow = { id: string; name: string; slug: string; created_at: string };
type MemberRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  revoked_at: string | null;
  plan_tier: string;
};
type GroupOpt = { id: string; slug: string; name: string };

// One tab of the settings page at a time — the page routes ?tab= to a section.
export type SettingsSection = "profile" | "invites" | "members";

export function SettingsPanel({
  team,
  members,
  teamSlug,
  groups,
  allowedSignupDomains,
  section,
}: {
  team: TeamRow;
  members: MemberRow[];
  teamSlug: string;
  groups?: GroupOpt[];
  allowedSignupDomains: string[];
  section: SettingsSection;
}) {
  const [teamName, setTeamName] = useState(team.name);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Active invite links
  const [invites, setInvites] = useState<ActiveInvite[] | null>(null);
  const [invitesError, setInvitesError] = useState<string | null>(null);
  const [showNewLink, setShowNewLink] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ActiveInvite | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeMemberTarget, setRevokeMemberTarget] = useState<MemberRow | null>(null);
  const [revokeMemberBusy, setRevokeMemberBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Sign-up policy
  const [domainsInput, setDomainsInput] = useState(allowedSignupDomains.join(", "));
  const [domainsSaving, setDomainsSaving] = useState(false);
  const [domainsMessage, setDomainsMessage] = useState<string | null>(null);
  const [domainsError, setDomainsError] = useState<string | null>(null);

  const [reactivateTokenById, setReactivateTokenById] = useState<Record<string, string>>({});
  const [reactivateErrorById, setReactivateErrorById] = useState<Record<string, string>>({});
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  const showInvites = section === "invites";
  useEffect(() => {
    if (showInvites) refreshInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInvites]);

  async function refreshInvites() {
    setInvitesError(null);
    const res = await fetch(`/api/team/${teamSlug}/invites`);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setInvitesError(d.error || "Failed to load invites");
      setInvites([]);
      return;
    }
    const d = await res.json();
    setInvites(d.invites ?? []);
  }

  async function createInviteLink(values: InviteLinkValues): Promise<string | null> {
    const res = await fetch(`/api/team/invites?team=${teamSlug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      return d.error || `HTTP ${res.status}`;
    }
    await refreshInvites();
    return null;
  }

  async function copyLink(inviteId: string, joinUrl: string | null) {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
    } catch {
      // Clipboard API blocked (insecure context, etc); skip toast.
      return;
    }
    setCopiedId(inviteId);
    window.setTimeout(() => {
      setCopiedId((cur) => (cur === inviteId ? null : cur));
    }, 1800);
  }

  async function confirmRevokeLink() {
    if (!revokeTarget) return;
    setRevokeBusy(true);
    const res = await fetch(`/api/team/${teamSlug}/invites/${revokeTarget.id}/revoke`, { method: "POST" });
    setRevokeBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setInvitesError(d.error || "Failed to revoke");
    }
    setRevokeTarget(null);
    await refreshInvites();
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

  async function saveDomains() {
    setDomainsSaving(true);
    setDomainsMessage(null);
    setDomainsError(null);
    const res = await fetch(`/api/team/settings?team=${teamSlug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowedSignupDomains: domainsInput }),
    });
    setDomainsSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setDomainsError(d.error || "Failed to save");
      return;
    }
    setDomainsMessage("Saved.");
  }

  async function confirmRevokeMember() {
    if (!revokeMemberTarget) return;
    setRevokeMemberBusy(true);
    await fetch(`/api/team/members/${revokeMemberTarget.id}`, { method: "DELETE" });
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
      {section === "profile" && (
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
      )}

      {section === "invites" && (
      <>
      <section className="settings-section">
        <div className="subsection-head">
          <h2>Active invite links</h2>
          <span className="kicker">Reusable · revoke when no longer needed</span>
        </div>
        {invitesError && <div className="form-error" style={{ marginBottom: 12 }}>{invitesError}</div>}
        {invites === null ? (
          <p className="kicker">Loading…</p>
        ) : invites.length === 0 ? (
          <p className="kicker">No active links yet.</p>
        ) : (
          <table className="member-table">
            <thead>
              <tr>
                <th>Role</th>
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
                  <td className="mono" style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>{inv.role}</td>
                  <td>{inv.groupNames.length ? inv.groupNames.join(", ") : <span style={{ color: "var(--mute)" }}>Team-default</span>}</td>
                  <td>{inv.createdBy.displayName ?? <span style={{ color: "var(--mute)" }}>—</span>}</td>
                  <td>{formatExpiresIn(inv.expiresAt)}</td>
                  <td>{inv.redemptionCount}</td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      onClick={() => copyLink(inv.id, inv.joinUrl)}
                      className={`btn-link ${copiedId === inv.id ? "is-success" : ""}`}
                      disabled={!inv.joinUrl}
                      style={{ marginRight: 14 }}
                    >
                      {copiedId === inv.id ? "Copied!" : "Copy link"}
                    </button>
                    <button onClick={() => setRevokeTarget(inv)} className="btn-link is-danger">
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ marginTop: 16 }}>
          <button className="btn" onClick={() => setShowNewLink(true)}>+ New link</button>
        </div>
      </section>

      <section className="settings-section">
        <div className="subsection-head">
          <h2>Sign-up policy</h2>
          <span className="kicker">Restrict invite + public sign-ups to specific email domains</span>
        </div>
        <div className="form-group" style={{ maxWidth: 520 }}>
          <label htmlFor="allowed-domains">Allowed email domains</label>
          <input
            id="allowed-domains"
            value={domainsInput}
            onChange={(e) => setDomainsInput(e.target.value)}
            placeholder="acme.com, acme.io"
          />
          <p className="help-note" style={{ marginTop: 6 }}>
            Leave empty to allow any email domain. Comma-separated. New sign-ups via invite link must match one of these domains.
          </p>
        </div>
        <button onClick={saveDomains} disabled={domainsSaving} className="btn">
          {domainsSaving ? "Saving" : "Save"}
        </button>
        {domainsError && <div className="form-error" style={{ marginTop: 10 }}>{domainsError}</div>}
        {domainsMessage && (
          <div className="mono" style={{ fontSize: 11, color: "var(--mute)", marginTop: 10, letterSpacing: "0.1em" }}>
            {domainsMessage.toUpperCase()}
          </div>
        )}
      </section>
      </>
      )}

      {section === "members" && (
      <section className="settings-section">
        <div className="subsection-head">
          <h2>Members</h2>
          <span className="kicker">{members.filter((m) => !m.revoked_at).length} active</span>
        </div>
        <p style={{ marginTop: 12 }}>
          <a href={`/team/${teamSlug}/groups`}>Manage groups &rarr;</a>
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
                      <button onClick={() => setRevokeMemberTarget(m)} className="btn danger-ghost">Revoke</button>
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
      )}

      <InviteLinkModal
        open={showNewLink}
        groups={groups ?? []}
        allowRoleChoice={true}
        onClose={() => setShowNewLink(false)}
        onSubmit={createInviteLink}
      />

      <ConfirmModal
        open={revokeTarget !== null}
        title="Revoke invite link?"
        body={
          revokeTarget
            ? `The ${revokeTarget.role} link${revokeTarget.groupNames.length ? ` for ${revokeTarget.groupNames.join(", ")}` : ""} will stop working immediately. Anyone who hasn't redeemed it yet will be locked out.`
            : ""
        }
        confirmLabel="Revoke link"
        danger
        busy={revokeBusy}
        onConfirm={confirmRevokeLink}
        onCancel={() => setRevokeTarget(null)}
      />

      <ConfirmModal
        open={revokeMemberTarget !== null}
        title="Revoke member?"
        body={
          revokeMemberTarget
            ? `${revokeMemberTarget.display_name || revokeMemberTarget.email || "This member"} will lose access immediately. You can reactivate them later.`
            : ""
        }
        confirmLabel="Revoke member"
        danger
        busy={revokeMemberBusy}
        onConfirm={confirmRevokeMember}
        onCancel={() => setRevokeMemberTarget(null)}
      />
    </div>
  );
}
