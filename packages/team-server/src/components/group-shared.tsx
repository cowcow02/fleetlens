"use client";

import { useMemo, useRef, useState } from "react";

export type Member = { id: string; email: string | null; display_name: string | null };
export type Group = { id: string; slug: string; name: string };
export type PickerSelection = { membershipId: string; isManager: boolean };

export function initial(m: Member | undefined) {
  const s = m?.display_name?.trim() || m?.email?.trim() || "?";
  return s.charAt(0).toUpperCase();
}

export function normalizeSlug(v: string) {
  return v.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+/, "");
}

export async function readError(r: Response, fallback: string) {
  const data = await r.json().catch(() => ({}));
  return (data as { error?: string }).error ?? fallback;
}

export async function addManyMembers(
  teamSlug: string,
  groupId: string,
  selections: PickerSelection[],
): Promise<{ ok: number; failed: { id: string; error: string }[] }> {
  const results = await Promise.all(
    selections.map(async ({ membershipId, isManager }) => {
      const r = await fetch(`/api/team/${teamSlug}/groups/${groupId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ membershipId, isManager }),
      });
      if (!r.ok) return { id: membershipId, error: await readError(r, `HTTP ${r.status}`) };
      return { id: membershipId, error: null as string | null };
    }),
  );
  const failed = results.filter((r) => r.error).map((r) => ({ id: r.id, error: r.error! }));
  return { ok: results.length - failed.length, failed };
}

export function MemberPicker({
  members,
  selectedIds,
  managerIds,
  onSelectedChange,
  onManagerChange,
  emptyHint = "No members match your search.",
}: {
  members: Member[];
  selectedIds: string[];
  managerIds: string[];
  onSelectedChange: (ids: string[]) => void;
  onManagerChange: (ids: string[]) => void;
  emptyHint?: string;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) =>
      (m.display_name ?? "").toLowerCase().includes(q) ||
      (m.email ?? "").toLowerCase().includes(q),
    );
  }, [members, search]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const managerSet = useMemo(() => new Set(managerIds), [managerIds]);

  const selectedRef = useRef(selectedIds);
  const managerRef = useRef(managerIds);
  selectedRef.current = selectedIds;
  managerRef.current = managerIds;

  function toggleSelected(id: string) {
    const cur = selectedRef.current;
    if (cur.includes(id)) {
      const next = cur.filter((x) => x !== id);
      selectedRef.current = next;
      onSelectedChange(next);
      if (managerRef.current.includes(id)) {
        const m = managerRef.current.filter((x) => x !== id);
        managerRef.current = m;
        onManagerChange(m);
      }
    } else {
      const next = [...cur, id];
      selectedRef.current = next;
      onSelectedChange(next);
    }
  }

  function toggleManager(id: string) {
    if (!selectedRef.current.includes(id)) return;
    const cur = managerRef.current;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    managerRef.current = next;
    onManagerChange(next);
  }

  function selectAllShown() {
    const next = Array.from(new Set([...selectedRef.current, ...filtered.map((m) => m.id)]));
    selectedRef.current = next;
    onSelectedChange(next);
  }

  function clearAll() {
    selectedRef.current = [];
    managerRef.current = [];
    onSelectedChange([]);
    onManagerChange([]);
  }

  return (
    <div className="member-picker">
      <input
        className="member-picker-search"
        placeholder={`Search ${members.length} ${members.length === 1 ? "member" : "members"}…`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="member-picker-list">
        {filtered.length === 0 ? (
          <div className="member-picker-empty">{emptyHint}</div>
        ) : (
          filtered.map((m) => {
            const checked = selectedSet.has(m.id);
            const isManager = managerSet.has(m.id);
            return (
              <div className={`member-picker-row ${checked ? "checked" : ""}`} key={m.id}>
                <label className="member-picker-row-main">
                  <input type="checkbox" checked={checked} onChange={() => toggleSelected(m.id)} />
                  <span className="avatar">{initial(m)}</span>
                  <div className="identity">
                    <span className="name">{m.display_name ?? m.email ?? m.id}</span>
                    {m.display_name && m.email && <span className="email">{m.email}</span>}
                  </div>
                </label>
                {checked && (
                  <button
                    type="button"
                    className={`role-toggle ${isManager ? "active" : ""}`}
                    onClick={() => toggleManager(m.id)}
                    title={isManager ? "Demote to member" : "Promote to group manager"}
                  >
                    <span className="star">{isManager ? "★" : "☆"}</span>
                    {isManager ? "Manager" : "Member"}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
      <div className="member-picker-footer">
        <span>
          <span className="selected-count">{selectedIds.length}</span> selected
          {managerIds.length > 0 && <> · {managerIds.length} as {managerIds.length === 1 ? "manager" : "managers"}</>}
          {" · "}{filtered.length} of {members.length} shown
        </span>
        <span>
          {filtered.length > 0 && (
            <button type="button" onClick={selectAllShown}>Select shown</button>
          )}
          {selectedIds.length > 0 && (
            <>
              {" · "}
              <button type="button" onClick={clearAll}>Clear</button>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

// Create-group modal (list-level action — a group has no detail page until it
// exists, so creation lives on the list, not in per-group settings).
export function ComposeModal({
  teamSlug,
  allMembers,
  onClose,
}: {
  teamSlug: string;
  allMembers: Member[];
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [managerIds, setManagerIds] = useState<string[]>([]);
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
    const { group } = (await r.json()) as { group: { id: string } };
    if (selectedIds.length > 0) {
      const managerSet = new Set(managerIds);
      const selections: PickerSelection[] = selectedIds.map((id) => ({ membershipId: id, isManager: managerSet.has(id) }));
      const { failed } = await addManyMembers(teamSlug, group.id, selections);
      if (failed.length > 0) {
        setBusy(false);
        setError(`Group created, but ${failed.length} member${failed.length === 1 ? "" : "s"} could not be added: ${failed[0].error}`);
        return;
      }
    }
    window.location.reload();
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal compose" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <div className="modal-head">
          <h2>New <em>group</em></h2>
          <p className="lede">Name the group, pick who&apos;s in it, choose managers, publish.</p>
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
            />
            <span className="hint">Lowercase letters, digits, hyphens. Used in URLs.</span>
          </div>
          <div className="modal-field">
            <label>
              Place members
              <span className="hint" style={{ marginLeft: 6, fontStyle: "normal", letterSpacing: 0, fontFamily: "inherit", textTransform: "none" }}>
                optional · tap ☆ on a selected row to promote them to manager
              </span>
            </label>
            <MemberPicker
              members={allMembers}
              selectedIds={selectedIds}
              managerIds={managerIds}
              onSelectedChange={setSelectedIds}
              onManagerChange={setManagerIds}
            />
          </div>
          {error && <div className="group-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="cancel" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!ready} onClick={submit}>
            {busy
              ? "Publishing…"
              : selectedIds.length > 0
                ? `+ Publish with ${selectedIds.length} ${selectedIds.length === 1 ? "member" : "members"}${managerIds.length > 0 ? ` (${managerIds.length} mgr)` : ""}`
                : "+ Publish group"}
          </button>
        </div>
      </div>
    </div>
  );
}
