import type { SessionDetail, SessionMeta, SessionEvent } from "./types.js";

export type TeamMessage = {
  tsMs: number;
  fromSessionId: string;
  fromTeammateId: string;
  /** Empty string when the recipient can't be resolved to a session in the group. */
  toSessionId: string;
  toTeammateId: string;
  body: string;
  kind: "message" | "idle-notification" | "shutdown-request";
};

export type TeamView = {
  teamName: string;
  leadSessionId: string;
  /** Ordered by first-event timestamp. */
  memberSessionIds: string[];
  /** sessionId → agentName. Lead maps to `undefined`. */
  agentNameBySessionId: Map<string, string | undefined>;
  /** All lead↔member messages paired, chronologically sorted. */
  messages: TeamMessage[];
  firstEventMs: number;
  lastEventMs: number;
};

export function groupByTeam(
  sessions: SessionMeta[],
  details: Map<string, SessionDetail>,
): TeamView[] {
  const byTeam = new Map<string, SessionMeta[]>();
  for (const s of sessions) {
    if (!s.teamName) continue;
    const arr = byTeam.get(s.teamName) ?? [];
    arr.push(s);
    byTeam.set(s.teamName, arr);
  }
  const views: TeamView[] = [];
  for (const [teamName, group] of byTeam) {
    const view = buildTeamView(teamName, group, details);
    if (view) views.push(view);
  }
  return views;
}

function buildTeamView(
  teamName: string,
  group: SessionMeta[],
  details: Map<string, SessionDetail>,
): TeamView | null {
  // Lead candidates must have actual orchestration activity. Sessions that
  // merely have a teamName tag (Claude Code can attach one to any chat
  // opened while a team context is active) don't qualify.
  const candidates = group.filter((s) => s.isTeamLead);
  if (candidates.length === 0) return null;

  // Prefer a candidate whose detail contains a TeamCreate tool_use.
  let lead: SessionMeta | undefined;
  for (const c of candidates) {
    const d = details.get(c.sessionId);
    if (d && containsTeamCreate(d.events)) {
      lead = c;
      break;
    }
  }
  if (!lead) {
    const sorted = [...candidates].sort(
      (a, b) =>
        Date.parse(a.firstTimestamp ?? "") - Date.parse(b.firstTimestamp ?? ""),
    );
    lead = sorted[0]!;
  }

  const agentNameBySessionId = new Map<string, string | undefined>();
  for (const s of group) agentNameBySessionId.set(s.sessionId, s.agentName);

  const members = group
    .filter((s) => s.sessionId !== lead!.sessionId)
    .sort(
      (a, b) =>
        Date.parse(a.firstTimestamp ?? "") - Date.parse(b.firstTimestamp ?? ""),
    );

  const sessionIdByAgentName = new Map<string, string>();
  for (const m of members) {
    if (m.agentName) sessionIdByAgentName.set(m.agentName, m.sessionId);
  }

  const messages: TeamMessage[] = [];
  for (const s of group) {
    const d = details.get(s.sessionId);
    if (!d) continue;
    const senderId = s.sessionId;
    const senderTeammateId = s.agentName ?? "team-lead";
    for (const ev of d.events) {
      const msg = extractSendMessage(ev);
      if (!msg) continue;
      const toTeammateId = msg.to;
      const toSessionId =
        toTeammateId === "team-lead"
          ? lead.sessionId
          : sessionIdByAgentName.get(toTeammateId) ?? "";
      messages.push({
        tsMs: ev.timestamp ? Date.parse(ev.timestamp) : 0,
        fromSessionId: senderId,
        fromTeammateId: senderTeammateId,
        toSessionId,
        toTeammateId,
        body: msg.body,
        kind: "message",
      });
    }
  }
  messages.sort((a, b) => a.tsMs - b.tsMs);

  const allTs: number[] = [];
  for (const s of group) {
    if (s.firstTimestamp) allTs.push(Date.parse(s.firstTimestamp));
    if (s.lastTimestamp) allTs.push(Date.parse(s.lastTimestamp));
  }
  const firstEventMs = allTs.length ? Math.min(...allTs) : 0;
  const lastEventMs = allTs.length ? Math.max(...allTs) : 0;

  return {
    teamName,
    leadSessionId: lead.sessionId,
    memberSessionIds: members.map((m) => m.sessionId),
    agentNameBySessionId,
    messages,
    firstEventMs,
    lastEventMs,
  };
}

function containsTeamCreate(events: SessionEvent[]): boolean {
  for (const ev of events) {
    if (ev.role !== "tool-call") continue;
    if (ev.toolName === "TeamCreate") return true;
  }
  return false;
}

function extractSendMessage(
  ev: SessionEvent,
): { to: string; body: string } | null {
  if (ev.role !== "tool-call" || ev.toolName !== "SendMessage") return null;
  for (const b of ev.blocks) {
    if (!b || typeof b !== "object") continue;
    if ((b as { type?: string }).type !== "tool_use") continue;
    const input = (b as { input?: Record<string, unknown> }).input ?? {};
    const to = typeof input.to === "string" ? input.to : "";
    const body = typeof input.message === "string" ? input.message : "";
    if (!to) return null;
    return { to, body };
  }
  return null;
}
