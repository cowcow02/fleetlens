# Team Orchestration View — Design

**Status:** Draft
**Date:** 2026-04-15
**Author:** brainstorming session (cowcow02 + Claude)

## Problem

Fleetlens currently renders each Claude Code session in isolation, but real orchestration work increasingly spans **multiple sessions acting as a team**: a lead session that coordinates, and N member sessions that execute under its direction. Today the tool:

1. Has no formal correlation between a lead session and its members. They appear as unrelated entries in the session list.
2. Renders inbound `<teammate-message>` traffic on the lead as if it were human user input, making it impossible to tell "what I actually typed" from "what a teammate reported back".
3. Offers no way to see the parallel execution story — the lead's timeline in isolation can't convey which member was doing what at the same moment.

The engineer interacting with the lead is the human user; they need a single unified view of the team's whole orchestration, anchored on the lead, that preserves each individual session's conversational detail while surfacing the cross-session parallelism and message flow.

## Goals

- Detect teams reliably from JSONL and link lead ↔ members with zero heuristics.
- Separate human input from cross-session team traffic in the lead's conversation view.
- Provide a single unified visualization of the team's orchestration: one sticky time-axis header across all agents, with a multi-column scrollable body that preserves each session's own conversation shape and shows cross-session messages as arrows between columns.
- Label team sessions on existing session lists so the human gravitates toward the lead as their entry point.

## Non-goals (v1)

- No dedicated `/teams` top-level page. Navigation stays lead-first; team view lives as a tab on the lead's session page.
- No team-level dashboard rollups (teams-per-day, aggregate team metrics).
- No edit / annotation / export of the team view.
- No support for Gemini CLI / other agent tooling *yet* — but data model and components are shaped so a second adapter could be added without reworking the primitives. Forward compatibility is kept by making the visualization primitive generic (tracks + messages), not Claude Code-specific.
- **No CLI surface changes.** Team detection is a web-side concern; `fleetlens` CLI gets no new subcommand and no new flags.

## JSONL protocol discovery

All conclusions below were verified against three real sessions shipped by Claude Code 2.1.78:

| Role | Session | Key JSONL fields |
|---|---|---|
| Lead | `3edd9aee…` | `teamName`, has `TeamCreate` tool_use, no `agentName` |
| Member A | `21bec111…` | `teamName`, `agentName: "kip-127-agent-organize"` |
| Member B | `aacdb908…` | `teamName`, `agentName: "kip-128-agent-edit"` |

**Team grouping field** — every event in every team-participating session carries a top-level `teamName: string`. All three share `"orchestrate-m6-cli"`. The value is stable across the full transcript.

**Canonical teammate id** — every event in a member session carries a top-level `agentName: string` (e.g. `"kip-127-agent-organize"`). This is the same string the lead uses as the `to` argument of its `SendMessage` tool_use and that appears as the `teammate_id` attribute of `<teammate-message>` XML wrappers on the lead side. Lead sessions do **not** carry `agentName`.

**Lead signals** — the lead session contains a `TeamCreate` tool_use near the start (`agent_type: "orchestrator"`) and a corresponding `TeamDelete` near shutdown. Its tool_result for `TeamCreate` references a `~/.claude/teams/<team_name>/config.json` file, but that file is deleted on `TeamDelete`, so we rely entirely on the JSONL, not the filesystem.

**Lead ↔ member messaging protocol**

Outbound (lead → member):
```
{ "type": "tool_use", "name": "SendMessage",
  "input": { "to": "<member agentName>",
             "message": "<human-readable instruction>",
             "type": "message" } }
```

Delivered on the member side as a synthetic `user` event whose content starts with:
```
<teammate-message teammate_id="team-lead" color="..." summary="...">
  …body…
</teammate-message>
```

Outbound (member → lead):
```
{ "type": "tool_use", "name": "SendMessage",
  "input": { "to": "team-lead", "message": "...", "type": "message" } }
```

Delivered on the lead side as a synthetic `user` event wrapped in `<teammate-message teammate_id="<member agentName>">`.

**Idle and shutdown notifications** ride the same channel with a JSON body:
```
<teammate-message teammate_id="kip-121-cli-foundation">
  {"type":"idle_notification","from":"kip-121-cli-foundation",…}
</teammate-message>
```

These are a distinct `kind` on the message model but use the same delivery primitive.

## Data model

### Parser extensions (`packages/parser/src/types.ts`, `parser.ts`)

```ts
type SessionMeta = {
  // … existing fields …
  /** Team identifier. Present on every event when a session participates in a team. */
  teamName?: string;
  /** Canonical teammate id for this session. Present on member sessions, undefined on leads. */
  agentName?: string;
};

type SessionEvent = {
  // … existing fields …
  /** Set when this event is a `<teammate-message>` delivery. The content is *not* human input. */
  teammateMessage?: {
    teammateId: string;   // sender — "team-lead" or a member's agentName
    body: string;         // cleaned inner text, wrapper stripped
    kind: "message" | "idle-notification" | "shutdown-request";
  };
};
```

**Parsing rules:**

- `teamName` and `agentName` are read from any event's top-level fields during `parseTranscript`. First non-empty wins; they are stable across a transcript.
- When a `user` event's content text (concatenated from `text` / `tool_result.content` blocks) matches the regex `/^\s*<teammate-message\s+teammate_id="([^"]+)"[^>]*>([\s\S]*?)<\/teammate-message>\s*$/`, we extract `teammateId` and `body`. `kind` is `"idle-notification"` if the body is JSON with `type === "idle_notification"`, `"shutdown-request"` if `type === "shutdown_request"`, else `"message"`.
- The raw content remains available on the event; `teammateMessage` is additive metadata. Views choose whether to render raw or cleaned.

### Cross-session analytics (`packages/parser/src/team.ts`, new)

```ts
type TeamMessage = {
  tsMs: number;
  fromSessionId: string;
  fromTeammateId: string;          // "team-lead" or a member's agentName
  toSessionId: string;
  toTeammateId: string;
  body: string;
  kind: "message" | "idle-notification" | "shutdown-request";
};

type TeamView = {
  teamName: string;
  leadSessionId: string;
  memberSessionIds: string[];      // ordered by first-event timestamp
  agentNameBySessionId: Map<string, string | undefined>;   // undefined for lead
  messages: TeamMessage[];         // chronologically sorted
  firstEventMs: number;
  lastEventMs: number;
};

function groupByTeam(
  sessions: SessionMeta[],
  details: Map<string, SessionDetail>,  // SessionDetail is an existing parser type
): TeamView[];
```

**Algorithm (deterministic, no heuristics):**

1. Filter `sessions` to those with a defined `teamName`. Group by `teamName`.
2. Within each group, the session(s) without `agentName` are lead candidates. Pick the one whose detail contains a `TeamCreate` tool_use; if none has one (e.g. the team was resumed after restart), pick the earliest-started session without `agentName`. If the group has zero sessions without `agentName`, skip the group — it's an orphaned/incomplete team.
3. For every other session, its `agentName` is its canonical teammate id. Stored on the map.
4. Message pairing — walk every session's events in order. For each `SendMessage` tool_use, construct a `TeamMessage` with the source being `{fromSessionId: this session, fromTeammateId: this session's agentName ?? "team-lead"}`, and resolve `toSessionId` by looking up `to` in the group's `agentName → sessionId` map (or the lead's sessionId if `to === "team-lead"`). The body is `input.message`. Timestamp comes from the event's `timestamp` field.
5. Sort all messages in the group by `tsMs`.

The outbound `SendMessage` tool_use is the sole source of truth for messages. We do not cross-validate against the receiving side's `<teammate-message>` delivery — it would only detect protocol drift, which isn't a failure mode we handle.

`groupByTeam` is a pure function. It doesn't read from disk; the caller is responsible for loading `sessions` and `details` via `fs.ts`.

### Node-side loader (`packages/parser/src/fs.ts`)

New helper:

```ts
async function loadTeamForSession(
  sessionId: string,
  projectsRoot = defaultProjectsRoot(),
): Promise<{ view: TeamView; details: Map<string, SessionDetail> } | null>;
```

1. Load the `SessionMeta` + `SessionDetail` for `sessionId`.
2. If `teamName` is undefined → return `null` (no team).
3. Walk `projectsRoot/*` to collect every session whose JSONL carries a matching `teamName`. For each candidate `*.jsonl`, read up to the first 50 lines, parse each as JSON, and return as soon as a `teamName` field matching the target team is seen (reject if the first 50 lines contain a different `teamName` or none at all). No full-session parse at this phase. Worktree projects are included automatically because they're sibling directories at the same level.
4. Fully parse each team session's `SessionDetail`.
5. Call `groupByTeam`, return the team view containing `sessionId` along with the detail map.

This is called lazily from the new team tab loader — not from the regular session list — so the extra scan only fires when the user opens the tab.

## Visualization

### Layout

**Sticky header** — compact swim-lane overview, always visible while the body scrolls.

- Shared time ruler across the full team span (`firstEventMs` → `lastEventMs`, local time).
- One horizontal lane per agent. Lead is on top in an accent color; members are ordered by first-event timestamp.
- Colored active-segment bars per lane, derived from each session's existing `activeSegments`.
- Small ticks on each lane for cross-session messages, colored by the other party.
- A vertical marker tracks the user's scroll position in wall-clock time.

**Multi-track body** — scrollable grid, one column per agent.

- Column order matches the header.
- Each column reads like the current session view: human / assistant / tool blocks in conversational order. Crucially, the lead column does **not** show events whose `teammateMessage` is set — those are cross-column deliveries, rendered only in the receiving column's stream. The lead column shows its outbound `SendMessage` tool_uses directly.
- Rows are time-anchored. Two alignment modes are exposed via a zoom slider in the sticky header:
  - **Event-anchored (default):** rows snap to significant events; idle gaps don't stretch. Most readable, and closest to how single-session views look today.
  - **Strict time:** row height is proportional to wall-clock duration. A 40-minute idle gap becomes a tall empty band, making parallelism visually explicit.
- Idle cells show a muted `· idle ·` marker so parallelism is visible at a glance.

**Cross-column messages** — an SVG overlay draws connecting arrows between a `SendMessage` cell in the sender's column and the corresponding `<teammate-message>` cell in the receiver's column. Hovering either cell highlights the arrow and its counterpart. Clicking the arrow scrolls both columns to the message pair.

**Drill-in** — clicking an active span or a row's header in a member column opens that member's own session page in a new tab, preserving the current deep-dive path.

### Forward-compatible primitive

The multi-track body is written as a generic component whose props don't mention teams:

```ts
type Track = {
  id: string;
  label: string;
  color: string;
  isLead?: boolean;
  rows: TrackRow[];
};

type TrackRow = {
  tsMs: number;
  content: ReactNode;
  kind: "human" | "agent" | "tool" | "inbound-message" | "idle";
};

type CrossTrackMessage = {
  tsMs: number;
  fromTrackId: string;
  toTrackId: string;
  label: string;
};

<MultiTrack
  tracks={tracks}
  messages={messages}
  zoom={zoom}
/>
```

The team tab is a thin adapter that converts `TeamView` + `SessionDetail` map into these props. If a future use case arrives (subagents, cross-project parallelism, a non-Claude-Code agent protocol), it gets its own adapter and reuses the same primitive. Per approach 3, we do not promote the component or introduce abstractions until the second consumer is concrete.

### Session list badges

A new `<TeamBadge session={sessionMeta} />` component is added to every session row:

- **"Team Lead"** — accent-colored pill when `teamName && !agentName`. Links directly to the session's Team tab (not the Conversation tab).
- **"Team Member"** — de-emphasized muted pill when `teamName && agentName`. Links to the member's own session page.

Rendered in all four existing session-row sites in one pass: sidebar recent sessions, `/sessions` list, calendar day view, dashboard "recent sessions" card. The badge is a pure function of `SessionMeta`, so adding it everywhere is a single shared component and costs no more than adding it to one site.

### Lead's conversation tab cleanup

The existing Conversation tab on a lead session filters out `user` events whose `teammateMessage` is set. A non-interactive compact banner at the top reads:
> "N inbound team messages hidden — open the Team tab to see them."

The banner is purely informational; there is no expand-in-place behavior. The Team tab is the single canonical place to see team traffic.

This directly addresses the second pain point: today the conversation view is polluted with team chatter that looks like user input.

## Data flow

```
User opens /sessions/<leadId>  → session page renders Conversation tab (default)
                              → filters out teammateMessage events
                              → shows "N team messages hidden" banner + Team tab

User clicks Team tab          → server component loadTeamForSession(leadId)
                              → scans projects root for sessions with matching teamName
                              → parses each, calls groupByTeam()
                              → returns TeamView + details map

Client renders                → SwimLaneHeader(view, zoom)
                                MultiTrack(
                                  tracks = [lead + members as Track[]],
                                  messages = view.messages.map(toCrossTrackMessage),
                                  zoom,
                                )
                                CrossColumnArrows(messages)

User scrolls                  → scroll position → wall-clock time marker in header
User zooms                    → re-layout rows (event-anchored ↔ strict time)
User clicks member span       → opens /sessions/<memberId> in new tab
```

## Edge cases

- **Team not finished** — `TeamDelete` may be absent on an active team. We don't require it; the lead detection falls back on "has `TeamCreate`" or "earliest session in group without `agentName`".
- **Resumed team** — if the user resumed a prior session and re-joined an existing team, the JSONL may lack `TeamCreate` at the top. Covered by the fallback rule above.
- **Orphaned sessions** — a session with `teamName` set but whose group has no lead (e.g. the lead JSONL was deleted). Skip the group; log a dev-mode warning; the member sessions still render normally with their Team Member badge but without a functional Team tab.
- **Unmatched SendMessage** — a `SendMessage` with a `to` value that doesn't correspond to any session in the group (stale, typo, cross-team). Store with `toSessionId: ""`, render the outbound cell but skip the arrow and annotate the cell "→ unknown teammate".
- **Very long team spans** — a team that ran over multiple days. Strict-time mode may be unusable; event-anchored stays readable. The zoom slider exposes both; no hard cap.
- **Lead has no members** — a team with only a `TeamCreate` and no `SendMessage` traffic. The Team tab still appears and renders a one-lane header; the multi-track body shows just the lead column with a subtitle "No team members yet".
- **Members in worktree projects** — the project slug in `~/.claude/projects/` differs between the main repo and its worktrees. The `loadTeamForSession` scan walks the projects root (all project dirs), so worktree members are found. We do **not** rely on the `canonicalProjectName()` rollup for this — team detection is orthogonal to project grouping.

## Testing

Parser (real unit tests, vitest):

- `parseTranscript` extracts `teamName` and `agentName` from a member JSONL fixture.
- `parseTranscript` does **not** populate `agentName` for a lead fixture.
- `parseTranscript` sets `teammateMessage` on a user event whose content is a `<teammate-message>` wrapper. Variants: text attribute forms (`color`, `summary`, no attrs), nested JSON body (idle/shutdown), leading/trailing whitespace.
- `parseTranscript` leaves `teammateMessage` undefined on a real human user event.
- `groupByTeam` clusters three fixture sessions (lead + 2 members) into one `TeamView` with correct `leadSessionId`, `agentNameBySessionId`, and message pairing.
- `groupByTeam` handles the orphaned-group case (returns nothing for a team with no lead).
- `groupByTeam` handles an unmatched `SendMessage.to` (stores empty `toSessionId`, still creates the message entry).
- Message pairing: every `SendMessage` in the fixture appears exactly once as a `TeamMessage`, with the correct source + destination sessionIds derived by `agentName` equality.

Fixtures: three trimmed JSONL snippets extracted from the real sample sessions used during brainstorming (lead + member A + member B), small enough to commit to `packages/parser/test/fixtures/team-*.jsonl`.

Web (smoke test extension):

- `scripts/smoke.mjs` hits `/sessions/<leadId>` with a fixture project root and asserts the response is 200 and contains the "Team" tab trigger element.
- Asserts `/sessions/<memberId>` also returns 200 (no accidental regression on member pages).

No new vitest coverage in `apps/web` (consistent with existing convention — web validation goes through smoke).

## Shipping plan

Per CLAUDE.md's release cadence: user-facing feature → `npm version minor` after merge to master, push tag to trigger the release workflow.

## Open questions

None that block implementation. The `agentName` field discovery collapsed the main uncertainty (teammate_id ↔ sessionId correlation) from "heuristic" to "deterministic".

---

# v2 redesign addendum (2026-04-15 afternoon)

After building v1 and reviewing it against a real team on localhost, the user pushed back on four issues:

1. **No scroll-position indicator** on the Team tab's sticky header — the existing single-session transcript tab has one, the Team tab didn't.
2. **Subagents were showing up as their own lanes.** `loadTeamForSession` filtered by `teamName`, but `listSessions` walks recursively and picked up `<session>/subagents/agent-*.jsonl` files too, inheriting the parent's `teamName` and polluting the roster.
3. **Visualization was hard to understand.** Two parallel views of the same data — a sticky swim-lane header plus a multi-track grid below — where you had to read both to piece together the story. Either unify them or drop one.
4. **No turn-collapsing.** The v1 grid rendered every atomic event as its own cell; after spending effort to collapse events into turns everywhere else, the Team tab threw that away.

## Decisions

**Delete both the sticky swim-lane header and the row-based grid from v1.** Replace them with one primitive:

### Multi-lane horizontal timeline (primary view)

One lane per agent (lead + each member). Wall-clock time is a shared horizontal axis across all lanes. Each lane is an independent horizontal track; each turn on that lane is positioned as a block whose left edge is the turn's `firstTimestamp + tOffsetMs` and whose width is the turn's `durationMs`. Overlapping turns across agents visually overlap on the canvas because they sit at the same X-position on different Y-lanes — the "lead started a turn, then halfway through a member spun up" story reads directly off the geometry.

Turn data comes from **the existing `buildMegaRows` in `packages/parser/src/presentation.ts`**, applied per session. Each `TurnMegaRow` already carries `tOffsetMs`, `durationMs`, a full summary, and the child `PresentationRow[]` for drill-down.

### Zoom, pan, and the universally applicable navigation UX

The single-session transcript has the same readability problem (long sessions get condensed). The v2 timeline is built as a **standalone reusable primitive** (`TimelineCanvas`) so a future change could replace the single-session sticky strip with the same component. Scope of this PR is the Team tab only.

Navigation:
- **Zoom slider** at the top right, from "fit-to-width" (zoom=0) to a max where short turns are legible. A "Fit" button snaps back. Ctrl/Cmd+wheel over the canvas zooms with the cursor position as the anchor.
- **Horizontal pan** via click-and-drag on empty canvas area, shift+wheel, or horizontal trackpad scroll.
- **Minimap strip** at the top of the canvas: compressed full-span overview with all lanes stacked, a draggable viewport rectangle marking the currently-visible range. Clicking the minimap jumps to that time. The viewport rect serves as the scroll-position indicator from point 1.

### Turn-block contents

Each block carries the same information density the Transcript tab shows for a turn. Compact layout, not stripped-down content. Graceful degradation at narrow widths (colored bar + duration only, hover tooltip, click-to-drawer).

### Detail drawer

Click any turn block → a drawer slides in from the right with the full turn contents. Close with Esc or the X button. No navigation away from the Team tab.

**Subagent visibility.** Subagents are no longer their own lanes (filtered out of `loadTeamForSession` by `filePath.includes('/subagents/')`). They remain visible as nested events *inside* their parent session's turn blocks via the drawer.

## Data-model delta from v1

- `loadTeamForSession` gains a subagent-path filter.
- The web-side adapter is rewritten from `TeamView → MultiTrackProps` (grid rows) to `TeamView → TimelineData`:
  ```ts
  type TeamTurn = {
    id: string;
    sessionId: string;
    trackId: string;
    startMs: number;
    endMs: number;
    megaRow: TurnMegaRow;
    agentColor: string;
  };
  type TeamTrack = {
    id: string;
    label: string;
    color: string;
    isLead: boolean;
    turns: TeamTurn[];
  };
  type TimelineData = {
    tracks: TeamTrack[];
    firstEventMs: number;
    lastEventMs: number;
  };
  ```
- The `MultiTrackProps` type and all of its consumers are deleted.

## Files that change

**New (this rework):**
- `apps/web/app/sessions/[id]/team-tab/timeline-canvas.tsx`
- `apps/web/app/sessions/[id]/team-tab/turn-drawer.tsx`

**Rewritten:**
- `apps/web/app/sessions/[id]/team-tab/adapter.ts`
- `apps/web/app/sessions/[id]/team-tab/team-tab-client.tsx`

**Deleted:**
- `apps/web/app/sessions/[id]/team-tab/swim-lane-header.tsx`
- `apps/web/app/sessions/[id]/team-tab/multi-track.tsx`

**Modified:**
- `packages/parser/src/fs.ts` — `loadTeamForSession` filters out `filePath.includes('/subagents/')` sessions.
- `apps/web/app/sessions/[id]/session-view.tsx` — the `team` prop type changes from `MultiTrackProps & { teamName }` to `TimelineData & { teamName }`.
- `apps/web/app/sessions/[id]/page.tsx` — adapter import + return type change ripple through.

## Non-goals of the v2 redesign

- Horizontal-scrolling single-session transcript — the primitive is designed so this could later be done, but not in this PR.
- Synchronized cross-session cursor with linked inspection across agents — drawer is one-at-a-time.
- Any new parser types. All turn data reuses `TurnMegaRow`.
