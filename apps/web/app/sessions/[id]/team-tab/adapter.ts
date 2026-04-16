import { formatGap } from "@/lib/format";
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
  userPrompt?: PresentationRow;
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

export type XAnchor = {
  tsMs: number;
  xFrac: number;
};

/** Idle band expressed as an x-range for the minimap. Unlike the body's
 *  IdleBand (yPx), this is expressed as normalized fractions [0, 1] so
 *  the minimap's horizontal scale stays independent of pixel width. */
export type MinimapIdleBand = {
  startMs: number;
  endMs: number;
  durationMs: number;
  xFracStart: number;
  xFracEnd: number;
  label: string;
};

/** When the total team span exceeds DAY_PAGE_HOURS we switch the minimap
 *  from a single compressed strip into day pages, each rendered on its own
 *  x-scale so a single day has the whole minimap width to itself. Page
 *  nav arrows move between pages. */
export type DayPage = {
  startMs: number;
  endMs: number;
  label: string;
  xAnchors: XAnchor[];
  minimapIdleBands: MinimapIdleBand[];
};

export type TimelineData = {
  tracks: TeamTrack[];
  yAnchors: YAnchor[];
  idleBands: IdleBand[];
  totalHeightPx: number;
  firstEventMs: number;
  lastEventMs: number;
  timeTicks: { tsMs: number; yPx: number; label: string }[];
  /** Event-anchored x-scale for the minimap. Same spirit as yAnchors:
   *  active intervals get proportional width, all-idle stretches collapse.
   *  When dayPages is set, minimap consumers should prefer those; this one
   *  still covers the full span for consumers that don't paginate. */
  xAnchors: XAnchor[];
  minimapIdleBands: MinimapIdleBand[];
  /** True when the team spans more than one local day — consumers can
   *  show full dates in hover cards / labels instead of just times. */
  multiDay: boolean;
  /** Present when the team span exceeds DAY_PAGE_HOURS. The minimap
   *  splits itself across these pages instead of cramming everything
   *  into one compressed strip. */
  dayPages?: DayPage[];
};

/** Code-level knob for the day-page width. 24h is the default that fits
 *  most multi-day team traces; 12h is available for fleets that run in
 *  shorter bursts. Not exposed to users. */
const DAY_PAGE_HOURS = 24;
const DAY_PAGE_MS = DAY_PAGE_HOURS * 60 * 60 * 1000;

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

const TURN_MIN_HEIGHT = 140;
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

  const multiDay = isMultiDay(view.firstEventMs, view.lastEventMs);
  const { xAnchors, minimapIdleBands } = buildXFunction(
    allTurns,
    view.firstEventMs,
    view.lastEventMs,
    multiDay,
  );

  const spanMs = view.lastEventMs - view.firstEventMs;
  const dayPages =
    spanMs > DAY_PAGE_MS
      ? buildDayPages(allTurns, view.firstEventMs, view.lastEventMs, multiDay)
      : undefined;

  return {
    tracks,
    yAnchors,
    idleBands,
    totalHeightPx,
    firstEventMs: view.firstEventMs,
    lastEventMs: view.lastEventMs,
    timeTicks,
    xAnchors,
    minimapIdleBands,
    multiDay,
    dayPages,
  };
}

/** Walk the full span in DAY_PAGE_HOURS slices starting at the local-day
 *  boundary that contains firstEventMs. Each page runs buildXFunction
 *  over just the turns that overlap its window so the compressed scale
 *  is tight to that day's actual activity. */
function buildDayPages(
  allTurns: TeamTurn[],
  firstEventMs: number,
  lastEventMs: number,
  multiDay: boolean,
): DayPage[] {
  // Anchor page 0 at local midnight of firstEventMs so successive pages
  // line up with real calendar days (feels natural when labels show
  // "Mar 27", "Mar 28", etc.).
  const firstDate = new Date(firstEventMs);
  const pageStart = new Date(
    firstDate.getFullYear(),
    firstDate.getMonth(),
    firstDate.getDate(),
  ).getTime();

  const pages: DayPage[] = [];
  let cursor = pageStart;
  while (cursor < lastEventMs) {
    const startMs = cursor;
    const endMs = Math.min(lastEventMs, cursor + DAY_PAGE_MS);
    const clampedStart = Math.max(startMs, firstEventMs);
    // Keep any turn that touches this window.
    const pageTurns = allTurns.filter(
      (t) => t.endMs >= clampedStart && t.startMs <= endMs,
    );
    // Skip empty days. A long team span can have multi-day gaps where
    // nothing actually happened — showing blank pages for those just
    // forces the user to click through noise. The minimap's job is to
    // visualize activity, so days without any are dropped entirely.
    if (pageTurns.length === 0) {
      cursor += DAY_PAGE_MS;
      continue;
    }
    const windowStart = clampedStart;
    const windowEnd = endMs;
    const { xAnchors, minimapIdleBands } = buildXFunction(
      pageTurns,
      windowStart,
      windowEnd,
      multiDay,
    );
    pages.push({
      startMs: windowStart,
      endMs: windowEnd,
      label: formatDayLabel(startMs),
      xAnchors,
      minimapIdleBands,
    });
    cursor += DAY_PAGE_MS;
  }
  return pages;
}

function formatDayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

type ActiveRegion = { startMs: number; endMs: number };

function mergeActiveRegions(turns: TeamTurn[]): ActiveRegion[] {
  const sorted = [...turns].sort((a, b) => a.startMs - b.startMs);
  const active: ActiveRegion[] = [];
  for (const t of sorted) {
    const last = active[active.length - 1];
    if (last && t.startMs <= last.endMs) {
      if (t.endMs > last.endMs) last.endMs = t.endMs;
    } else {
      active.push({ startMs: t.startMs, endMs: t.endMs });
    }
  }
  return active;
}

function isMultiDay(firstMs: number, lastMs: number): boolean {
  const a = new Date(firstMs);
  const b = new Date(lastMs);
  return (
    a.getFullYear() !== b.getFullYear() ||
    a.getMonth() !== b.getMonth() ||
    a.getDate() !== b.getDate()
  );
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
  let lastUserRow: PresentationRow | undefined;
  for (const m of mega) {
    if (m.kind === "user") {
      lastUserRow = m;
      continue;
    }
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
      userPrompt: lastUserRow,
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

  const active = mergeActiveRegions(allTurns);

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

/* ----------- X function (minimap horizontal scale) ----------- */

/** Synthetic "ms weight" each active interval contributes. Used to keep
 *  short active bursts visually wide enough to click while still letting
 *  genuinely long activity dominate. */
const ACTIVE_MIN_WEIGHT_MS = 45_000;

/** Synthetic "ms weight" each idle interval collapses to. Doesn't scale
 *  with real duration — a 10-minute gap and a 10-hour overnight gap both
 *  take roughly the same horizontal space, with the actual duration and
 *  date carried in the hatched band's label. */
function idleWeightMs(gapMs: number): number {
  if (gapMs < 60_000) return 20_000;
  if (gapMs < 10 * 60_000) return 40_000;
  if (gapMs < 60 * 60_000) return 60_000;
  if (gapMs < 6 * 60 * 60_000) return 80_000;
  return 100_000; // multi-hour, multi-day — effectively capped
}

function buildXFunction(
  allTurns: TeamTurn[],
  firstEventMs: number,
  lastEventMs: number,
  multiDay: boolean,
): {
  xAnchors: XAnchor[];
  minimapIdleBands: MinimapIdleBand[];
} {
  if (allTurns.length === 0 || lastEventMs <= firstEventMs) {
    return {
      xAnchors: [
        { tsMs: firstEventMs, xFrac: 0 },
        { tsMs: lastEventMs, xFrac: 1 },
      ],
      minimapIdleBands: [],
    };
  }

  const active = mergeActiveRegions(allTurns);

  // Build the interval list: alternating active / idle spans that cover
  // [firstEventMs, lastEventMs] end to end.
  type Interval = {
    startMs: number;
    endMs: number;
    isIdle: boolean;
    weight: number;
  };
  const intervals: Interval[] = [];
  let cursor = firstEventMs;
  for (const a of active) {
    if (a.startMs > cursor) {
      const gap = a.startMs - cursor;
      intervals.push({
        startMs: cursor,
        endMs: a.startMs,
        isIdle: gap >= ALL_IDLE_THRESHOLD_MS,
        weight:
          gap >= ALL_IDLE_THRESHOLD_MS
            ? idleWeightMs(gap)
            : Math.max(ACTIVE_MIN_WEIGHT_MS, gap),
      });
    }
    const dur = a.endMs - a.startMs;
    intervals.push({
      startMs: a.startMs,
      endMs: a.endMs,
      isIdle: false,
      weight: Math.max(ACTIVE_MIN_WEIGHT_MS, dur),
    });
    cursor = a.endMs;
  }
  if (cursor < lastEventMs) {
    const gap = lastEventMs - cursor;
    intervals.push({
      startMs: cursor,
      endMs: lastEventMs,
      isIdle: gap >= ALL_IDLE_THRESHOLD_MS,
      weight:
        gap >= ALL_IDLE_THRESHOLD_MS
          ? idleWeightMs(gap)
          : Math.max(ACTIVE_MIN_WEIGHT_MS, gap),
    });
  }

  const totalWeight = intervals.reduce((s, i) => s + i.weight, 0) || 1;

  const xAnchors: XAnchor[] = [{ tsMs: firstEventMs, xFrac: 0 }];
  let cumWeight = 0;
  for (const i of intervals) {
    cumWeight += i.weight;
    xAnchors.push({ tsMs: i.endMs, xFrac: cumWeight / totalWeight });
  }

  const minimapIdleBands: MinimapIdleBand[] = [];
  let walkWeight = 0;
  for (const i of intervals) {
    const start = walkWeight / totalWeight;
    walkWeight += i.weight;
    const end = walkWeight / totalWeight;
    if (i.isIdle) {
      minimapIdleBands.push({
        startMs: i.startMs,
        endMs: i.endMs,
        durationMs: i.endMs - i.startMs,
        xFracStart: start,
        xFracEnd: end,
        label: idleLabel(i.startMs, i.endMs, multiDay),
      });
    }
  }

  return { xAnchors, minimapIdleBands };
}

function idleLabel(startMs: number, endMs: number, multiDay: boolean): string {
  const dur = `${formatGap(endMs - startMs)} idle`;
  if (!multiDay) return dur;
  const a = new Date(startMs);
  const b = new Date(endMs);
  const sameDay =
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay) return dur;
  const toDate = b.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${dur} → ${toDate}`;
}

export function xOfMs(anchors: XAnchor[], tsMs: number): number {
  if (anchors.length === 0) return 0;
  if (tsMs <= anchors[0]!.tsMs) return anchors[0]!.xFrac;
  if (tsMs >= anchors[anchors.length - 1]!.tsMs)
    return anchors[anchors.length - 1]!.xFrac;

  let lo = 0;
  let hi = anchors.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid]!.tsMs <= tsMs) lo = mid;
    else hi = mid;
  }
  const a = anchors[lo]!;
  const b = anchors[hi]!;
  if (b.tsMs === a.tsMs) return a.xFrac;
  const frac = (tsMs - a.tsMs) / (b.tsMs - a.tsMs);
  return a.xFrac + frac * (b.xFrac - a.xFrac);
}

/** Inverse of xOfMs — given an xFrac in [0, 1], return the wall-clock ms
 *  that lives at that compressed position. Used by the minimap's click-to-
 *  seek. */
export function msOfXFrac(anchors: XAnchor[], xFrac: number): number {
  if (anchors.length === 0) return 0;
  if (xFrac <= anchors[0]!.xFrac) return anchors[0]!.tsMs;
  if (xFrac >= anchors[anchors.length - 1]!.xFrac)
    return anchors[anchors.length - 1]!.tsMs;

  let lo = 0;
  let hi = anchors.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid]!.xFrac <= xFrac) lo = mid;
    else hi = mid;
  }
  const a = anchors[lo]!;
  const b = anchors[hi]!;
  if (b.xFrac === a.xFrac) return a.tsMs;
  const frac = (xFrac - a.xFrac) / (b.xFrac - a.xFrac);
  return a.tsMs + frac * (b.tsMs - a.tsMs);
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
