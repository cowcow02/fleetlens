"use client";
import { useEffect, useState } from "react";

export type InviteLinkValues = {
  role: "admin" | "member";
  groupIds: string[];
  expiresInDays: number;
};

export function InviteLinkModal({
  open,
  groups,
  lockedGroupId,
  allowRoleChoice,
  onClose,
  onSubmit,
}: {
  open: boolean;
  groups: { id: string; name: string }[];
  // For the group-manager flow, the current group is preselected + locked on.
  lockedGroupId?: string;
  // Admin settings show the role select; manager flow forces member-only.
  allowRoleChoice: boolean;
  onClose: () => void;
  // Resolve with null on success, or a string error to surface in the modal.
  onSubmit: (values: InviteLinkValues) => Promise<string | null>;
}) {
  const [role, setRole] = useState<"admin" | "member">("member");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(
    lockedGroupId ? [lockedGroupId] : [],
  );
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRole("member");
    setSelectedGroupIds(lockedGroupId ? [lockedGroupId] : []);
    setExpiresInDays(90);
    setBusy(false);
    setError(null);
  }, [open, lockedGroupId]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  function toggleGroup(id: string) {
    if (id === lockedGroupId) return;
    setSelectedGroupIds((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id],
    );
  }

  async function submit() {
    setError(null);
    setBusy(true);
    const days = Math.max(1, Math.min(365, Math.floor(expiresInDays) || 90));
    const err = await onSubmit({
      role,
      groupIds: selectedGroupIds,
      expiresInDays: days,
    });
    if (err) {
      setError(err);
      setBusy(false);
      return;
    }
    onClose();
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal modal--form" role="dialog" aria-modal="true" aria-labelledby="invite-link-title">
        <div className="modal-subtitle">New invite link</div>
        <h2 id="invite-link-title">
          Share a <em>reusable</em> link
        </h2>

        {allowRoleChoice && (
          <div className="modal-field">
            <label htmlFor="invite-role">Role on join</label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as "admin" | "member")}
              autoFocus
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <div className="field-hint">
              {role === "admin"
                ? "Anyone redeeming this link becomes a team admin. Use carefully."
                : "Standard team member access."}
            </div>
          </div>
        )}

        {groups.length > 0 && (
          <div className="modal-field">
            <label>Add to groups {lockedGroupId ? "" : "(optional)"}</label>
            <div className="group-chip-list">
              {groups.map((g) => {
                const isLocked = g.id === lockedGroupId;
                const isSelected = selectedGroupIds.includes(g.id);
                const className = isLocked
                  ? "group-chip locked"
                  : isSelected
                    ? "group-chip selected"
                    : "group-chip";
                return (
                  <button
                    key={g.id}
                    type="button"
                    className={className}
                    onClick={() => toggleGroup(g.id)}
                    disabled={isLocked}
                    aria-pressed={isSelected}
                  >
                    <span aria-hidden="true">{isSelected ? "✓" : "+"}</span>
                    {g.name}
                  </button>
                );
              })}
            </div>
            <div className="field-hint">
              {lockedGroupId
                ? "This group is auto-included. Tap any other group to add it."
                : "Click a group to add or remove it. Leave empty for a team-default link."}
            </div>
          </div>
        )}

        <div className="modal-field">
          <label htmlFor="invite-expires">Expires in (days)</label>
          <input
            id="invite-expires"
            type="number"
            min={1}
            max={365}
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(Number(e.target.value))}
          />
          <div className="field-hint">1–365 days. Default 90.</div>
        </div>

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn" onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create link"}
          </button>
        </div>
      </div>
    </div>
  );
}
