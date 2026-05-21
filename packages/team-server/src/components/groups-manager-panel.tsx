"use client";
import { useState } from "react";

type Member = { id: string; email: string | null; display_name: string | null };
type GroupMembership = {
  group_id: string;
  membership_id: string;
  is_manager: boolean;
  added_at: string;
};
type Group = { id: string; slug: string; name: string };
type GroupWithMembers = { group: Group; members: GroupMembership[] };

export function GroupsManagerPanel({
  teamSlug,
  groups,
  allMembers,
}: {
  teamSlug: string;
  groups: GroupWithMembers[];
  allMembers: Member[];
}) {
  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [draftNameById, setDraftNameById] = useState<Record<string, string>>({});
  const [renameErrorById, setRenameErrorById] = useState<Record<string, string>>({});
  const [pendingAddByGroup, setPendingAddByGroup] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<string | null>(null);

  async function create() {
    setCreateError(null);
    if (!newSlug || !newName) {
      setCreateError("Slug and name are required.");
      return;
    }
    setCreating(true);
    try {
      const r = await fetch(`/api/team/${teamSlug}/groups`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: newSlug, name: newName }),
      });
      if (!r.ok) {
        setCreateError((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
        return;
      }
      window.location.reload();
    } finally {
      setCreating(false);
    }
  }

  async function rename(groupId: string, name: string) {
    setRenameErrorById((p) => ({ ...p, [groupId]: "" }));
    const r = await fetch(`/api/team/${teamSlug}/groups/${groupId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) {
      const msg = (await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`;
      setRenameErrorById((p) => ({ ...p, [groupId]: msg }));
      return;
    }
    window.location.reload();
  }

  async function removeGroup(groupId: string, name: string) {
    if (!confirm(`Delete the "${name}" group? Members keep their team access but lose this group affiliation.`)) return;
    const r = await fetch(`/api/team/${teamSlug}/groups/${groupId}`, { method: "DELETE" });
    if (!r.ok) {
      setRowError((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      return;
    }
    window.location.reload();
  }

  async function addMember(groupId: string) {
    const membershipId = pendingAddByGroup[groupId];
    if (!membershipId) return;
    const r = await fetch(`/api/team/${teamSlug}/groups/${groupId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ membershipId }),
    });
    if (!r.ok) {
      setRowError((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      return;
    }
    window.location.reload();
  }

  async function removeMember(groupId: string, membershipId: string) {
    const r = await fetch(
      `/api/team/${teamSlug}/groups/${groupId}/members?membershipId=${membershipId}`,
      { method: "DELETE" },
    );
    if (!r.ok) {
      setRowError((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      return;
    }
    window.location.reload();
  }

  async function toggleManager(groupId: string, membershipId: string, next: boolean) {
    const r = await fetch(`/api/team/${teamSlug}/groups/${groupId}/members`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ membershipId, isManager: next }),
    });
    if (!r.ok) {
      setRowError((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      return;
    }
    window.location.reload();
  }

  function labelFor(m: Member) {
    return m.display_name ? `${m.display_name} <${m.email ?? ""}>` : m.email ?? m.id;
  }

  return (
    <>
      <section className="settings-section">
        <div className="subsection-head">
          <h2>New group</h2>
          <span className="kicker">Organize this team into squads</span>
        </div>
        <div className="settings-row" style={{ marginTop: 12, flexWrap: "wrap" }}>
          <input
            placeholder="slug (e.g. platform)"
            value={newSlug}
            onChange={(e) => setNewSlug(e.target.value)}
            style={{ flex: "0 0 200px" }}
          />
          <input
            placeholder="Display name (e.g. Platform Squad)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ flex: "1 1 240px" }}
          />
          <button className="btn" disabled={creating} onClick={create}>
            {creating ? "Creating…" : "+ Create group"}
          </button>
        </div>
        {createError && <div className="form-error" style={{ marginTop: 12 }}>{createError}</div>}
      </section>

      {rowError && <div className="form-error" style={{ marginBottom: 16 }}>{rowError}</div>}

      {groups.length === 0 ? (
        <div className="kicker" style={{ marginTop: 16 }}>No groups yet.</div>
      ) : (
        groups.map(({ group, members }) => {
          const memberIds = new Set(members.map((m) => m.membership_id));
          const available = allMembers.filter((m) => !memberIds.has(m.id));
          const draft = draftNameById[group.id] ?? group.name;
          const dirty = draft !== group.name;
          const managerCount = members.filter((m) => m.is_manager).length;
          return (
            <section key={group.id} className="settings-section">
              <div className="subsection-head">
                <h2>
                  {group.name} <small style={{ opacity: 0.55 }}>/{group.slug}</small>
                </h2>
                <span className="kicker">
                  {members.length} {members.length === 1 ? "member" : "members"} ·{" "}
                  {managerCount} {managerCount === 1 ? "manager" : "managers"}
                </span>
              </div>

              <div className="settings-row" style={{ marginTop: 12, gap: 8 }}>
                <a className="btn secondary" href={`/team/${teamSlug}/groups/${group.slug}`}>
                  Open
                </a>
                <a className="btn secondary" href={`/team/${teamSlug}/groups/${group.slug}/invite`}>
                  + Invite
                </a>
              </div>

              <table className="member-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Role in group</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {members.length === 0 && (
                    <tr>
                      <td colSpan={3} style={{ opacity: 0.6 }}>No members yet.</td>
                    </tr>
                  )}
                  {members.map((gm) => {
                    const m = allMembers.find((a) => a.id === gm.membership_id);
                    return (
                      <tr key={gm.membership_id}>
                        <td>{m ? labelFor(m) : gm.membership_id}</td>
                        <td>
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <input
                              type="checkbox"
                              checked={gm.is_manager}
                              onChange={(e) => toggleManager(group.id, gm.membership_id, e.target.checked)}
                            />
                            <span>Manager</span>
                          </label>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button
                            className="btn danger-ghost"
                            onClick={() => removeMember(group.id, gm.membership_id)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {available.length > 0 && (
                <div className="settings-row" style={{ marginTop: 12, gap: 8 }}>
                  <select
                    value={pendingAddByGroup[group.id] ?? ""}
                    onChange={(e) =>
                      setPendingAddByGroup((p) => ({ ...p, [group.id]: e.target.value }))
                    }
                    style={{ flex: "1 1 280px" }}
                  >
                    <option value="">Add a team member…</option>
                    {available.map((m) => (
                      <option key={m.id} value={m.id}>
                        {labelFor(m)}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn secondary"
                    disabled={!pendingAddByGroup[group.id]}
                    onClick={() => addMember(group.id)}
                  >
                    Add
                  </button>
                </div>
              )}

              <div className="settings-row" style={{ marginTop: 20, gap: 8, flexWrap: "wrap" }}>
                <input
                  value={draft}
                  onChange={(e) =>
                    setDraftNameById((p) => ({ ...p, [group.id]: e.target.value }))
                  }
                  style={{ flex: "1 1 240px" }}
                />
                <button
                  className="btn secondary"
                  disabled={!dirty || !draft.trim()}
                  onClick={() => rename(group.id, draft.trim())}
                >
                  Rename
                </button>
                <button
                  className="btn danger-ghost"
                  onClick={() => removeGroup(group.id, group.name)}
                >
                  Delete group
                </button>
              </div>
              {renameErrorById[group.id] && (
                <div className="form-error" style={{ marginTop: 8 }}>{renameErrorById[group.id]}</div>
              )}
            </section>
          );
        })
      )}
    </>
  );
}
