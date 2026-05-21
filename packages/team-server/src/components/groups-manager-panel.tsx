"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

type Member = { id: string; email: string | null; display_name: string | null };
type GroupMembership = {
  group_id: string;
  membership_id: string;
  is_manager: boolean;
  added_at: string;
};
type Group = { id: string; slug: string; name: string };
type GroupWithMembers = { group: Group; members: GroupMembership[] };

function memberLabel(m: Member) {
  if (m.display_name && m.email) return `${m.display_name} · ${m.email}`;
  return m.display_name ?? m.email ?? m.id;
}

function initial(m: Member | undefined) {
  const s = m?.display_name?.trim() || m?.email?.trim() || "?";
  return s.charAt(0).toUpperCase();
}

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

function normalizeSlug(v: string) {
  return v.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+/, "");
}

export function GroupsManagerPanel({
  teamSlug,
  groups,
  allMembers,
}: {
  teamSlug: string;
  groups: GroupWithMembers[];
  allMembers: Member[];
}) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [editingNameFor, setEditingNameFor] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [pendingAdd, setPendingAdd] = useState<Record<string, string>>({});
  const [busyMember, setBusyMember] = useState<string | null>(null);
  const [errorByGroup, setErrorByGroup] = useState<Record<string, string>>({});

  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!openMenu) return;
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      setOpenMenu(null);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenu]);

  function setGroupError(groupId: string, msg: string | null) {
    setErrorByGroup((p) => {
      const next = { ...p };
      if (msg) next[groupId] = msg;
      else delete next[groupId];
      return next;
    });
  }

  async function jsonErr(r: Response, fallback: string) {
    const data = await r.json().catch(() => ({}));
    return (data as { error?: string }).error ?? fallback;
  }

  async function commitRename(groupId: string, originalName: string) {
    const next = nameDraft.trim();
    setEditingNameFor(null);
    if (!next || next === originalName) return;
    setGroupError(groupId, null);
    const r = await fetch(`/api/team/${teamSlug}/groups/${groupId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: next }),
    });
    if (!r.ok) {
      setGroupError(groupId, await jsonErr(r, `HTTP ${r.status}`));
      return;
    }
    window.location.reload();
  }

  async function removeGroup(groupId: string, name: string) {
    setOpenMenu(null);
    if (!confirm(`Delete "${name}"? Members keep their team access but lose this group affiliation.`)) return;
    setGroupError(groupId, null);
    const r = await fetch(`/api/team/${teamSlug}/groups/${groupId}`, { method: "DELETE" });
    if (!r.ok) {
      setGroupError(groupId, await jsonErr(r, `HTTP ${r.status}`));
      return;
    }
    window.location.reload();
  }

  async function addMember(groupId: string) {
    const membershipId = pendingAdd[groupId];
    if (!membershipId) return;
    setGroupError(groupId, null);
    setBusyMember(`add:${groupId}`);
    const r = await fetch(`/api/team/${teamSlug}/groups/${groupId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ membershipId }),
    });
    if (!r.ok) {
      setBusyMember(null);
      setGroupError(groupId, await jsonErr(r, `HTTP ${r.status}`));
      return;
    }
    window.location.reload();
  }

  async function removeMember(groupId: string, membershipId: string) {
    setGroupError(groupId, null);
    setBusyMember(`del:${membershipId}`);
    const r = await fetch(
      `/api/team/${teamSlug}/groups/${groupId}/members?membershipId=${membershipId}`,
      { method: "DELETE" },
    );
    if (!r.ok) {
      setBusyMember(null);
      setGroupError(groupId, await jsonErr(r, `HTTP ${r.status}`));
      return;
    }
    window.location.reload();
  }

  async function toggleManager(groupId: string, membershipId: string, next: boolean) {
    setGroupError(groupId, null);
    setBusyMember(`mgr:${membershipId}`);
    const r = await fetch(`/api/team/${teamSlug}/groups/${groupId}/members`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ membershipId, isManager: next }),
    });
    if (!r.ok) {
      setBusyMember(null);
      setGroupError(groupId, await jsonErr(r, `HTTP ${r.status}`));
      return;
    }
    window.location.reload();
  }

  async function create() {
    setCreateError(null);
    const slug = normalizeSlug(newSlug);
    const name = newName.trim();
    if (!slug || !name) {
      setCreateError("Both slug and display name are required.");
      return;
    }
    setCreating(true);
    const r = await fetch(`/api/team/${teamSlug}/groups`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, name }),
    });
    if (!r.ok) {
      setCreating(false);
      setCreateError(await jsonErr(r, `HTTP ${r.status}`));
      return;
    }
    window.location.reload();
  }

  function handleNameKey(e: KeyboardEvent<HTMLInputElement>, groupId: string, original: string) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename(groupId, original);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditingNameFor(null);
    }
  }

  return (
    <div className="group-feed" ref={menuRef}>
      {groups.map(({ group, members }, idx) => {
        const memberIds = new Set(members.map((m) => m.membership_id));
        const available = allMembers.filter((m) => !memberIds.has(m.id));
        const managerCount = members.filter((gm) => gm.is_manager).length;
        const editing = editingNameFor === group.id;
        const menuOpen = openMenu === group.id;
        const err = errorByGroup[group.id];

        return (
          <article className="group-card" key={group.id}>
            <header className="group-card-eyebrow">
              <span>
                <span className="index">GROUP / {pad2(idx + 1)}</span>
              </span>
              <span>
                <span className="group-menu" data-open={menuOpen}>
                  <button
                    className="group-menu-trigger"
                    aria-label="More actions"
                    onClick={() => setOpenMenu(menuOpen ? null : group.id)}
                  >
                    •••
                  </button>
                  {menuOpen && (
                    <div className="group-menu-pop" role="menu">
                      <button
                        onClick={() => {
                          setOpenMenu(null);
                          setNameDraft(group.name);
                          setEditingNameFor(group.id);
                        }}
                      >
                        Rename group
                      </button>
                      <div className="menu-rule" />
                      <button
                        className="danger"
                        onClick={() => removeGroup(group.id, group.name)}
                      >
                        Delete group…
                      </button>
                    </div>
                  )}
                </span>
              </span>
            </header>

            <div className="group-card-identity">
              <div className="group-card-name-row">
                {editing ? (
                  <input
                    autoFocus
                    className="group-card-name-input"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={() => commitRename(group.id, group.name)}
                    onKeyDown={(e) => handleNameKey(e, group.id, group.name)}
                  />
                ) : (
                  <span
                    className="group-card-name"
                    title="Click to rename"
                    onClick={() => {
                      setNameDraft(group.name);
                      setEditingNameFor(group.id);
                    }}
                  >
                    {group.name}
                  </span>
                )}
                <span className="group-card-slug">/{group.slug}</span>
              </div>

              <div className="group-card-counts">
                <span>
                  <span className={`num ${members.length === 0 ? "zero" : ""}`}>{members.length}</span>
                  {members.length === 1 ? "member" : "members"}
                </span>
                <span className="sep">·</span>
                <span>
                  <span className={`num ${managerCount === 0 ? "zero" : ""}`}>{managerCount}</span>
                  {managerCount === 1 ? "manager" : "managers"}
                </span>
              </div>

              <div className="group-card-actions">
                <a href={`/team/${teamSlug}/groups/${group.slug}`}>
                  Open roster <span className="arrow">→</span>
                </a>
                <span className="sep">·</span>
                <a href={`/team/${teamSlug}/groups/${group.slug}/invite`}>
                  Invite someone <span className="arrow">→</span>
                </a>
              </div>
            </div>

            <div className="group-roster">
              <div className="group-roster-label">
                <span>Roster</span>
                <span className="count">{members.length}</span>
              </div>
              {members.length === 0 ? (
                <div className="group-roster-empty">
                  Nobody is in this group yet. Add someone below.
                </div>
              ) : (
                members.map((gm) => {
                  const m = allMembers.find((a) => a.id === gm.membership_id);
                  return (
                    <div className="group-row" key={gm.membership_id}>
                      <span className={`group-row-avatar ${gm.is_manager ? "manager" : ""}`}>
                        {initial(m)}
                      </span>
                      <div className="group-row-identity">
                        <span className="group-row-name">
                          {m?.display_name ?? m?.email ?? gm.membership_id}
                        </span>
                        {m?.display_name && m?.email && (
                          <span className="group-row-email">{m.email}</span>
                        )}
                      </div>
                      <button
                        className={`group-role-toggle ${gm.is_manager ? "active" : ""}`}
                        disabled={busyMember === `mgr:${gm.membership_id}`}
                        onClick={() => toggleManager(group.id, gm.membership_id, !gm.is_manager)}
                        title={gm.is_manager ? "Demote to member" : "Promote to manager"}
                      >
                        <span className="star">{gm.is_manager ? "★" : "☆"}</span>
                        {gm.is_manager ? "Manager" : "Member"}
                      </button>
                      <button
                        className="group-row-remove"
                        disabled={busyMember === `del:${gm.membership_id}`}
                        onClick={() => removeMember(group.id, gm.membership_id)}
                        title="Remove from group"
                        aria-label="Remove from group"
                      >
                        ×
                      </button>
                    </div>
                  );
                })
              )}

              {available.length > 0 ? (
                <div className="group-add">
                  <select
                    value={pendingAdd[group.id] ?? ""}
                    onChange={(e) =>
                      setPendingAdd((p) => ({ ...p, [group.id]: e.target.value }))
                    }
                    disabled={busyMember === `add:${group.id}`}
                  >
                    <option value="">Add a team member…</option>
                    {available.map((m) => (
                      <option key={m.id} value={m.id}>
                        {memberLabel(m)}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={!pendingAdd[group.id] || busyMember === `add:${group.id}`}
                    onClick={() => addMember(group.id)}
                  >
                    {busyMember === `add:${group.id}` ? "…" : "Add"}
                  </button>
                </div>
              ) : (
                <div className="group-add-empty">
                  All active team members are already in this group.
                </div>
              )}

              {err && <div className="group-error">{err}</div>}
            </div>
          </article>
        );
      })}

      <article className="group-card draft">
        <header className="group-card-eyebrow">
          <span>
            <span className="index">GROUP / {pad2(groups.length + 1)}</span>
          </span>
          <span className="badge">Draft</span>
        </header>

        <div className="group-card-identity">
          <div className="group-card-name-row">
            <span className="group-card-name">{newName.trim() || "Untitled group"}</span>
            <span className="group-card-slug">/{normalizeSlug(newSlug) || "your-slug"}</span>
          </div>
          <div className="group-card-counts">
            <span><span className="num zero">0</span>members</span>
            <span className="sep">·</span>
            <span><span className="num zero">0</span>managers</span>
          </div>
          <div className="group-card-actions" style={{ color: "var(--mute)" }}>
            New groups inherit no members. Add people from the roster after publishing.
          </div>
        </div>

        <div className="group-draft-fields">
          <div className="group-draft-field">
            <label htmlFor="new-group-name">Display name</label>
            <input
              id="new-group-name"
              placeholder="e.g. Platform Squad"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                if (!slugTouched) setNewSlug(normalizeSlug(e.target.value));
              }}
            />
          </div>
          <div className="group-draft-field">
            <label htmlFor="new-group-slug">Slug</label>
            <input
              id="new-group-slug"
              placeholder="platform"
              value={newSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setNewSlug(normalizeSlug(e.target.value));
              }}
            />
          </div>
          <button
            className="group-draft-publish"
            disabled={creating || !newSlug.trim() || !newName.trim()}
            onClick={create}
          >
            {creating ? "Publishing…" : "+ Publish new group"}
          </button>
          {createError && <div className="group-error">{createError}</div>}
        </div>
      </article>
    </div>
  );
}
