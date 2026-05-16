"use client";
import { useState } from "react";

type Member = { id: string; email: string | null; display_name: string | null };
type GroupMembership = { group_id: string; membership_id: string; is_manager: boolean; added_at: string };
type GroupWithMembers = {
  group: { id: string; slug: string; name: string };
  members: GroupMembership[];
};

export function GroupsSettingsPanel({
  teamSlug,
  groups,
  allMembers,
}: {
  teamSlug: string;
  groups: GroupWithMembers[];
  allMembers: Member[];
}) {
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    if (!newName || !newSlug) {
      setError("Slug and name are required");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/team/${teamSlug}/groups`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: newSlug, name: newName }),
      });
      if (!r.ok) {
        setError((await r.json()).error ?? `HTTP ${r.status}`);
        return;
      }
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  async function addMember(groupId: string, membershipId: string) {
    const r = await fetch(`/api/team/${teamSlug}/groups/${groupId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ membershipId }),
    });
    if (!r.ok) {
      alert((await r.json()).error ?? `HTTP ${r.status}`);
      return;
    }
    window.location.reload();
  }
  async function removeMember(groupId: string, membershipId: string) {
    const r = await fetch(`/api/team/${teamSlug}/groups/${groupId}/members?membershipId=${membershipId}`, {
      method: "DELETE",
    });
    if (!r.ok) {
      alert((await r.json()).error ?? `HTTP ${r.status}`);
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
      alert((await r.json()).error ?? `HTTP ${r.status}`);
      return;
    }
    window.location.reload();
  }
  async function deleteGroup(groupId: string) {
    if (!confirm("Delete this group? Members keep their team membership but lose this group affiliation.")) return;
    const r = await fetch(`/api/team/${teamSlug}/groups/${groupId}`, { method: "DELETE" });
    if (!r.ok) {
      alert((await r.json()).error ?? `HTTP ${r.status}`);
      return;
    }
    window.location.reload();
  }

  return (
    <div>
      <section style={{ marginBottom: 24 }}>
        <h2>Create group</h2>
        <input placeholder="slug (e.g., platform)" value={newSlug} onChange={(e) => setNewSlug(e.target.value)} />
        <input placeholder="Name (e.g., Platform Squad)" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button disabled={busy} onClick={create}>Create</button>
        {error && <div style={{ color: "tomato" }}>{error}</div>}
      </section>
      {groups.map(({ group, members }) => {
        const memberIds = new Set(members.map((m) => m.membership_id));
        const available = allMembers.filter((m) => !memberIds.has(m.id));
        return (
          <section key={group.id} style={{ marginBottom: 24, border: "1px solid #333", padding: 12 }}>
            <h2>{group.name} <small style={{ opacity: 0.6 }}>/{group.slug}</small></h2>
            <table>
              <thead><tr><th>Member</th><th>Role in group</th><th></th></tr></thead>
              <tbody>
                {members.map((gm) => {
                  const member = allMembers.find((a) => a.id === gm.membership_id);
                  return (
                    <tr key={gm.membership_id}>
                      <td>{member?.email ?? gm.membership_id}</td>
                      <td>
                        <label>
                          <input
                            type="checkbox"
                            checked={gm.is_manager}
                            onChange={(e) => toggleManager(group.id, gm.membership_id, e.target.checked)}
                          /> Manager
                        </label>
                      </td>
                      <td><button onClick={() => removeMember(group.id, gm.membership_id)}>Remove</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {available.length > 0 && (
              <details>
                <summary>Add member</summary>
                {available.map((m) => (
                  <button key={m.id} onClick={() => addMember(group.id, m.id)}>
                    + {m.email}
                  </button>
                ))}
              </details>
            )}
            <button onClick={() => deleteGroup(group.id)} style={{ marginTop: 8, color: "tomato" }}>Delete group</button>
          </section>
        );
      })}
    </div>
  );
}
