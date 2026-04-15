import type { TeamView, SessionDetail } from "@claude-lens/parser";
import type { TurnMegaRow } from "@claude-lens/parser";
import { buildPresentation, buildMegaRows } from "@claude-lens/parser";

export type TeamTurn = {
  id: string;
  sessionId: string;
  trackId: string;
  startMs: number;
  endMs: number;
  megaRow: TurnMegaRow;
  agentColor: string;
};

export type TeamTrack = {
  id: string;
  label: string;
  color: string;
  isLead: boolean;
  turns: TeamTurn[];
};

export type TimelineData = {
  tracks: TeamTrack[];
  firstEventMs: number;
  lastEventMs: number;
};

const LEAD_COLOR = "#f0b429";
const MEMBER_COLORS = ["#58a6ff", "#b58cf0", "#3fb950", "#f85149", "#db6d28"];

export function teamViewToTimelineData(
  view: TeamView,
  details: Map<string, SessionDetail>,
): TimelineData {
  const tracks: TeamTrack[] = [];

  const leadDetail = details.get(view.leadSessionId);
  if (leadDetail) {
    tracks.push(buildTrack(leadDetail, "LEAD", LEAD_COLOR, true));
  }
  view.memberSessionIds.forEach((id, i) => {
    const d = details.get(id);
    if (!d) return;
    const label = view.agentNameBySessionId.get(id) ?? id.slice(0, 8);
    tracks.push(buildTrack(d, label, MEMBER_COLORS[i % MEMBER_COLORS.length]!, false));
  });

  return {
    tracks,
    firstEventMs: view.firstEventMs,
    lastEventMs: view.lastEventMs,
  };
}

function buildTrack(
  d: SessionDetail,
  label: string,
  color: string,
  isLead: boolean,
): TeamTrack {
  // buildMegaRows reports tOffsetMs / durationMs relative to session start;
  // convert to absolute wall-clock using the session's firstTimestamp.
  const sessionStartMs = d.firstTimestamp ? Date.parse(d.firstTimestamp) : 0;
  const rows = buildPresentation(d.events);
  const mega = buildMegaRows(rows);
  const turns: TeamTurn[] = [];
  let turnIndex = 0;
  for (const mr of mega) {
    if (mr.kind !== "turn") continue;
    if (mr.tOffsetMs === undefined || mr.durationMs === undefined) continue;
    const startMs = sessionStartMs + mr.tOffsetMs;
    const endMs = startMs + mr.durationMs;
    turns.push({
      id: `${d.sessionId}:${turnIndex++}`,
      sessionId: d.sessionId,
      trackId: d.sessionId,
      startMs,
      endMs,
      megaRow: mr,
      agentColor: color,
    });
  }
  turns.sort((a, b) => a.startMs - b.startMs);
  return {
    id: d.sessionId,
    label,
    color,
    isLead,
    turns,
  };
}
