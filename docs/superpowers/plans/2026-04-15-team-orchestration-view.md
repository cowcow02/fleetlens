# Team Orchestration View — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a "Team" tab on a lead session's page that unifies a Claude Code team lead and its member sessions against a shared time axis, with deterministic lead ↔ member correlation via the `teamName` / `agentName` fields on the JSONL.

**Architecture:** Parser gets three new fields on its existing types (`teamName`, `agentName`, `teammateMessage`) populated at parse time. A new pure function `groupByTeam()` in `packages/parser/src/team.ts` clusters sessions by `teamName` and pairs cross-session messages. A new `loadTeamForSession()` helper in `fs.ts` scans the projects dir (cheap first-50-lines check) to find team-mates on demand. The web app adds a Team tab on the lead's session page that renders a sticky swim-lane header + a scrollable multi-track body. The multi-track component is written with generic props (`tracks`, `messages`) so it can be reused later for subagents or other agent protocols without refactor.

**Tech Stack:** TypeScript, vitest (parser tests), Next.js 16 App Router (server + client components), pnpm + Turborepo. Follow the project conventions in `/Users/cowcow02/Repo/claude-lens/CLAUDE.md` — kept-brief comments, no placeholder abstractions, no feature flags, trust internal data.

**Spec:** `docs/superpowers/specs/2026-04-15-team-orchestration-view-design.md`

**Execution note:** This plan modifies parser + web + adds components. Recommended to execute on a feature branch (`feat/team-view`) and PR into master. All validation goes through vitest (parser) and the existing `pnpm verify` smoke script (web).

---

## File Structure

**New files:**

| Path | Purpose |
|---|---|
| `packages/parser/src/team.ts` | Pure `groupByTeam()` + `TeamView` / `TeamMessage` types |
| `packages/parser/test/team.test.ts` | vitest cases for `groupByTeam` and teammate-message parsing |
| `packages/parser/test/fixtures/team-lead.jsonl` | Trimmed lead fixture (5–10 events) |
| `packages/parser/test/fixtures/team-member-a.jsonl` | Trimmed member fixture (3–5 events) |
| `packages/parser/test/fixtures/team-member-b.jsonl` | Trimmed second member fixture |
| `apps/web/app/sessions/[id]/team-tab/team-tab-loader.tsx` | Server component; loads team view for a session |
| `apps/web/app/sessions/[id]/team-tab/team-tab-client.tsx` | Client wrapper; owns zoom state |
| `apps/web/app/sessions/[id]/team-tab/adapter.ts` | Converts `TeamView` + details into `MultiTrack` props |
| `apps/web/app/sessions/[id]/team-tab/swim-lane-header.tsx` | Sticky header, shared ruler + lane bars + message ticks |
| `apps/web/app/sessions/[id]/team-tab/multi-track.tsx` | Generic scrollable grid (`tracks`, `messages`, `zoom`) |
| `apps/web/app/sessions/[id]/team-tab/cross-column-arrows.tsx` | SVG overlay drawing lead↔member arrows |
| `apps/web/components/team-badge.tsx` | Shared `<TeamBadge session={...} />` pill |

**Modified files:**

| Path | Change |
|---|---|
| `packages/parser/src/types.ts` | Add `teamName`, `agentName` to `SessionMeta`; add `teammateMessage` to `SessionEvent` |
| `packages/parser/src/parser.ts` | Populate new fields during `parseTranscript` / `toEvent` |
| `packages/parser/src/fs.ts` | Add `scanForTeamName()` + `loadTeamForSession()` helpers |
| `packages/parser/src/index.ts` | Export `groupByTeam`, `TeamView`, `TeamMessage` |
| `apps/web/app/sessions/[id]/page.tsx` | Add "Team" tab trigger; render `team-tab-loader` when active |
| `apps/web/app/sessions/[id]/session-view.tsx` | Filter `teammateMessage` events out of Conversation; add hidden-count banner |
| `apps/web/app/sessions/page.tsx` | Render `<TeamBadge>` on session rows |
| `apps/web/components/sidebar.tsx` | Render `<TeamBadge>` on sidebar recent sessions |
| `apps/web/components/dashboard-view.tsx` | Render `<TeamBadge>` on dashboard recents card |
| `apps/web/app/sessions/sessions-grid.tsx` | Render `<TeamBadge>` on calendar day view grid |
| `scripts/smoke.mjs` | Assert `/sessions/<leadId>` contains Team tab trigger when applicable |

---

## Chunk 1: Parser data model + field extraction

### Task 1.1: Add new fields to parser types

**Files:**
- Modify: `packages/parser/src/types.ts`

- [ ] **Step 1: Add `teamName` and `agentName` to `SessionMeta`**

In `packages/parser/src/types.ts`, at the end of `SessionMeta` (just before the closing `};`), add:

```ts
  /** Team identifier — present on every event when a session participates in a team.
   *  Derived from the top-level `teamName` field that Claude Code writes on all
   *  events in team sessions. First non-empty value wins. */
  teamName?: string;
  /** Canonical teammate id for this session. Present on member sessions,
   *  undefined on leads. Derived from the top-level `agentName` field that
   *  Claude Code writes on all events in a member session. Used to pair
   *  lead-side SendMessage.to values directly. */
  agentName?: string;
```

- [ ] **Step 2: Add `teammateMessage` to `SessionEvent`**

In the same file, at the end of `SessionEvent`, add:

```ts
  /** Set when this user event is a cross-session team message delivery.
   *  The event is NOT real human input — it's an inbound `<teammate-message>`
   *  wrapper from a sibling team session. `teammateId` is the sender. */
  teammateMessage?: {
    teammateId: string;
    body: string;
    kind: "message" | "idle-notification" | "shutdown-request";
  };
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -F @claude-lens/parser exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/parser/src/types.ts
git commit -m "feat(parser): add teamName/agentName/teammateMessage fields"
```

---

### Task 1.2: Extract teamName and agentName in parseTranscript

**Files:**
- Modify: `packages/parser/src/parser.ts:347-402` (the final metadata loop + return)
- Test: `packages/parser/test/parser.test.ts` (existing file — add new cases)

- [ ] **Step 1: Write failing test for `teamName` extraction**

Append to `packages/parser/test/parser.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseTranscript } from "../src/parser.js";

describe("parseTranscript — team fields", () => {
  it("extracts teamName from top-level event field", () => {
    const lines = [
      { type: "user", sessionId: "s1", teamName: "my-team",
        message: { content: "hi" }, timestamp: "2026-04-15T10:00:00Z", uuid: "u1" },
    ];
    const { meta } = parseTranscript(lines);
    expect(meta.teamName).toBe("my-team");
  });

  it("leaves teamName undefined when absent", () => {
    const lines = [
      { type: "user", sessionId: "s1",
        message: { content: "hi" }, timestamp: "2026-04-15T10:00:00Z", uuid: "u1" },
    ];
    const { meta } = parseTranscript(lines);
    expect(meta.teamName).toBeUndefined();
  });

  it("extracts agentName on member session", () => {
    const lines = [
      { type: "user", sessionId: "s1", teamName: "t", agentName: "kip-127",
        message: { content: "hi" }, timestamp: "2026-04-15T10:00:00Z", uuid: "u1" },
    ];
    const { meta } = parseTranscript(lines);
    expect(meta.agentName).toBe("kip-127");
  });

  it("leaves agentName undefined on lead session", () => {
    const lines = [
      { type: "user", sessionId: "s1", teamName: "t",
        message: { content: "hi" }, timestamp: "2026-04-15T10:00:00Z", uuid: "u1" },
    ];
    const { meta } = parseTranscript(lines);
    expect(meta.agentName).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @claude-lens/parser test -- parser.test.ts`
Expected: FAIL — `meta.teamName` is `undefined` (field not populated yet).

- [ ] **Step 3: Implement the extraction**

In `packages/parser/src/parser.ts`, inside `parseTranscript`, find the `for (const r of rawLines)` loop that populates `sessionId`, `cwd`, `gitBranch` (around line 347). Add two more "first wins" captures:

```ts
let teamName: string | undefined;
let agentName: string | undefined;
```

near the other `let` declarations, and inside that loop:

```ts
if (typeof o.teamName === "string" && !teamName) teamName = o.teamName;
if (typeof o.agentName === "string" && !agentName) agentName = o.agentName;
```

Then add `teamName` and `agentName` to the returned `meta` object at the bottom:

```ts
    meta: {
      // …existing fields…
      teamName,
      agentName,
      // …
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @claude-lens/parser test -- parser.test.ts`
Expected: PASS — all four cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/parser/src/parser.ts packages/parser/test/parser.test.ts
git commit -m "feat(parser): extract teamName and agentName from JSONL events"
```

---

### Task 1.3: Classify user events as teammate-message deliveries

**Files:**
- Modify: `packages/parser/src/parser.ts` — inside `toEvent`, the `user` branch (around lines 95–145)
- Test: `packages/parser/test/parser.test.ts`

- [ ] **Step 1: Write failing tests for `teammateMessage` classification**

Append to `packages/parser/test/parser.test.ts`:

```ts
describe("parseTranscript — teammateMessage classification", () => {
  const base = {
    type: "user",
    sessionId: "s1",
    timestamp: "2026-04-15T10:00:00Z",
    uuid: "u1",
    parentUuid: null,
  };

  function withContent(content: unknown) {
    return [{ ...base, message: { content } }];
  }

  it("tags a basic teammate-message wrapper", () => {
    const lines = withContent(
      '<teammate-message teammate_id="team-lead">hello from lead</teammate-message>',
    );
    const { events } = parseTranscript(lines);
    expect(events[0]!.teammateMessage).toEqual({
      teammateId: "team-lead",
      body: "hello from lead",
      kind: "message",
    });
  });

  it("handles attributes like color and summary", () => {
    const lines = withContent(
      '<teammate-message teammate_id="kip-121" color="blue" summary="PR #104 ready">PR merged</teammate-message>',
    );
    const { events } = parseTranscript(lines);
    expect(events[0]!.teammateMessage?.teammateId).toBe("kip-121");
    expect(events[0]!.teammateMessage?.body).toBe("PR merged");
  });

  it("classifies idle notifications by JSON body type", () => {
    const lines = withContent(
      '<teammate-message teammate_id="kip-121">{"type":"idle_notification","from":"kip-121"}</teammate-message>',
    );
    const { events } = parseTranscript(lines);
    expect(events[0]!.teammateMessage?.kind).toBe("idle-notification");
  });

  it("classifies shutdown requests by JSON body type", () => {
    const lines = withContent(
      '<teammate-message teammate_id="team-lead">{"type":"shutdown_request","requestId":"x"}</teammate-message>',
    );
    const { events } = parseTranscript(lines);
    expect(events[0]!.teammateMessage?.kind).toBe("shutdown-request");
  });

  it("leaves teammateMessage undefined on real human user input", () => {
    const lines = withContent("add a new feature please");
    const { events } = parseTranscript(lines);
    expect(events[0]!.teammateMessage).toBeUndefined();
  });

  it("accepts wrapper inside an array content block", () => {
    const lines = withContent([
      { type: "text",
        text: '<teammate-message teammate_id="kip-121">PR merged</teammate-message>' },
    ]);
    const { events } = parseTranscript(lines);
    expect(events[0]!.teammateMessage?.teammateId).toBe("kip-121");
    expect(events[0]!.teammateMessage?.body).toBe("PR merged");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm -F @claude-lens/parser test -- parser.test.ts`
Expected: FAIL — all 6 teammate-message cases fail (`teammateMessage` undefined).

- [ ] **Step 3: Add the classifier helper**

At the top of `packages/parser/src/parser.ts` (near the other helpers like `cleanText`), add:

```ts
const TEAMMATE_MSG_RE =
  /^\s*<teammate-message\s+teammate_id="([^"]+)"[^>]*>([\s\S]*?)<\/teammate-message>\s*$/;

function classifyTeammateMessage(
  text: string,
): SessionEvent["teammateMessage"] | undefined {
  const m = text.match(TEAMMATE_MSG_RE);
  if (!m) return undefined;
  const teammateId = m[1]!;
  const body = m[2]!.trim();
  let kind: "message" | "idle-notification" | "shutdown-request" = "message";
  // Bodies can be plain text OR a JSON payload for idle/shutdown protocol.
  if (body.startsWith("{")) {
    try {
      const parsed = JSON.parse(body) as { type?: string };
      if (parsed.type === "idle_notification") kind = "idle-notification";
      else if (parsed.type === "shutdown_request") kind = "shutdown-request";
    } catch {
      /* not JSON, treat as message */
    }
  }
  return { teammateId, body, kind };
}
```

- [ ] **Step 4: Wire classifier into the `user` branch of `toEvent`**

In `toEvent`, in the `user` handling block (around line 90), after you've determined the user text `c` (the string content case) and before building the return object, call the classifier. There are two paths:

**String content path** (around line 105):

```ts
const tm = classifyTeammateMessage(c);
return {
  index, uuid, parentUuid, timestamp,
  role: "user",
  rawType,
  preview: truncate(c, 200),
  blocks: [{ type: "text", text: c }],
  teammateMessage: tm,
  raw,
};
```

**Array content path** with a text block (around line 131):

```ts
const textBlock = (c as ContentBlock[]).find(
  (b): b is { type: "text"; text: string } => b?.type === "text",
);
const tm = textBlock ? classifyTeammateMessage(textBlock.text) : undefined;
return {
  index, uuid, parentUuid, timestamp,
  role: "user",
  rawType,
  preview: textBlock ? truncate(textBlock.text, 200) : truncate(JSON.stringify(c), 200),
  blocks: c as ContentBlock[],
  teammateMessage: tm,
  raw,
};
```

Do not classify on the tool_result path — team deliveries are always `message.content` text, not tool_results.

- [ ] **Step 5: Run tests to verify green**

Run: `pnpm -F @claude-lens/parser test -- parser.test.ts`
Expected: PASS — all 6 new cases + existing cases green.

- [ ] **Step 6: Commit**

```bash
git add packages/parser/src/parser.ts packages/parser/test/parser.test.ts
git commit -m "feat(parser): classify <teammate-message> wrapped user events"
```

---

## Chunk 2: Fixtures + groupByTeam analytics

### Task 2.1: Commit trimmed JSONL fixtures

**Files:**
- Create: `packages/parser/test/fixtures/team-lead.jsonl`
- Create: `packages/parser/test/fixtures/team-member-a.jsonl`
- Create: `packages/parser/test/fixtures/team-member-b.jsonl`

- [ ] **Step 1: Build the lead fixture**

Write exactly this content to `packages/parser/test/fixtures/team-lead.jsonl` (one JSON object per line, no trailing newline inside objects). This is a minimal but realistic lead transcript: TeamCreate, one outbound SendMessage, one inbound teammate-message from each member, TeamDelete.

```jsonl
{"type":"user","sessionId":"lead-1","teamName":"alpha","timestamp":"2026-04-15T10:00:00Z","uuid":"L1","parentUuid":null,"message":{"content":"start team alpha"}}
{"type":"assistant","sessionId":"lead-1","teamName":"alpha","timestamp":"2026-04-15T10:00:05Z","uuid":"L2","parentUuid":"L1","requestId":"req1","message":{"id":"m1","model":"claude-opus","content":[{"type":"tool_use","id":"tu1","name":"TeamCreate","input":{"team_name":"alpha","description":"demo","agent_type":"orchestrator"}}]}}
{"type":"assistant","sessionId":"lead-1","teamName":"alpha","timestamp":"2026-04-15T10:01:00Z","uuid":"L3","parentUuid":"L2","requestId":"req2","message":{"id":"m2","model":"claude-opus","content":[{"type":"tool_use","id":"tu2","name":"SendMessage","input":{"to":"member-a","message":"do task A","type":"message"}}]}}
{"type":"user","sessionId":"lead-1","teamName":"alpha","timestamp":"2026-04-15T10:05:00Z","uuid":"L4","parentUuid":"L3","message":{"content":"<teammate-message teammate_id=\"member-a\">task A done</teammate-message>"}}
{"type":"assistant","sessionId":"lead-1","teamName":"alpha","timestamp":"2026-04-15T10:06:00Z","uuid":"L5","parentUuid":"L4","requestId":"req3","message":{"id":"m3","model":"claude-opus","content":[{"type":"tool_use","id":"tu3","name":"SendMessage","input":{"to":"member-b","message":"do task B","type":"message"}}]}}
{"type":"user","sessionId":"lead-1","teamName":"alpha","timestamp":"2026-04-15T10:08:00Z","uuid":"L6","parentUuid":"L5","message":{"content":"<teammate-message teammate_id=\"member-b\">{\"type\":\"idle_notification\",\"from\":\"member-b\"}</teammate-message>"}}
{"type":"assistant","sessionId":"lead-1","teamName":"alpha","timestamp":"2026-04-15T10:10:00Z","uuid":"L7","parentUuid":"L6","requestId":"req4","message":{"id":"m4","model":"claude-opus","content":[{"type":"tool_use","id":"tu4","name":"TeamDelete","input":{"team_name":"alpha"}}]}}
```

- [ ] **Step 2: Build member A fixture**

Write to `packages/parser/test/fixtures/team-member-a.jsonl`:

```jsonl
{"type":"user","sessionId":"mem-a","teamName":"alpha","agentName":"member-a","timestamp":"2026-04-15T10:01:05Z","uuid":"A1","parentUuid":null,"message":{"content":"<teammate-message teammate_id=\"team-lead\">do task A</teammate-message>"}}
{"type":"assistant","sessionId":"mem-a","teamName":"alpha","agentName":"member-a","timestamp":"2026-04-15T10:02:00Z","uuid":"A2","parentUuid":"A1","requestId":"areq1","message":{"id":"am1","model":"claude-opus","content":[{"type":"text","text":"working on task A"}]}}
{"type":"assistant","sessionId":"mem-a","teamName":"alpha","agentName":"member-a","timestamp":"2026-04-15T10:04:55Z","uuid":"A3","parentUuid":"A2","requestId":"areq2","message":{"id":"am2","model":"claude-opus","content":[{"type":"tool_use","id":"atu1","name":"SendMessage","input":{"to":"team-lead","message":"task A done","type":"message"}}]}}
```

- [ ] **Step 3: Build member B fixture**

Write to `packages/parser/test/fixtures/team-member-b.jsonl`:

```jsonl
{"type":"user","sessionId":"mem-b","teamName":"alpha","agentName":"member-b","timestamp":"2026-04-15T10:06:05Z","uuid":"B1","parentUuid":null,"message":{"content":"<teammate-message teammate_id=\"team-lead\">do task B</teammate-message>"}}
{"type":"assistant","sessionId":"mem-b","teamName":"alpha","agentName":"member-b","timestamp":"2026-04-15T10:07:30Z","uuid":"B2","parentUuid":"B1","requestId":"breq1","message":{"id":"bm1","model":"claude-opus","content":[{"type":"tool_use","id":"btu1","name":"SendMessage","input":{"to":"team-lead","message":"progress: 50%","type":"message"}}]}}
```

- [ ] **Step 4: Commit**

```bash
git add packages/parser/test/fixtures/
git commit -m "test(parser): add team-lead + 2 member JSONL fixtures"
```

---

### Task 2.2: Implement groupByTeam

**Files:**
- Create: `packages/parser/src/team.ts`
- Modify: `packages/parser/src/index.ts`
- Create: `packages/parser/test/team.test.ts`

- [ ] **Step 1: Write failing test for basic clustering**

Create `packages/parser/test/team.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTranscript } from "../src/parser.js";
import { groupByTeam } from "../src/team.js";
import type { SessionDetail, SessionMeta } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fix = (name: string) => join(here, "fixtures", name);

function loadFixture(path: string, id: string): SessionDetail {
  const text = readFileSync(path, "utf8").trim();
  const lines = text.split("\n").map((l) => JSON.parse(l));
  const { meta, events } = parseTranscript(lines);
  return {
    ...meta,
    id,
    filePath: path,
    projectName: "test",
    projectDir: "test",
  } as SessionDetail & { events: typeof events } & { events: any[] };
  // Note: SessionDetail = SessionMeta & { events; subagents? } — cast OK for test.
}

describe("groupByTeam", () => {
  it("clusters lead + 2 members into one TeamView", () => {
    const lead = loadFixture(fix("team-lead.jsonl"), "lead-1");
    const a = loadFixture(fix("team-member-a.jsonl"), "mem-a");
    const b = loadFixture(fix("team-member-b.jsonl"), "mem-b");
    const sessions: SessionMeta[] = [lead, a, b];
    const details = new Map([
      ["lead-1", { ...lead, events: (lead as any).events }],
      ["mem-a", { ...a, events: (a as any).events }],
      ["mem-b", { ...b, events: (b as any).events }],
    ]);
    const views = groupByTeam(sessions, details as any);
    expect(views).toHaveLength(1);
    const v = views[0]!;
    expect(v.teamName).toBe("alpha");
    expect(v.leadSessionId).toBe("lead-1");
    expect(v.memberSessionIds).toEqual(
      expect.arrayContaining(["mem-a", "mem-b"]),
    );
    expect(v.agentNameBySessionId.get("lead-1")).toBeUndefined();
    expect(v.agentNameBySessionId.get("mem-a")).toBe("member-a");
    expect(v.agentNameBySessionId.get("mem-b")).toBe("member-b");
  });

  it("pairs SendMessage events into TeamMessages with resolved ids", () => {
    const lead = loadFixture(fix("team-lead.jsonl"), "lead-1");
    const a = loadFixture(fix("team-member-a.jsonl"), "mem-a");
    const b = loadFixture(fix("team-member-b.jsonl"), "mem-b");
    const details = new Map([
      ["lead-1", { ...lead, events: (lead as any).events }],
      ["mem-a", { ...a, events: (a as any).events }],
      ["mem-b", { ...b, events: (b as any).events }],
    ]);
    const view = groupByTeam([lead, a, b], details as any)[0]!;
    // Expect 4 messages: lead→A, A→lead, lead→B, B→lead
    expect(view.messages.length).toBe(4);

    const byPair = view.messages.map(
      (m) => `${m.fromSessionId}→${m.toSessionId}`,
    );
    expect(byPair).toEqual(
      expect.arrayContaining([
        "lead-1→mem-a",
        "mem-a→lead-1",
        "lead-1→mem-b",
        "mem-b→lead-1",
      ]),
    );
    // Sorted chronologically
    for (let i = 1; i < view.messages.length; i++) {
      expect(view.messages[i]!.tsMs).toBeGreaterThanOrEqual(
        view.messages[i - 1]!.tsMs,
      );
    }
  });

  it("skips groups with no lead candidate", () => {
    const a = loadFixture(fix("team-member-a.jsonl"), "mem-a");
    const b = loadFixture(fix("team-member-b.jsonl"), "mem-b");
    // Both members present, no session without agentName
    const sessions = [a, b];
    const details = new Map([
      ["mem-a", { ...a, events: (a as any).events }],
      ["mem-b", { ...b, events: (b as any).events }],
    ]);
    const views = groupByTeam(sessions, details as any);
    expect(views).toHaveLength(0);
  });

  it("records an unmatched SendMessage with empty toSessionId", () => {
    const lead = loadFixture(fix("team-lead.jsonl"), "lead-1");
    // Only the lead — members dropped
    const views = groupByTeam(
      [lead],
      new Map([["lead-1", { ...lead, events: (lead as any).events }]]) as any,
    );
    expect(views).toHaveLength(1);
    const msgs = views[0]!.messages;
    // Both SendMessages from the lead are unmatched
    expect(msgs.every((m) => m.fromSessionId === "lead-1")).toBe(true);
    expect(msgs.every((m) => m.toSessionId === "")).toBe(true);
  });

  it("classifies idle-notification messages", () => {
    const lead = loadFixture(fix("team-lead.jsonl"), "lead-1");
    const a = loadFixture(fix("team-member-a.jsonl"), "mem-a");
    const b = loadFixture(fix("team-member-b.jsonl"), "mem-b");
    const details = new Map([
      ["lead-1", { ...lead, events: (lead as any).events }],
      ["mem-a", { ...a, events: (a as any).events }],
      ["mem-b", { ...b, events: (b as any).events }],
    ]);
    const view = groupByTeam([lead, a, b], details as any)[0]!;
    // Nothing in the fixtures currently produces an idle kind on the
    // SendMessage pairing path (that'd come from the <teammate-message>
    // on the receiving side). This test just asserts the kind field is
    // populated with "message" for all SendMessage-sourced entries.
    expect(view.messages.every((m) => m.kind === "message")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm -F @claude-lens/parser test -- team.test.ts`
Expected: FAIL — `team.js` does not exist.

- [ ] **Step 3: Implement team.ts**

Create `packages/parser/src/team.ts`:

```ts
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

/**
 * Pure cross-session clustering. No fs, no parsing.
 *
 * Algorithm:
 * 1. Filter to sessions with teamName, group by teamName.
 * 2. Pick the lead: the session with no agentName (preferring one that
 *    contains a TeamCreate tool_use). If none: skip the group.
 * 3. Derive the agentName map from each session's SessionMeta.agentName.
 * 4. Walk every session's events, emit a TeamMessage per SendMessage
 *    tool_use. Resolve the recipient sessionId by matching `to` against
 *    either the members' agentName or the lead's sessionId (when to="team-lead").
 * 5. Sort messages by timestamp.
 */
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
  const candidates = group.filter((s) => !s.agentName);
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
    // Fallback: earliest-starting candidate.
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

  // Reverse lookup: agentName → sessionId (members only).
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
```

- [ ] **Step 4: Export from parser index**

In `packages/parser/src/index.ts`, add:

```ts
export { groupByTeam } from "./team.js";
export type { TeamView, TeamMessage } from "./team.js";
```

- [ ] **Step 5: Run tests**

Run: `pnpm -F @claude-lens/parser test -- team.test.ts`
Expected: PASS — all 5 cases green. Also run the full parser suite: `pnpm -F @claude-lens/parser test`. Everything should still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/parser/src/team.ts packages/parser/src/index.ts packages/parser/test/team.test.ts
git commit -m "feat(parser): add groupByTeam() for lead/member correlation"
```

---

## Chunk 3: Node-side team loader

### Task 3.1: Implement scanForTeamName + loadTeamForSession

**Files:**
- Modify: `packages/parser/src/fs.ts`

- [ ] **Step 1: Add the cheap scanner**

In `packages/parser/src/fs.ts`, add a new exported helper near the existing `readJsonlFile` utilities:

```ts
/**
 * Cheap check: does the JSONL at `filePath` participate in team `teamName`?
 * Reads up to the first 50 lines and returns `true` as soon as it sees an
 * event with a matching `teamName` field. Returns `false` if no match by
 * line 50 or on any read error.
 */
export async function scanForTeamName(
  filePath: string,
  teamName: string,
): Promise<boolean> {
  try {
    const lines = await readJsonlFile(filePath);
    const limit = Math.min(lines.length, 50);
    for (let i = 0; i < limit; i++) {
      const line = lines[i];
      if (!line || typeof line !== "object") continue;
      const tn = (line as { teamName?: unknown }).teamName;
      if (typeof tn === "string" && tn === teamName) return true;
    }
    return false;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Add `loadTeamForSession`**

Below `scanForTeamName`, add:

```ts
import { groupByTeam } from "./team.js";
import type { TeamView } from "./team.js";

/**
 * Load the team view for a given session. Returns null if the session has
 * no teamName (not participating in any team). Otherwise, scans all
 * projects in the projects root for siblings in the same team and returns
 * a TeamView + the SessionDetail map for the lead and every member.
 *
 * This is only called when the user opens the Team tab, so the fan-out
 * scan only fires on demand.
 */
export async function loadTeamForSession(
  sessionId: string,
  projectsRoot: string = defaultProjectsRoot(),
): Promise<{
  view: TeamView;
  details: Map<string, SessionDetail>;
} | null> {
  // 1. Load this session's detail to get its teamName.
  const selfList = await listSessions(projectsRoot);
  const self = selfList.find((s) => s.sessionId === sessionId);
  if (!self || !self.teamName) return null;
  const teamName = self.teamName;

  // 2. Find every other session whose JSONL carries the same teamName.
  //    Use the cheap scanner first to avoid fully parsing every JSONL.
  const candidates: SessionMeta[] = [];
  for (const s of selfList) {
    if (s.sessionId === self.sessionId) {
      candidates.push(self);
      continue;
    }
    // If the cheap meta scan already populated teamName, trust it.
    if (s.teamName === teamName) {
      candidates.push(s);
      continue;
    }
    // Otherwise fall back to the first-50-lines scanner.
    if (await scanForTeamName(s.filePath, teamName)) {
      candidates.push(s);
    }
  }

  // 3. Parse each candidate fully.
  const details = new Map<string, SessionDetail>();
  for (const c of candidates) {
    const d = await loadSessionDetail(c.sessionId, projectsRoot);
    if (d) details.set(c.sessionId, d);
  }

  // 4. Cluster.
  const views = groupByTeam(candidates, details);
  const view = views.find((v) => v.teamName === teamName);
  if (!view) return null;
  return { view, details };
}
```

**Integration notes for the implementer:** the existing `listSessions` and `loadSessionDetail` function names are illustrative — look up the actual exported names in `fs.ts` and match them. If `listSessions` already returns `SessionMeta` with `teamName` populated (because Task 1.2 taught `parseTranscript` to extract it), most of the cheap-scan fallback is unnecessary and you can shortcut to `s.teamName === teamName`.

- [ ] **Step 3: Typecheck the parser package**

Run: `pnpm -F @claude-lens/parser exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Smoke-run against real sessions**

The three real sessions we brainstormed against live on disk. Write a temporary script (NOT committed) to verify loadTeamForSession works end-to-end:

```bash
node -e '
import("./packages/parser/dist/fs.js").then(async (fs) => {
  const r = await fs.loadTeamForSession("3edd9aee-a722-42cc-a249-1d79a7d6af76");
  console.log("lead:", r?.view.leadSessionId);
  console.log("members:", r?.view.memberSessionIds);
  console.log("messages:", r?.view.messages.length);
});
'
```

(You'll need to `pnpm -F @claude-lens/parser build` first.)

Expected: lead is the lead sessionId, members include the two member sessionIds, messages >= 20.

If the dist import path differs, use whatever the parser's built entry is.

- [ ] **Step 5: Commit**

```bash
git add packages/parser/src/fs.ts
git commit -m "feat(parser): add loadTeamForSession() for on-demand team lookup"
```

---

## Chunk 4: Web — filter lead conversation + banner

### Task 4.1: Hide teammate messages from the lead's Conversation tab

**Files:**
- Modify: `apps/web/app/sessions/[id]/session-view.tsx`

- [ ] **Step 1: Locate the event-rendering list**

Read `apps/web/app/sessions/[id]/session-view.tsx` and find where `user`-role events are rendered (search for `role === "user"` or the component that maps over `events`). Identify the exact variable name for the event list.

- [ ] **Step 2: Filter events whose `teammateMessage` is set**

Before the map/render, derive two arrays:

```tsx
const teammateCount = session.events.filter((e) => e.teammateMessage).length;
const visibleEvents = session.events.filter((e) => !e.teammateMessage);
```

Use `visibleEvents` as the data source for the existing render loop. Do not rename existing props — just swap the source array.

- [ ] **Step 3: Render the banner**

At the top of the Conversation tab's scroll container, only when `teammateCount > 0`, render a compact banner. Match the existing style palette (reuse whatever info-banner class the session view already uses; if none, inline minimal tailwind like `rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground mb-2`):

```tsx
{teammateCount > 0 && (
  <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground mb-2">
    {teammateCount} inbound team message{teammateCount === 1 ? "" : "s"} hidden — open the Team tab to see them.
  </div>
)}
```

- [ ] **Step 4: Rebuild and smoke**

Rebuild the standalone + CLI per the CLAUDE.md dev server flow, launch on port 3321, hit a real lead session page:

```bash
rm -rf apps/web/.next packages/cli/app
NEXT_OUTPUT=standalone pnpm -F @claude-lens/web build
node scripts/prepare-cli.mjs
node packages/cli/dist/index.js stop
node packages/cli/dist/index.js web usage --no-open
```

Open http://localhost:3321/sessions/3edd9aee-a722-42cc-a249-1d79a7d6af76 and visually verify:
- The "135 inbound team messages hidden" banner appears at the top.
- The user message list no longer contains any `<teammate-message>` entries.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/sessions/\[id\]/session-view.tsx
git commit -m "feat(web): hide teammate-message events from lead's conversation tab"
```

---

## Chunk 5: Web — Team tab + multi-track view

### Task 5.1: Add the Team tab trigger

**Files:**
- Modify: `apps/web/app/sessions/[id]/page.tsx`

- [ ] **Step 1: Read the file and locate the tab layout**

Find where Conversation / Timeline / Tools tabs are currently defined. Identify the tab primitive (likely a shadcn `Tabs` + `TabsList` + `TabsTrigger`).

- [ ] **Step 2: Add a "Team" tab conditionally**

Only render the trigger when `session.teamName` is truthy. Example shape:

```tsx
{session.teamName && (
  <TabsTrigger value="team">Team</TabsTrigger>
)}
```

And a matching `<TabsContent value="team">` that lazy-loads the Team tab loader:

```tsx
{session.teamName && (
  <TabsContent value="team">
    <TeamTabLoader sessionId={session.sessionId} />
  </TabsContent>
)}
```

Import `TeamTabLoader` from the team-tab directory (created next).

- [ ] **Step 3: Commit placeholder (doesn't compile yet — skip until 5.2 done)**

No commit yet — this depends on 5.2.

---

### Task 5.2: Build the Team tab loader (server component)

**Files:**
- Create: `apps/web/app/sessions/[id]/team-tab/team-tab-loader.tsx`
- Create: `apps/web/app/sessions/[id]/team-tab/adapter.ts`
- Create: `apps/web/app/sessions/[id]/team-tab/team-tab-client.tsx`

- [ ] **Step 1: Write the loader**

Create `apps/web/app/sessions/[id]/team-tab/team-tab-loader.tsx`:

```tsx
import { loadTeamForSession } from "@claude-lens/parser/fs";
import { teamViewToMultiTrackProps } from "./adapter.js";
import { TeamTabClient } from "./team-tab-client.js";

export async function TeamTabLoader({ sessionId }: { sessionId: string }) {
  const result = await loadTeamForSession(sessionId);
  if (!result) {
    return (
      <div className="text-sm text-muted-foreground p-4">
        This session isn't part of a team.
      </div>
    );
  }
  const props = teamViewToMultiTrackProps(result.view, result.details);
  return <TeamTabClient initial={props} teamName={result.view.teamName} />;
}
```

- [ ] **Step 2: Write the adapter**

Create `apps/web/app/sessions/[id]/team-tab/adapter.ts`:

```ts
import type { TeamView, TeamMessage } from "@claude-lens/parser";
import type { SessionDetail, SessionEvent } from "@claude-lens/parser";

export type TrackRow = {
  tsMs: number;
  kind: "human" | "agent" | "tool" | "inbound-message" | "idle";
  /** Display label (short) */
  label: string;
  /** Long preview text */
  preview: string;
};

export type Track = {
  id: string;          // sessionId
  label: string;       // "LEAD" or agentName
  color: string;       // css color token
  isLead: boolean;
  rows: TrackRow[];
  /** Active-segment bars for the header lane. */
  activeSegments: { startMs: number; endMs: number }[];
};

export type CrossTrackMessage = {
  tsMs: number;
  fromTrackId: string;
  toTrackId: string;
  label: string;
};

export type MultiTrackProps = {
  tracks: Track[];
  messages: CrossTrackMessage[];
  firstEventMs: number;
  lastEventMs: number;
};

const LEAD_COLOR = "var(--team-lead, #f0b429)";
const MEMBER_COLORS = [
  "var(--team-m1, #58a6ff)",
  "var(--team-m2, #b58cf0)",
  "var(--team-m3, #3fb950)",
  "var(--team-m4, #f85149)",
  "var(--team-m5, #db6d28)",
];

export function teamViewToMultiTrackProps(
  view: TeamView,
  details: Map<string, SessionDetail>,
): MultiTrackProps {
  const tracks: Track[] = [];

  // Lead first.
  const leadDetail = details.get(view.leadSessionId);
  if (leadDetail) {
    tracks.push(buildTrack(leadDetail, "LEAD", LEAD_COLOR, true));
  }

  // Then members in order.
  view.memberSessionIds.forEach((id, i) => {
    const d = details.get(id);
    if (!d) return;
    const label = view.agentNameBySessionId.get(id) ?? id.slice(0, 8);
    tracks.push(
      buildTrack(d, label, MEMBER_COLORS[i % MEMBER_COLORS.length]!, false),
    );
  });

  const messages: CrossTrackMessage[] = view.messages.map((m) => ({
    tsMs: m.tsMs,
    fromTrackId: m.fromSessionId,
    toTrackId: m.toSessionId,
    label: m.body.slice(0, 80),
  }));

  return {
    tracks,
    messages,
    firstEventMs: view.firstEventMs,
    lastEventMs: view.lastEventMs,
  };
}

function buildTrack(
  d: SessionDetail,
  label: string,
  color: string,
  isLead: boolean,
): Track {
  const rows: TrackRow[] = [];
  for (const ev of d.events) {
    const row = toRow(ev, isLead);
    if (row) rows.push(row);
  }
  return {
    id: d.sessionId,
    label,
    color,
    isLead,
    rows,
    activeSegments: d.activeSegments ?? [],
  };
}

function toRow(ev: SessionEvent, isLead: boolean): TrackRow | null {
  if (!ev.timestamp) return null;
  const tsMs = Date.parse(ev.timestamp);

  // Lead track: show the lead's own outbound SendMessage as a tool row but
  // suppress inbound teammate-message events (they render in the sender's
  // column instead via the arrow).
  if (ev.teammateMessage && isLead) return null;

  if (ev.teammateMessage) {
    return {
      tsMs,
      kind: "inbound-message",
      label: `← from ${ev.teammateMessage.teammateId}`,
      preview: ev.teammateMessage.body.slice(0, 200),
    };
  }

  if (ev.role === "user") {
    return { tsMs, kind: "human", label: "HUMAN", preview: ev.preview };
  }
  if (ev.role === "agent" || ev.role === "agent-thinking") {
    return { tsMs, kind: "agent", label: "AGENT", preview: ev.preview };
  }
  if (ev.role === "tool-call") {
    return {
      tsMs,
      kind: "tool",
      label: ev.toolName ?? "tool",
      preview: ev.preview,
    };
  }
  return null;
}
```

- [ ] **Step 3: Write the client wrapper**

Create `apps/web/app/sessions/[id]/team-tab/team-tab-client.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { MultiTrackProps } from "./adapter.js";
import { SwimLaneHeader } from "./swim-lane-header.js";
import { MultiTrack } from "./multi-track.js";

export function TeamTabClient({
  initial,
  teamName,
}: {
  initial: MultiTrackProps;
  teamName: string;
}) {
  const [zoom, setZoom] = useState(0); // 0 = event-anchored, 1 = strict time
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Team: {teamName}</h2>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Event-anchored</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
          <span>Strict time</span>
        </label>
      </div>
      <SwimLaneHeader {...initial} />
      <MultiTrack {...initial} zoom={zoom} />
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/sessions/\[id\]/team-tab/
git commit -m "feat(web): team tab loader, adapter, and client scaffold"
```

---

### Task 5.3: Build the swim-lane header

**Files:**
- Create: `apps/web/app/sessions/[id]/team-tab/swim-lane-header.tsx`

- [ ] **Step 1: Create the component**

```tsx
import type { MultiTrackProps } from "./adapter.js";

export function SwimLaneHeader({
  tracks,
  messages,
  firstEventMs,
  lastEventMs,
}: MultiTrackProps) {
  const span = Math.max(1, lastEventMs - firstEventMs);

  return (
    <div className="sticky top-0 z-10 rounded-md border border-border bg-background/95 backdrop-blur px-3 py-2">
      <TimeRuler firstMs={firstEventMs} lastMs={lastEventMs} />
      <div className="flex flex-col gap-1.5 mt-1.5">
        {tracks.map((t) => (
          <div key={t.id} className="flex items-center gap-2">
            <div
              className="w-28 text-[10px] font-mono truncate"
              style={{ color: t.color }}
              title={t.label}
            >
              {t.isLead ? "LEAD" : t.label}
            </div>
            <div className="flex-1 relative h-3 rounded-sm bg-muted">
              {t.activeSegments.map((seg, i) => {
                const left = ((seg.startMs - firstEventMs) / span) * 100;
                const width = ((seg.endMs - seg.startMs) / span) * 100;
                return (
                  <div
                    key={i}
                    className="absolute top-0.5 h-2 rounded-sm"
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(0.3, width)}%`,
                      background: t.color,
                      opacity: 0.85,
                    }}
                  />
                );
              })}
              {messages
                .filter(
                  (m) => m.fromTrackId === t.id || m.toTrackId === t.id,
                )
                .map((m, i) => {
                  const otherId =
                    m.fromTrackId === t.id ? m.toTrackId : m.fromTrackId;
                  const other = tracks.find((x) => x.id === otherId);
                  const left = ((m.tsMs - firstEventMs) / span) * 100;
                  return (
                    <div
                      key={i}
                      className="absolute top-[-2px] w-[2px] h-4"
                      style={{
                        left: `${left}%`,
                        background: other?.color ?? "#888",
                      }}
                      title={m.label}
                    />
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimeRuler({ firstMs, lastMs }: { firstMs: number; lastMs: number }) {
  const ticks: number[] = [];
  const span = lastMs - firstMs;
  const step = span / 5;
  for (let i = 0; i <= 5; i++) ticks.push(firstMs + step * i);
  return (
    <div className="flex items-center gap-2">
      <div className="w-28" />
      <div className="flex-1 flex justify-between text-[9px] text-muted-foreground font-mono">
        {ticks.map((t, i) => (
          <span key={i}>{new Date(t).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}</span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -F @claude-lens/web exec tsc --noEmit`
Expected: no errors. Fix any import paths.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/sessions/\[id\]/team-tab/swim-lane-header.tsx
git commit -m "feat(web): team tab swim-lane header with time ruler and message ticks"
```

---

### Task 5.4: Build the multi-track body (event-anchored mode)

**Files:**
- Create: `apps/web/app/sessions/[id]/team-tab/multi-track.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useMemo } from "react";
import type { MultiTrackProps } from "./adapter.js";

type Props = MultiTrackProps & { zoom: number };

type MergedRow = {
  tsMs: number;
  cells: Map<string, { kind: string; label: string; preview: string }>;
};

export function MultiTrack({
  tracks,
  messages,
  firstEventMs,
  lastEventMs,
  zoom,
}: Props) {
  const rows = useMemo(() => mergeRows(tracks), [tracks]);

  // Zoom: 0 = event-anchored (each row gets equal height, natural reading).
  // 1 = strict-time (row height is proportional to wall-clock gap to next row).
  // Linear interpolation between the two modes.
  const total = Math.max(1, lastEventMs - firstEventMs);

  return (
    <div
      className="grid gap-0 border border-border rounded-md overflow-hidden"
      style={{
        gridTemplateColumns: `80px repeat(${tracks.length}, minmax(240px, 1fr))`,
        fontFamily: "ui-monospace, monospace",
        fontSize: "11px",
      }}
    >
      {/* Sticky column headers */}
      <div className="sticky top-0 bg-muted/40 p-2 text-[9px] text-muted-foreground border-b border-border">
        TIME
      </div>
      {tracks.map((t) => (
        <div
          key={t.id}
          className="sticky top-0 bg-muted/40 p-2 border-b border-l border-border font-semibold"
          style={{ color: t.color }}
        >
          {t.isLead ? "LEAD" : t.label}
        </div>
      ))}

      {rows.map((row, i) => {
        const next = rows[i + 1];
        const gapMs = next ? next.tsMs - row.tsMs : 0;
        const strictHeight = Math.max(24, (gapMs / total) * 1800);
        const anchoredHeight = 36;
        const height = anchoredHeight + (strictHeight - anchoredHeight) * zoom;

        return (
          <div key={i} className="contents">
            <div
              className="p-2 text-[9px] text-muted-foreground border-b border-border flex items-start"
              style={{ minHeight: `${height}px` }}
            >
              {formatTime(row.tsMs)}
            </div>
            {tracks.map((t) => {
              const cell = row.cells.get(t.id);
              return (
                <div
                  key={t.id}
                  className="p-2 border-b border-l border-border"
                  style={{ minHeight: `${height}px` }}
                >
                  {cell ? (
                    <>
                      <div
                        className="text-[9px] mb-0.5"
                        style={{ color: t.color }}
                      >
                        {cell.label}
                      </div>
                      <div className="text-foreground/90 leading-snug">
                        {cell.preview}
                      </div>
                    </>
                  ) : (
                    <span className="text-muted-foreground/40 italic">· idle ·</span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function mergeRows(tracks: MultiTrackProps["tracks"]): MergedRow[] {
  type Entry = {
    tsMs: number;
    trackId: string;
    kind: string;
    label: string;
    preview: string;
  };
  const all: Entry[] = [];
  for (const t of tracks) {
    for (const r of t.rows) {
      all.push({
        tsMs: r.tsMs,
        trackId: t.id,
        kind: r.kind,
        label: r.label,
        preview: r.preview,
      });
    }
  }
  all.sort((a, b) => a.tsMs - b.tsMs);

  // Group entries that fall within a small window (e.g., 2 seconds) into
  // one row so simultaneous events across tracks line up cleanly.
  const merged: MergedRow[] = [];
  const WINDOW_MS = 2_000;
  for (const e of all) {
    const last = merged[merged.length - 1];
    if (last && e.tsMs - last.tsMs <= WINDOW_MS) {
      last.cells.set(e.trackId, {
        kind: e.kind,
        label: e.label,
        preview: e.preview,
      });
    } else {
      merged.push({
        tsMs: e.tsMs,
        cells: new Map([
          [e.trackId, { kind: e.kind, label: e.label, preview: e.preview }],
        ]),
      });
    }
  }
  return merged;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/sessions/\[id\]/team-tab/multi-track.tsx
git commit -m "feat(web): multi-track body with event-anchored + strict-time zoom"
```

---

### Task 5.5: Wire up the Team tab trigger

**Files:**
- Modify: `apps/web/app/sessions/[id]/page.tsx`

- [ ] **Step 1: Import and use `TeamTabLoader`**

Add the import at the top:

```tsx
import { TeamTabLoader } from "./team-tab/team-tab-loader.js";
```

Wire the trigger + content as described in Task 5.1 (now uncommented since loader exists).

- [ ] **Step 2: Rebuild and smoke**

```bash
rm -rf apps/web/.next packages/cli/app
NEXT_OUTPUT=standalone pnpm -F @claude-lens/web build
node scripts/prepare-cli.mjs
node packages/cli/dist/index.js stop
node packages/cli/dist/index.js web usage --no-open
```

Open http://localhost:3321/sessions/3edd9aee-a722-42cc-a249-1d79a7d6af76 and verify:
- A "Team" tab appears next to the existing tabs.
- Clicking it shows the swim-lane header with 3 colored lanes (lead + 2 members).
- The multi-track body below shows the lead and member columns with interleaved rows.
- The zoom slider at top-right actually resizes rows toward strict-time mode when dragged right.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/sessions/\[id\]/page.tsx
git commit -m "feat(web): add Team tab trigger to lead session page"
```

---

### Task 5.6: Extend smoke script for Team tab

**Files:**
- Modify: `scripts/smoke.mjs`

- [ ] **Step 1: Add a smoke route for the team-enabled lead session**

Read `scripts/smoke.mjs` to find the route-checking pattern. Add a new assertion: hit `/sessions/3edd9aee-a722-42cc-a249-1d79a7d6af76` (or whatever lead session the smoke fixture expects) and assert the response body contains the string `"Team"` near a tab trigger. If the smoke script is purely a 200-check today, add a simple `response.text()` contains-check.

- [ ] **Step 2: Run `pnpm verify`**

Expected: PASS. Fix anything that breaks.

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke.mjs
git commit -m "test(smoke): assert Team tab renders on lead session page"
```

---

## Chunk 6: Session row badges

### Task 6.1: Build the TeamBadge component

**Files:**
- Create: `apps/web/components/team-badge.tsx`

- [ ] **Step 1: Create the component**

```tsx
import Link from "next/link";
import type { SessionMeta } from "@claude-lens/parser";

export function TeamBadge({ session }: { session: SessionMeta }) {
  if (!session.teamName) return null;
  const isLead = !session.agentName;
  if (isLead) {
    return (
      <Link
        href={`/sessions/${session.sessionId}?tab=team`}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30"
        title={`Team lead — ${session.teamName}`}
      >
        Team Lead
      </Link>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide bg-muted/40 text-muted-foreground border border-border"
      title={`Team member — ${session.teamName} · ${session.agentName}`}
    >
      Team Member
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/team-badge.tsx
git commit -m "feat(web): TeamBadge component for session rows"
```

---

### Task 6.2: Render TeamBadge in all session row sites

**Files:**
- Modify: `apps/web/app/sessions/page.tsx`
- Modify: `apps/web/components/sidebar.tsx`
- Modify: `apps/web/components/dashboard-view.tsx`
- Modify: `apps/web/app/sessions/sessions-grid.tsx`

- [ ] **Step 1: Add badge to each**

In each file, find where a session row is rendered (search for `session.firstUserPreview`, `session.sessionId`, or the session list map). Next to the existing session title/preview, render:

```tsx
<TeamBadge session={s} />
```

Import from `@/components/team-badge` (or the project's existing component import root — match the style of existing imports in the same file).

- [ ] **Step 2: Visual smoke**

Rebuild + restart the web server (same commands as Task 4.1 Step 4). Open:
- http://localhost:3321 — dashboard recents should show the team lead session with an amber "Team Lead" pill.
- http://localhost:3321/sessions — list should show lead + members with their respective badges.
- Sidebar should show the same.
- Calendar day view (click a day with team activity).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/sessions/page.tsx apps/web/components/sidebar.tsx apps/web/components/dashboard-view.tsx apps/web/app/sessions/sessions-grid.tsx
git commit -m "feat(web): render TeamBadge on all session row sites"
```

---

## Final verification

- [ ] **Run full test suite**

```bash
pnpm test
```

Expected: all parser tests green, web passes (no new vitest cases, smoke covers it).

- [ ] **Run pnpm verify**

```bash
pnpm verify
```

Expected: typecheck + smoke all pass.

- [ ] **Manual walkthrough**

1. Open the lead session's Conversation tab → see the "N inbound team messages hidden" banner, no `<teammate-message>` in the user list.
2. Click the Team tab → see swim lanes, multi-track body, zoom slider works.
3. Open `/sessions` → see "Team Lead" and "Team Member" badges on the right rows.
4. Open a member session directly → normal session page still renders fine.

- [ ] **Release**

Per CLAUDE.md release flow:

```bash
pnpm test && pnpm verify
npm version minor
git push origin master
git push origin v<new-version>
```

The tag push triggers the GitHub Actions release workflow.
