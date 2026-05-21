"use client";
import { useEffect, useState } from "react";
import { type ActiveInvite, formatExpiresIn } from "./invite-shared";
import { InviteLinkModal, type InviteLinkValues } from "./invite-link-modal";
import { ConfirmModal } from "./confirm-modal";

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
  const [showNewLink, setShowNewLink] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ActiveInvite | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);

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

  async function createInviteLink(values: InviteLinkValues): Promise<string | null> {
    const res = await fetch(`/api/team/${teamSlug}/groups/${groupSlug}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: values.label,
        groupIds: values.groupIds,
        expiresInDays: values.expiresInDays,
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      return d.error || `HTTP ${res.status}`;
    }
    await refresh();
    return null;
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setRevokeBusy(true);
    const res = await fetch(`/api/team/${teamSlug}/invites/${revokeTarget.id}/revoke`, { method: "POST" });
    setRevokeBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setInvitesError(d.error || "Failed to revoke");
    }
    setRevokeTarget(null);
    await refresh();
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
                  <button
                    onClick={() => copyLink(inv.joinUrl)}
                    className="btn ghost"
                    style={{ marginRight: 6 }}
                    disabled={!inv.joinUrl}
                  >
                    Copy
                  </button>
                  <button onClick={() => setRevokeTarget(inv)} className="btn danger-ghost">
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: 16 }}>
        <button className="btn" onClick={() => setShowNewLink(true)}>
          + New link
        </button>
      </div>

      <InviteLinkModal
        open={showNewLink}
        groups={availableGroups}
        lockedGroupId={preselectedGroupId}
        allowRoleChoice={false}
        onClose={() => setShowNewLink(false)}
        onSubmit={createInviteLink}
      />

      <ConfirmModal
        open={revokeTarget !== null}
        title="Revoke invite link?"
        body={
          revokeTarget
            ? `"${revokeTarget.label ?? "(default)"}" will stop working immediately. Anyone who hasn't redeemed it yet will be locked out.`
            : ""
        }
        confirmLabel="Revoke link"
        danger
        busy={revokeBusy}
        onConfirm={confirmRevoke}
        onCancel={() => setRevokeTarget(null)}
      />
    </section>
  );
}
