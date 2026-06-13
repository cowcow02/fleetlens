"use client";

import Link from "next/link";
import { useState } from "react";
import { ComposeModal, initial, type Member } from "./group-shared";

type GroupMembership = { membership_id: string; is_manager: boolean };
type Group = { id: string; slug: string; name: string };
type GroupWithMembers = { group: Group; members: GroupMembership[] };

// Read-only overview of all groups. Roster edits, invites, data sources, and
// rename/delete all live in the per-group settings modal (reached via the gear
// or "Settings" link → group detail page). The only mutation here is creating
// a brand-new group, which has nowhere else to live.
export function GroupsList({
  teamSlug,
  groups,
  allMembers,
}: {
  teamSlug: string;
  groups: GroupWithMembers[];
  allMembers: Member[];
}) {
  const [composing, setComposing] = useState(false);
  const byId = new Map(allMembers.map((m) => [m.id, m]));

  return (
    <>
      <div className="section-head">
        <div>
          <h1><em>Groups</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            All groups · {groups.length} {groups.length === 1 ? "group" : "groups"}
          </div>
        </div>
        <button className="section-head-cta" onClick={() => setComposing(true)}>
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
          <button className="section-head-cta" onClick={() => setComposing(true)}>
            <span className="plus">+</span> Add the first group
          </button>
        </div>
      ) : (
        <div className="group-list">
          {groups.map(({ group, members }) => {
            const managerCount = members.filter((m) => m.is_manager).length;
            const shown = members.slice(0, 7);
            const overflow = members.length - shown.length;
            return (
              <article className="group-list-row" key={group.id}>
                <div className="group-list-main">
                  <Link className="group-list-name" href={`/team/${teamSlug}/groups/${group.slug}`}>
                    {group.name}
                  </Link>
                  <span className="group-list-slug">/{group.slug}</span>
                  <span className="group-list-counts">
                    <span className={members.length === 0 ? "zero" : ""}>{members.length}</span>{" "}
                    {members.length === 1 ? "member" : "members"}
                    <span className="sep">·</span>
                    <span className={managerCount === 0 ? "zero" : ""}>{managerCount}</span>{" "}
                    {managerCount === 1 ? "manager" : "managers"}
                  </span>
                </div>

                <div className="group-list-avatars" aria-hidden>
                  {members.length === 0 ? (
                    <span className="group-list-empty">No members yet</span>
                  ) : (
                    <>
                      {shown.map((gm) => {
                        const m = byId.get(gm.membership_id);
                        return (
                          <span
                            key={gm.membership_id}
                            className={`group-list-avatar ${gm.is_manager ? "manager" : ""}`}
                            title={`${m?.display_name ?? m?.email ?? gm.membership_id}${gm.is_manager ? " · manager" : ""}`}
                          >
                            {initial(m)}
                          </span>
                        );
                      })}
                      {overflow > 0 && <span className="group-list-avatar more">+{overflow}</span>}
                    </>
                  )}
                </div>

                <div className="group-list-actions">
                  <Link className="btn-link" href={`/team/${teamSlug}/groups/${group.slug}`}>
                    Open →
                  </Link>
                  <Link
                    className="btn secondary group-list-settings"
                    href={`/team/${teamSlug}/groups/${group.slug}?settings=members`}
                    aria-label={`${group.name} settings`}
                  >
                    <span aria-hidden style={{ marginRight: 6 }}>⚙</span> Settings
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {composing && (
        <ComposeModal teamSlug={teamSlug} allMembers={allMembers} onClose={() => setComposing(false)} />
      )}
    </>
  );
}
