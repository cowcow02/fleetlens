import type { SessionEvent } from "@claude-lens/parser";

type TeammateMsg = NonNullable<SessionEvent["teammateMessage"]>;

export function formatTeammatePreview(tm: TeammateMsg): string {
  switch (tm.kind) {
    case "idle-notification":
      return `${tm.teammateId} is idle / available`;
    case "shutdown-request":
      return `${tm.teammateId} requesting shutdown`;
    case "shutdown-approved":
      return `${tm.teammateId} shutdown approved`;
    case "teammate-terminated":
      return `${tm.teammateId} has shut down`;
    case "task-assignment":
      return `task assigned to ${tm.teammateId}`;
    default:
      return tm.body.length > 120 ? tm.body.slice(0, 120) + "…" : tm.body;
  }
}
