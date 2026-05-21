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

async function readError(r: Response, fallback: string) {
  const data = await r.json().catch(() => ({}));
  return (data as { error?: string }).error ?? fallback;
}

type ModalState =
  | null
  | { kind: "compose" }
  | { kind: "invite"; groupId: string };

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

  const [pendingRemove, setPendingRemove] = useState<{ groupId: string; membershipId: string } | null>(null);
  const removeTimerRef = useRef<number | null>(null);

  const [modal, setModal] = useState<ModalState>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!openMenu) return;
      if (panelRef.current && panelRef.current.contains(e.target as Node)) {
        const t = e.target as HTMLElement;
        if (t.closest("[data-menu-keepopen]")) return;
      }
      setOpenMenu(null);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenu]);

  useEffect(() => {
    if (!modal) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setModal(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modal]);

  function setGroupError(groupId: string, msg: string | null) {
    setErrorByGroup((p) => {
      const next = { ...p };
      if (msg) next[groupId] = msg;
      else delete next[groupId];
      return next;
    });
  }

  function armRemove(groupId: string, membershipId: string) {
    setPendingRemove({ groupId, membershipId });
    if (removeTimerRef.current) window.clearTimeout(removeTimerRef.current);
    removeTimerRef.current = window.setTimeout(() => setPendingRemove(null), 4000);
  }

  function cancelRemove() {
    if (removeTimerRef.current) window.clearTimeout(removeTimerRef.current);
    removeTimerRef.current = null;
    setPendingRemove(null);
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
      setGroupError(groupId, await readError(r, `HTTP ${r.status}`));
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
      setGroupError(groupId, await readError(r, `HTTP ${r.status}`));
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
      setGroupError(groupId, await readError(r, `HTTP ${r.status}`));
      return;
    }
    window.location.reload();
  }

  async function commitRemoveMember(groupId: string, membershipId: string) {
    cancelRemove();
    setGroupError(groupId, null);
    setBusyMember(`del:${membershipId}`);
    const r = await fetch(
      `/api/team/${teamSlug}/groups/${groupId}/members?membershipId=${membershipId}`,
      { method: "DELETE" },
    );
    if (!r.ok) {
      setBusyMember(null);
      setGroupError(groupId, await readError(r, `HTTP ${r.status}`));
      return;
    }
    window.location.reload();
  }

  function handleRemoveClick(groupId: string, membershipId: string) {
    if (pendingRemove?.groupId === groupId && pendingRemove?.membershipId === membershipId) {
      commitRemoveMember(groupId, membershipId);
    } else {
      armRemove(groupId, membershipId);
    }
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
      setGroupError(groupId, await readError(r, `HTTP ${r.status}`));
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

  const allGroups = groups.map((g) => g.group);

  return (
    <div ref={panelRef}>
      <div className="section-head">
        <div>
          <h1><em>Groups</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            All groups · {groups.length} {groups.length === 1 ? "group" : "groups"}
          </div>
        </div>
        <button className="section-head-cta" onClick={() => setModal({ kind: "compose" })}>
          <span className="plus">+</span> Add new group
        </button>
      </div>

      {groups.length === 0 ? (
        <div
          style={{
            padding: "60px 24px",
            textAlign: "center",
            border: "1px dashed var(--rule)",
            background: "color-mix(in srgb, var(--paper) 55%, transparent)",
          }}
        >
          <div className="serif-italic" style={{ fontSize: 24, color: "var(--mute)", marginBottom: 10 }}>
            No groups yet.
          </div>
          <button className="section-head-cta" onClick={() => setModal({ kind: "compose" })}>
            <span className="plus">+</span> Add the first group
          </button>
        </div>
      ) : (
        <div className="group-feed">
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
                  <span className="index">GROUP / {pad2(idx + 1)}</span>
                  <span className="group-menu" data-open={menuOpen} data-menu-keepopen>
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
                      <a
                        className="group-card-name"
                        href={`/team/${teamSlug}/groups/${group.slug}`}
                      >
                        {group.name}
                      </a>
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

                  <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: "auto", paddingTop: 8 }}>
                    <a
                      href={`/team/${teamSlug}/groups/${group.slug}`}
                      className="group-cta-primary"
                    >
                      Open roster <span className="arrow">→</span>
                    </a>
                    <div className="group-card-actions-secondary">
                      <button onClick={() => setModal({ kind: "invite", groupId: group.id })}>
                        + Invite someone
                      </button>
                    </div>
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
                      const isPending = pendingRemove?.groupId === group.id && pendingRemove?.membershipId === gm.membership_id;
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
                            className={`group-row-remove ${isPending ? "confirming" : ""}`}
                            disabled={busyMember === `del:${gm.membership_id}`}
                            onClick={() => handleRemoveClick(group.id, gm.membership_id)}
                            title={isPending ? "Click again to confirm removal" : "Remove from group"}
                            aria-label={isPending ? "Confirm removal" : "Remove from group"}
                          >
                            {isPending ? "Confirm ×" : "×"}
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
        </div>
      )}

      {modal?.kind === "compose" && (
        <ComposeModal
          teamSlug={teamSlug}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.kind === "invite" && (
        <InviteModal
          teamSlug={teamSlug}
          targetGroup={allGroups.find((g) => g.id === modal.groupId)!}
          allGroups={allGroups}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function ComposeModal({ teamSlug, onClose }: { teamSlug: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = !!slug.trim() && !!name.trim() && !busy;

  async function submit() {
    setError(null);
    if (!ready) return;
    setBusy(true);
    const r = await fetch(`/api/team/${teamSlug}/groups`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: normalizeSlug(slug), name: name.trim() }),
    });
    if (!r.ok) {
      setBusy(false);
      setError(await readError(r, `HTTP ${r.status}`));
      return;
    }
    window.location.reload();
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal compose" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <div className="modal-head">
          <h2>New <em>group</em></h2>
          <p className="lede">
            Organize this team into a squad. Add members from the roster after publishing.
          </p>
        </div>
        <div className="modal-body">
          <div className="modal-field">
            <label htmlFor="new-name">Display name</label>
            <input
              id="new-name"
              autoFocus
              placeholder="e.g. Platform Squad"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugTouched) setSlug(normalizeSlug(e.target.value));
              }}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          <div className="modal-field">
            <label htmlFor="new-slug">Slug</label>
            <input
              id="new-slug"
              placeholder="platform"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(normalizeSlug(e.target.value));
              }}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            <span className="hint">Lowercase letters, digits, hyphens. Used in URLs.</span>
          </div>
          {error && <div className="group-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="cancel" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!ready} onClick={submit}>
            {busy ? "Publishing…" : "+ Publish group"}
          </button>
        </div>
      </div>
    </div>
  );
}

function InviteModal({
  teamSlug,
  targetGroup,
  allGroups,
  onClose,
}: {
  teamSlug: string;
  targetGroup: Group;
  allGroups: Group[];
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([targetGroup.id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function toggle(id: string) {
    setSelectedIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }

  async function submit() {
    setError(null);
    if (selectedIds.length === 0) {
      setError("Pick at least one group.");
      return;
    }
    setBusy(true);
    const r = await fetch(`/api/team/${teamSlug}/groups/${targetGroup.slug}/invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim() || undefined, groupIds: selectedIds }),
    });
    if (!r.ok) {
      setBusy(false);
      setError(await readError(r, `HTTP ${r.status}`));
      return;
    }
    const data = await r.json();
    const url = data.joinUrl ?? `${window.location.origin}/signup?invite=${data.tokenPlaintext}`;
    setLink(url);
    setBusy(false);
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal invite" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <div className="modal-head">
          <h2>Invite to <em>{targetGroup.name}</em></h2>
          <p className="lede">
            Generates a share link. The invitee joins as a regular team member and lands in the groups you select.
          </p>
        </div>

        {!link ? (
          <>
            <div className="modal-body">
              <div className="modal-field">
                <label htmlFor="invite-email">Email <span className="hint" style={{ marginLeft: 6, fontStyle: "normal", letterSpacing: 0, fontFamily: "inherit", textTransform: "none" }}>optional</span></label>
                <input
                  id="invite-email"
                  type="email"
                  placeholder="newhire@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="modal-field">
                <label>Place in groups</label>
                <div className="modal-groups">
                  {allGroups.map((g) => {
                    const locked = g.id === targetGroup.id;
                    return (
                      <label key={g.id} className={locked ? "locked" : ""}>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(g.id)}
                          disabled={locked}
                          onChange={() => toggle(g.id)}
                        />
                        {g.name}
                        {locked && <span className="locked-tag">· LOCKED</span>}
                      </label>
                    );
                  })}
                </div>
              </div>
              {error && <div className="group-error">{error}</div>}
            </div>
            <div className="modal-footer">
              <button className="cancel" onClick={onClose}>Cancel</button>
              <button className="primary" disabled={busy} onClick={submit}>
                {busy ? "Generating…" : "+ Generate invite link"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body">
              <div className="modal-field">
                <label>Invite link · expires in 7 days</label>
                <div className="modal-copy-row">
                  <div className="modal-link-box">{link}</div>
                  <button className={`modal-copy-btn ${copied ? "copied" : ""}`} onClick={copy}>
                    {copied ? "Copied ✓" : "Copy"}
                  </button>
                </div>
                <span className="hint">Share this out-of-band. The invitee sets their password on first click.</span>
              </div>
            </div>
            <div className="modal-footer">
              <button className="primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
