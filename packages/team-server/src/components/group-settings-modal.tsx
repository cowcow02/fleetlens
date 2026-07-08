"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type ActiveInvite, formatExpiresIn } from "./invite-shared";
import { GroupIntegrationsPanel } from "./group-integrations-panel";
import {
  addManyMembers,
  initial,
  MemberPicker,
  normalizeSlug,
  readError,
  type Group,
  type Member,
  type PickerSelection,
} from "./group-shared";

export type GroupMemberRow = { id: string; email: string | null; display_name: string | null; is_manager: boolean };

export type SettingsTab = "members" | "invites" | "sources" | "general";

const TABS: { key: SettingsTab; label: string }[] = [
  { key: "members", label: "Members" },
  { key: "invites", label: "Invite links" },
  { key: "sources", label: "Integrations" },
  { key: "general", label: "General" },
];

export function GroupSettingsModal({
  teamSlug,
  group,
  members,
  allMembers,
  allGroups,
  initialTab = "members",
  onClose,
}: {
  teamSlug: string;
  group: Group;
  members: GroupMemberRow[];
  allMembers: Member[];
  allGroups: Group[];
  initialTab?: SettingsTab;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal group-settings" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <div className="modal-head">
          <h2>{group.name} <em>settings</em></h2>
          <p className="lede">Members, invite links, and what feeds this group&rsquo;s insight report — all in one place.</p>
          <div className="group-settings-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={`group-settings-tab ${tab === t.key ? "active" : ""}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="modal-body group-settings-body">
          {tab === "members" && <MembersTab teamSlug={teamSlug} group={group} members={members} allMembers={allMembers} />}
          {tab === "invites" && <InvitesTab teamSlug={teamSlug} group={group} allGroups={allGroups} />}
          {tab === "sources" && <GroupIntegrationsPanel teamSlug={teamSlug} groupSlug={group.slug} embedded />}
          {tab === "general" && <GeneralTab teamSlug={teamSlug} group={group} memberCount={members.length} />}
        </div>
      </div>
    </div>
  );
}

// ── Members ────────────────────────────────────────────────────────────────

function MembersTab({
  teamSlug,
  group,
  members,
  allMembers,
}: {
  teamSlug: string;
  group: Group;
  members: GroupMemberRow[];
  allMembers: Member[];
}) {
  const [busyMember, setBusyMember] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const removeTimer = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [managerIds, setManagerIds] = useState<string[]>([]);
  const [addBusy, setAddBusy] = useState(false);

  const inGroup = useMemo(() => new Set(members.map((m) => m.id)), [members]);
  const available = useMemo(() => allMembers.filter((m) => !inGroup.has(m.id)), [allMembers, inGroup]);

  function armRemove(id: string) {
    setPendingRemove(id);
    if (removeTimer.current) window.clearTimeout(removeTimer.current);
    removeTimer.current = window.setTimeout(() => setPendingRemove(null), 4000);
  }

  async function removeMember(id: string) {
    if (removeTimer.current) window.clearTimeout(removeTimer.current);
    setPendingRemove(null);
    setError(null);
    setBusyMember(`del:${id}`);
    const r = await fetch(`/api/team/${teamSlug}/groups/${group.id}/members?membershipId=${id}`, { method: "DELETE" });
    if (!r.ok) {
      setBusyMember(null);
      setError(await readError(r, `HTTP ${r.status}`));
      return;
    }
    window.location.reload();
  }

  async function toggleManager(id: string, next: boolean) {
    setError(null);
    setBusyMember(`mgr:${id}`);
    const r = await fetch(`/api/team/${teamSlug}/groups/${group.id}/members`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ membershipId: id, isManager: next }),
    });
    if (!r.ok) {
      setBusyMember(null);
      setError(await readError(r, `HTTP ${r.status}`));
      return;
    }
    window.location.reload();
  }

  async function submitAdd() {
    if (selectedIds.length === 0) return;
    setError(null);
    setAddBusy(true);
    const managerSet = new Set(managerIds);
    const selections: PickerSelection[] = selectedIds.map((id) => ({ membershipId: id, isManager: managerSet.has(id) }));
    const { failed } = await addManyMembers(teamSlug, group.id, selections);
    if (failed.length > 0) {
      setAddBusy(false);
      setError(`${failed.length} of ${selectedIds.length} couldn't be added: ${failed[0].error}`);
      return;
    }
    window.location.reload();
  }

  if (adding) {
    return (
      <div>
        <div className="group-settings-tab-head">
          <h3>Add members to {group.name}</h3>
          <button className="btn-link" onClick={() => setAdding(false)}>← Back to roster</button>
        </div>
        {available.length === 0 ? (
          <div className="group-add-empty" style={{ margin: 0 }}>Every active team member is already in this group.</div>
        ) : (
          <MemberPicker
            members={available}
            selectedIds={selectedIds}
            managerIds={managerIds}
            onSelectedChange={setSelectedIds}
            onManagerChange={setManagerIds}
          />
        )}
        {error && <div className="group-error">{error}</div>}
        <div className="settings-row" style={{ marginTop: 16 }}>
          <button className="btn" disabled={addBusy || selectedIds.length === 0} onClick={submitAdd}>
            {addBusy
              ? "Adding…"
              : selectedIds.length === 0
                ? "Add members"
                : `Add ${selectedIds.length}${managerIds.length > 0 ? ` (${managerIds.length} mgr)` : ""}`}
          </button>
          <button className="btn-link" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="group-settings-tab-head">
        <h3>{members.length} {members.length === 1 ? "member" : "members"}</h3>
        {available.length > 0 && (
          <button className="btn secondary" onClick={() => setAdding(true)}>+ Add members</button>
        )}
      </div>
      {members.length === 0 ? (
        <div className="group-roster-empty">Nobody is in this group yet. Add someone above.</div>
      ) : (
        <div className="group-member-list">
          {members.map((m) => {
            const isPending = pendingRemove === m.id;
            return (
              <div className="group-row" key={m.id}>
                <span className={`group-row-avatar ${m.is_manager ? "manager" : ""}`}>{initial(m)}</span>
                <div className="group-row-identity">
                  <span className="group-row-name">{m.display_name ?? m.email ?? m.id}</span>
                  {m.display_name && m.email && <span className="group-row-email">{m.email}</span>}
                </div>
                <button
                  className={`group-role-toggle ${m.is_manager ? "active" : ""}`}
                  disabled={busyMember === `mgr:${m.id}`}
                  onClick={() => toggleManager(m.id, !m.is_manager)}
                  title={m.is_manager ? "Demote to member" : "Promote to manager"}
                >
                  <span className="star">{m.is_manager ? "★" : "☆"}</span>
                  {m.is_manager ? "Manager" : "Member"}
                </button>
                <button
                  className={`group-row-remove ${isPending ? "confirming" : ""}`}
                  disabled={busyMember === `del:${m.id}`}
                  onClick={() => (isPending ? removeMember(m.id) : armRemove(m.id))}
                  title={isPending ? "Click again to confirm removal" : "Remove from group"}
                  aria-label={isPending ? "Confirm removal" : "Remove from group"}
                >
                  {isPending ? "Confirm ×" : "×"}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {error && <div className="group-error">{error}</div>}
    </div>
  );
}

// ── Invite links ─────────────────────────────────────────────────────────────

function InvitesTab({ teamSlug, group, allGroups }: { teamSlug: string; group: Group; allGroups: Group[] }) {
  const [invites, setInvites] = useState<ActiveInvite[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState("");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([group.id]);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newLink, setNewLink] = useState<string | null>(null);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    setLoadError(null);
    const res = await fetch(`/api/team/${teamSlug}/invites`);
    if (!res.ok) {
      setLoadError(await readError(res, "Failed to load invites"));
      setInvites([]);
      return;
    }
    const d = await res.json();
    // Only invites that place the invitee into THIS group.
    setInvites((d.invites as ActiveInvite[]).filter((iv) => iv.groupIds.includes(group.id)));
  }

  async function copy(id: string, url: string | null) {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1600);
    } catch {
      setCopiedId(null);
    }
  }

  async function revoke(id: string) {
    setRevoking(id);
    const r = await fetch(`/api/team/${teamSlug}/invites/${id}/revoke`, { method: "POST" });
    setRevoking(null);
    if (r.ok) await refresh();
  }

  function toggleGroup(id: string) {
    if (id === group.id) return; // this group is locked on
    setSelectedGroupIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function createInvite() {
    setCreateError(null);
    setBusy(true);
    const r = await fetch(`/api/team/${teamSlug}/groups/${group.slug}/invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim() || undefined, groupIds: selectedGroupIds }),
    });
    if (!r.ok) {
      setBusy(false);
      setCreateError(await readError(r, `HTTP ${r.status}`));
      return;
    }
    const data = await r.json();
    setNewLink(data.joinUrl ?? `${window.location.origin}/signup?invite=${data.tokenPlaintext}`);
    setBusy(false);
    setEmail("");
    await refresh();
  }

  if (invites === null) return <p className="help-note" style={{ border: "none", padding: 0 }}>Loading…</p>;

  if (creating) {
    return (
      <div>
        <div className="group-settings-tab-head">
          <h3>New invite link</h3>
          <button className="btn-link" onClick={() => { setCreating(false); setNewLink(null); }}>← Back to links</button>
        </div>
        {newLink ? (
          <div className="modal-field">
            <label>Invite link · expires in 7 days</label>
            <div className="modal-copy-row">
              <div className="modal-link-box">{newLink}</div>
              <button className={`modal-copy-btn ${copiedId === "new" ? "copied" : ""}`} onClick={() => copy("new", newLink)}>
                {copiedId === "new" ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <span className="hint">Share this out-of-band. The invitee sets their password on first click.</span>
            <div className="settings-row" style={{ marginTop: 16 }}>
              <button className="btn" onClick={() => { setCreating(false); setNewLink(null); }}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <div className="modal-field">
              <label htmlFor="grp-invite-email">
                Email
                <span className="hint" style={{ marginLeft: 6, fontStyle: "normal", letterSpacing: 0, fontFamily: "inherit", textTransform: "none" }}>optional</span>
              </label>
              <input id="grp-invite-email" type="email" placeholder="newhire@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="modal-field">
              <label>Place in groups</label>
              <div className="modal-groups">
                {allGroups.map((g) => {
                  const locked = g.id === group.id;
                  return (
                    <label key={g.id} className={locked ? "locked" : ""}>
                      <input type="checkbox" checked={selectedGroupIds.includes(g.id)} disabled={locked} onChange={() => toggleGroup(g.id)} />
                      {g.name}
                      {locked && <span className="locked-tag">· LOCKED</span>}
                    </label>
                  );
                })}
              </div>
            </div>
            {createError && <div className="group-error">{createError}</div>}
            <div className="settings-row" style={{ marginTop: 16 }}>
              <button className="btn" disabled={busy} onClick={createInvite}>{busy ? "Generating…" : "+ Generate link"}</button>
              <button className="btn-link" onClick={() => setCreating(false)}>Cancel</button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="group-settings-tab-head">
        <h3>{invites.length} active {invites.length === 1 ? "link" : "links"}</h3>
        <button className="btn secondary" onClick={() => setCreating(true)}>+ New invite link</button>
      </div>
      {loadError && <div className="group-error">{loadError}</div>}
      {invites.length === 0 ? (
        <div className="group-roster-empty">No active invite links into this group.</div>
      ) : (
        <table className="member-table">
          <thead>
            <tr><th>Groups</th><th>Created by</th><th>Expires</th><th>Uses</th><th></th></tr>
          </thead>
          <tbody>
            {invites.map((iv) => (
              <tr key={iv.id}>
                <td>{iv.groupNames.join(", ")}</td>
                <td>{iv.createdBy.displayName ?? <span style={{ color: "var(--mute)" }}>—</span>}</td>
                <td>{formatExpiresIn(iv.expiresAt)}</td>
                <td>{iv.redemptionCount}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className={`btn-link ${copiedId === iv.id ? "is-success" : ""}`} disabled={!iv.joinUrl} onClick={() => copy(iv.id, iv.joinUrl)} style={{ marginRight: 12 }}>
                    {copiedId === iv.id ? "Copied!" : "Copy link"}
                  </button>
                  <button className="btn-link is-danger" disabled={revoking === iv.id} onClick={() => revoke(iv.id)}>Revoke</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── General (rename / delete) ────────────────────────────────────────────────

function GeneralTab({ teamSlug, group, memberCount }: { teamSlug: string; group: Group; memberCount: number }) {
  const [name, setName] = useState(group.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function rename() {
    const next = name.trim();
    if (!next || next === group.name) return;
    setError(null);
    setBusy(true);
    const r = await fetch(`/api/team/${teamSlug}/groups/${group.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: next }),
    });
    if (!r.ok) {
      setBusy(false);
      setError(await readError(r, `HTTP ${r.status}`));
      return;
    }
    window.location.reload();
  }

  async function remove() {
    setError(null);
    setBusy(true);
    const r = await fetch(`/api/team/${teamSlug}/groups/${group.id}`, { method: "DELETE" });
    if (!r.ok) {
      setBusy(false);
      setError(await readError(r, `HTTP ${r.status}`));
      return;
    }
    window.location.href = `/team/${teamSlug}/groups`;
  }

  return (
    <div>
      <div className="modal-field">
        <label htmlFor="grp-name">Display name</label>
        <input id="grp-name" value={name} onChange={(e) => setName(e.target.value)} />
        <span className="hint">Slug /{group.slug} is fixed — it&rsquo;s used in report URLs.</span>
      </div>
      <button className="btn" disabled={busy || !name.trim() || name.trim() === group.name} onClick={rename}>
        {busy ? "Saving…" : "Save name"}
      </button>

      <div style={{ marginTop: 30, paddingTop: 20, borderTop: "1px solid var(--rule)" }}>
        <div className="provider-head" style={{ color: "var(--danger)" }}>Danger zone</div>
        {!confirmDelete ? (
          <button className="btn-link is-danger" onClick={() => setConfirmDelete(true)}>Delete this group…</button>
        ) : (
          <div className="callout error">
            Delete <strong>{group.name}</strong>? Its {memberCount} {memberCount === 1 ? "member keeps" : "members keep"} team
            access but lose this group affiliation, and the group&rsquo;s insight report disappears.
            <div className="settings-row" style={{ marginTop: 10 }}>
              <button className="btn" style={{ background: "var(--danger)", borderColor: "var(--danger)" }} disabled={busy} onClick={remove}>
                {busy ? "Deleting…" : "Delete group"}
              </button>
              <button className="btn-link" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {error && <div className="group-error" style={{ marginTop: 12 }}>{error}</div>}
    </div>
  );
}
