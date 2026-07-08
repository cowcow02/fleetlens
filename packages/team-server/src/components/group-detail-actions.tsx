"use client";

import { useState } from "react";
import { GroupSettingsModal, type GroupMemberRow, type SettingsTab } from "./group-settings-modal";
import type { Group, Member } from "./group-shared";

// Header controls for the group detail page: the Settings button that opens the
// consolidated settings modal. `autoOpenTab` (from ?settings=<tab>) lets the
// list page deep-link straight into a tab.
export function GroupDetailActions({
  teamSlug,
  group,
  members,
  allMembers,
  allGroups,
  autoOpenTab,
}: {
  teamSlug: string;
  group: Group;
  members: GroupMemberRow[];
  allMembers: Member[];
  allGroups: Group[];
  autoOpenTab?: SettingsTab | null;
}) {
  const [open, setOpen] = useState<boolean>(!!autoOpenTab);

  return (
    <>
      <button className="btn secondary group-settings-trigger" onClick={() => setOpen(true)}>
        <span aria-hidden style={{ marginRight: 6 }}>⚙</span> Settings
      </button>
      {open && (
        <GroupSettingsModal
          teamSlug={teamSlug}
          group={group}
          members={members}
          allMembers={allMembers}
          allGroups={allGroups}
          initialTab={autoOpenTab ?? "members"}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
