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
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  SessionDetail,
  SessionEvent,
  SubagentRun,
  WorkflowRun,
  PrMarker,
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
  type MinimapSeg,
} from "./session-view/types";
import { subagentColor, workflowColor } from "./session-view/colors";
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
  WfMiniStat,
  SectionLabel,
  StatCell,
  TokenLine,
} from "./session-view/workflows-shared";
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
   *  drops out unless it crosses MIN_GAP_MS — which the first 6s in a
   *  typical Codex session does not. */
  const rawIdleBands = useMemo(() => {
    // Anchor on ANY timestamped event so agent-thinking, meta, and other
    // intra-turn signals prove the parent is doing work. Only what we
    // need to distinguish is "user" (turn boundary) vs everything else.
    const isUserRole = (role: string) => role === "user";
    // 30s threshold: keeps ordinary tool latency (Read big file, slow Bash,
    // model thinking between anchors) out of the idle stripes while still
    // catching anything that reads as a real pause.
    const MIN_GAP_MS = 30_000;
    const anchors: { ms: number; role: string }[] = [];
    for (const e of events) {
      if (!e.timestamp) continue;
      const ms = Date.parse(e.timestamp);
      if (!Number.isFinite(ms)) continue;
      anchors.push({ ms, role: e.role });
    }
    if (anchors.length < 2) return [];
    anchors.sort((a, b) => a.ms - b.ms);
    const sessionStartMs = anchors[0]!.ms - (events.find((e) => e.timestamp)?.tOffsetMs ?? 0);

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
    // sequence where thinking→agent crosses MIN_GAP_MS still reads as
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

      if (rawGap <= MIN_GAP_MS) continue;
      if (skipAsLatency) continue;

      const gStart = anchors[i - 1]!.ms - sessionStartMs;
      const gEnd = anchors[i]!.ms - sessionStartMs;
      const betweenTurn = isUserRole(curRole);

      if (!betweenTurn) {
        // In-turn gap: the parent is mid-turn. If any subagent run overlaps,
        // the parent is waiting on delegated work — not idle. Drop the
        // whole gap rather than carving out startup/teardown slivers that
        // would clutter the minimap with thin stripes. Gaps with no
        // subagent overlap (long Bash runs, model thinking between tool
        // calls) still emit as a single band.
        if (overlapsSubagent(gStart, gEnd)) continue;
        bands.push({ start: gStart, end: gEnd, durationMs: gEnd - gStart });
        continue;
      }

      // Between-turn gap: user walked away. Carve out background subagent
      // activity so only the genuinely-unwatched portion counts as idle.
      // Each surviving slice becomes its own band.
      for (const slice of carveOutSubagents(gStart, gEnd)) {
        const dur = slice.end - slice.start;
        if (dur > MIN_GAP_MS) {
          bands.push({ start: slice.start, end: slice.end, durationMs: dur });
        }
      }
    }
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
  const [selectedDayKey, setSelectedDayKey] = useState<string>(
    () => (sessionDays.length ? sessionDays[sessionDays.length - 1]!.key : "all"),
  );
  useEffect(() => {
    setSelectedDayKey(sessionDays.length ? sessionDays[sessionDays.length - 1]!.key : "all");
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
  // most recent day (the default selectedDayKey is already the last day, so the
  // minimap matches). Routed through gotoDay rather than scrolling to the day's
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
    if (days.length <= 1 || isSessionLive) {
      didInitialDayJump.current = true;
      return;
    }
    didInitialDayJump.current = true;
    gotoDay(days[days.length - 1]!.key);
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
    const ev = events.find((e) => e.tOffsetMs !== undefined && e.tOffsetMs >= d.startMs);
    if (!ev) return;
    // In turns mode the day's first row may be inside a collapsed turn — expand
    // it so the row exists in the DOM before the scroll effect runs.
    if (filter === "turns") {
      const turnIdx = turnByRowIndex.get(ev.index);
      if (turnIdx !== undefined && !expandedTurns.has(turnIdx)) {
        setExpandedTurns((prev) => new Set(prev).add(turnIdx));
      }
    }
    setDayScrollTarget((prev) => ({ index: ev.index, key, block: "start", n: (prev?.n ?? 0) + 1 }));
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
            collapsed={collapsed}
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

/* ------------------------------------------------------------------ */
/*  Mini-map                                                           */
/*                                                                     */
/*  Design:                                                            */
/*  - Renders ONE segment per presentation row (not per raw event)     */
/*    so density matches what the user sees in the transcript.         */
/*  - Variable heights by importance: User/Agent/Error/Interrupt       */
/*    full height; Tool/Model reduced; idle = full w/ stripes.         */
/*  - Minimum block width 5px so single events never disappear.        */
/*  - Scroll playhead: thin vertical line tracks the current transcript*/
/*    scroll position inside the <main> container.                     */
/*  - Time axis ticks below the bar, auto-scaled by total duration.    */
/*  - Rich hover card (role pill + preview) instead of bare SVG title. */
/* ------------------------------------------------------------------ */

// MinimapSeg moved to ./session-view/types.ts

/** All rows render at full bar height — distinction comes from color/pattern
 *  alone, matching Claude Managed Agents' unified-height timeline. */
const ROW_IMPORTANCE: Record<PresentationRowKind, number> = {
  user: 1.0,
  agent: 1.0,
  interrupt: 1.0,
  error: 1.0,
  "tool-group": 1.0,
  model: 1.0,
  "task-notification": 1.0,
};

function Minimap({
  displayRows,
  durationMs,
  dayWindow,
  selectedIndex,
  onSelect,
  headerOffset,
  subagents,
  workflows,
  onWorkflowClick,
  collapsed,
  selectedSubagentId,
  onSelectSubagent,
  prMarkers,
  coldResumeMarkers,
  rawIdleBands,
  model,
  onPlayheadChange,
}: {
  displayRows: DisplayRow[];
  durationMs: number;
  /** When set, scope the timeline to this offset window (one local day).
   *  null renders the full session. */
  dayWindow?: { startMs: number; endMs: number } | null;
  selectedIndex: number | null;
  onSelect: (i: number) => void;
  headerOffset: number;
  subagents?: SubagentRun[];
  workflows?: WorkflowRun[];
  onWorkflowClick?: (runId: string) => void;
  collapsed?: boolean;
  selectedSubagentId?: string | null;
  onSelectSubagent?: (id: string | null) => void;
  prMarkers?: PrMarker[];
  coldResumeMarkers?: {
    tOffsetMs: number;
    info: NonNullable<SessionEvent["coldResume"]>;
  }[];
  /** Idle bands derived directly from raw event timestamps. Used in place
   *  of the legacy "gap before user row" heuristic so Codex sessions
   *  (which spend most of their time in agent reasoning, not user input)
   *  surface their dead-air on the minimap. */
  rawIdleBands?: { start: number; end: number; durationMs: number }[];
  model?: string;
  /** Fires with the offset (ms) of the topmost on-screen transcript row — the
   *  same scroll signal that draws the playhead. SessionView uses it to make
   *  the selected day follow scroll. */
  onPlayheadChange?: (ms: number | null) => void;
}) {
  const WIDTH = 1400;
  /** Main timeline height. Sub-agent lanes stack below this. */
  const MAIN_H = 28;
  /** Per-subagent lane height including the inner gap. */
  const SUB_LANE_H = 11;
  /** Gap between the main timeline and the sub-agent lanes (when present). */
  const SUB_LANE_GAP = 6;
  /** Per-workflow lane height — a touch taller than subagent lanes so the
   *  workflow tier reads as distinct. */
  const WF_LANE_H = 13;
  const BAR_TOP = 3;
  const BAR_BOT = MAIN_H - 3;
  const BAR_H = BAR_BOT - BAR_TOP;
  /** Gap subtracted from each segment's width so blocks never touch. */
  const GAP = 3;
  const MIN_BLOCK = 6;
  /** Minimum displayed segment width in SVG units. Every segment gets at
   *  least this much space regardless of time duration, so tool-group
   *  blocks inside a 24-minute session are still visible + clickable. */
  const MIN_DISPLAY_WIDTH = 12;
  /** Error/interrupt rendered as thin vertical bars capped at this width. */
  const THIN_BAR_MAX = 5;

  const [hover, setHover] = useState<{
    clientX: number;
    row?: PresentationRow;
    turn?: TurnMegaRow;
    idleMs?: number;
    subagent?: SubagentRun;
    workflow?: WorkflowRun;
    pr?: PrMarker;
    cold?: {
      tOffsetMs: number;
      info: NonNullable<SessionEvent["coldResume"]>;
    };
  } | null>(null);
  const [playheadMs, setPlayheadMs] = useState<number | null>(null);
  // Read inside the observer so the latest callback fires without re-subscribing
  // the IntersectionObserver (its effect deps stay [displayRows.length, headerOffset]).
  const onPlayheadChangeRef = useRef(onPlayheadChange);
  onPlayheadChangeRef.current = onPlayheadChange;
  const containerRef = useRef<HTMLDivElement>(null);

  /* Playhead — track which transcript row is at the top of the viewport.
   *
   * The old implementation ran `querySelectorAll("[data-sl-row-index]")`
   * on every scroll event. For a session with ~2000 rows that's thousands
   * of DOM queries per second during scroll — enough to pin a CPU core
   * and make Chrome ask to kill the tab. IntersectionObserver is event-
   * driven: the browser only notifies us when rows enter or leave the region
   * below the sticky header, so the cost scales with *changes* instead of
   * with scroll rate × row count.
   */
  useEffect(() => {
    const main = containerRef.current?.closest("main") as HTMLElement | null;
    if (!main) return;

    // Crop the observation region by the sticky header at the top and keep the
    // whole viewport below it. Every row visible below the header intersects
    // this region; the topmost (smallest offsetTop) is the row sitting at the
    // header line — the playhead. Using the full area (not a thin band) means
    // the playhead never blanks out in the gaps between sparse rows, so the
    // scroll→timeline highlight — and the day-follow that rides on it — stays
    // continuous. Still event-driven: a row only fires when it enters or
    // leaves, so cost scales with scroll distance, not row count.
    const rootMargin = `-${headerOffset}px 0px 0px 0px`;

    // Rows currently visible below the header. The topmost is the playhead.
    const visibleRows = new Set<HTMLElement>();

    const publishTopmost = () => {
      let value: number | null = null;
      if (visibleRows.size > 0) {
        let topmost: HTMLElement | null = null;
        let topmostOff = Infinity;
        for (const el of visibleRows) {
          const t = el.offsetTop;
          if (t < topmostOff) {
            topmostOff = t;
            topmost = el;
          }
        }
        if (topmost) {
          const tOff = Number(topmost.getAttribute("data-sl-toffset"));
          value = Number.isNaN(tOff) ? null : tOff;
        }
      }
      setPlayheadMs(value);
      onPlayheadChangeRef.current?.(value);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          if (e.isIntersecting) visibleRows.add(el);
          else visibleRows.delete(el);
        }
        publishTopmost();
      },
      { root: main, rootMargin, threshold: 0 },
    );

    // Observe all current rows. Re-observes whenever the row count
    // changes (i.e. filter switch, turn expand/collapse).
    const rows = main.querySelectorAll<HTMLDivElement>("[data-sl-row-index]");
    for (const r of rows) observer.observe(r);

    return () => observer.disconnect();
  }, [displayRows.length, headerOffset]);

  // Offset window for the rendered timeline. `winEnd` is the absolute offset
  // of the right edge (session/day end); `safeDur` is the window LENGTH used
  // as the proportional-width divisor. For a single-day session (dayWindow
  // null) these collapse to [0, durationMs] — identical to the old behavior.
  const winStart = dayWindow?.startMs ?? 0;
  const winEnd = dayWindow?.endMs ?? durationMs;
  const safeDur = Math.max(winEnd - winStart, 1);

  // Subagent/workflow lanes are scoped to the same window as the main
  // timeline so a day view doesn't reserve empty lanes for runs that happened
  // on other days. Overlap test, not containment — a run straddling the
  // window edge still shows.
  const winSubagents = useMemo(
    () =>
      (subagents ?? []).filter(
        (s) =>
          s.startTOffsetMs !== undefined &&
          s.endTOffsetMs !== undefined &&
          s.endTOffsetMs >= winStart &&
          s.startTOffsetMs <= winEnd,
      ),
    [subagents, winStart, winEnd],
  );
  const winWorkflows = useMemo(
    () =>
      (workflows ?? []).filter(
        (w) =>
          w.startTOffsetMs !== undefined &&
          w.startTOffsetMs <= winEnd &&
          (w.endTOffsetMs ?? winEnd) >= winStart,
      ),
    [workflows, winStart, winEnd],
  );

  /* Build segments from the same display-row stream the transcript
     uses. Collapsed turns become one wide segment; expanded-turn
     headers are skipped; presentation rows (whether standalone or
     indented children of an expanded turn) become atomic segments. */
  const segs: MinimapSeg[] = useMemo(() => {
    const out: MinimapSeg[] = [];

    // Flatten to (item, start) pairs with the expanded-turn headers removed
    // and collapsed turns preserved as single-item entries.
    type WithTime =
      | { kind: "row"; row: PresentationRow; start: number; gapMs: number }
      | {
          kind: "turn";
          turn: TurnMegaRow;
          start: number;
          gapMs: number;
        };

    const withTime: WithTime[] = [];
    for (const d of displayRows) {
      if (d.kind === "turn-expanded-header") continue;
      if (d.kind === "turn-expanded-footer") continue;
      if (d.kind === "turn-collapsed") {
        if (d.turn.tOffsetMs === undefined) continue;
        if (d.turn.tOffsetMs < winStart || d.turn.tOffsetMs > winEnd) continue;
        withTime.push({
          kind: "turn",
          turn: d.turn,
          start: d.turn.tOffsetMs,
          gapMs: d.turn.rows[0]?.gapMs ?? 0,
        });
      } else {
        // presentation row
        if (d.row.tOffsetMs === undefined) continue;
        if (d.row.tOffsetMs < winStart || d.row.tOffsetMs > winEnd) continue;
        withTime.push({
          kind: "row",
          row: d.row,
          start: d.row.tOffsetMs,
          gapMs: d.row.gapMs ?? 0,
        });
      }
    }

    // Build a sorted copy of idle bands so we can clip row/turn ends to
    // the start of the next idle band (or the next row, whichever comes
    // first). This stops a row's rectangle from spanning across an idle
    // gap and visually swallowing it.
    const idleBands = (rawIdleBands ?? [])
      .filter((b) => b.end > winStart && b.start < winEnd)
      .sort((a, b) => a.start - b.start);
    const nextIdleStartFrom = (t: number): number | undefined => {
      for (const b of idleBands) {
        if (b.start >= t) return b.start;
      }
      return undefined;
    };

    for (let i = 0; i < withTime.length; i++) {
      const item = withTime[i];
      const next = withTime[i + 1];
      const start = item.start;
      const nextRowStart = next?.start;
      const nextIdleStart = nextIdleStartFrom(start + 1);
      // Cap end to whichever comes first: next visible row, next idle band,
      // or the window's right edge (so a day's last segment doesn't bleed
      // past the scoped window into the next day).
      const cap = (raw: number) =>
        Math.min(
          raw,
          nextRowStart ?? Number.POSITIVE_INFINITY,
          nextIdleStart ?? Number.POSITIVE_INFINITY,
          winEnd,
        );

      if (item.kind === "turn") {
        const turnEnd = start + (item.turn.durationMs ?? 0);
        out.push({
          kind: "turn",
          turn: item.turn,
          primaryIndex: item.turn.firstPrimaryIndex,
          start,
          end: Math.max(cap(turnEnd), start + 1),
        });
      } else {
        const end = cap(nextRowStart ?? start + 800);
        out.push({
          kind: "row",
          row: item.row,
          primaryIndex: rowPrimaryIndex(item.row),
          start,
          end: Math.max(end, start + 1),
        });
      }
    }

    // Idle bands are computed from raw event timestamps (5s threshold) up
    // in the parent — append them and let the sort below interleave by
    // start time so they slot between rows correctly.
    for (const band of idleBands) {
      out.push({
        kind: "idle",
        start: band.start,
        end: band.end,
        durationMs: band.durationMs,
      });
    }
    out.sort((a, b) => a.start - b.start);

    // Cap the number of rendered segments. Each <rect> carries two
    // event handlers (onMouseEnter + onClick), so 2000 raw-events in
    // "All events" mode becomes 4000 DOM event listeners — enough to
    // stall Chrome during paint. Sampling to MAX contiguous buckets
    // loses per-item hover precision but keeps the overall shape and
    // click-to-navigate behavior (clicks map to the first row inside
    // the bucket, which is the right anchor for "jump here" UX).
    const MAX_SEGMENTS = 600;
    if (out.length <= MAX_SEGMENTS) return out;

    const step = Math.ceil(out.length / MAX_SEGMENTS);
    const bucketed: MinimapSeg[] = [];
    for (let i = 0; i < out.length; i += step) {
      const first = out[i]!;
      const last = out[Math.min(i + step - 1, out.length - 1)]!;
      // Merge bucket: keep the first seg's kind + primaryIndex (so clicks
      // jump to the first item of the bucket), but extend the end range
      // to cover the whole bucket's time span.
      if (first.kind === "idle") {
        bucketed.push({
          kind: "idle",
          start: first.start,
          end: last.end,
          durationMs: last.end - first.start,
        });
      } else if (first.kind === "turn") {
        bucketed.push({
          kind: "turn",
          turn: first.turn,
          primaryIndex: first.primaryIndex,
          start: first.start,
          end: last.end,
        });
      } else {
        bucketed.push({
          kind: "row",
          row: first.row,
          primaryIndex: first.primaryIndex,
          start: first.start,
          end: last.end,
        });
      }
    }
    return bucketed;
  }, [displayRows, safeDur, rawIdleBands, winStart, winEnd]);

  /* Sequential layout with a minimum displayed width per segment.
     - Raw proportional width = (seg.end - seg.start) / safeDur * WIDTH
     - Enforced width = max(raw, MIN_DISPLAY_WIDTH)
     - x positions are cumulative (not time-proportional), so tiny events
       stay visible next to a 24-minute turn.
     - If the cumulative width exceeds WIDTH, proportionally shrink so it
       all fits. Time ordering is preserved; exact time-to-pixel mapping
       is sacrificed. */
  const positions: { x: number; w: number }[] = useMemo(() => {
    if (segs.length === 0) return [];
    const raws = segs.map((s) => ((s.end - s.start) / safeDur) * WIDTH);
    const enforced = raws.map((w) => Math.max(w, MIN_DISPLAY_WIDTH));
    const total = enforced.reduce((a, b) => a + b, 0);
    const scale = WIDTH / total;
    const out: { x: number; w: number }[] = [];
    let cursor = 0;
    for (const w of enforced) {
      const scaled = w * scale;
      out.push({ x: cursor, w: scaled });
      cursor += scaled;
    }
    return out;
  }, [segs, safeDur]);

  /** Map a time offset (ms) to an x coordinate in the relaxed layout.
   *  Walks segments sequentially and interpolates within whichever one
   *  contains the target ms. Used for the playhead indicator. */
  const msToX = (ms: number): number => {
    if (segs.length === 0) return 0;
    if (ms <= segs[0].start) return positions[0]?.x ?? 0;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const p = positions[i];
      if (!p) continue;
      if (ms < s.start) return p.x;
      if (ms <= s.end) {
        const segDur = s.end - s.start;
        const frac = segDur > 0 ? (ms - s.start) / segDur : 0;
        return p.x + frac * p.w;
      }
    }
    const last = positions[positions.length - 1];
    return last ? last.x + last.w : WIDTH;
  };

  // ---- Sub-agent lane assignment -------------------------------------
  // Place each subagent in the lowest lane index where it doesn't
  // collide with the most recent bar in that lane. Greedy left→right
  // sweep — O(N×L) where L is the number of lanes (small in practice).
  // Returns a Map agentId → laneIndex plus the total lane count.
  const { laneOf, laneCount } = useMemo(() => {
    if (winSubagents.length === 0) {
      return { laneOf: new Map<string, number>(), laneCount: 0 };
    }
    const sorted = [...winSubagents].sort(
      (a, b) => (a.startTOffsetMs ?? 0) - (b.startTOffsetMs ?? 0),
    );
    const laneEnds: number[] = [];
    const laneOf = new Map<string, number>();
    for (const s of sorted) {
      const start = s.startTOffsetMs ?? 0;
      const end = s.endTOffsetMs ?? start + 1;
      let assigned = -1;
      for (let i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i]! <= start) {
          assigned = i;
          break;
        }
      }
      if (assigned === -1) {
        assigned = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[assigned] = end;
      laneOf.set(s.agentId, assigned);
    }
    return { laneOf, laneCount: laneEnds.length };
  }, [winSubagents]);

  const SUB_BLOCK_TOP = MAIN_H + SUB_LANE_GAP;
  const SUB_LANES_H = laneCount > 0 ? laneCount * SUB_LANE_H : 0;

  // ---- Workflow lane assignment --------------------------------------
  // Same greedy sweep as subagents. Workflow runs are mostly sequential
  // milestones, so this usually collapses to one lane — but overlap is
  // handled if two runs ever ran concurrently.
  const { wfLaneOf, wfLaneCount } = useMemo(() => {
    // Only place workflows we can actually draw (startTOffsetMs known). A
    // running run has no end yet — it extends to the session end (safeDur),
    // matching the open-ended bar the render draws. Counting only placeable
    // runs keeps wfLaneCount in lockstep with what renders, so no empty
    // reserved band appears.
    const placeable = winWorkflows;
    if (placeable.length === 0) {
      return { wfLaneOf: new Map<string, number>(), wfLaneCount: 0 };
    }
    const sorted = [...placeable].sort(
      (a, b) => (a.startTOffsetMs ?? 0) - (b.startTOffsetMs ?? 0),
    );
    const laneEnds: number[] = [];
    const wfLaneOf = new Map<string, number>();
    for (const w of sorted) {
      const start = w.startTOffsetMs ?? 0;
      const end = w.endTOffsetMs ?? winEnd;
      let assigned = -1;
      for (let i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i]! <= start) {
          assigned = i;
          break;
        }
      }
      if (assigned === -1) {
        assigned = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[assigned] = Math.max(end, start + 1);
      wfLaneOf.set(w.runId, assigned);
    }
    return { wfLaneOf, wfLaneCount: laneEnds.length };
  }, [winWorkflows, winEnd]);

  const SUB_BLOCK_BOTTOM = MAIN_H + (laneCount > 0 ? SUB_LANE_GAP + SUB_LANES_H : 0);
  const WF_BLOCK_TOP = SUB_BLOCK_BOTTOM + (wfLaneCount > 0 ? SUB_LANE_GAP : 0);
  const WF_LANES_H = wfLaneCount > 0 ? wfLaneCount * WF_LANE_H : 0;
  const TOTAL_H = SUB_BLOCK_BOTTOM + (wfLaneCount > 0 ? SUB_LANE_GAP + WF_LANES_H : 0);

  return (
    <div
      ref={containerRef}
      style={{
        padding: "8px 10px",
        position: "relative",
        background: "var(--af-surface)",
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 8,
        marginTop: 2,
      }}
      onMouseLeave={() => setHover(null)}
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${TOTAL_H}`}
        preserveAspectRatio="none"
        style={{
          width: "100%",
          height: TOTAL_H,
          display: "block",
          overflow: "visible",
        }}
      >
        <defs>
          <pattern
            id="stripes"
            patternUnits="userSpaceOnUse"
            width="6"
            height="6"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill="rgba(120, 115, 108, 0.04)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(120, 115, 108, 0.28)" strokeWidth="2" />
          </pattern>
        </defs>

        {/* Segments — x/w come from the relaxed sequential layout, NOT
            from raw time proportions. See the positions memo above. */}
        {segs.map((seg, i) => {
          const pos = positions[i];
          if (!pos) return null;
          const xRaw = pos.x;
          const wRaw = pos.w;

          if (seg.kind === "idle") {
            // Idle block: fill its span minus a gap on each side, with a
            // subtle border so the diagonal stripes read as a distinct block.
            const w = Math.max(wRaw - GAP, MIN_BLOCK);
            return (
              <rect
                key={`idle-${i}`}
                x={xRaw + GAP / 2}
                y={BAR_TOP + 1}
                width={w}
                height={BAR_H - 2}
                fill="url(#stripes)"
                stroke="rgba(120, 115, 108, 0.35)"
                strokeWidth="0.6"
                rx="3"
                onMouseEnter={(e) =>
                  setHover({
                    clientX: e.clientX,
                    idleMs: seg.durationMs,
                  })
                }
              />
            );
          }

          // Resolve the theme + selection state. Turn segments use the
          // "agent" theme (a turn is the agent's work wrapped as one unit).
          const rowKind: PresentationRowKind = seg.kind === "turn" ? "agent" : seg.row.kind;
          const theme = ROLE_THEMES[rowKind];
          const importance = ROW_IMPORTANCE[rowKind];
          const h = BAR_H * importance;
          const y = BAR_TOP + (BAR_H - h) / 2;
          const isSelected = selectedIndex === seg.primaryIndex;

          // Error/interrupt: render as a THIN vertical bar regardless of
          // actual span. Consecutive errors become a visible comb of
          // narrow strokes separated by gaps, matching Claude's UI.
          const isThin =
            seg.kind === "row" && (seg.row.kind === "error" || seg.row.kind === "interrupt");
          let w: number;
          let x: number;
          if (isThin) {
            w = Math.min(Math.max(wRaw - GAP, 2), THIN_BAR_MAX);
            x = xRaw + Math.max((wRaw - w) / 2, GAP / 2);
          } else {
            w = Math.max(wRaw - GAP, MIN_BLOCK);
            x = xRaw + GAP / 2;
          }

          const ringPad = 2.5;
          const onHover = (e: React.MouseEvent) =>
            seg.kind === "turn"
              ? setHover({ clientX: e.clientX, turn: seg.turn })
              : setHover({ clientX: e.clientX, row: seg.row });
          return (
            <g key={`seg-${seg.primaryIndex}-${i}`}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill={theme.mini}
                rx="3"
                style={{ cursor: "pointer" }}
                onClick={() => onSelect(seg.primaryIndex)}
                onMouseEnter={onHover}
              />
              {isSelected && (
                <rect
                  x={x - ringPad}
                  y={y - ringPad}
                  width={w + ringPad * 2}
                  height={h + ringPad * 2}
                  fill="none"
                  stroke="#5C84C3"
                  strokeWidth="2"
                  rx="5"
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}

        {/* Sub-agent lanes — one row per lane, colored by agentType.
            Background-mode runs are highlighted with a brighter fill +
            extra dashed outline so you can spot true parallelism at a
            glance. Bars use the same msToX mapping as the main timeline
            so the subagent's start/end aligns vertically with whatever
            was happening in the main session at that time. */}
        {laneCount > 0 && winSubagents.length > 0 && (
          <g>
            {/* Faint divider line above the subagent lane block */}
            <line
              x1={0}
              x2={WIDTH}
              y1={MAIN_H + SUB_LANE_GAP / 2}
              y2={MAIN_H + SUB_LANE_GAP / 2}
              stroke="var(--af-border-subtle)"
              strokeWidth="0.6"
              strokeDasharray="2 4"
            />
            {winSubagents.map((s) => {
              const lane = laneOf.get(s.agentId) ?? 0;
              if (s.startTOffsetMs === undefined || s.endTOffsetMs === undefined) return null;
              const startX = msToX(s.startTOffsetMs);
              const endX = msToX(s.endTOffsetMs);
              // Minimum 8px so a 78-second subagent in a 16-hour session is
              // still wide enough to read + hit-test. Long subagents render
              // at their actual proportional width.
              const w = Math.max(endX - startX, 8);
              const y = SUB_BLOCK_TOP + lane * SUB_LANE_H;
              const h = SUB_LANE_H - 2;
              const fill = subagentColor(s.agentType, s.runInBackground);
              const isSelected = selectedSubagentId === s.agentId;
              return (
                <g key={s.agentId}>
                  <rect
                    x={startX}
                    y={y}
                    width={w}
                    height={h}
                    fill={fill}
                    stroke={s.runInBackground ? "#fff" : "transparent"}
                    strokeWidth={s.runInBackground ? 0.5 : 0}
                    strokeDasharray={s.runInBackground ? "1.5 1.5" : undefined}
                    rx="2"
                    style={{ cursor: "pointer" }}
                    onMouseEnter={(e) => setHover({ clientX: e.clientX, subagent: s })}
                    onClick={() => onSelectSubagent?.(isSelected ? null : s.agentId)}
                  />
                  {isSelected && (
                    <rect
                      x={startX - 2}
                      y={y - 2}
                      width={w + 4}
                      height={h + 4}
                      fill="none"
                      stroke="var(--af-accent)"
                      strokeWidth="1.5"
                      rx="4"
                      pointerEvents="none"
                    />
                  )}
                </g>
              );
            })}
          </g>
        )}

        {/* Workflow lanes — one bar per dynamic-workflow run, on the same
            time axis as the main timeline, colored by status (orange tier,
            distinct from the blue/purple subagents). The agent count is the
            headline — a single Workflow tool call hides a whole fleet. */}
        {wfLaneCount > 0 && winWorkflows.length > 0 && (
          <g>
            <line
              x1={0}
              x2={WIDTH}
              y1={WF_BLOCK_TOP - SUB_LANE_GAP / 2}
              y2={WF_BLOCK_TOP - SUB_LANE_GAP / 2}
              stroke="var(--af-border-subtle)"
              strokeWidth="0.6"
              strokeDasharray="2 4"
            />
            {winWorkflows.map((w) => {
              if (w.startTOffsetMs === undefined) return null;
              const lane = wfLaneOf.get(w.runId) ?? 0;
              const startX = msToX(w.startTOffsetMs);
              // A still-running run has no endTOffsetMs — draw it open-ended to
              // the session end so it's visible (and dashed, to read as ongoing)
              // rather than vanishing while still occupying a reserved lane.
              const inProgress = w.endTOffsetMs === undefined;
              const endX = msToX(w.endTOffsetMs ?? winEnd);
              const wWidth = Math.max(endX - startX, 8);
              const y = WF_BLOCK_TOP + lane * WF_LANE_H;
              const h = WF_LANE_H - 2;
              const fill = workflowColor(w.status);
              // Center the agent count label inside the bar when there's room.
              const label = `${w.agentCount}`;
              const showLabel = wWidth > 22;
              return (
                <g key={w.runId} style={{ cursor: "pointer" }}>
                  <rect
                    x={startX}
                    y={y}
                    width={wWidth}
                    height={h}
                    fill={fill}
                    fillOpacity={inProgress ? 0.55 : 1}
                    stroke={inProgress ? fill : "transparent"}
                    strokeWidth={inProgress ? 0.8 : 0}
                    strokeDasharray={inProgress ? "2 2" : undefined}
                    rx="2"
                    onMouseEnter={(e) => setHover({ clientX: e.clientX, workflow: w })}
                    onClick={() => onWorkflowClick?.(w.runId)}
                  />
                  {showLabel && (
                    <text
                      x={startX + wWidth / 2}
                      y={y + h / 2 + 3}
                      textAnchor="middle"
                      fontSize="8.5"
                      fontWeight="700"
                      fill="#fff"
                      pointerEvents="none"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        )}

        {/* PR markers — diamond + vertical line at each `gh pr create` */}
        {prMarkers?.map((pr, i) => {
          if (pr.tOffsetMs === undefined) return null;
          if (pr.tOffsetMs < winStart || pr.tOffsetMs > winEnd) return null;
          const x = msToX(pr.tOffsetMs);
          return (
            <g
              key={`pr-${i}`}
              style={{ cursor: "pointer" }}
              onMouseEnter={(e) => setHover({ clientX: e.clientX, pr })}
            >
              <line
                x1={x}
                x2={x}
                y1={0}
                y2={TOTAL_H}
                stroke="#8b5cf6"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                opacity="0.7"
              />
              {/* Invisible wider hit area for easier hovering */}
              <rect
                x={x - 8}
                y={0}
                width={16}
                height={TOTAL_H}
                fill="transparent"
              />
              {/* Diamond marker at mid-height */}
              <polygon
                points={`${x},${MAIN_H / 2 - 5} ${x + 5},${MAIN_H / 2} ${x},${MAIN_H / 2 + 5} ${x - 5},${MAIN_H / 2}`}
                fill="#8b5cf6"
                stroke="var(--af-surface)"
                strokeWidth="1.5"
              />
            </g>
          );
        })}

        {coldResumeMarkers?.map((cr, i) => {
          if (cr.tOffsetMs < winStart || cr.tOffsetMs > winEnd) return null;
          const x = msToX(cr.tOffsetMs);
          return (
            <g
              key={`cold-${i}`}
              style={{ cursor: "pointer" }}
              onMouseEnter={(e) => setHover({ clientX: e.clientX, cold: cr })}
            >
              <line
                x1={x}
                x2={x}
                y1={0}
                y2={TOTAL_H}
                stroke="#D97706"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                opacity="0.75"
                pointerEvents="none"
              />
              {/* Hover hit-area limited to the diamond itself — a wider/taller
                  target used to swallow hovers+clicks meant for adjacent
                  user-prompt markers sitting right beside the cache-rebuild
                  point. */}
              <rect
                x={x - 6}
                y={MAIN_H / 2 - 8}
                width={12}
                height={16}
                fill="transparent"
              />
              <polygon
                points={`${x},${MAIN_H / 2 - 5} ${x + 5},${MAIN_H / 2} ${x},${MAIN_H / 2 + 5} ${x - 5},${MAIN_H / 2}`}
                fill="#D97706"
                stroke="var(--af-surface)"
                strokeWidth="1.5"
                pointerEvents="none"
              />
            </g>
          );
        })}

        {/* Playhead — positioned against the relaxed layout, not raw time.
            Spans the full SVG height (main + subagent lanes) so you can see
            which subagents were running at the current scroll position. */}
        {playheadMs !== null && (
          <line
            x1={msToX(playheadMs)}
            x2={msToX(playheadMs)}
            y1={0}
            y2={TOTAL_H}
            stroke="#0F172A"
            strokeWidth="1.25"
            strokeDasharray="2 2"
            opacity="0.65"
          />
        )}
      </svg>

      {/* Hover card */}
      {hover && (
        <MinimapHoverCard
          containerRef={containerRef}
          clientX={hover.clientX}
          row={hover.row}
          turn={hover.turn}
          idleMs={hover.idleMs}
          subagent={hover.subagent}
          workflow={hover.workflow}
          pr={hover.pr}
          cold={hover.cold}
          model={model}
        />
      )}

      {/* Sub-agent legend strip — only when there are subagent lanes. */}
      {laneCount > 0 && subagents && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 6,
            fontSize: 10,
            color: "var(--af-text-tertiary)",
          }}
        >
          <span style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Sub-agents
          </span>
          <span>·</span>
          <span>
            {subagents.length} run{subagents.length === 1 ? "" : "s"}
          </span>
          <span style={{ marginLeft: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Array.from(new Set(subagents.map((s) => s.agentType))).map((type) => (
              <span
                key={type}
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: subagentColor(type, false),
                  }}
                />
                {type}
              </span>
            ))}
            {subagents.some((s) => s.runInBackground) && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: "transparent",
                    border: "1px dashed var(--af-text-secondary)",
                  }}
                />
                background
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

// subagentColor, workflowColor moved to ./session-view/colors.ts

function MinimapHoverCard({
  containerRef,
  clientX,
  row,
  turn,
  idleMs,
  subagent,
  workflow,
  pr,
  cold,
  model,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  clientX: number;
  row?: PresentationRow;
  turn?: TurnMegaRow;
  idleMs?: number;
  subagent?: SubagentRun;
  workflow?: WorkflowRun;
  pr?: PrMarker;
  cold?: { tOffsetMs: number; info: NonNullable<SessionEvent["coldResume"]> };
  model?: string;
}) {
  const rect = containerRef.current?.getBoundingClientRect();
  const localX = rect ? clientX - rect.left : 0;
  const left = Math.min(Math.max(localX - 140, 8), (rect?.width ?? 1400) - 300);
  // Always open below the minimap. The minimap lives inside the sticky
  // header, so there's never reliable space above it for a tooltip.
  const posStyle = { top: "calc(100% + 8px)", left };

  if (workflow) {
    const w = workflow;
    const startOff = formatOffset(w.startTOffsetMs);
    const endOff = formatOffset(w.endTOffsetMs);
    const dur = w.durationMs !== undefined ? formatGap(w.durationMs) : "";
    return (
      <div
        style={{
          position: "absolute",
          ...posStyle,
          zIndex: 100,
          background: "#0F172A",
          color: "#F1F5F9",
          borderRadius: 10,
          padding: "12px 14px",
          fontSize: 11,
          pointerEvents: "none",
          boxShadow: "0 6px 24px rgba(15,23,42,0.22)",
          maxWidth: 440,
          minWidth: 280,
          lineHeight: 1.45,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 4,
              background: workflowColor(w.status),
              color: "#fff",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            workflow · {w.status}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              opacity: 0.7,
              marginLeft: "auto",
            }}
          >
            {startOff} → {endOff} · {dur}
          </span>
        </div>
        <div style={{ fontWeight: 600, marginBottom: 4, fontFamily: "var(--font-mono)" }}>
          {w.name}
        </div>
        {w.description && (
          <div style={{ opacity: 0.8, marginBottom: 6 }}>{w.description}</div>
        )}
        <div
          style={{
            fontSize: 10,
            opacity: 0.75,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            paddingTop: 6,
            borderTop: "1px solid rgba(241,245,249,0.08)",
            fontFamily: "var(--font-mono)",
          }}
        >
          <span style={{ color: "#FB923C", fontWeight: 600 }}>{w.agentCount} agents</span>
          <span>·</span>
          <span>{w.toolCallCount.toLocaleString()} tools</span>
          <span>·</span>
          <span>{formatTokens(w.totalTokens)} tok</span>
          {w.phases.length > 0 && (
            <>
              <span>·</span>
              <span>{w.phases.length} phases</span>
            </>
          )}
        </div>
        <div style={{ marginTop: 6, fontSize: 10, opacity: 0.55, fontStyle: "italic" }}>
          Click to open this run in the Workflows tab.
        </div>
      </div>
    );
  }

  if (subagent) {
    const startOff = formatOffset(subagent.startTOffsetMs);
    const endOff = formatOffset(subagent.endTOffsetMs);
    const dur = subagent.durationMs !== undefined ? formatGap(subagent.durationMs) : "";
    const totalIn =
      subagent.totalUsage.input + subagent.totalUsage.cacheRead + subagent.totalUsage.cacheWrite;
    return (
      <div
        style={{
          position: "absolute",
          ...posStyle,
          zIndex: 100,
          background: "#0F172A",
          color: "#F1F5F9",
          borderRadius: 10,
          padding: "12px 14px",
          fontSize: 11,
          pointerEvents: "none",
          boxShadow: "0 6px 24px rgba(15,23,42,0.22)",
          maxWidth: 440,
          minWidth: 280,
          lineHeight: 1.45,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 4,
              background: subagentColor(subagent.agentType, subagent.runInBackground),
              color: "#fff",
            }}
          >
            {subagent.agentType}
          </span>
          {subagent.runInBackground && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: 3,
                background: "rgba(251, 191, 36, 0.18)",
                color: "#FBBF24",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              background
            </span>
          )}
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              opacity: 0.7,
              marginLeft: "auto",
            }}
          >
            {startOff} → {endOff} · {dur}
          </span>
        </div>
        <div style={{ fontWeight: 500, marginBottom: 6 }}>{subagent.description}</div>
        <div
          style={{
            fontSize: 10,
            opacity: 0.65,
            display: "flex",
            gap: 8,
            paddingTop: 6,
            borderTop: "1px solid rgba(241,245,249,0.08)",
          }}
        >
          <span>{subagent.eventCount} events</span>
          <span>·</span>
          <span style={{ fontFamily: "var(--font-mono)" }}>
            {formatTokens(totalIn)}/{formatTokens(subagent.totalUsage.output)} tok
          </span>
        </div>
        {subagent.finalPreview && (
          <div
            style={{
              marginTop: 6,
              opacity: 0.78,
              fontStyle: "italic",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            → {subagent.finalPreview}
          </div>
        )}
      </div>
    );
  }

  if (cold) {
    const { trigger, gapMs, writeTokens, compact } = cold.info;
    const isCompact = trigger === "compact";
    const estUsd = estimateCost(
      { input: 0, output: 0, cacheRead: 0, cacheWrite: writeTokens },
      model,
    );
    let label: string;
    if (!isCompact) label = "⚡ CACHE REBUILD";
    else if (compact?.trigger === "auto") label = "⚡ AUTO-COMPACT";
    else label = "⚡ /COMPACT";
    const detailLine = isCompact
      ? `${formatTokens(writeTokens)} rewritten · pre-compact ${formatTokens(compact?.preTokens ?? 0)}`
      : `${formatTokens(writeTokens)} rewritten · idle ${formatGap(gapMs)}`;
    const hint = isCompact
      ? "Conversation was summarized; prefix had to be rewritten into a fresh cache."
      : "Prompt cache expired during idle; resuming within 5 min keeps it warm.";
    return (
      <div
        style={{
          position: "absolute",
          ...posStyle,
          zIndex: 100,
          background: "#0F172A",
          color: "#F1F5F9",
          borderRadius: 10,
          padding: "10px 14px",
          fontSize: 11,
          pointerEvents: "none",
          boxShadow: "0 6px 24px rgba(15,23,42,0.22)",
          maxWidth: 340,
          minWidth: 220,
          lineHeight: 1.45,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 4,
              background: "#D97706",
              color: "#fff",
            }}
          >
            {label}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, opacity: 0.7 }}>
            at {formatOffset(cold.tOffsetMs)}
          </span>
        </div>
        <div style={{ fontWeight: 500, fontFamily: "var(--font-mono)" }}>
          {detailLine}
          {estUsd >= 0.005 && ` · est. ${formatCost(estUsd)}`}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 10,
            opacity: 0.65,
            fontStyle: "italic",
            whiteSpace: "normal",
          }}
        >
          {hint}
        </div>
      </div>
    );
  }

  if (pr) {
    const label = pr.title
      ? `PR${pr.prNumber ? ` #${pr.prNumber}` : ""}: ${pr.title}`
      : pr.prNumber
        ? `PR #${pr.prNumber}`
        : "PR created";
    return (
      <div
        style={{
          position: "absolute",
          ...posStyle,
          zIndex: 100,
          background: "#0F172A",
          color: "#F1F5F9",
          borderRadius: 10,
          padding: "10px 14px",
          fontSize: 11,
          pointerEvents: "none",
          boxShadow: "0 6px 24px rgba(15,23,42,0.22)",
          maxWidth: 360,
          minWidth: 200,
          lineHeight: 1.45,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 4,
              background: "#8b5cf6",
              color: "#fff",
            }}
          >
            PR
          </span>
          {pr.tOffsetMs !== undefined && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, opacity: 0.7 }}>
              at {formatOffset(pr.tOffsetMs)}
            </span>
          )}
        </div>
        <div style={{ fontWeight: 500 }}>{label}</div>
      </div>
    );
  }

  if (idleMs !== undefined) {
    return (
      <div
        style={{
          position: "absolute",
          ...posStyle,
          zIndex: 100,
          background: "#0F172A",
          color: "#F1F5F9",
          borderRadius: 10,
          padding: "8px 12px",
          fontSize: 11,
          pointerEvents: "none",
          boxShadow: "0 6px 24px rgba(15,23,42,0.22)",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 2 }}>Session idle</div>
        <div style={{ opacity: 0.78, fontFamily: "var(--font-mono)" }}>{formatGap(idleMs)}</div>
      </div>
    );
  }

  if (turn) {
    const theme = ROLE_THEMES.agent;
    const s = turn.summary;
    const dur = turn.durationMs !== undefined ? formatGap(turn.durationMs) : "";
    const startOff = formatOffset(turn.tOffsetMs);
    const endOff =
      turn.tOffsetMs !== undefined && turn.durationMs !== undefined
        ? formatOffset(turn.tOffsetMs + turn.durationMs)
        : undefined;
    const hasFirstLast =
      s.firstAgentPreview && s.finalAgentPreview && s.firstAgentPreview !== s.finalAgentPreview;
    // Top tools aggregated summary line (up to 3 entries)
    const topTools = s.toolNames
      .slice(0, 3)
      .map((t) =>
        t.count > 1 ? `${shortenToolName(t.name)} ×${t.count}` : shortenToolName(t.name),
      )
      .join(" · ");

    return (
      <div
        style={{
          position: "absolute",
          ...posStyle,
          zIndex: 100,
          background: "#0F172A",
          color: "#F1F5F9",
          borderRadius: 10,
          padding: "12px 14px",
          fontSize: 11,
          pointerEvents: "none",
          boxShadow: "0 6px 24px rgba(15,23,42,0.22)",
          maxWidth: 440,
          minWidth: 280,
          lineHeight: 1.45,
        }}
      >
        {/* Header: Turn pill + start→end range */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 4,
              background: theme.mini,
              color: "#fff",
            }}
          >
            Turn
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              opacity: 0.7,
            }}
          >
            {endOff ? `${startOff} → ${endOff}` : startOff}
          </span>
          {dur && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                opacity: 0.55,
              }}
            >
              · {dur}
            </span>
          )}
        </div>

        {/* First agent message */}
        {s.firstAgentPreview && (
          <div
            style={{
              opacity: 0.95,
              fontWeight: 500,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              marginBottom: 6,
            }}
          >
            {s.firstAgentPreview}
          </div>
        )}

        {/* Middle: stats + top tools */}
        <div
          style={{
            fontSize: 10,
            opacity: 0.65,
            marginBottom: hasFirstLast ? 6 : 0,
            borderTop: s.firstAgentPreview ? "1px solid rgba(241,245,249,0.08)" : undefined,
            paddingTop: s.firstAgentPreview ? 6 : 0,
          }}
        >
          {s.agentMessages} msg · {s.toolCalls} tools
          {s.errors > 0 ? ` · ${s.errors} err` : ""}
          {topTools && (
            <>
              <span style={{ opacity: 0.5, margin: "0 4px" }}>·</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>{topTools}</span>
              {s.toolNames.length > 3 && (
                <span style={{ opacity: 0.65 }}> +{s.toolNames.length - 3}</span>
              )}
            </>
          )}
        </div>

        {/* Last agent message */}
        {hasFirstLast && s.finalAgentPreview && (
          <div
            style={{
              opacity: 0.92,
              display: "flex",
              gap: 6,
              alignItems: "flex-start",
              borderTop: "1px solid rgba(241,245,249,0.08)",
              paddingTop: 6,
            }}
          >
            <span style={{ opacity: 0.5 }}>→</span>
            <span
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {s.finalAgentPreview}
            </span>
          </div>
        )}
      </div>
    );
  }

  if (!row) return null;

  const theme = ROLE_THEMES[row.kind];
  const preview = rowPreview(row);

  return (
    <div
      style={{
        position: "absolute",
        ...posStyle,
        zIndex: 100,
        background: "#0F172A",
        color: "#F1F5F9",
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 11,
        pointerEvents: "none",
        boxShadow: "0 6px 24px rgba(15,23,42,0.22)",
        maxWidth: 360,
        minWidth: 220,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: 4,
            background: theme.mini,
            color: "#fff",
          }}
        >
          {theme.label}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            opacity: 0.65,
          }}
        >
          {formatOffset(row.tOffsetMs)}
        </span>
      </div>
      <div
        style={{
          lineHeight: 1.45,
          opacity: 0.92,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {preview}
      </div>
    </div>
  );
}

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
/*                                                                     */
/*  A single `Workflow` tool call collapses a whole dynamic-workflow   */
/*  fan-out into one transcript row. This panel surfaces what that row */
/*  actually did: each run's spawned-agent count, tool calls, tokens,  */
/*  phases, and progress log — the fleet work the transcript hides.    */
/* ------------------------------------------------------------------ */

function WorkflowsPanel({
  workflows,
  spawnedAgentCount,
  focusRunId,
  selectedAgentKey,
  onOpenAgent,
  onJumpToParent,
  onClearFocus,
}: {
  workflows: WorkflowRun[];
  spawnedAgentCount: number;
  focusRunId?: string | null;
  selectedAgentKey?: string | null;
  onOpenAgent: (runId: string, agent: WorkflowRun["agents"][number]) => void;
  onJumpToParent: (toolUseId?: string) => void;
  onClearFocus?: () => void;
}) {
  const totalTokens = workflows.reduce((n, w) => n + w.totalTokens, 0);
  const totalTools = workflows.reduce((n, w) => n + w.toolCallCount, 0);
  return (
    <section
      style={{
        marginBottom: 16,
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 10,
        background: "var(--af-surface)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          padding: "10px 14px",
          borderBottom: "1px solid var(--af-border-subtle)",
          background: "var(--af-surface-subtle, rgba(234,88,12,0.04))",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            fontSize: 13,
            fontWeight: 600,
            color: "var(--af-text)",
          }}
        >
          <WorkflowIcon size={14} style={{ color: "#EA580C" }} />
          Workflows
        </span>
        <span
          style={{
            fontSize: 11.5,
            color: "var(--af-text-tertiary)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {workflows.length} run{workflows.length === 1 ? "" : "s"} ·{" "}
          {spawnedAgentCount.toLocaleString()} agents · {totalTools.toLocaleString()} tool calls ·{" "}
          {formatTokens(totalTokens)} tok orchestrated
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {workflows.map((w) => (
          <WorkflowCard
            key={w.runId}
            w={w}
            focused={focusRunId === w.runId}
            selectedAgentKey={selectedAgentKey}
            onOpenAgent={onOpenAgent}
            onJumpToParent={onJumpToParent}
            onClearFocus={onClearFocus}
          />
        ))}
      </div>
    </section>
  );
}

function WorkflowCard({
  w,
  focused = false,
  selectedAgentKey,
  onOpenAgent,
  onJumpToParent,
  onClearFocus,
}: {
  w: WorkflowRun;
  focused?: boolean;
  selectedAgentKey?: string | null;
  onOpenAgent: (runId: string, agent: WorkflowRun["agents"][number]) => void;
  onJumpToParent: (toolUseId?: string) => void;
  onClearFocus?: () => void;
}) {
  const [open, setOpen] = useState(focused);
  const cardRef = useRef<HTMLDivElement>(null);
  // Focused via a minimap lane click — expand and scroll this run into view.
  useEffect(() => {
    if (focused) {
      setOpen(true);
      cardRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [focused]);
  const color = workflowColor(w.status);
  const dur = w.durationMs !== undefined ? formatGap(w.durationMs) : "—";
  const startOff = formatOffset(w.startTOffsetMs);

  return (
    <div
      ref={cardRef}
      style={{
        borderTop: "1px solid var(--af-border-subtle)",
        scrollMarginTop: 120,
      }}
    >
      {/* Collapsed header — click to expand */}
      <button
        onClick={() => {
          setOpen((v) => !v);
          // Any toggle is the user taking over from the timeline jump — drop the
          // focus highlight so it doesn't linger on a card they've moved past.
          onClearFocus?.();
        }}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "inherit",
          flexWrap: "wrap",
        }}
      >
        <span style={{ color: "var(--af-text-tertiary)", display: "inline-flex" }}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            fontWeight: 600,
            color: focused ? "#EA580C" : "var(--af-text)",
            background: focused ? "rgba(234,88,12,0.16)" : "transparent",
            padding: "2px 8px",
            borderRadius: 6,
            transition: "background 0.4s ease, color 0.4s ease",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={w.name}
        >
          {w.name}
        </span>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 600,
            padding: "2px 7px",
            borderRadius: 100,
            background: color,
            color: "#fff",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {w.status}
        </span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              padding: "2px 10px",
              borderRadius: 100,
              background: "rgba(234,88,12,0.14)",
              color: "#EA580C",
              fontFamily: "var(--font-mono)",
              whiteSpace: "nowrap",
            }}
          >
            {w.agentCount} agents
          </span>
          <WfMiniStat icon={<Wrench size={11} />} value={`${w.toolCallCount.toLocaleString()}`} />
          <WfMiniStat value={`${formatTokens(w.totalTokens)} tok`} />
          <WfMiniStat icon={<Clock size={11} />} value={dur} />
        </span>
      </button>

      {/* Expanded detail */}
      {open && (
        <div style={{ padding: "0 14px 14px 38px", display: "flex", flexDirection: "column", gap: 12 }}>
          {w.description && (
            <div style={{ fontSize: 12.5, color: "var(--af-text-secondary)", lineHeight: 1.5 }}>
              {w.description}
            </div>
          )}

          <div
            style={{
              display: "flex",
              gap: 14,
              flexWrap: "wrap",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--af-text-tertiary)",
            }}
          >
            <span>starts at {startOff}</span>
            {w.model && <span>· {w.model}</span>}
            <span>· runId {w.runId}</span>
            {w.parentToolUseId && (
              <button
                type="button"
                onClick={() => onJumpToParent(w.parentToolUseId)}
                style={{
                  marginLeft: "auto",
                  fontSize: 11,
                  color: "var(--af-accent)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  fontFamily: "var(--font-mono)",
                }}
              >
                Jump to timeline →
              </button>
            )}
          </div>

          {w.agents.length > 0 ? (
            <WorkflowPhaseTabs
              w={w}
              selectedAgentKey={selectedAgentKey}
              onOpenAgent={onOpenAgent}
            />
          ) : (
            w.phases.length > 0 && (
              <div>
                <SectionLabel>Phases</SectionLabel>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {w.phases.map((p, i) => (
                    <span
                      key={`${p.title}-${i}`}
                      title={p.detail}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: 11,
                        padding: "3px 9px",
                        borderRadius: 4,
                        background: "var(--af-border-subtle)",
                        color: "var(--af-text)",
                      }}
                    >
                      <b style={{ fontWeight: 600, fontFamily: "var(--font-mono)" }}>{p.title}</b>
                      {p.detail && (
                        <span style={{ color: "var(--af-text-tertiary)", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.detail}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )
          )}

          {w.logs.length > 0 && <WorkflowRunLog logs={w.logs} />}
        </div>
      )}
    </div>
  );
}

/** Compact model label: "claude-opus-4-8[1m]" → "opus-4-8", "claude-haiku-4-5-20251001" → "haiku-4-5". */
function shortenModel(model: string): string {
  return model
    .replace(/^claude-/, "")
    .replace(/\[1m\]$/, "")
    .replace(/-\d{6,}$/, "")
    .trim();
}

/** Status dot color for a single workflow-spawned agent. */
function agentStateColor(state?: string): string {
  const s = (state ?? "").toLowerCase();
  if (s === "done" || s === "completed" || s === "success") return "#10B981";
  if (s === "error" || s === "failed") return "#EF4444";
  if (s === "running" || s === "active" || s === "in_progress") return "#F59E0B";
  return "#8A8580";
}

/** Per-phase tabs for a workflow run. Each tab lists the agents (actions)
 *  that ran in that phase so you can review what actually happened. */
function WorkflowPhaseTabs({
  w,
  selectedAgentKey,
  onOpenAgent,
}: {
  w: WorkflowRun;
  selectedAgentKey?: string | null;
  onOpenAgent: (runId: string, agent: WorkflowRun["agents"][number]) => void;
}) {
  // Build the phase list from meta.phases (ordered), bucketing agents by
  // phaseIndex. Agents whose phaseIndex isn't in meta.phases fall into an
  // appended bucket keyed by their phaseTitle so nothing is dropped.
  const groups = useMemo(() => {
    const byIndex = new Map<number, WorkflowRun["agents"]>();
    const extras = new Map<string, WorkflowRun["agents"]>();
    for (const a of w.agents) {
      if (a.phaseIndex && a.phaseIndex >= 1 && a.phaseIndex <= w.phases.length) {
        const arr = byIndex.get(a.phaseIndex) ?? [];
        arr.push(a);
        byIndex.set(a.phaseIndex, arr);
      } else {
        const key = a.phaseTitle ?? "Other";
        const arr = extras.get(key) ?? [];
        arr.push(a);
        extras.set(key, arr);
      }
    }
    const out = w.phases.map((p, i) => ({
      key: `p${i + 1}`,
      title: p.title,
      detail: p.detail,
      agents: byIndex.get(i + 1) ?? [],
    }));
    for (const [title, agents] of extras) {
      out.push({ key: `x-${title}`, title, detail: undefined, agents });
    }
    return out;
  }, [w]);

  // Default to the first phase that actually has agents.
  const firstWithAgents = groups.find((g) => g.agents.length > 0)?.key ?? groups[0]?.key ?? "";
  const [active, setActive] = useState(firstWithAgents);
  const activeGroup = groups.find((g) => g.key === active) ?? groups[0];

  return (
    <div>
      <SectionLabel>Phases &amp; actions</SectionLabel>
      {/* Phase tab strip */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
        {groups.map((g) => {
          const isActive = g.key === active;
          return (
            <button
              key={g.key}
              onClick={() => setActive(g.key)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11.5,
                fontWeight: isActive ? 600 : 500,
                padding: "4px 10px",
                borderRadius: 6,
                border: "1px solid",
                borderColor: isActive ? "#EA580C" : "var(--af-border-subtle)",
                background: isActive ? "rgba(234,88,12,0.12)" : "transparent",
                color: isActive ? "#EA580C" : "var(--af-text-secondary)",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
              }}
            >
              {g.title}
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "0px 5px",
                  borderRadius: 100,
                  background: isActive ? "#EA580C" : "var(--af-border-subtle)",
                  color: isActive ? "#fff" : "var(--af-text-tertiary)",
                }}
              >
                {g.agents.length}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active phase body */}
      {activeGroup && (
        <div>
          {activeGroup.detail && (
            <div
              style={{
                fontSize: 11.5,
                color: "var(--af-text-tertiary)",
                marginBottom: 8,
                fontStyle: "italic",
              }}
            >
              {activeGroup.detail}
            </div>
          )}
          {activeGroup.agents.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--af-text-tertiary)", padding: "8px 0" }}>
              No agents recorded for this phase.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {activeGroup.agents.map((a) => (
                <WorkflowAgentRow
                  key={`${a.index}-${a.agentId ?? a.label}`}
                  a={a}
                  selected={selectedAgentKey === `${w.runId}:${a.agentId ?? a.index}`}
                  onOpen={() => onOpenAgent(w.runId, a)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One agent (action) inside a phase — collapsed shows label + metering;
 *  expanding reveals the task prompt and the returned result. */
/** Full transcript detail for one workflow agent — fetched on demand from
 *  /api/workflow-agent. Mirrors the parser's WorkflowAgentDetail. */
type WfAgentDetail = {
  prompt?: string;
  finalText?: string;
  steps: { index: number; tool: string; preview: string; full?: string; isError?: boolean }[];
  toolCalls: { name: string; count: number }[];
  toolCallCount: number;
  assistantMessageCount: number;
  eventCount: number;
  totalUsage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  model?: string;
  durationMs?: number;
};

function WorkflowAgentRow({
  a,
  selected,
  onOpen,
}: {
  a: WorkflowRun["agents"][number];
  selected: boolean;
  onOpen: () => void;
}) {
  const dur = a.durationMs !== undefined ? formatGap(a.durationMs) : undefined;
  return (
    <button
      onClick={onOpen}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        textAlign: "left",
        cursor: "pointer",
        border: "1px solid",
        borderColor: selected ? "#EA580C" : "var(--af-border-subtle)",
        borderRadius: 6,
        background: selected
          ? "rgba(234,88,12,0.08)"
          : "var(--af-surface-subtle, rgba(120,115,108,0.04))",
        color: "inherit",
        flexWrap: "wrap",
      }}
    >
      <span
        title={a.state}
        style={{ width: 7, height: 7, borderRadius: "50%", background: agentStateColor(a.state), flexShrink: 0 }}
      />
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--af-text)",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: 280,
        }}
        title={a.label}
      >
        {a.label}
      </span>
      {a.model && (
        <span style={{ fontSize: 10, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)" }}>
          {shortenModel(a.model)}
        </span>
      )}
      {a.lastToolSummary && (
        <span
          style={{
            fontSize: 11,
            color: "var(--af-text-tertiary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 240,
          }}
          title={a.lastToolSummary}
        >
          → {a.lastToolSummary}
        </span>
      )}
      <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {dur && <WfMiniStat icon={<Clock size={10} />} value={dur} />}
        {a.tokens !== undefined && <WfMiniStat value={`${formatTokens(a.tokens)} tok`} />}
        {a.toolCalls !== undefined && <WfMiniStat icon={<Wrench size={10} />} value={`${a.toolCalls}`} />}
        <span style={{ color: selected ? "#EA580C" : "var(--af-text-tertiary)", display: "inline-flex" }}>
          <ChevronRight size={14} />
        </span>
      </span>
    </button>
  );
}

/** Right side-sheet showing one workflow agent's full transcript — Task,
 *  ordered Steps, and Result — fetched on demand. Kept out of the card so the
 *  Workflows tab stays short even for 100+ step agents. */
function WorkflowAgentDrawer({
  sessionId,
  runId,
  agent,
  onClose,
}: {
  sessionId: string;
  runId: string;
  agent: WorkflowRun["agents"][number];
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<WfAgentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setDetail(null);
    setFailed(false);
    if (!agent.agentId) return;
    setLoading(true);
    const ctrl = new AbortController();
    const url = `/api/workflow-agent?session=${encodeURIComponent(sessionId)}&run=${encodeURIComponent(runId)}&agent=${encodeURIComponent(agent.agentId)}`;
    fetch(url, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: WfAgentDetail) => setDetail(d))
      .catch((e) => {
        if (e?.name !== "AbortError") setFailed(true);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [sessionId, runId, agent.agentId]);

  const prompt = detail?.prompt ?? agent.promptPreview;
  const finalText = detail?.finalText ?? agent.resultPreview;
  const dur = detail?.durationMs ?? agent.durationMs;
  const model = detail?.model ?? agent.model;
  const toolCount = detail?.toolCallCount ?? agent.toolCalls;
  const tok = detail ? detail.totalUsage.input + detail.totalUsage.output : agent.tokens;

  return (
    <div>
      {/* Sticky title bar */}
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid var(--af-border-subtle)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--af-surface)",
          position: "sticky",
          top: 0,
          zIndex: 1,
        }}
      >
        <span
          title={agent.state}
          style={{ width: 8, height: 8, borderRadius: "50%", background: agentStateColor(agent.state), flexShrink: 0 }}
        />
        <span
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            fontFamily: "var(--font-mono)",
            color: "var(--af-text)",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={agent.label}
        >
          {agent.label}
        </span>
        <button
          onClick={onClose}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--af-text-tertiary)", padding: 4 }}
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      {/* Meta strip */}
      <div
        style={{
          padding: "9px 18px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--af-text-tertiary)",
          borderBottom: "1px solid var(--af-border-subtle)",
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        {agent.phaseTitle && <span>phase {agent.phaseTitle}</span>}
        {agent.state && <span>· {agent.state}</span>}
        {model && <span>· {shortenModel(model)}</span>}
        {dur !== undefined && <span>· {formatGap(dur)}</span>}
        {toolCount !== undefined && <span>· {toolCount} tools</span>}
        {tok !== undefined && <span>· {formatTokens(tok)} tok</span>}
      </div>

      {/* Body — each section collapsed by default; click to expand. */}
      <div style={{ padding: "12px 18px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
        {loading && (
          <div style={{ fontSize: 11.5, color: "var(--af-text-tertiary)", fontStyle: "italic" }}>
            Loading full transcript…
          </div>
        )}
        {failed && (
          <div style={{ fontSize: 11.5, color: "var(--af-text-tertiary)", fontStyle: "italic" }}>
            Full transcript unavailable — showing the journal summary.
          </div>
        )}

        {prompt && (
          <DrawerCollapsible title="Task" hint={detail ? undefined : "preview"}>
            <div style={{ fontSize: 12, color: "var(--af-text-secondary)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
              {prompt}
            </div>
          </DrawerCollapsible>
        )}

        {detail && detail.steps.length > 0 && (
          <DrawerCollapsible
            title="Steps"
            count={detail.steps.length}
            hint={detail.toolCalls.slice(0, 6).map((t) => `${shortenToolName(t.name)} ×${t.count}`).join("  ·  ")}
          >
            <div style={{ border: "1px solid var(--af-border-subtle)", borderRadius: 6, background: "var(--af-surface)" }}>
              {detail.steps.map((s) => (
                <WorkflowStepRow key={s.index} s={s} />
              ))}
            </div>
          </DrawerCollapsible>
        )}

        {finalText && (
          <DrawerCollapsible title="Result" hint={detail ? undefined : "preview"}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--af-text-secondary)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                lineHeight: 1.5,
                background: "var(--af-surface)",
                border: "1px solid var(--af-border-subtle)",
                borderRadius: 4,
                padding: "8px 10px",
              }}
            >
              {finalText}
            </div>
          </DrawerCollapsible>
        )}
      </div>
    </div>
  );
}

/** Collapsible section inside the agent sheet — default collapsed. */
function DrawerCollapsible({
  title,
  count,
  hint,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: "1px solid var(--af-border-subtle)", borderRadius: 8, overflow: "hidden" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 12px",
          background: open ? "var(--af-surface-subtle, rgba(120,115,108,0.05))" : "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "inherit",
        }}
      >
        <span style={{ color: "var(--af-text-tertiary)", display: "inline-flex" }}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--af-text-secondary)" }}>
          {title}
        </span>
        {count !== undefined && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "1px 7px",
              borderRadius: 100,
              background: "rgba(234,88,12,0.14)",
              color: "#EA580C",
              fontFamily: "var(--font-mono)",
            }}
          >
            {count}
          </span>
        )}
        {hint && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 10.5,
              color: "var(--af-text-tertiary)",
              fontFamily: "var(--font-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 280,
            }}
          >
            {hint}
          </span>
        )}
      </button>
      {open && <div style={{ padding: "0 12px 12px" }}>{children}</div>}
    </div>
  );
}

/** One step row — click to reveal the full tool input (e.g. the complete
 *  multi-line bash command) when it's longer than the one-line preview. */
function WorkflowStepRow({ s }: { s: WfAgentDetail["steps"][number] }) {
  const [open, setOpen] = useState(false);
  const expandable = !!s.full;
  return (
    <div style={{ borderTop: s.index === 1 ? "none" : "1px solid var(--af-border-subtle)" }}>
      <div
        onClick={() => expandable && setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          padding: "4px 10px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          cursor: expandable ? "pointer" : "default",
        }}
      >
        <span style={{ color: "var(--af-text-tertiary)", minWidth: 28, textAlign: "right", flexShrink: 0 }}>
          {s.index}
        </span>
        <span style={{ fontWeight: 600, color: s.isError ? "#EF4444" : "var(--af-text)", flexShrink: 0, minWidth: 104 }}>
          {s.isError ? "⚠ " : ""}
          {shortenToolName(s.tool)}
        </span>
        <span
          style={{ flex: 1, color: "var(--af-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={s.preview}
        >
          {s.preview}
        </span>
        {expandable && (
          <span style={{ color: "var(--af-text-tertiary)", display: "inline-flex", flexShrink: 0 }}>
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
        )}
      </div>
      {open && s.full && (
        <pre
          style={{
            margin: 0,
            padding: "6px 10px 10px 40px",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: "var(--af-text-secondary)",
            background: "var(--af-surface-subtle, rgba(120,115,108,0.05))",
            lineHeight: 1.5,
          }}
        >
          {s.full}
        </pre>
      )}
    </div>
  );
}

/** Collapsible coarse run log (▶ / ✓ task markers) — secondary to the
 *  per-phase agent view. */
function WorkflowRunLog({ logs }: { logs: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--af-text-tertiary)",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: 0,
        }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Run log ({logs.length})
      </button>
      {open && (
        <div
          style={{
            marginTop: 6,
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            lineHeight: 1.7,
            color: "var(--af-text-secondary)",
            background: "var(--af-surface-subtle, rgba(120,115,108,0.05))",
            border: "1px solid var(--af-border-subtle)",
            borderRadius: 6,
            padding: "8px 12px",
            maxHeight: 240,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          {logs.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}

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
