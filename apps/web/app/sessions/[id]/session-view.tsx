"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Cpu,
  Folder,
  GitPullRequest,
  Workflow as WorkflowIcon,
  Wrench,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  SessionDetail,
  SessionEvent,
  WorkflowRun,
} from "@claude-lens/parser";
import type { Entry } from "@claude-lens/entries";
import { OutcomePill } from "@/components/outcome-pill";
import {
  buildPresentation,
  buildMegaRows,
  detectPrMarkers,
  type MegaRow,
  type PresentationRow,
  type PresentationRowKind,
  type TurnMegaRow,
  type TurnSummary,
} from "@claude-lens/parser";
import {
  rowPrimaryIndex,
  type DisplayRow,
} from "./session-view/types";
import { Minimap } from "./session-view/minimap";
import {
  formatDayKey,
  flattenMegaRows,
  allRowsAsRawRows,
  formatDurationHeader,
} from "./session-view/helpers";
import { EntryDayStrip } from "./session-view/entry-day-strip";
import { DebugList } from "./session-view/debug-list";
import { Tooltip, TooltipRow } from "./session-view/tooltip";
import { TokenChip, TurnTokenChip } from "./session-view/token-stats";
import {
  InlineStat,
  InlineStatDivider,
  EntrypointBadge,
  InlineTokenStat,
  useAnchoredTooltip,
  AnchoredTooltip,
} from "./session-view/header-stats";
import { Drawer } from "./session-view/drawer";
import {
  WorkflowsPanel,
  WorkflowAgentDrawer,
} from "./session-view/workflows-panel";
import { SubagentDrawer } from "./session-view/subagent-drawer";
import { estimateCost, formatCost, formatGap, formatOffset, formatRelative, formatTokens, shortId } from "@/lib/format";
import { LiveBadge } from "@/components/live-badge";
import { AskButton, AskDrawer } from "@/components/ask";
import { TailMode } from "@/components/tail-mode";
import type { TimelineData } from "./team-tab/adapter";
import { TeamTabClient } from "./team-tab/team-tab-client";
import { TeamMinimap } from "./team-tab/team-minimap";
import {
  ROLE_THEMES,
  MAX_INLINE_STEPS,
  rowPreview,
  formatToolSummary,
  shortenToolName,
  TurnStepsList,
} from "./turn-steps";
import {
  ToolUseCard,
  ToolCardShell,
  CodeBlock,
  DiffView,
  PathLabel,
  type ToolUseInput,
} from "./tool-cards";

/* ------------------------------------------------------------------ */
/*  Constants + theming                                               */
/* ------------------------------------------------------------------ */

/** Gap > this (ms) before a user row is shown as a "Session idle" divider
 *  in the transcript body (separate from the minimap, which now derives
 *  idle from raw event timestamps via rawIdleBands). */
const IDLE_THRESHOLD_MS = 2000;

/** Sticky header height (session header + tabs + mini-map).
 *  Transcript rows reserve this as scroll-margin so scrollIntoView lands
 *  them below the sticky area instead of hidden underneath. */
const STICKY_HEADER_HEIGHT = 310;

type FilterMode = "turns" | "meaningful" | "all" | PresentationRowKind;

const FILTER_MODES: { value: FilterMode; label: string }[] = [
  { value: "turns", label: "Turns" },
  { value: "meaningful", label: "All actions" },
  { value: "all", label: "All events" },
  { value: "user", label: "User only" },
  { value: "agent", label: "Agent only" },
  { value: "tool-group", label: "Tool only" },
  { value: "error", label: "Errors only" },
];

/* ------------------------------------------------------------------ */
/*  Main component                                                    */
/* ------------------------------------------------------------------ */

/** Drawer width in px — reserved on the transcript's right edge when open. */
const DRAWER_WIDTH = 460;
/** Wider sheet for the workflow-agent step log — dense step rows need room. */
const WF_AGENT_DRAWER_WIDTH = 600;

type TabId = "transcript" | "workflows" | "team" | "debug";
const VALID_TABS: TabId[] = ["transcript", "workflows", "team", "debug"];

export function SessionView({
  session,
  team,
  teamLead,
  entries = [],
}: {
  session: SessionDetail;
  team?: (TimelineData & { teamName: string }) | null;
  teamLead?: { leadSessionId: string; teamName: string; agentName: string } | null;
  entries?: Entry[];
}) {
  const readHash = (): TabId => {
    if (typeof window === "undefined") return "transcript";
    const h = window.location.hash.replace("#", "");
    if (VALID_TABS.includes(h as TabId)) return h as TabId;
    return "transcript";
  };
  const [tab, setTabRaw] = useState<TabId>(readHash);
  const setTab = (t: TabId) => {
    setTabRaw(t);
    window.history.replaceState(null, "", `#${t}`);
  };
  // Re-read hash on client mount and whenever the session changes (Next.js
  // reuses this component across /sessions/[id] navigations, so useState
  // doesn't reinitialize — the old tab would stick without this).
  useEffect(() => {
    setTabRaw(readHash());
  }, [session.sessionId]);
  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace("#", "");
      if (VALID_TABS.includes(h as TabId)) setTabRaw(h as TabId);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // Team tab — playhead (set by TeamTable as the user scrolls) and seek
  // target (set by TeamMinimap clicks). Hoisted to session-view so the
  // sticky-header TeamMinimap and the body's TeamTable share the same
  // state without duplicating the minimap.
  const [teamPlayheadMs, setTeamPlayheadMs] = useState<number | null>(null);
  const [teamSeekTarget, setTeamSeekTarget] = useState<{
    tsMs: number;
    trackId?: string;
  } | null>(null);
  // Member track ids currently in the table's horizontal viewport, published
  // by TeamTable on scroll. The sticky TeamMinimap uses this to mirror the
  // table's current agents in its default (collapsed) lane set.
  const [teamVisibleTrackIds, setTeamVisibleTrackIds] = useState<string[]>([]);
  // When the user explicitly clicks "Show all" in the minimap we display
  // every lane regardless of table scroll position.
  const [teamExpanded, setTeamExpanded] = useState(false);
  const [filter, setFilter] = useState<FilterMode>("turns");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(null);
  /** Workflow run to focus (auto-expand + scroll) on the Workflows tab —
   *  set when a workflow lane on the minimap is clicked. */
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  /** Workflow agent whose full step log is open in the right side-sheet. */
  const [selectedWorkflowAgent, setSelectedWorkflowAgent] = useState<{
    runId: string;
    agent: WorkflowRun["agents"][number];
  } | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [expandedTurns, setExpandedTurns] = useState<Set<number>>(new Set());
  /** When a timeline click sets the index we also want to scroll. Track that
   *  intent separately so selection via row-click doesn't auto-scroll. */
  const [scrollIntent, setScrollIntent] = useState(0);
  /** Scroll-only target (no selection) — used by day navigation so jumping to
   *  a day scrolls the transcript there WITHOUT popping the event drawer the
   *  way a row/minimap selection does. `block` aligns the strip to the top
   *  ("start", normal day jump) or the bottom ("end", used by "go to end of the
   *  previous day" — scrolling the current day's strip to the viewport bottom
   *  reveals the previous day's tail above it). `n` forces the effect to re-run
   *  even when the same target is requested twice. */
  const [dayScrollTarget, setDayScrollTarget] = useState<
    { index: number; key: string; block: "start" | "end"; n: number } | null
  >(null);
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  // Per-day digest cards (EntryDayStrip) are interleaved into the transcript at
  // each day's first row, so day-nav scrolls to the card itself when present.
  const dayStripRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // The event/subagent drawers are transcript-scoped (position: fixed, shown
  // whenever a selection exists). Clear the selection when leaving the
  // transcript so a stale drawer doesn't overlay the Workflows/Team/Debug tabs.
  useEffect(() => {
    if (tab !== "transcript") {
      setSelectedIndex(null);
      setSelectedSubagentId(null);
    }
    if (tab !== "workflows") {
      setSelectedWorkflowId(null);
      setSelectedWorkflowAgent(null);
    }
  }, [tab]);

  /** Measured height of the sticky header — used both as the drawer's
   *  top offset (so it sits exactly below the header) and as the
   *  scroll-margin for transcript rows (so click-to-focus lands a row
   *  below the header instead of hidden underneath it). Measured once
   *  at mount + on resize via ResizeObserver — no magic constants. */
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(STICKY_HEADER_HEIGHT);
  // Live mirror so the day-scroll alignment can read the current header height
  // WITHOUT taking headerH as an effect dep — collapse flips headerH on every
  // scroll direction change, and a dep there would re-fire the day scroll mid-
  // free-scroll and yank the view back to the last nav target.
  const headerHRef = useRef(headerH);
  headerHRef.current = headerH;
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderH(el.offsetHeight);
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  /** Collapsed-header state. When the user scrolls past the first
   *  ~80px, hide the breadcrumb / title / meta-stats / tabs row and
   *  keep only the mini-map visible. This matches the pattern in
   *  Claude's own Sessions UI — you trade discovery info for more
   *  screen real-estate once you're deep in reading. Hysteresis (60
   *  vs 80) prevents flicker at the boundary. */
  const [collapsed, setCollapsed] = useState(false);
  // When the user explicitly clicks the toggle, suppress auto-collapse
  // for a short period so the scroll listener doesn't immediately undo it.
  const manualPinRef = useRef(0);
  // Stamped on every explicit day-jump so TailMode's live-follow observer
  // bails for a beat — otherwise a streaming live event yanks the view back
  // to the bottom mid-navigation. See gotoDay / jumpAcrossDay.
  const tailNavLockRef = useRef(0);
  const toggleCollapsed = () => {
    setCollapsed((v) => !v);
    manualPinRef.current = Date.now();
  };
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const mainEl = el.closest("main") as HTMLElement | null;
    if (!mainEl) return;
    // Team tab has its own fixed-height scroll container, so listening
    // to `main` alone misses all vertical scroll when the inner table
    // is what's moving. Pick the team table's scroll element as the
    // scroll target when on team tab (it has data-team-scroll). Falls
    // back to the main element for every other tab.
    const teamScroll =
      tab === "team"
        ? (document.querySelector("[data-team-scroll]") as HTMLElement | null)
        : null;
    const main = teamScroll ?? mainEl;
    // Track scroll direction to avoid jitter. Collapse only when
    // scrolling DOWN past a threshold; expand only at scrollTop===0.
    // This eliminates the loop where collapse changes height → scroll
    // changes → triggers expand → height changes → etc.
    let lastY = main.scrollTop;
    let locked = false; // debounce lock after a toggle
    let raf = 0;
    const update = () => {
      raf = 0;
      if (locked) return;
      // Respect manual pin — user clicked the toggle, don't override
      // their choice for 2 seconds so the next scroll doesn't fight it.
      if (Date.now() - manualPinRef.current < 2000) return;
      const y = main.scrollTop;
      const dir = y - lastY; // positive = scrolling down
      lastY = y;
      setCollapsed((prev) => {
        // Expand: when user scrolls UP (iOS-style reveal).
        if (prev && dir < 0) {
          locked = true;
          setTimeout(() => { locked = false; }, 300);
          return false;
        }
        // Collapse: only when scrolling DOWN past threshold.
        if (!prev && dir > 0 && y > 150) {
          locked = true;
          setTimeout(() => { locked = false; }, 300);
          return true;
        }
        return prev;
      });
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(update);
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      main.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [tab]);

  // Run after every render that changed scrollIntent — the DOM is now
  // guaranteed up-to-date (including any drawer grid reflow).
  useEffect(() => {
    if (selectedIndex === null) return;
    const el = rowRefs.current[selectedIndex];
    if (!el) return;

    // scrollIntoView correctly handles content-visibility: auto on the
    // target's ancestors/siblings (it forces layout-measure of the row,
    // unlike manual offsetTop math which reads the stale placeholder
    // size of unvisited rows). Use "start" + a scroll-margin-top in CSS
    // to land the row just below the sticky header.
    el.scrollIntoView({ block: "start", behavior: "auto" });
  }, [scrollIntent, selectedIndex]);

  // Scroll-only effect for day navigation — scrolls to a row without setting
  // selectedIndex (so no drawer opens). Same scrollIntoView contract as above.
  useEffect(() => {
    if (!dayScrollTarget) return;
    const main = headerRef.current?.closest("main") as HTMLElement | null;
    // Prefer the day's digest card (it leads the day); fall back to the first
    // row when that day has no entry.
    const el =
      dayStripRefs.current[dayScrollTarget.key] ?? rowRefs.current[dayScrollTarget.index];
    if (!el || !main) return;
    el.scrollIntoView({ block: dayScrollTarget.block, behavior: "auto" });

    // scrollIntoView aims using the content-visibility ESTIMATED heights of the
    // rows ABOVE the target, so on a long transcript (worst at mount, when none
    // have been laid out yet) it undershoots by 100–200px — leaving the PREVIOUS
    // day's tall trailing turn-block still straddling the header line. The
    // playhead observer then reads THAT block's offset and followDayToScroll
    // reverts the day-jump. For a top-aligned jump, re-measure on the next few
    // frames (real heights now settle progressively) and nudge the target to sit
    // exactly at the header line so the prev block clears it. block:"end" (go to
    // end of prev day) intentionally leaves the prev-day tail on the line, so it
    // needs no correction.
    if (dayScrollTarget.block !== "start") return;
    let frames = 0;
    let settled = 0;
    let raf = 0;
    const align = () => {
      const delta = Math.round(
        el.getBoundingClientRect().top - main.getBoundingClientRect().top - headerHRef.current,
      );
      if (Math.abs(delta) > 1) {
        main.scrollTop += delta;
        settled = 0;
      } else {
        settled++;
      }
      // Keep correcting until it holds for two consecutive frames (rows above
      // the target settle their real content-visibility heights progressively,
      // and on a long transcript that can take many frames). Cap as a backstop.
      if (settled < 2 && ++frames < 20) raf = requestAnimationFrame(align);
    };
    raf = requestAnimationFrame(align);
    return () => cancelAnimationFrame(raf);
  }, [dayScrollTarget]);

  const { events, durationMs, totalUsage, model, eventCount, projectName } = session;
  const airTimeMs = session.airTimeMs ?? durationMs;
  const workflowCount = session.workflows?.length ?? 0;
  const hasWorkflows = workflowCount > 0;

  /** Inbound `<teammate-message>` events are cross-session team traffic
   *  wrapped in a synthetic user event. On the LEAD's transcript these are
   *  protocol noise (idle notifications, task assignments) — hide them and
   *  point the user to the Team tab. On a MEMBER's transcript the teammate
   *  messages ARE the task instructions from the lead, so we keep them
   *  visible — hiding them would strip all context from the member's work. */
  const isLead = session.isTeamLead;
  const teammateCount = useMemo(
    () => (isLead ? events.filter((e) => e.teammateMessage).length : 0),
    [events, isLead],
  );
  const visibleEvents = useMemo(
    () => (teammateCount === 0 ? events : events.filter((e) => !e.teammateMessage)),
    [events, teammateCount],
  );

  // A session is "live" if its last activity was within 45 seconds — where
  // "activity" includes nested background-agent/workflow writes, not just the
  // main transcript's last event (lastActivityMs).
  const isSessionLive = (() => {
    const isoMs = session.lastTimestamp ? Date.parse(session.lastTimestamp) : NaN;
    const ms = Math.max(
      Number.isNaN(isoMs) ? 0 : isoMs,
      session.lastActivityMs && Number.isFinite(session.lastActivityMs) ? session.lastActivityMs : 0,
    );
    return ms > 0 && Date.now() - ms < 45_000;
  })();

  /** Detect PR creations in this session. */
  const prMarkers = useMemo(() => detectPrMarkers(session), [session]);

  /** Idle bands derived from raw event timestamps. Anchors include every
   *  timestamped event (agent-thinking and meta are activity too), and
   *  each emitted band's `start..end` is a literal time range so the
   *  minimap stripe width tracks actual idle duration — no across-gap
   *  merging.
   *
   *  Two exclusions keep "delegated work" and "response latency" out of
   *  idle:
   *    - Subagent run spans are carved out of every candidate gap. When a
   *      parent dispatches an Agent tool call the gap between tool_use and
   *      tool_result is the subagent's runtime — not idle. Background
   *      runs that overlap a user-away gap likewise get clipped out so
   *      only the genuinely-unwatched portion remains. The carve can
   *      produce multiple surviving slices per gap; each becomes its own
   *      band so the visual extent matches reality.
   *    - "Awaiting first response" — the period between a user message
   *      and the first agent/tool-call anchor — is dropped wholesale,
   *      even if intermediate thinking/meta anchors split it into
   *      multiple sub-gaps. Long model reasoning before the first reply
   *      is composing, not idle. (User→user gaps still register as
   *      between-turn idle because no agent activity occurred between.)
   *
   *  Side effect: the leading warm-up gap before the first agent response
   *  drops out unless it crosses the idle threshold — which the first 6s in a
   *  typical Codex session does not. */
  const rawIdleBands = useMemo(() => {
    // Anchor on ANY timestamped event so agent-thinking, meta, and other
    // intra-turn signals prove the parent is doing work. Only what we
    // need to distinguish is "user" (turn boundary) vs everything else.
    const isUserRole = (role: string) => role === "user";
    // Two thresholds, because an in-turn pause and a between-turn pause mean
    // different things. MID-TURN the agent is actively working — a long Bash,
    // a build, model thinking between tool calls — so a 30s–2min gap is NOT
    // idle; only a genuine multi-minute stall is. We match the parser's
    // active-segment gap (3 min) there. BETWEEN turns the user has actually
    // stepped away, so a lower bar is right. The old single 30s threshold drew
    // every tool-call pause as a "Session idle" sliver, shredding a long turn
    // into dozens of fragments and clipping the turn's minimap block at the
    // first sliver (so the block stopped short of a workflow that ran inside it).
    const IN_TURN_IDLE_MS = 180_000;
    const BETWEEN_TURN_IDLE_MS = 120_000;
    const anchors: { ms: number; role: string }[] = [];
    for (const e of events) {
      if (!e.timestamp) continue;
      const ms = Date.parse(e.timestamp);
      if (!Number.isFinite(ms)) continue;
      anchors.push({ ms, role: e.role });
    }
    if (anchors.length < 2) return [];
    anchors.sort((a, b) => a.ms - b.ms);
    // anchors[0].ms (sorted ascending) is the global-min timestamp — exactly the
    // origin the parser measures tOffsetMs from (tOffsetMs = ms - min(all ts)), so
    // band offsets (anchor.ms - sessionStartMs) land in the SAME space as the day
    // window. The old `- firstInFile.tOffsetMs` term subtracted a DIFFERENT event's
    // offset when the JSONL starts out of chronological order, skewing every band
    // by their gap and leaking the between-day idle past the minimap's strict
    // day-window edge filter (a ~40h "Session idle" band dominating the day view).
    const sessionStartMs = anchors[0]!.ms;

    // "Busy" spans = delegated agent work that means the parent isn't idle:
    // subagent runs AND dynamic-workflow execution. Both are carved out of the
    // idle bands so a long Workflow run (during which the parent just waits)
    // reads as active agent time, not dead air. A still-running workflow has
    // no end offset yet — extend it to the last anchor.
    const lastAnchorOff = anchors[anchors.length - 1]!.ms - sessionStartMs;
    const busySpans = [
      ...(session.subagents ?? [])
        .filter((s) => s.startTOffsetMs !== undefined && s.endTOffsetMs !== undefined)
        .map((s) => ({ start: s.startTOffsetMs as number, end: s.endTOffsetMs as number })),
      ...(session.workflows ?? [])
        .filter((w) => w.startTOffsetMs !== undefined)
        .map((w) => ({
          start: w.startTOffsetMs as number,
          end: (w.endTOffsetMs ?? lastAnchorOff) as number,
        })),
    ].sort((a, b) => a.start - b.start);

    /** Subtract subagent spans from [start, end] in offset coordinates,
     *  returning 0+ remaining slices in time order. */
    const carveOutSubagents = (
      start: number,
      end: number,
    ): { start: number; end: number }[] => {
      let pieces: { start: number; end: number }[] = [{ start, end }];
      for (const span of busySpans) {
        if (span.end <= start) continue;
        if (span.start >= end) break;
        const next: { start: number; end: number }[] = [];
        for (const p of pieces) {
          if (span.end <= p.start || span.start >= p.end) {
            next.push(p);
            continue;
          }
          if (span.start > p.start) next.push({ start: p.start, end: span.start });
          if (span.end < p.end) next.push({ start: span.end, end: p.end });
        }
        pieces = next;
      }
      return pieces;
    };

    const overlapsSubagent = (start: number, end: number): boolean => {
      for (const span of busySpans) {
        if (span.end <= start) continue;
        // busySpans is sorted by start, so once span.start >= end no
        // later span can overlap [start, end] either — bail out cleanly.
        if (span.start >= end) return false;
        return true;
      }
      return false;
    };

    type Band = { start: number; end: number; durationMs: number };
    const bands: Band[] = [];

    // "Awaiting first response" — true after a user message, false once an
    // agent or tool-call anchor proves the model started replying.
    // Thinking and meta events don't clear it, so a user→thinking→agent
    // sequence where thinking→agent crosses the idle threshold still reads as
    // response latency rather than idle.
    let awaitingFirstResponse = false;
    if (anchors[0]) {
      if (isUserRole(anchors[0].role)) awaitingFirstResponse = true;
    }

    for (let i = 1; i < anchors.length; i++) {
      const rawGap = anchors[i]!.ms - anchors[i - 1]!.ms;
      const curRole = anchors[i]!.role;
      // Snapshot the phase BEFORE updating, so the gap is classified by
      // the state at its start (anchors[i-1]).
      const skipAsLatency = awaitingFirstResponse && !isUserRole(curRole);

      if (isUserRole(curRole)) awaitingFirstResponse = true;
      else if (curRole === "agent" || curRole === "tool-call") awaitingFirstResponse = false;

      const betweenTurn = isUserRole(curRole);
      if (rawGap <= (betweenTurn ? BETWEEN_TURN_IDLE_MS : IN_TURN_IDLE_MS)) continue;
      if (skipAsLatency) continue;

      const gStart = anchors[i - 1]!.ms - sessionStartMs;
      const gEnd = anchors[i]!.ms - sessionStartMs;

      if (!betweenTurn) {
        // In-turn gap: the parent is mid-turn. If any subagent run overlaps,
        // the parent is waiting on delegated work — not idle. Drop the
        // whole gap rather than carving out startup/teardown slivers that
        // would clutter the minimap with thin stripes. Gaps with no
        // subagent overlap (a genuine multi-minute stall) emit as one band.
        if (overlapsSubagent(gStart, gEnd)) continue;
        bands.push({ start: gStart, end: gEnd, durationMs: gEnd - gStart });
        continue;
      }

      // Between-turn gap: user walked away. Carve out background subagent
      // activity so only the genuinely-unwatched portion counts as idle.
      // Each surviving slice becomes its own band.
      for (const slice of carveOutSubagents(gStart, gEnd)) {
        const dur = slice.end - slice.start;
        if (dur > BETWEEN_TURN_IDLE_MS) {
          bands.push({ start: slice.start, end: slice.end, durationMs: dur });
        }
      }
    }

    bands.sort((a, b) => a.start - b.start);
    return bands;
  }, [events, session.subagents, session.workflows]);

  const coldResumeMarkers = useMemo(() => {
    const seen = new Set<string>();
    const out: {
      tOffsetMs: number;
      info: NonNullable<SessionEvent["coldResume"]>;
    }[] = [];
    for (const e of events) {
      if (!e.coldResume || !e.messageId || e.tOffsetMs === undefined) continue;
      if (seen.has(e.messageId)) continue;
      seen.add(e.messageId);
      out.push({ tOffsetMs: e.tOffsetMs, info: e.coldResume });
    }
    return out;
  }, [events]);

  /** Local-day buckets the session spans, in event order. Each day's
   *  `startMs`/`endMs` are tOffsetMs bounds (offset from session start) so
   *  they plug straight into the minimap's offset coordinate space. Keys are
   *  derived as literal `YYYY-MM-DD` from local date parts so SSR and client
   *  agree (no locale/Date formatting that could drift across the hydration
   *  boundary). Long multi-day sessions use this to scope the minimap to one
   *  day at a time instead of squashing days into a single bar. */
  const sessionDays = useMemo(() => {
    const byDay = new Map<string, { startMs: number; endMs: number; count: number }>();
    for (const e of events) {
      if (e.tOffsetMs === undefined || !e.timestamp) continue;
      const ms = Date.parse(e.timestamp);
      if (!Number.isFinite(ms)) continue;
      const d = new Date(ms);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const cur = byDay.get(key);
      if (!cur) byDay.set(key, { startMs: e.tOffsetMs, endMs: e.tOffsetMs, count: 1 });
      else {
        cur.startMs = Math.min(cur.startMs, e.tOffsetMs);
        cur.endMs = Math.max(cur.endMs, e.tOffsetMs);
        cur.count += 1;
      }
    }
    return [...byDay.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => a.startMs - b.startMs);
  }, [events]);

  /** local_day → per-day digest card. `entry.local_day` and `sessionDays` keys
   *  are both built from local-time getFullYear/Month/Date (see parser's
   *  toLocalDay), so the strings match exactly and the card lands on the right
   *  day's first transcript row. */
  const entryByDay = useMemo(() => {
    const m = new Map<string, Entry>();
    for (const e of entries) m.set(e.local_day, e);
    return m;
  }, [entries]);

  // Selected timeline day. Defaults to the LAST (most recent) active day so a
  // long, multi-day transcript opens where the action is rather than at the
  // top of an old day; the initial-jump effect below scrolls there instantly,
  // and the day then follows the scroll position as the user reads in either
  // direction (see followDayToScroll). The lazy initializer runs identically on
  // server + client (sessionDays is deterministic), so there's no hydration
  // mismatch; the effect re-pins it when the component is reused across
  // /sessions/[id] navigations. "all" shows the full session.
  const didInitialDayJump = useRef(false);
  // A `?day=YYYY-MM-DD` query param (set by links from the Day / Concurrency
  // views) pins the opening day to that day instead of the most recent one.
  // Validated against the session's real day buckets and ignored if it doesn't
  // match. Read in effects (not the lazy initializer) so SSR and the first
  // client render agree — the param-driven selection happens client-side.
  const wantedDayFromUrl = (days: typeof sessionDays): string | null => {
    if (typeof window === "undefined") return null;
    const w = new URLSearchParams(window.location.search).get("day");
    return w && days.some((d) => d.key === w) ? w : null;
  };
  const lastOrAll = (days: typeof sessionDays) =>
    days.length ? days[days.length - 1]!.key : "all";
  const [selectedDayKey, setSelectedDayKey] = useState<string>(
    () => lastOrAll(sessionDays),
  );
  useEffect(() => {
    setSelectedDayKey(wantedDayFromUrl(sessionDays) ?? lastOrAll(sessionDays));
    didInitialDayJump.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sessionId]);

  const dayIndex = sessionDays.findIndex((d) => d.key === selectedDayKey);
  // Latest sessionDays, read by the initial-jump effect so it doesn't re-run on
  // every render. On LIVE sessions SSE router.refresh() rebuilds sessionDays each
  // tick; reading it via ref keeps the once-per-session jump from re-firing.
  const sessionDaysRef = useRef(sessionDays);
  sessionDaysRef.current = sessionDays;
  // Read by followDayToScroll (the scroll→day follower) without stale closure.
  const selectedDayKeyRef = useRef(selectedDayKey);
  selectedDayKeyRef.current = selectedDayKey;

  // Initial jump: on first paint of a multi-day session, snap straight to the
  // requested day (?day=) or, by default, the most recent one (the lazy
  // selectedDayKey is the last day; the re-pin effect above re-points it to the
  // requested day client-side, so the minimap matches). Routed through gotoDay
  // rather than scrolling to the day's
  // strip directly: in "turns" mode the most recent day can be absorbed into a
  // turn anchored on an earlier day and so have NO inline strip — gotoDay finds
  // the day's first event, expands its turn, and falls back to the row ref, so
  // it lands reliably either way. Single-day sessions stay at the top. Runs once
  // per session; the re-pin effect above clears didInitialDayJump on nav.
  //
  // SKIPPED for live sessions: their destination is the live tail, which
  // TailMode scrolls to on mount. Jumping to the most-recent-day's TOP would
  // scroll the view UP, and that programmatic scroll trips TailMode's scroll-up
  // detector (check()) into turning live-follow off — and it would race
  // TailMode's own mount scroll. followDayToScroll still keeps the minimap on
  // the last day, since the tail sits there.
  useEffect(() => {
    if (tab !== "transcript" || didInitialDayJump.current) return;
    const days = sessionDaysRef.current;
    if (days.length <= 1) {
      didInitialDayJump.current = true;
      return;
    }
    const wanted = wantedDayFromUrl(days);
    // Live tail: let TailMode land on the live tail unless an explicit EARLIER
    // day was requested (?day=). A request for the live/last day needs no jump
    // — the tail is already in it — and jumping would fight TailMode's mount
    // scroll and flip live-follow off.
    if (isSessionLive && (!wanted || wanted === days[days.length - 1]!.key)) {
      didInitialDayJump.current = true;
      return;
    }
    didInitialDayJump.current = true;
    gotoDay(wanted ?? days[days.length - 1]!.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sessionDays]);

  // The displayed day is a single function of scroll position. The Minimap
  // reports the offset (ms) of the topmost on-screen row — the SAME signal it
  // draws the playhead from — and we select that row's day. Display only: this
  // never scrolls the transcript. Navigation (gotoDay / the inline day-boundary
  // buttons) moves the scroll, and the day then follows this one signal, so
  // there's no second writer that could revert a day-jump. (The old scroll-spy
  // used a separate pixel heuristic that disagreed with where nav scrolled to,
  // which is what made "next day" snap back.) The tailNavLock guard lets an
  // explicit jump's scroll settle first, and the key-unchanged no-op keeps a
  // LIVE session's SSE refreshes from churning the selection.
  function followDayToScroll(ms: number | null) {
    if (ms === null) return;
    if (Date.now() - tailNavLockRef.current < 1500) return;
    const days = sessionDaysRef.current;
    if (days.length <= 1) return;
    const cur = selectedDayKeyRef.current;
    if (cur === "all") return; // respect an explicit "show all days" choice
    // Days are sorted by startMs; the last one starting at/below ms is the
    // containing day (and tolerates the overnight gap between days).
    let hit = days[0]!;
    for (const d of days) {
      if (ms >= d.startMs) hit = d;
      else break;
    }
    if (hit.key !== cur) setSelectedDayKey(hit.key);
  }

  /** Offset window for the selected day, or null when there's a single day
   *  or "all" is chosen — null tells the minimap to render the full session
   *  exactly as before (no regression for single-day sessions). */
  const dayWindow = useMemo(() => {
    if (sessionDays.length <= 1 || selectedDayKey === "all") return null;
    const d = sessionDays.find((x) => x.key === selectedDayKey);
    return d ? { startMs: d.startMs, endMs: d.endMs } : null;
  }, [sessionDays, selectedDayKey]);

  /** Build the full presentation stream once. */
  const allRows = useMemo(() => buildPresentation(visibleEvents), [visibleEvents]);

  /** Collapse the presentation stream into conversational turns (user →
   *  agent loop → next user). Used by the "turns" filter mode. */
  const megaRows = useMemo(() => buildMegaRows(allRows), [allRows]);

  /** Lookup: row primary index → containing turn's primary index.
   *  Used when a mini-map click targets a row inside a collapsed turn —
   *  we auto-expand that turn before scrolling. */
  const turnByRowIndex = useMemo(() => {
    const map = new Map<number, number>();
    for (const m of megaRows) {
      if (m.kind !== "turn") continue;
      for (const r of m.rows) {
        map.set(rowPrimaryIndex(r), m.firstPrimaryIndex);
      }
    }
    return map;
  }, [megaRows]);

  /** Flat list of display items the TranscriptList iterates over.
   *  Three modes:
   *    - "turns"  → megaRows, expanded via expandedTurns set
   *    - "all"    → raw events (debug fallback)
   *    - other    → filtered flat presentation rows
   */
  const displayRows: DisplayRow[] = useMemo(() => {
    if (filter === "turns") {
      return flattenMegaRows(megaRows, expandedTurns);
    }
    if (filter === "all")
      return allRowsAsRawRows(visibleEvents).map((r) => ({
        kind: "presentation",
        row: r,
      }));
    if (filter === "meaningful") return allRows.map((r) => ({ kind: "presentation", row: r }));
    return allRows
      .filter((r) => {
        if (filter === "agent") return r.kind === "agent";
        if (filter === "tool-group") return r.kind === "tool-group";
        return r.kind === filter;
      })
      .map((r) => ({ kind: "presentation", row: r }));
  }, [filter, megaRows, expandedTurns, allRows, visibleEvents]);

  const selectedEvent =
    selectedIndex !== null
      ? (visibleEvents.find((e) => e.index === selectedIndex) ?? null)
      : null;
  const selectedRow =
    selectedIndex !== null
      ? (allRows.find((r) => rowPrimaryIndex(r) === selectedIndex) ?? null)
      : null;

  function toggleTurn(firstPrimaryIndex: number) {
    setExpandedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(firstPrimaryIndex)) next.delete(firstPrimaryIndex);
      else next.add(firstPrimaryIndex);
      return next;
    });
  }

  function scrollToIndex(index: number) {
    // If we're in turns mode and the target row is inside a collapsed
    // turn, expand that turn first so the row actually exists in the DOM
    // before the scroll effect runs.
    if (filter === "turns") {
      const turnIdx = turnByRowIndex.get(index);
      if (turnIdx !== undefined && !expandedTurns.has(turnIdx)) {
        setExpandedTurns((prev) => new Set(prev).add(turnIdx));
      }
    }
    setSelectedIndex(index);
    // Bump the intent counter so the useEffect always fires — even if the
    // same row is clicked twice (same selectedIndex ≠ new effect otherwise).
    setScrollIntent((n) => n + 1);
  }

  /** Switch the minimap to a given day (or "all"). Also scrolls the transcript
   *  to that day's first row so "jump to a day" navigates the body too. Called
   *  on user day-picks and once on mount by the initial-jump effect (for non-live
   *  multi-day sessions, to open on the most recent day). */
  function gotoDay(key: string) {
    setSelectedDayKey(key);
    tailNavLockRef.current = Date.now();
    // Paging days scrolls the transcript; that programmatic scroll (often
    // upward to an earlier day's first row) would otherwise read as a
    // user scroll-up and pop the sticky header open. Force it collapsed and
    // pin so the scroll listener leaves it alone — day-nav always stays
    // collapsed.
    setCollapsed(true);
    manualPinRef.current = Date.now();
    if (key === "all") return;
    const d = sessionDays.find((x) => x.key === key);
    if (!d) return;
    // Target the day's first PRESENTATION ROW, not its first raw event. A day can
    // open on a meta/system/sidechain event that has no row, whose index then
    // lands in neither turnByRowIndex nor rowRefs — so the jump silently no-ops
    // (the bug where a multi-day session opened stuck at the very top). A row's
    // primary index is the coordinate both that map and the scroll refs use.
    let firstRow = allRows.find(
      (r) => r.tOffsetMs !== undefined && r.tOffsetMs >= d.startMs,
    );
    // A day can consist entirely of background-agent / workflow events, which
    // render in the Workflows tab — not the transcript — so NO presentation row
    // falls inside it (sessionDays is built from all events, allRows only from
    // the visible transcript). Fall back to the last rendered row so the jump
    // lands on the closest content instead of silently no-oping (the bug where
    // the view stayed pinned at the very top).
    if (!firstRow) {
      for (let i = allRows.length - 1; i >= 0; i--) {
        if (allRows[i]!.tOffsetMs !== undefined) {
          firstRow = allRows[i];
          break;
        }
      }
    }
    if (!firstRow) return;
    const targetIndex = rowPrimaryIndex(firstRow);
    // In turns mode that row may be inside a collapsed turn (often one anchored
    // on the PREVIOUS day) — expand it so the row exists in the DOM before the
    // scroll effect runs.
    if (filter === "turns") {
      const turnIdx = turnByRowIndex.get(targetIndex);
      if (turnIdx !== undefined && !expandedTurns.has(turnIdx)) {
        setExpandedTurns((prev) => new Set(prev).add(turnIdx));
      }
    }
    setDayScrollTarget((prev) => ({ index: targetIndex, key, block: "start", n: (prev?.n ?? 0) + 1 }));
  }

  /** Cross-day hop used by the inline day-boundary buttons. Selecting a day can
   *  differ from where we scroll: "go to end of previous day" selects the
   *  previous day but scrolls the CURRENT day's strip to the viewport bottom
   *  (block:"end"), revealing the previous day's tail above it. "go to start of
   *  next day" selects + scrolls to that day's strip (block:"start"). */
  function jumpAcrossDay(
    selectKey: string,
    scrollKey: string,
    block: "start" | "end",
    fallbackIndex: number,
  ) {
    setSelectedDayKey(selectKey);
    setCollapsed(true);
    manualPinRef.current = Date.now();
    tailNavLockRef.current = Date.now();
    // The fallback row may live inside a collapsed turn — expand it so the
    // element exists if the strip ref is unavailable.
    if (filter === "turns") {
      const turnIdx = turnByRowIndex.get(fallbackIndex);
      if (turnIdx !== undefined && !expandedTurns.has(turnIdx)) {
        setExpandedTurns((prev) => new Set(prev).add(turnIdx));
      }
    }
    setDayScrollTarget((prev) => ({
      index: fallbackIndex,
      key: scrollKey,
      block,
      n: (prev?.n ?? 0) + 1,
    }));
  }

  /** Scroll the transcript to the row whose assistant message issued a given
   *  tool_use id. Used by workflow cards / lanes to jump to the originating
   *  Workflow tool call. */
  function jumpToToolUse(toolUseId?: string) {
    if (!toolUseId) return;
    const ev = events.find((e) =>
      e.blocks.some((b) => b?.type === "tool_use" && b.id === toolUseId),
    );
    if (ev) {
      setSelectedSubagentId(null);
      // The Workflow row lives in the transcript — switch there first (e.g.
      // when jumping from the Workflows tab) so the scroll target exists.
      if (tab !== "transcript") setTab("transcript");
      scrollToIndex(ev.index);
    }
  }

  const totalInput = totalUsage.input + totalUsage.cacheRead + totalUsage.cacheWrite;

  return (
    <div style={{ padding: 0 }}>
      {/* ============================ STICKY HEADER ============================ */}
      <div
        ref={headerRef}
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          background: "var(--background)",
          borderBottom: "1px solid var(--af-border-subtle)",
          padding: "18px 40px 0",
        }}
      >
        {/* Always-visible compact bar: breadcrumb + tabs + toggle — stays
            accessible even when the header body is collapsed on scroll. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: collapsed ? 6 : 6,
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: "var(--af-text-tertiary)",
              whiteSpace: "nowrap",
            }}
          >
            <Link
              href="/sessions"
              style={{
                color: "var(--af-text-tertiary)",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <ArrowLeft size={12} /> Sessions
            </Link>
            <span style={{ margin: "0 8px" }}>/</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>sesn_{shortId(session.id)}</span>
            {teamLead && (
              <>
                <span style={{ margin: "0 8px" }}>·</span>
                <Link
                  href={`/sessions/${teamLead.leadSessionId}#team`}
                  style={{
                    color: "var(--af-accent)",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontWeight: 500,
                  }}
                  title={`View team lead for ${teamLead.teamName}`}
                >
                  {teamLead.agentName} in {teamLead.teamName} ↗
                </Link>
              </>
            )}
          </div>
          <div className="af-tabs" style={{ flexShrink: 0, marginLeft: "auto" }}>
            <button
              className={`af-tab-btn ${tab === "transcript" ? "active" : ""}`}
              onClick={() => setTab("transcript")}
            >
              Timeline
            </button>
            {hasWorkflows && (
              <button
                className={`af-tab-btn ${tab === "workflows" ? "active" : ""}`}
                onClick={() => setTab("workflows")}
              >
                Workflows
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "1px 6px",
                    borderRadius: 100,
                    background: "rgba(234,88,12,0.16)",
                    color: "#EA580C",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {workflowCount}
                </span>
              </button>
            )}
            {team && (
              <button
                className={`af-tab-btn ${tab === "team" ? "active" : ""}`}
                onClick={() => setTab("team")}
              >
                Team
              </button>
            )}
            <button
              className={`af-tab-btn ${tab === "debug" ? "active" : ""}`}
              onClick={() => setTab("debug")}
            >
              Log
            </button>
          </div>
          <button
            onClick={toggleCollapsed}
            title={collapsed ? "Show session details" : "Hide session details"}
            style={{
              background: "var(--af-surface-hover)",
              border: "1px solid var(--af-border-subtle)",
              borderRadius: 4,
              width: 24,
              height: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "var(--af-text-secondary)",
              flexShrink: 0,
              transition: "transform 0.2s ease",
              transform: collapsed ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            <ChevronUp size={14} />
          </button>
        </div>

        {/* Collapsible block — title + meta-stats + filter toolbar.
            Hidden on scroll-down so the minimap gets more space. */}
        <div
          style={{
            maxHeight: collapsed ? 0 : 500,
            opacity: collapsed ? 0 : 1,
            overflow: "hidden",
            transition:
              "max-height 0.24s ease, opacity 0.18s ease, margin-bottom 0.24s ease",
            marginBottom: collapsed ? 0 : 0,
            pointerEvents: collapsed ? "none" : "auto",
          }}
        >

        {/* Single-line compact header — title + inline dot-separated stats */}
        <div
          className="flex items-baseline"
          style={{
            gap: 10,
            marginBottom: 10,
            flexWrap: "wrap",
          }}
        >
          <h1
            style={{
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              fontFamily: "var(--font-mono)",
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            sesn_{session.id.replace(/-/g, "").slice(0, 22)}
          </h1>
          <LiveBadge mtimeIso={session.lastTimestamp} activityMs={session.lastActivityMs} size="md" />
          <span
            style={{
              fontSize: 10.5,
              padding: "2px 9px",
              borderRadius: 100,
              background: "var(--af-border-subtle)",
              color: "var(--af-text-secondary)",
              fontWeight: 500,
              position: "relative",
              top: -1,
            }}
          >
            {isSessionLive ? "Running" : "Idle"}
          </span>
          <InlineStatDivider />
          {model && <InlineStat icon={<Cpu size={12} />} value={model} mono />}
          {session.entrypoint && (
            <>
              <InlineStatDivider />
              <EntrypointBadge entrypoint={session.entrypoint} />
            </>
          )}
          <InlineStatDivider />
          <InlineStat icon={<Folder size={12} />} value={projectName} truncate />
          <InlineStatDivider />
          {airTimeMs !== undefined && (
            <InlineStat
              icon={<Clock size={12} />}
              value={formatDurationHeader(airTimeMs)}
            />
          )}
          <InlineStatDivider />
          <InlineTokenStat usage={totalUsage} />
          {session.coldResumeCount !== undefined &&
            session.coldResumeCount > 0 &&
            session.cacheRebuildTokens !== undefined && (
              <>
                <InlineStatDivider />
                <ColdResumeSessionStat
                  count={session.coldResumeCount}
                  writeTokens={session.cacheRebuildTokens}
                  model={model}
                />
              </>
            )}
          <InlineStatDivider />
          <InlineStat value={`${eventCount} events`} />
          {(session.workflowCount ?? 0) > 0 && (
            <>
              <InlineStatDivider />
              <InlineStat
                icon={<WorkflowIcon size={12} />}
                value={`${session.workflowCount} workflow${session.workflowCount === 1 ? "" : "s"} · ${(session.spawnedAgentCount ?? 0).toLocaleString()} agents`}
              />
            </>
          )}
          {prMarkers.length > 0 && (
            <>
              <InlineStatDivider />
              <InlineStat
                icon={<GitPullRequest size={12} />}
                value={
                  prMarkers.length === 1
                    ? prMarkers[0].title
                      ? `PR${prMarkers[0].prNumber ? ` #${prMarkers[0].prNumber}` : ""}: ${prMarkers[0].title}`
                      : prMarkers[0].prNumber
                        ? `PR #${prMarkers[0].prNumber}`
                        : "1 PR shipped"
                    : `${prMarkers.length} PRs shipped`
                }
                truncate
              />
            </>
          )}
          <span style={{ marginLeft: "auto" }}>
            {session.firstTimestamp && (
              <span
                style={{
                  fontSize: 11.5,
                  color: "var(--af-text-tertiary)",
                }}
                suppressHydrationWarning
              >
                {formatRelative(session.firstTimestamp)}
              </span>
            )}
          </span>
        </div>

        {/* Toolbar (filter, copy, ask) */}
        <div
          className="flex items-center"
          style={{
            gap: 14,
            paddingBottom: 8,
          }}
        >
          <select
            value={filter}
            onChange={(e) =>
              setFilter(e.target.value as "meaningful" | "all" | PresentationRowKind)
            }
            className="sl-compact-select"
          >
            {FILTER_MODES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>

          <span
            style={{
              marginLeft: "auto",
              fontSize: 12,
              color: "var(--af-text-tertiary)",
            }}
          >
            {filter === "turns"
              ? `${megaRows.filter((m) => m.kind === "turn").length} turns · ${allRows.length} actions`
              : filter === "meaningful"
                ? `${allRows.length} rows (of ${visibleEvents.length} raw events)`
                : `${displayRows.length} rows`}
          </span>

          <button
            title="Copy all"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--af-text-secondary)",
              fontSize: 12,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
            onClick={() => {
              const text = allRows.map((r) => `[${r.kind}] ${rowPreview(r)}`).join("\n");
              navigator.clipboard?.writeText(text);
            }}
          >
            <Copy size={12} /> Copy all
          </button>
          <AskButton
            onClick={() => {
              setAskOpen((p) => !p);
              setSelectedIndex(null);
              setSelectedSubagentId(null);
            }}
          />
        </div>
        </div>{/* /collapsible top block */}

        {/* Mini-map — adapts to whatever the transcript list is currently
            showing. In "Turns" mode a collapsed turn becomes ONE wide block
            spanning its duration. In flat modes, each row is atomic. The
            `subagents` prop adds parallel lanes below the main timeline,
            one bar per subagent run, positioned at the same x-scale.
            This strip stays visible even when the header is collapsed. */}
        <div
          style={{
            paddingBottom: collapsed ? 10 : 0,
            transition: "padding-bottom 0.2s ease",
          }}
        >
        {/* Day navigator — only for multi-day sessions on the non-team
            minimap. Lets you step the timeline through each local day (default
            = the most recent) so a long-running session reads one day at a
            time instead of squashed into one bar. */}
        {tab !== "team" && sessionDays.length > 1 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 6,
              fontSize: 12,
              color: "var(--af-text-secondary)",
            }}
          >
            <span style={{ color: "var(--af-text-tertiary)" }}>Timeline day</span>
            <button
              type="button"
              title="Previous day"
              aria-label="Previous day"
              onClick={() => dayIndex > 0 && gotoDay(sessionDays[dayIndex - 1]!.key)}
              disabled={selectedDayKey === "all" || dayIndex <= 0}
              className="sl-day-nav-btn"
            >
              <ChevronLeft size={13} />
            </button>
            <select
              value={selectedDayKey}
              onChange={(e) => gotoDay(e.target.value)}
              className="sl-compact-select"
            >
              {sessionDays.map((d, i) => (
                <option key={d.key} value={d.key}>
                  {formatDayKey(d.key)} · {d.count} event{d.count === 1 ? "" : "s"} (day {i + 1}/{sessionDays.length})
                </option>
              ))}
              <option value="all">All days ({sessionDays.length})</option>
            </select>
            <button
              type="button"
              title="Next day"
              aria-label="Next day"
              onClick={() =>
                dayIndex >= 0 && dayIndex < sessionDays.length - 1 && gotoDay(sessionDays[dayIndex + 1]!.key)
              }
              disabled={selectedDayKey === "all" || dayIndex < 0 || dayIndex >= sessionDays.length - 1}
              className="sl-day-nav-btn"
            >
              <ChevronRight size={13} />
            </button>
            <span style={{ color: "var(--af-text-tertiary)", marginLeft: 2 }}>
              {selectedDayKey === "all"
                ? `showing all ${sessionDays.length} days`
                : `day ${dayIndex + 1} of ${sessionDays.length}`}
            </span>
          </div>
        )}
        {tab === "team" && team ? (
          <TeamMinimap
            data={team}
            playheadMs={teamPlayheadMs}
            onSeek={(tsMs, trackId) => {
              setTeamSeekTarget({ tsMs, trackId });
              if (teamExpanded) setTeamExpanded(false);
            }}
            expanded={teamExpanded}
            onToggleExpanded={() => setTeamExpanded((v) => !v)}
            visibleTrackIds={teamVisibleTrackIds}
          />
        ) : (
          <Minimap
            displayRows={displayRows}
            durationMs={durationMs ?? 0}
            dayWindow={dayWindow}
            selectedIndex={selectedIndex}
            onSelect={scrollToIndex}
            headerOffset={headerH}
            subagents={session.subagents}
            workflows={session.workflows}
            onWorkflowClick={(runId) => {
              setSelectedWorkflowId(runId);
              setTab("workflows");
            }}
            prMarkers={prMarkers}
            coldResumeMarkers={coldResumeMarkers}
            rawIdleBands={rawIdleBands}
            model={model}
            selectedSubagentId={selectedSubagentId}
            onSelectSubagent={(id) => {
              setSelectedSubagentId(id);
              // Close the event drawer so we don't have two drawers fighting
              // for the same right-side real estate.
              if (id) setSelectedIndex(null);
            }}
            onPlayheadChange={followDayToScroll}
          />
        )}
        </div>
      </div>

      {/* ============================ CONTENT ============================ */}
      {/* Transcript is in normal flow; when the drawer is open we reserve
          DRAWER_WIDTH on the right so rows don't slide under it. */}
      <div
        style={{
          padding: "0 40px",
          paddingRight: selectedEvent ? DRAWER_WIDTH + 24 : 40,
          paddingTop: 8,
          transition: "padding-right 0.15s ease",
        }}
      >
        {tab === "team" && team ? (
          <TeamTabClient
            initial={team}
            teamName={team.teamName}
            playheadMs={teamPlayheadMs}
            onPlayheadChange={setTeamPlayheadMs}
            onVisibleTrackIdsChange={setTeamVisibleTrackIds}
            seekTarget={teamSeekTarget}
          />
        ) : tab === "workflows" && hasWorkflows ? (
          <div style={{ paddingBottom: 24 }}>
            <WorkflowsPanel
              workflows={session.workflows!}
              spawnedAgentCount={session.spawnedAgentCount ?? 0}
              focusRunId={selectedWorkflowId}
              selectedAgentKey={
                selectedWorkflowAgent
                  ? `${selectedWorkflowAgent.runId}:${selectedWorkflowAgent.agent.agentId ?? selectedWorkflowAgent.agent.index}`
                  : null
              }
              onOpenAgent={(runId, agent) =>
                setSelectedWorkflowAgent((cur) =>
                  cur && cur.runId === runId && cur.agent.index === agent.index
                    ? null
                    : { runId, agent },
                )
              }
              onJumpToParent={jumpToToolUse}
              onClearFocus={() => setSelectedWorkflowId(null)}
            />
          </div>
        ) : tab === "debug" ? (
          <DebugList events={events} />
        ) : (
          <>
            {teammateCount > 0 && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--af-text-tertiary, #888)",
                  background: "var(--af-surface-subtle, rgba(255,255,255,0.04))",
                  border: "1px solid var(--af-border-subtle, rgba(255,255,255,0.08))",
                  borderRadius: 6,
                  padding: "6px 10px",
                  marginBottom: 8,
                }}
              >
                {teammateCount} inbound team message
                {teammateCount === 1 ? "" : "s"} hidden —{" "}
                <button
                  onClick={() => setTab("team")}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--af-accent)",
                    cursor: "pointer",
                    padding: 0,
                    font: "inherit",
                    textDecoration: "underline",
                  }}
                >
                  open the Team tab
                </button>{" "}
                to see them.
              </div>
            )}
            <TranscriptList
              displayRows={displayRows}
              rowRefs={rowRefs}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
              onToggleTurn={toggleTurn}
              stickyOffset={headerH + 16}
              isSessionLive={isSessionLive}
              team={team}
              model={model}
              rawIdleBands={rawIdleBands}
              sessionDays={sessionDays}
              entryByDay={entryByDay}
              dayStripRefs={dayStripRefs}
              onJumpAcrossDay={jumpAcrossDay}
            />
          </>
        )}
      </div>

      {/* Drawer — position: fixed, anchored to the viewport so it's
          independent of the main scroll container, grid cells, or any
          calc() height math. Top is measured from the sticky header via
          ResizeObserver so it tracks header size changes automatically. */}
      {selectedEvent && (
        <aside
          style={{
            position: "fixed",
            top: headerH,
            right: 0,
            bottom: 0,
            width: DRAWER_WIDTH,
            borderLeft: "1px solid var(--af-border-subtle)",
            background: "var(--af-surface)",
            overflowY: "auto",
            zIndex: 25,
            boxShadow: "-8px 0 24px rgba(15, 23, 42, 0.05)",
          }}
        >
          <Drawer event={selectedEvent} row={selectedRow} onClose={() => setSelectedIndex(null)} />
        </aside>
      )}

      {/* Sub-agent detail drawer — opens when the user clicks a lane
          bar on the mini-map. Shows the full prompt the parent sent,
          timing + token breakdown, tool call counts, and the final
          agent text. Clicking "Jump to parent" scrolls the transcript
          to the Agent tool_use row that dispatched this subagent. */}
      {(() => {
        const sub = selectedSubagentId
          ? session.subagents?.find((s) => s.agentId === selectedSubagentId)
          : undefined;
        if (!sub) return null;
        return (
          <aside
            style={{
              position: "fixed",
              top: headerH,
              right: 0,
              bottom: 0,
              width: DRAWER_WIDTH,
              borderLeft: "1px solid var(--af-border-subtle)",
              background: "var(--af-surface)",
              overflowY: "auto",
              zIndex: 26,
              boxShadow: "-8px 0 24px rgba(15, 23, 42, 0.08)",
            }}
          >
            <SubagentDrawer
              subagent={sub}
              onClose={() => setSelectedSubagentId(null)}
              onJumpToParent={() => {
                // Find the parent Agent tool-call row by its toolUseId and
                // scroll the transcript to it.
                if (!sub.parentToolUseId) return;
                const parentEvent = events.find((e) =>
                  e.blocks.some(
                    (b) =>
                      b?.type === "tool_use" &&
                      b.name === "Agent" &&
                      b.id === sub.parentToolUseId,
                  ),
                );
                if (parentEvent) {
                  setSelectedSubagentId(null);
                  scrollToIndex(parentEvent.index);
                }
              }}
            />
          </aside>
        );
      })()}

      {/* Workflow-agent step log — opens as a right side-sheet so the full
          (often 100+ step) transcript doesn't make the Workflows tab huge. */}
      {selectedWorkflowAgent && (
        <aside
          style={{
            position: "fixed",
            top: headerH,
            right: 0,
            bottom: 0,
            width: WF_AGENT_DRAWER_WIDTH,
            maxWidth: "100vw",
            borderLeft: "1px solid var(--af-border-subtle)",
            background: "var(--af-surface)",
            overflowY: "auto",
            zIndex: 28,
            boxShadow: "-8px 0 24px rgba(15, 23, 42, 0.1)",
          }}
        >
          <WorkflowAgentDrawer
            sessionId={session.id}
            runId={selectedWorkflowAgent.runId}
            agent={selectedWorkflowAgent.agent}
            onClose={() => setSelectedWorkflowAgent(null)}
          />
        </aside>
      )}

      {/* Ask drawer */}
      {askOpen && (
        <aside
          style={{
            position: "fixed",
            top: headerH,
            right: 0,
            bottom: 0,
            width: DRAWER_WIDTH,
            borderLeft: "1px solid var(--af-border-subtle)",
            background: "var(--af-surface)",
            zIndex: 27,
            boxShadow: "-8px 0 24px rgba(15, 23, 42, 0.08)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <AskDrawer
            sessionId={session.id}
            onClose={() => setAskOpen(false)}
          />
        </aside>
      )}

      {/* Tail mode FAB — auto-scroll to follow live events */}
      <TailMode isLive={isSessionLive} navLockRef={tailNavLockRef} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Row helpers                                                       */
/* ------------------------------------------------------------------ */

// rowPrimaryIndex, DisplayRow, flattenMegaRows, allRowsAsRawRows moved to ./session-view/{types,helpers}.ts

/* ------------------------------------------------------------------ */
/*  Header stats + token stat w/ tooltip                              */
/* ------------------------------------------------------------------ */

// InlineStat, InlineStatDivider, EntrypointBadge, InlineTokenStat, useAnchoredTooltip, AnchoredTooltip moved to ./session-view/header-stats.tsx

/* ------------------------------------------------------------------ */
/*  Generic Tooltip                                                    */
/* ------------------------------------------------------------------ */

// Tooltip, TooltipRow moved to ./session-view/tooltip.tsx

/* ------------------------------------------------------------------ */
/*  Mini-map                                                           */
/* ------------------------------------------------------------------ */

// ROW_IMPORTANCE, Minimap, MinimapHoverCard moved to ./session-view/minimap.tsx
// MinimapSeg moved to ./session-view/types.ts
// subagentColor, workflowColor moved to ./session-view/colors.ts

/* ------------------------------------------------------------------ */
/*  Transcript list + rows                                            */
/* ------------------------------------------------------------------ */

function TranscriptList({
  displayRows,
  rowRefs,
  selectedIndex,
  onSelect,
  onToggleTurn,
  stickyOffset,
  isSessionLive,
  team,
  model,
  rawIdleBands,
  sessionDays,
  entryByDay,
  dayStripRefs,
  onJumpAcrossDay,
}: {
  displayRows: DisplayRow[];
  rowRefs: React.MutableRefObject<Record<number, HTMLDivElement | null>>;
  selectedIndex: number | null;
  onSelect: (i: number | null) => void;
  onToggleTurn: (firstPrimaryIndex: number) => void;
  stickyOffset: number;
  isSessionLive?: boolean;
  team?: (TimelineData & { teamName: string }) | null;
  model?: string;
  /** Anchor-to-anchor idle bands. The body emits IdleDivider before any
   *  row whose start matches a band's end, so Codex sessions get the same
   *  "Session idle X minutes" markers Claude has always had. */
  rawIdleBands?: { start: number; end: number; durationMs: number }[];
  /** Day buckets (sorted by startMs) + per-day digest cards. The body drops a
   *  card at each day's first row so per-day perception sits inline with that
   *  day's work instead of stacked at the top. */
  sessionDays: { key: string; startMs: number; endMs: number; count: number }[];
  entryByDay: Map<string, Entry>;
  dayStripRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  /** Hop to an adjacent day from an inline day-boundary button.
   *  (selectKey, scrollKey, block, fallbackRowIndex). */
  onJumpAcrossDay: (
    selectKey: string,
    scrollKey: string,
    block: "start" | "end",
    fallbackIndex: number,
  ) => void;
}) {
  // Find the last collapsed turn index so we can mark it as in-progress
  // when the session is live.
  let lastCollapsedTurnIdx = -1;
  if (isSessionLive) {
    for (let i = displayRows.length - 1; i >= 0; i--) {
      if (displayRows[i].kind === "turn-collapsed") {
        lastCollapsedTurnIdx = i;
        break;
      }
    }
  }

  const idleBandList = (rawIdleBands ?? []).slice().sort((a, b) => a.start - b.start);
  /** Returns the first matching idle band (or null) whose end falls within
   *  1s of the given row's tOffset. Tolerance absorbs Date.parse rounding
   *  between anchor.ms and the presentation row's tOffsetMs. */
  const idleBandBeforeOffset = (
    tOff: number | undefined,
  ): { start: number; durationMs: number } | null => {
    if (tOff === undefined) return null;
    for (const b of idleBandList) {
      if (Math.abs(b.end - tOff) < 1000) return b;
    }
    return null;
  };
  /** Pull a t-offset off whichever display-row variant we have. */
  const rowTOffset = (d: DisplayRow): number | undefined => {
    if (d.kind === "turn-collapsed" || d.kind === "turn-expanded-header") return d.turn.tOffsetMs;
    if (d.kind === "turn-expanded-footer") return undefined;
    return d.row.tOffsetMs;
  };
  // A display row → its event PRIMARY index (what jumpAcrossDay's turn/row
  // lookups are keyed by — NOT the displayRows loop position).
  const rowPrimaryIndexOf = (d: DisplayRow): number =>
    d.kind === "presentation" ? rowPrimaryIndex(d.row) : d.turn.firstPrimaryIndex;
  /** Which local day a row falls in: the last day bucket whose start is at or
   *  before the row's offset. sessionDays is pre-sorted by startMs. */
  const dayKeyForOffset = (tOff: number | undefined): string | null => {
    if (tOff === undefined) return null;
    let key: string | null = null;
    for (const dd of sessionDays) {
      if (dd.startMs <= tOff) key = dd.key;
      else break;
    }
    return key;
  };

  const out: React.ReactNode[] = [];
  // Tracks the day of the last emitted row so a day's digest card is dropped
  // once, before that day's first non-indented row.
  let currentDayKey: string | null = null;
  // A user row and the turn-collapsed row that follows it share a
  // tOffsetMs (turn anchors at the user message — see buildMegaRows), so
  // both would match the same between-turn band without this guard. Track
  // emitted band starts and skip duplicates.
  const emittedBandStarts = new Set<number>();
  for (let i = 0; i < displayRows.length; i++) {
    const d = displayRows[i];
    // Emit a "Session idle" divider before any row that starts right after
    // an anchor-to-anchor idle band. Skips indented (child) rows so an
    // expanded turn doesn't render dividers for its inner steps.
    const indented = d.kind === "presentation" ? d.indented : false;
    if (!indented) {
      const band = idleBandBeforeOffset(rowTOffset(d));
      if (
        band !== null &&
        band.durationMs > IDLE_THRESHOLD_MS &&
        !emittedBandStarts.has(band.start)
      ) {
        emittedBandStarts.add(band.start);
        out.push(<IdleDivider key={`idle-before-${i}`} gapMs={band.durationMs} />);
      }
      // Day boundary: drop this day's digest card at its first row (after any
      // overnight idle divider that led into the day) so per-day perception
      // sits inline with that day's work, not stacked at the top. The boundary
      // also gets inline jump controls so you can page across days while
      // reading — "↓ start of next day" sits at the bottom of the day that just
      // ended, "↑ end of previous day" at the top of the new one.
      const dk = dayKeyForOffset(rowTOffset(d));
      if (dk && dk !== currentDayKey) {
        const endedKey = currentDayKey; // day that just ended; null on the first day
        currentDayKey = dk;
        // Fallback scroll target for days with no digest card: the day's first
        // row by PRIMARY index (i is the displayRows position — wrong key space).
        const firstIdx = rowPrimaryIndexOf(d);
        if (endedKey) {
          out.push(
            <DayJumpRow
              key={`daydown-${dk}`}
              dir="down"
              label={formatDayKey(dk)}
              onClick={() => onJumpAcrossDay(dk, dk, "start", firstIdx)}
            />,
          );
        }
        const dayEntry = entryByDay.get(dk);
        if (dayEntry) {
          out.push(
            <div
              key={`daystrip-${dk}`}
              ref={(el) => {
                dayStripRefs.current[dk] = el;
              }}
              style={{ marginBottom: 12, scrollMarginTop: stickyOffset }}
            >
              <EntryDayStrip entry={dayEntry} />
            </div>,
          );
        }
        if (endedKey) {
          out.push(
            <DayJumpRow
              key={`dayup-${dk}`}
              dir="up"
              label={formatDayKey(endedKey)}
              onClick={() => onJumpAcrossDay(endedKey, dk, "end", firstIdx)}
            />,
          );
        }
      }
    }

    // Collapsed turn summary row
    if (d.kind === "turn-collapsed") {
      const idx = d.turn.firstPrimaryIndex;
      const turnCold = findColdResumeInDisplayRow(d);
      out.push(
        <CollapsedTurnRow
          key={`turn-${idx}`}
          turn={d.turn}
          stickyOffset={stickyOffset}
          onClick={() => onToggleTurn(idx)}
          inProgress={i === lastCollapsedTurnIdx}
          team={team}
          coldResume={turnCold ?? undefined}
          model={model}
          refCb={(el) => {
            rowRefs.current[idx] = el;
          }}
        />,
      );
      continue;
    }

    // Expanded turn header
    if (d.kind === "turn-expanded-header") {
      const turnCold = findColdResumeInDisplayRow(d);
      out.push(
        <ExpandedTurnHeader
          key={`turnhead-${d.turn.firstPrimaryIndex}`}
          turn={d.turn}
          onClick={() => onToggleTurn(d.turn.firstPrimaryIndex)}
          coldResume={turnCold ?? undefined}
          model={model}
        />,
      );
      continue;
    }

    // Expanded turn footer — matching collapse control at the bottom of
    // the expanded rows so the user can collapse right where their eye
    // lands after reading through the content.
    if (d.kind === "turn-expanded-footer") {
      out.push(
        <ExpandedTurnFooter
          key={`turnfoot-${d.turn.firstPrimaryIndex}`}
          turn={d.turn}
          onClick={() => onToggleTurn(d.turn.firstPrimaryIndex)}
        />,
      );
      continue;
    }

    // Normal presentation row (possibly indented as a child of an expanded
    // turn). Idle dividers are now emitted at the top of the loop from the
    // shared rawIdleBands list — no separate gap-before-user check needed.
    const r = d.row;
    const idx = rowPrimaryIndex(r);
    out.push(
      <TranscriptRow
        key={`row-${idx}`}
        row={r}
        selected={selectedIndex === idx}
        onSelect={() => onSelect(idx)}
        stickyOffset={stickyOffset}
        indented={d.indented}
        refCb={(el) => {
          rowRefs.current[idx] = el;
        }}
      />,
    );
  }
  return <div>{out}</div>;
}

function IdleDivider({ gapMs }: { gapMs: number }) {
  return (
    <div
      style={{
        margin: "8px 0",
        padding: "6px 12px",
        textAlign: "center",
        background:
          "repeating-linear-gradient(135deg, rgba(107,101,96,0.04) 0px, rgba(107,101,96,0.04) 6px, rgba(107,101,96,0.12) 6px, rgba(107,101,96,0.12) 12px)",
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 6,
        fontSize: 11,
        color: "var(--af-text-tertiary)",
        letterSpacing: "0.02em",
      }}
    >
      Session idle · {formatGap(gapMs)}
    </div>
  );
}

/** Inline cross-day jump control rendered at each day boundary. "down" sits at
 *  the bottom of the day that just ended and jumps to the start of the next day;
 *  "up" sits at the top of the new day and jumps to the end of the previous one.
 *  The day always follows the scroll position (see followDayToScroll); these are
 *  a one-click shortcut across the long idle gap between days so you don't have
 *  to hand-scroll the whole span. "down" (start of next day) lands that day's
 *  first row at the header line so the day-follow agrees; "up" (end of previous
 *  day) scrolls the new day's strip to the viewport bottom, leaving the previous
 *  day's tail above the header line. */
function DayJumpRow({
  dir,
  label,
  onClick,
}: {
  dir: "up" | "down";
  label: string;
  onClick: () => void;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "center", margin: "6px 0" }}>
      <button
        type="button"
        onClick={onClick}
        title={dir === "up" ? `Go to the end of ${label}` : `Go to the start of ${label}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          color: "var(--af-text-secondary)",
          background: "var(--af-surface)",
          border: "1px solid var(--af-border-subtle)",
          borderRadius: 100,
          padding: "3px 12px",
          cursor: "pointer",
        }}
      >
        {dir === "up" ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {dir === "up" ? `End of ${label}` : `Start of ${label}`}
      </button>
    </div>
  );
}

function findColdResumeInDisplayRow(
  d: DisplayRow,
): SessionEvent["coldResume"] | null {
  if (d.kind === "presentation") return findColdResumeInRow(d.row);
  if (d.kind === "turn-collapsed" || d.kind === "turn-expanded-header") {
    for (const r of d.turn.rows) {
      const hit = findColdResumeInRow(r);
      if (hit) return hit;
    }
  }
  return null;
}

function findColdResumeInRow(
  r: PresentationRow,
): SessionEvent["coldResume"] | null {
  if (r.kind === "agent") {
    if (r.event.coldResume) return r.event.coldResume;
    for (const ge of r.groupedEvents) {
      if (ge.coldResume) return ge.coldResume;
    }
  } else if (r.kind === "tool-group") {
    for (const e of r.events) if (e.coldResume) return e.coldResume;
  }
  return null;
}

function ColdResumeNotice({
  info,
  model,
}: {
  info: NonNullable<SessionEvent["coldResume"]>;
  model?: string;
}) {
  const { trigger, gapMs, writeTokens, writeRatio, compact } = info;
  const estUsd = estimateCost(
    { input: 0, output: 0, cacheRead: 0, cacheWrite: writeTokens },
    model,
  );
  const isCompact = trigger === "compact";
  const fullyCold = writeRatio >= 0.9;
  let title: string;
  if (!isCompact) title = `Session resumed cold · idle ${formatGap(gapMs)}`;
  else if (compact?.trigger === "auto") title = "Auto-compact rebuilt the cache";
  else title = "Conversation compacted · cache rebuilt";
  const hint = isCompact
    ? "Compaction summarizes the conversation, so the prefix must be rewritten into a fresh cache. Any /compact or auto-compact will cost this rewrite."
    : "Prompt cache expired during idle. Resuming within 5 min keeps the cache warm and avoids the rewrite tax.";
  return (
    <div
      style={{
        padding: "8px 12px",
        background: "rgba(217, 119, 6, 0.08)",
        border: "1px solid rgba(217, 119, 6, 0.35)",
        borderLeft: "3px solid rgba(217, 119, 6, 0.9)",
        borderRadius: 6,
        fontSize: 11.5,
        color: "var(--af-text-secondary)",
        lineHeight: 1.5,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontWeight: 600,
          color: "#78350F",
          letterSpacing: "0.01em",
        }}
      >
        <span style={{ fontSize: 13 }}>⚡</span>
        {title}
      </div>
      <div style={{ marginTop: 4, fontFamily: "var(--font-mono)", fontSize: 11 }}>
        Rewrote <b>{formatTokens(writeTokens)}</b> tokens into prompt cache
        {estUsd >= 0.005 && (
          <>
            {" "}
            · est. <b>{formatCost(estUsd)}</b>
          </>
        )}
        {isCompact && compact && (
          <>
            {" "}
            · pre-compact <b>{formatTokens(compact.preTokens)}</b>
          </>
        )}
        {!isCompact && (
          <>
            {" "}
            · {fullyCold ? "fully cold" : "partial"} ({Math.round(writeRatio * 100)}% write)
          </>
        )}
      </div>
      <div
        style={{
          marginTop: 3,
          fontSize: 10.5,
          color: "var(--af-text-tertiary)",
          fontStyle: "italic",
        }}
      >
        {hint}
      </div>
    </div>
  );
}

function ColdResumeSessionStat({
  count,
  writeTokens,
  model,
}: {
  count: number;
  writeTokens: number;
  model?: string;
}) {
  const { ref, anchor, open, close } = useAnchoredTooltip();
  const estUsd = estimateCost(
    { input: 0, output: 0, cacheRead: 0, cacheWrite: writeTokens },
    model,
  );
  return (
    <span
      ref={ref}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11.5,
        fontWeight: 600,
        color: "#78350F",
        background: "rgba(217, 119, 6, 0.12)",
        padding: "2px 8px",
        borderRadius: 100,
        cursor: "default",
      }}
      onMouseEnter={open}
      onMouseLeave={close}
    >
      <span style={{ fontSize: 12 }}>⚡</span>
      {count} cache rebuild{count === 1 ? "" : "s"} · {formatTokens(writeTokens)} rewritten
      {anchor && (
        <AnchoredTooltip anchor={anchor} width={320}>
          <TooltipRow label="Cache rebuilds" value={count.toLocaleString()} />
          <TooltipRow label="Tokens rewritten" value={writeTokens.toLocaleString()} />
          {estUsd >= 0.005 && (
            <TooltipRow label="Est. rebuild cost" value={formatCost(estUsd)} />
          )}
          <div
            style={{
              marginTop: 6,
              paddingTop: 6,
              borderTop: "1px solid rgba(241,245,249,0.12)",
              opacity: 0.65,
              fontSize: 10,
              whiteSpace: "normal",
              lineHeight: 1.4,
            }}
          >
            Turns where the whole prompt-cache prefix had to be rewritten.
            Either the cache expired during a long idle gap, or a /compact
            (manual or auto) summarized the conversation. Both cost tokens
            at 1.25× base input price.
          </div>
        </AnchoredTooltip>
      )}
    </span>
  );
}

function ColdResumeChip({
  info,
  model,
}: {
  info: NonNullable<SessionEvent["coldResume"]>;
  model?: string;
}) {
  const { writeTokens } = info;
  const estUsd = estimateCost(
    { input: 0, output: 0, cacheRead: 0, cacheWrite: writeTokens },
    model,
  );
  return (
    <span
      title={`Prompt cache expired during idle; this turn rewrote ${writeTokens.toLocaleString()} tokens into cache${estUsd >= 0.005 ? ` (est. ${formatCost(estUsd)})` : ""}.`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10.5,
        fontWeight: 600,
        padding: "2px 7px",
        borderRadius: 3,
        background: "rgba(217, 119, 6, 0.14)",
        color: "#78350F",
        letterSpacing: "0.01em",
        cursor: "default",
      }}
    >
      ⚡ cold resume · {formatTokens(writeTokens)} rewritten
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Collapsed turn row                                                 */
/*                                                                     */
/*  Three-line layout:                                                 */
/*    1. First agent preview (intent / plan)                           */
/*    2. Middle summary (counts + top tools + duration)                */
/*    3. Final agent preview (answer / conclusion)                     */
/* ------------------------------------------------------------------ */

function CollapsedTurnRow({
  turn,
  onClick,
  refCb,
  stickyOffset,
  inProgress,
  team,
  coldResume,
  model,
}: {
  turn: TurnMegaRow;
  /** Fires when the user wants to fully expand this turn into the
   *  transcript list (inner rows appear below as separate TranscriptRow
   *  entries). Triggered by the "Show all N steps" bottom bar. */
  onClick: () => void;
  refCb: (el: HTMLDivElement | null) => void;
  stickyOffset: number;
  inProgress?: boolean;
  team?: (TimelineData & { teamName: string }) | null;
  coldResume?: NonNullable<SessionEvent["coldResume"]>;
  model?: string;
}) {
  const theme = ROLE_THEMES.agent;
  const s = turn.summary;
  const hasTokens = s.totalTokens.input > 0 || s.totalTokens.output > 0;

  // First / conclusion agent-message indices are pre-computed by
  // buildMegaRows — the "conclusion" uses a heuristic that skips short
  // codas following a task-notification (so e.g. "Ship done..." beats
  // a later "Acknowledged — the background task closed out").
  const firstAgentIdx = s.firstAgentIndex ?? -1;
  const finalAgentIdx = s.finalAgentIndex ?? -1;
  const firstAgentRow = firstAgentIdx >= 0 ? turn.rows[firstAgentIdx] : undefined;
  const finalAgentRow =
    finalAgentIdx >= 0 && finalAgentIdx !== firstAgentIdx ? turn.rows[finalAgentIdx] : undefined;

  // Middle list excludes the first and conclusion messages. Any coda
  // messages (e.g. "Acknowledged ...") remain visible here as ordinary
  // steps — they happened, they just aren't the semantic conclusion.
  const middleRows = turn.rows.filter((_, i) => {
    if (i === firstAgentIdx) return false;
    if (finalAgentRow && i === finalAgentIdx) return false;
    return true;
  });

  // Local state: whether the first / last message is rendered in full
  // markdown form inline (instead of the 2-line preview).
  const [firstExpanded, setFirstExpanded] = useState(false);
  const [lastExpanded, setLastExpanded] = useState(false);

  // Stop click propagation on interactive children so clicks on the
  // expandable message areas don't bubble up and trigger onClick on the
  // whole row — we want explicit controls only.
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      ref={refCb}
      data-sl-row-index={turn.firstPrimaryIndex}
      data-sl-toffset={turn.tOffsetMs ?? 0}
      style={{
        display: "grid",
        gridTemplateColumns: "20px 84px 1fr auto auto",
        columnGap: 12,
        alignItems: "start",
        padding: "14px 12px 0 12px",
        borderBottom: "1px solid var(--af-border-subtle)",
        transition: "background 0.08s",
        scrollMarginTop: stickyOffset,
      }}
    >
      {/* Col 1 — empty spacer to keep the Agent pill aligned with
          TranscriptRow's pill column (which also has an empty 20px slot). */}
      <span />

      {/* Col 2 — "Agent" role pill */}
      <span
        style={{
          justifySelf: "start",
          fontSize: 11,
          fontWeight: 600,
          padding: "3px 10px",
          borderRadius: 4,
          background: theme.bg,
          color: theme.fg,
          marginTop: 2,
        }}
      >
        Agent
      </span>

      {/* Col 3 — content (cold-resume notice · first · stats · steps · last · bottom bar) */}
      <div
        style={{
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          paddingBottom: 10,
        }}
      >
        {coldResume && (
          <div onClick={stop}>
            <ColdResumeNotice info={coldResume} model={model} />
          </div>
        )}

        {/* 1. First agent message — clickable to expand into full markdown */}
        {firstAgentRow && (
          <ExpandableMessage
            label="First message"
            row={firstAgentRow as Extract<PresentationRow, { kind: "agent" }>}
            expanded={firstExpanded}
            onToggle={(e) => {
              stop(e);
              setFirstExpanded((v) => !v);
            }}
          />
        )}

        {/* Stats line */}
        <div onClick={stop}>
          <TurnStatsLine summary={s} durationMs={turn.durationMs} rows={turn.rows} team={team} />
        </div>

        {/* 2. Steps list — each middle row as a compact bullet */}
        {middleRows.length > 0 && (
          <div onClick={stop}>
            <TurnStepsList rows={middleRows} />
          </div>
        )}

        {/* 3. Conclusion / in-progress indicator */}
        {inProgress && finalAgentRow ? (
          <ExpandableMessage
            label={`In progress · ${turn.rows.length} step${turn.rows.length === 1 ? "" : "s"} so far`}
            labelPrefix={
              <span
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#ef4444",
                  animation: "cs-live-pulse 1.6s ease-in-out infinite",
                }}
              />
            }
            row={finalAgentRow as Extract<PresentationRow, { kind: "agent" }>}
            expanded={lastExpanded}
            onToggle={(e) => {
              stop(e);
              setLastExpanded((v) => !v);
            }}
            arrow
          />
        ) : finalAgentRow ? (
          <ExpandableMessage
            label="Conclusion"
            row={finalAgentRow as Extract<PresentationRow, { kind: "agent" }>}
            expanded={lastExpanded}
            onToggle={(e) => {
              stop(e);
              setLastExpanded((v) => !v);
            }}
            arrow
          />
        ) : null}

        {/* Bottom bar — explicit "expand full turn" action */}
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            onClick();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            width: "100%",
            padding: "7px 10px",
            marginTop: 4,
            background: "var(--af-surface-hover)",
            border: "1px solid var(--af-border-subtle)",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 500,
            color: "var(--af-text-secondary)",
            fontFamily: "inherit",
            cursor: "pointer",
            transition: "all 0.1s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--af-surface-elevated)";
            e.currentTarget.style.color = "var(--af-text)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--af-surface-hover)";
            e.currentTarget.style.color = "var(--af-text-secondary)";
          }}
        >
          <ChevronDown size={13} />
          Show all {turn.rows.length} step{turn.rows.length === 1 ? "" : "s"}
        </button>
      </div>

      {/* Col 4 — Token chip with hover breakdown */}
      <span style={{ marginTop: 3 }}>{hasTokens && <TurnTokenChip usage={s.totalTokens} />}</span>

      {/* Col 5 — Offset */}
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--af-text-tertiary)",
          marginTop: 3,
          minWidth: 64,
          textAlign: "right",
        }}
      >
        {formatOffset(turn.tOffsetMs)}
      </span>
    </div>
  );
}

/** Expandable first/last message inside a collapsed turn. Shows a 2-line
 *  clamped preview by default; clicking expands into a full markdown
 *  rendering for reading the agent's intent/conclusion in context. */
function ExpandableMessage({
  label,
  labelPrefix,
  row,
  expanded,
  onToggle,
  arrow,
}: {
  label: string;
  labelPrefix?: React.ReactNode;
  row: Extract<PresentationRow, { kind: "agent" }>;
  expanded: boolean;
  onToggle: (e: React.MouseEvent) => void;
  arrow?: boolean;
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "6px 10px",
        borderRadius: 6,
        background: expanded ? "var(--af-surface-hover)" : "transparent",
        border: expanded ? "1px solid var(--af-border-subtle)" : "1px solid transparent",
        cursor: "pointer",
        transition: "all 0.12s",
        borderTop: arrow && !expanded ? "1px dashed var(--af-border-subtle)" : undefined,
      }}
      onMouseEnter={(e) => {
        if (!expanded) e.currentTarget.style.background = "var(--af-surface-hover)";
      }}
      onMouseLeave={(e) => {
        if (!expanded) e.currentTarget.style.background = "transparent";
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 10,
          color: "var(--af-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          fontWeight: 600,
        }}
      >
        {labelPrefix}
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {label}
      </div>
      {expanded ? (
        <div className="sl-prose" style={{ fontSize: 13 }}>
          {row.event.blocks
            .filter((b): b is { type: "text"; text: string } => b.type === "text")
            .map((b, i) => (
              <ReactMarkdown
                key={i}
                remarkPlugins={[remarkGfm]}
                components={{
                  a: (props) => (
                    <a
                      {...props}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "var(--af-accent)",
                        textDecoration: "underline",
                      }}
                    />
                  ),
                }}
              >
                {b.text}
              </ReactMarkdown>
            ))}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "flex-start",
            fontSize: 13,
            lineHeight: 1.45,
            color: "var(--af-text)",
            fontWeight: 500,
          }}
        >
          {arrow && (
            <span
              style={{
                color: "var(--af-text-tertiary)",
                fontSize: 11,
                marginTop: 1,
              }}
            >
              →
            </span>
          )}
          <span
            style={{
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {row.event.preview}
          </span>
        </div>
      )}
    </div>
  );
}

/** One-line "8 messages · 23 tools · 5m 12s" stat strip at the top of
 *  a collapsed turn. Aggregates at a glance. */
/**
 * Ghostty-style activity summary for a collapsed turn.
 *
 * Instead of "8 messages · 23 tool calls", renders something like:
 *   "Editing 3 files +45 -40, reading 2 files, running 1 bash command · 5m 12s"
 *   "└ apps/web/components/theme-toggle.tsx"
 *
 * Aggregates tool calls by type and extracts the last file path being
 * operated on so the user can see at a glance what the agent is doing.
 */
function TurnStatsLine({
  summary,
  durationMs,
  rows,
  team,
}: {
  summary: TurnSummary;
  durationMs?: number;
  rows: PresentationRow[];
  team?: (TimelineData & { teamName: string }) | null;
}) {
  // Aggregate tool calls into activity categories.
  let editCount = 0;
  let writeCount = 0;
  let readCount = 0;
  let bashCount = 0;
  let grepCount = 0;
  let globCount = 0;
  let agentCount = 0;
  let otherToolCount = 0;
  let lastFilePath: string | undefined;
  const dispatchedNames: string[] = [];

  for (const r of rows) {
    if (r.kind !== "tool-group") continue;
    for (const ev of r.events) {
      const name = ev.toolName ?? "";
      const input = (ev.blocks.find(
        (b) => b && (b as { type?: string }).type === "tool_use",
      ) as { type: "tool_use"; input?: Record<string, unknown> } | undefined)
        ?.input;

      const filePath =
        typeof input?.file_path === "string" ? input.file_path : undefined;

      switch (name) {
        case "Edit":
          editCount++;
          if (filePath) lastFilePath = filePath;
          break;
        case "Write":
          writeCount++;
          if (filePath) lastFilePath = filePath;
          break;
        case "Read":
          readCount++;
          if (filePath) lastFilePath = filePath;
          break;
        case "Bash":
          bashCount++;
          break;
        case "Grep":
          grepCount++;
          break;
        case "Glob":
          globCount++;
          break;
        case "Agent": {
          agentCount++;
          const agentName = typeof input?.name === "string" ? input.name : undefined;
          if (agentName) dispatchedNames.push(agentName);
          break;
        }
        default:
          otherToolCount++;
          break;
      }
    }
  }

  // Build the Ghostty-style summary phrases.
  const phrases: React.ReactNode[] = [];
  // Build the summary phrases — past tense for completed turns.
  if (editCount > 0 || writeCount > 0) {
    const fileCount = editCount + writeCount;
    phrases.push(
      <span key="edit">
        <b style={{ fontWeight: 600 }}>Edited {fileCount} file{fileCount === 1 ? "" : "s"}</b>
      </span>,
    );
  }
  if (readCount > 0) {
    phrases.push(
      <span key="read">
        read <b style={{ fontWeight: 600 }}>{readCount}</b> file{readCount === 1 ? "" : "s"}
      </span>,
    );
  }
  if (bashCount > 0) {
    phrases.push(
      <span key="bash">
        ran <b style={{ fontWeight: 600 }}>{bashCount}</b> command{bashCount === 1 ? "" : "s"}
      </span>,
    );
  }
  if (grepCount + globCount > 0) {
    const searchCount = grepCount + globCount;
    phrases.push(
      <span key="search">
        <b style={{ fontWeight: 600 }}>{searchCount}</b> search{searchCount === 1 ? "" : "es"}
      </span>,
    );
  }
  if (agentCount > 0) {
    // When team data is available and we extracted agent names from the
    // tool inputs, render clickable member chips instead of a plain count.
    const nameToSession = team
      ? new Map(team.tracks.filter((t) => !t.isLead).map((t) => [t.label, t.id]))
      : null;
    if (dispatchedNames.length > 0 && nameToSession && nameToSession.size > 0) {
      phrases.push(
        <span key="agent" style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          dispatched{" "}
          {dispatchedNames.map((n, i) => {
            const sid = nameToSession.get(n);
            return sid ? (
              <Link
                key={i}
                href={`/sessions/${sid}`}
                style={{
                  fontSize: 10,
                  padding: "1px 7px",
                  background: "var(--af-surface-hover)",
                  border: "1px solid var(--af-border-subtle)",
                  borderRadius: 10,
                  color: "var(--af-text-secondary)",
                  textDecoration: "none",
                  fontWeight: 600,
                }}
              >
                {n}
              </Link>
            ) : (
              <span
                key={i}
                style={{
                  fontSize: 10,
                  padding: "1px 7px",
                  background: "var(--af-surface-hover)",
                  borderRadius: 10,
                  color: "var(--af-text-tertiary)",
                }}
              >
                {n}
              </span>
            );
          })}
        </span>,
      );
    } else {
      phrases.push(
        <span key="agent">
          dispatched <b style={{ fontWeight: 600 }}>{agentCount}</b> sub-agent{agentCount === 1 ? "" : "s"}
        </span>,
      );
    }
  }
  if (otherToolCount > 0 && phrases.length === 0) {
    phrases.push(
      <span key="other">
        <b style={{ fontWeight: 600 }}>{otherToolCount}</b> tool call{otherToolCount === 1 ? "" : "s"}
      </span>,
    );
  }

  // Fallback if no tools.
  if (phrases.length === 0 && summary.agentMessages > 0) {
    phrases.push(
      <span key="msgs">
        {summary.agentMessages} message{summary.agentMessages === 1 ? "" : "s"}
      </span>,
    );
  }

  // Shorten file path for display.
  const shortPath = lastFilePath
    ? (() => {
        const parts = lastFilePath.split("/");
        return parts.length > 3
          ? "…/" + parts.slice(-3).join("/")
          : lastFilePath;
      })()
    : undefined;

  return (
    <div
      style={{
        fontSize: 11,
        color: "var(--af-text-tertiary)",
        lineHeight: 1.6,
      }}
    >
      {/* Activity summary line */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
        {phrases.map((p, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ opacity: 0.5 }}>, </span>}
            {p}
          </React.Fragment>
        ))}
        {summary.errors > 0 && (
          <>
            <span style={{ opacity: 0.5 }}>, </span>
            <span style={{ color: "var(--af-danger)" }}>
              {summary.errors} error{summary.errors === 1 ? "" : "s"}
            </span>
          </>
        )}
        {durationMs !== undefined && durationMs > 0 && (
          <>
            <span style={{ opacity: 0.5, marginLeft: 4 }}>·</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>
              {formatGap(durationMs)}
            </span>
          </>
        )}
      </div>

      {/* Last file path (Ghostty "└ ..." style) */}
      {shortPath && (
        <div
          style={{
            fontSize: 10,
            color: "var(--af-text-tertiary)",
            fontFamily: "var(--font-mono)",
            marginTop: 1,
            opacity: 0.75,
          }}
          title={lastFilePath}
        >
          └ {shortPath}
        </div>
      )}
    </div>
  );
}

function ExpandedTurnHeader({
  turn,
  onClick,
  coldResume,
  model,
}: {
  turn: TurnMegaRow;
  onClick: () => void;
  coldResume?: NonNullable<SessionEvent["coldResume"]>;
  model?: string;
}) {
  const s = turn.summary;
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px 6px 18px",
        marginLeft: 12,
        borderLeft: "2px solid var(--af-accent)",
        borderBottom: "1px dashed var(--af-border-subtle)",
        fontSize: 11,
        color: "var(--af-text-tertiary)",
        cursor: "pointer",
        background: "rgba(92, 132, 195, 0.04)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(92, 132, 195, 0.10)";
        e.currentTarget.style.color = "var(--af-text-secondary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(92, 132, 195, 0.04)";
        e.currentTarget.style.color = "var(--af-text-tertiary)";
      }}
    >
      <ChevronDown size={13} />
      <span>
        Hide turn · {s.agentMessages} message{s.agentMessages === 1 ? "" : "s"} · {s.toolCalls} tool
        {s.toolCalls === 1 ? "" : "s"}
        {turn.durationMs !== undefined ? ` · ${formatGap(turn.durationMs)}` : ""}
      </span>
      {coldResume && (
        <span style={{ marginLeft: "auto" }}>
          <ColdResumeChip info={coldResume} model={model} />
        </span>
      )}
    </div>
  );
}

/** Matching collapse control at the bottom of an expanded turn. Mirrors
 *  the top ExpandedTurnHeader so after reading through the inner rows
 *  the user has a collapse button right where their eye lands. */
function ExpandedTurnFooter({ turn, onClick }: { turn: TurnMegaRow; onClick: () => void }) {
  const s = turn.summary;
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 12px 7px 18px",
        marginLeft: 12,
        marginBottom: 8,
        borderLeft: "2px solid var(--af-accent)",
        borderTop: "1px dashed var(--af-border-subtle)",
        borderBottomLeftRadius: 6,
        borderBottomRightRadius: 6,
        fontSize: 11,
        color: "var(--af-text-tertiary)",
        cursor: "pointer",
        background: "rgba(92, 132, 195, 0.04)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(92, 132, 195, 0.10)";
        e.currentTarget.style.color = "var(--af-text-secondary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(92, 132, 195, 0.04)";
        e.currentTarget.style.color = "var(--af-text-tertiary)";
      }}
    >
      <ChevronUp size={13} />
      <span>
        Collapse turn · {s.agentMessages} message{s.agentMessages === 1 ? "" : "s"} · {s.toolCalls}{" "}
        tool{s.toolCalls === 1 ? "" : "s"}
        {turn.durationMs !== undefined ? ` · ${formatGap(turn.durationMs)}` : ""}
      </span>
    </div>
  );
}

function TranscriptRow({
  row,
  selected,
  onSelect,
  refCb,
  stickyOffset,
  indented,
}: {
  row: PresentationRow;
  selected: boolean;
  onSelect: () => void;
  refCb: (el: HTMLDivElement | null) => void;
  stickyOffset: number;
  indented?: boolean;
}) {
  const theme = ROLE_THEMES[row.kind];
  const event = row.kind === "tool-group" ? row.events[0] : row.event;
  const usage = event.usage;
  const hasUsage = row.kind === "agent" && usage && (usage.input > 0 || usage.output > 0);
  const isTeammateMsg = row.kind === "user" && !!row.event.teammateMessage;
  const roleLabel = isTeammateMsg ? "Team Lead" : theme.label;

  const preview = rowPreview(row);

  return (
    <div
      ref={refCb}
      onClick={onSelect}
      data-sl-row-index={row.kind === "tool-group" ? row.events[0].index : row.event.index}
      data-sl-toffset={row.tOffsetMs ?? 0}
      style={{
        display: "grid",
        // Empty 20px prefix column keeps the role pill at the same x-offset
        // as collapsed turn rows (which have a chevron there). Ensures the
        // User/Agent/Tool tags align vertically in the transcript.
        gridTemplateColumns: "20px 84px 1fr auto auto",
        gap: 14,
        alignItems: "center",
        padding: "11px 12px",
        paddingLeft: indented ? 28 : 12,
        borderBottom: "1px solid var(--af-border-subtle)",
        borderLeft: indented ? "2px solid var(--af-accent)" : "2px solid transparent",
        marginLeft: indented ? 12 : 0,
        cursor: "pointer",
        background: selected
          ? "var(--af-accent-subtle)"
          : indented
            ? "rgba(92, 132, 195, 0.03)"
            : "transparent",
        transition: "background 0.08s",
        scrollMarginTop: stickyOffset,
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.background = "var(--af-surface-hover)";
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = "transparent";
      }}
    >
      {/* Empty chevron-slot column — keeps the pill column aligned with
          collapsed-turn rows that do render a chevron. */}
      <span />
      <span
        style={{
          justifySelf: "start",
          fontSize: 11,
          fontWeight: 600,
          padding: "3px 10px",
          borderRadius: 4,
          background: theme.bg,
          color: theme.fg,
        }}
      >
        {roleLabel}
      </span>

      <span
        style={{
          fontSize: 13,
          color: row.kind === "error" ? "var(--af-danger)" : "var(--af-text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {row.kind === "tool-group" && (
          <Wrench size={13} style={{ color: "var(--af-text-tertiary)", flexShrink: 0 }} />
        )}
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {row.kind === "tool-group" ? (
            <ToolGroupLabel toolNames={row.toolNames} count={row.count} />
          ) : (
            preview
          )}
        </span>
      </span>

      {hasUsage && usage ? <TokenChip usage={usage} /> : <span />}

      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--af-text-tertiary)",
          minWidth: 64,
          textAlign: "right",
        }}
      >
        {formatOffset(row.tOffsetMs)}
      </span>
    </div>
  );
}

/* -------- Token chip w/ hover tooltip -------- */

/** Pretty inline label for a collapsed tool-group row. Shows unique tool
 *  names with bolded names and subtle "×N" counts. */
function ToolGroupLabel({
  toolNames,
  count,
}: {
  toolNames: { name: string; count: number }[];
  count: number;
}) {
  const MAX = 4;
  const shown = toolNames.slice(0, MAX);
  const overflow = toolNames.length - MAX;
  return (
    <span>
      {shown.map((t, i) => (
        <span key={t.name}>
          {i > 0 && <span style={{ color: "var(--af-text-tertiary)", margin: "0 6px" }}>·</span>}
          <b>{shortenToolName(t.name)}</b>
          {t.count > 1 && (
            <span
              style={{
                color: "var(--af-text-tertiary)",
                fontWeight: 400,
                marginLeft: 4,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
            >
              ×{t.count}
            </span>
          )}
        </span>
      ))}
      {overflow > 0 && (
        <span
          style={{
            color: "var(--af-text-tertiary)",
            marginLeft: 8,
            fontSize: 11,
          }}
        >
          +{overflow} more
        </span>
      )}
      {count > 3 && (
        <span
          style={{
            color: "var(--af-text-tertiary)",
            marginLeft: 10,
            fontSize: 11,
            fontFamily: "var(--font-mono)",
          }}
        >
          ({count} calls)
        </span>
      )}
    </span>
  );
}

// TokenChip, TurnTokenChip moved to ./session-view/token-stats.tsx

/* ------------------------------------------------------------------ */
/*  Debug list                                                         */
/* ------------------------------------------------------------------ */

// DebugList moved to ./session-view/debug-list.tsx

/* ------------------------------------------------------------------ */
/*  SubagentDrawer                                                    */
/*                                                                     */
/*  Opened when the user clicks a sub-agent lane bar on the mini-map. */
/*  Renders everything we know about the run — type pill, background  */
/*  badge, timing range, duration, stats, the full prompt the parent  */
/*  dispatched, the final agent text, and a "Jump to parent" action   */
/*  that scrolls the transcript to the Agent tool_use row that kicked */
/*  this subagent off.                                                */
/* ------------------------------------------------------------------ */

// SubagentDrawer moved to ./session-view/subagent-drawer.tsx

/* ------------------------------------------------------------------ */
/*  Workflows panel                                                    */
/* ------------------------------------------------------------------ */

// WorkflowsPanel, WorkflowCard, WorkflowPhaseTabs, WorkflowAgentRow,
// WorkflowAgentDrawer, DrawerCollapsible, WorkflowStepRow, WorkflowRunLog,
// shortenModel, agentStateColor, WfAgentDetail moved to ./session-view/workflows-panel.tsx

// WfMiniStat, SectionLabel, StatCell, TokenLine moved to ./session-view/workflows-shared.tsx

/* ------------------------------------------------------------------ */
/*  Drawer                                                             */
/* ------------------------------------------------------------------ */

// DrawerContent, BlockView moved to ./session-view/drawer.tsx

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

// formatDurationHeader moved to ./session-view/helpers.ts

// EntryDayStrip moved to ./session-view/entry-day-strip.tsx
