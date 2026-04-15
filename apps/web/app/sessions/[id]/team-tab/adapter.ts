import type {
  TeamView,
  SessionDetail,
  PresentationRow,
  SubagentRun,
  TurnMegaRow,
} from "@claude-lens/parser";
import { buildPresentation, buildMegaRows } from "@claude-lens/parser";

export type TeamTrack = {
  id: string;
  label: string;
  color: string;
  isLead: boolean;
  presentationRows: PresentationRow[];
  subagents: SubagentRun[];
  sessionStartMs: number;
  turns: TeamTurn[];
};

export type TeamTurn = {
  id: string;
  trackId: string;
  startMs: number;
  endMs: number;
  megaRow: TurnMegaRow;
  durationMs: number;
};

export type IdleBand = {
  kind: "idle";
  startMs: number;
  endMs: number;
  durationMs: number;
  yPx: number;
  heightPx: number;
};

export type YAnchor = {
  tsMs: number;
  yPx: number;
};

export type TimelineData = {
  tracks: TeamTrack[];
  yAnchors: YAnchor[];
  idleBands: IdleBand[];
  totalHeightPx: number;
  firstEventMs: number;
  lastEventMs: number;
  timeTicks: { tsMs: number; yPx: number; label: string }[];
};

const LEAD_COLOR = "#f0b429";
const MEMBER_COLORS = [
  "#58a6ff",
  "#b58cf0",
  "#3fb950",
  "#f85149",
  "#db6d28",
  "#ff7b72",
  "#56d364",
];

const TURN_MIN_HEIGHT = 100;
function turnPreferredHeight(durationMs: number): number {
  const minutes = durationMs / 60_000;
  // Gentle log growth so a 10-hour turn doesn't blow up the page.
  const bonus = Math.min(220, 80 * Math.log10(minutes + 1));
  return TURN_MIN_HEIGHT + bonus;
}

function idleBandHeight(gapMs: number): number {
  if (gapMs < 10_000) return 6;
  if (gapMs < 60_000) return 18;
  if (gapMs < 10 * 60_000) return 24;
  if (gapMs < 60 * 60_000) return 32;
  return 44;
}

// Gaps smaller than this between turn activity are NOT collapsed — they stay
// proportional to keep short pauses readable.
const ALL_IDLE_THRESHOLD_MS = 30_000;

export function teamViewToTimelineData(
  view: TeamView,
  details: Map<string, SessionDetail>,
): TimelineData {
  const tracks: TeamTrack[] = [];

  const lead = details.get(view.leadSessionId);
  if (lead) tracks.push(buildTrack(lead, "LEAD", LEAD_COLOR, true));

  view.memberSessionIds.forEach((id, i) => {
    const d = details.get(id);
    if (!d) return;
    const label = view.agentNameBySessionId.get(id) ?? id.slice(0, 8);
    tracks.push(
      buildTrack(d, label, MEMBER_COLORS[i % MEMBER_COLORS.length]!, false),
    );
  });

  const allTurns = tracks.flatMap((t) => t.turns);
  allTurns.sort((a, b) => a.startMs - b.startMs);

  const { yAnchors, idleBands, totalHeightPx, timeTicks } = buildYFunction(
    allTurns,
    view.firstEventMs,
    view.lastEventMs,
  );

  return {
    tracks,
    yAnchors,
    idleBands,
    totalHeightPx,
    firstEventMs: view.firstEventMs,
    lastEventMs: view.lastEventMs,
    timeTicks,
  };
}

function buildTrack(
  d: SessionDetail,
  label: string,
  color: string,
  isLead: boolean,
): TeamTrack {
  const sessionStartMs = d.firstTimestamp ? Date.parse(d.firstTimestamp) : 0;
  const presentationRows = buildPresentation(d.events);
  const mega = buildMegaRows(presentationRows);

  const turns: TeamTurn[] = [];
  let turnIndex = 0;
  for (const m of mega) {
    if (m.kind !== "turn") continue;
    if (m.tOffsetMs === undefined || m.durationMs === undefined) continue;
    const startMs = sessionStartMs + m.tOffsetMs;
    // Never zero — always at least 1s so layout math never divides by 0.
    const durationMs = Math.max(1000, m.durationMs);
    turns.push({
      id: `${d.sessionId}:${turnIndex++}`,
      trackId: d.sessionId,
      startMs,
      endMs: startMs + durationMs,
      megaRow: m,
      durationMs,
    });
  }

  return {
    id: d.sessionId,
    label,
    color,
    isLead,
    presentationRows,
    subagents: d.subagents ?? [],
    sessionStartMs,
    turns,
  };
}

function buildYFunction(
  allTurns: TeamTurn[],
  firstEventMs: number,
  lastEventMs: number,
): {
  yAnchors: YAnchor[];
  idleBands: IdleBand[];
  totalHeightPx: number;
  timeTicks: { tsMs: number; yPx: number; label: string }[];
} {
  if (allTurns.length === 0) {
    return {
      yAnchors: [
        { tsMs: firstEventMs, yPx: 0 },
        { tsMs: lastEventMs, yPx: 0 },
      ],
      idleBands: [],
      totalHeightPx: 0,
      timeTicks: [],
    };
  }

  // Merge overlapping turn intervals across all lanes → active regions.
  // Gaps between active regions are "all-idle" candidates for compression.
  const sorted = [...allTurns].sort((a, b) => a.startMs - b.startMs);
  type Active = { startMs: number; endMs: number };
  const active: Active[] = [];
  for (const t of sorted) {
    const last = active[active.length - 1];
    if (last && t.startMs <= last.endMs) {
      if (t.endMs > last.endMs) last.endMs = t.endMs;
    } else {
      active.push({ startMs: t.startMs, endMs: t.endMs });
    }
  }

  const anchorSet = new Set<number>();
  anchorSet.add(firstEventMs);
  anchorSet.add(lastEventMs);
  for (const a of active) {
    anchorSet.add(a.startMs);
    anchorSet.add(a.endMs);
  }
  for (const t of allTurns) {
    anchorSet.add(t.startMs);
    anchorSet.add(t.endMs);
  }
  const anchorTimes = [...anchorSet].sort((a, b) => a - b);

  type Interval = {
    startMs: number;
    endMs: number;
    isIdle: boolean;
    heightPx: number;
  };
  const intervals: Interval[] = [];
  for (let i = 0; i < anchorTimes.length - 1; i++) {
    const startMs = anchorTimes[i]!;
    const endMs = anchorTimes[i + 1]!;
    const durationMs = endMs - startMs;
    if (durationMs <= 0) continue;

    const insideActive = active.some(
      (a) => a.startMs <= startMs && a.endMs >= endMs,
    );
    if (!insideActive && durationMs >= ALL_IDLE_THRESHOLD_MS) {
      intervals.push({
        startMs,
        endMs,
        isIdle: true,
        heightPx: idleBandHeight(durationMs),
      });
      continue;
    }

    // Baseline so short active intervals still have enough room to render.
    let needed = 24;
    for (const t of allTurns) {
      const overlap = Math.min(t.endMs, endMs) - Math.max(t.startMs, startMs);
      if (overlap <= 0) continue;
      const fraction = overlap / t.durationMs;
      const contribution = turnPreferredHeight(t.durationMs) * fraction;
      if (contribution > needed) needed = contribution;
    }
    intervals.push({ startMs, endMs, isIdle: false, heightPx: needed });
  }

  const yAnchors: YAnchor[] = [{ tsMs: anchorTimes[0]!, yPx: 0 }];
  let cursorY = 0;
  for (let i = 0; i < intervals.length; i++) {
    cursorY += intervals[i]!.heightPx;
    yAnchors.push({ tsMs: intervals[i]!.endMs, yPx: cursorY });
  }
  const totalHeightPx = cursorY;

  const idleBands: IdleBand[] = [];
  let cursor2 = 0;
  for (const i of intervals) {
    if (i.isIdle) {
      idleBands.push({
        kind: "idle",
        startMs: i.startMs,
        endMs: i.endMs,
        durationMs: i.endMs - i.startMs,
        yPx: cursor2,
        heightPx: i.heightPx,
      });
    }
    cursor2 += i.heightPx;
  }

  const timeTicks = yAnchors.map((a) => ({
    tsMs: a.tsMs,
    yPx: a.yPx,
    label: formatTimeLabel(a.tsMs),
  }));

  return { yAnchors, idleBands, totalHeightPx, timeTicks };
}

function formatTimeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function yOfMs(anchors: YAnchor[], tsMs: number): number {
  if (anchors.length === 0) return 0;
  if (tsMs <= anchors[0]!.tsMs) return anchors[0]!.yPx;
  if (tsMs >= anchors[anchors.length - 1]!.tsMs)
    return anchors[anchors.length - 1]!.yPx;

  let lo = 0;
  let hi = anchors.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid]!.tsMs <= tsMs) lo = mid;
    else hi = mid;
  }
  const a = anchors[lo]!;
  const b = anchors[hi]!;
  if (b.tsMs === a.tsMs) return a.yPx;
  const frac = (tsMs - a.tsMs) / (b.tsMs - a.tsMs);
  return a.yPx + frac * (b.yPx - a.yPx);
}
