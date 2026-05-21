# Team Insight Report — Phase 1 Static Prototype — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static prototype of the team insight report at `/team/[slug]/insights` in the team edition, with mock data rich enough to demonstrate the end-state vision (six sections including three flavors of opt-in "spotlight" cards).

**Architecture:** Server component page composes six presentational components. All data is hardcoded in a single `mock-data.ts` file shaped to look like the eventual ingest payload, so Phase 2 can swap a fetcher function without UI changes. No DB, no ingest endpoint, no personal-edition changes.

**Tech Stack:** Next.js 16 App Router server components, React 19, plain CSS (extending the existing editorial design system in `globals.css`), TypeScript, vitest (one unit test for mock-data shape integrity).

**Spec:** `docs/superpowers/specs/2026-05-14-team-insight-report-design.md`

---

## File structure

**Create:**
- `packages/team-server/src/app/team/[slug]/insights/page.tsx` — server component route
- `packages/team-server/src/app/team/[slug]/insights/types.ts` — local TypeScript types for the report payload
- `packages/team-server/src/app/team/[slug]/insights/mock-data.ts` — single source of mock data
- `packages/team-server/src/components/team-pulse.tsx`
- `packages/team-server/src/components/working-shape-distribution.tsx`
- `packages/team-server/src/components/harness-diffusion.tsx`
- `packages/team-server/src/components/projects-table.tsx`
- `packages/team-server/src/components/spotlight-card.tsx`
- `packages/team-server/src/components/roster-snapshot.tsx`
- `packages/team-server/test/app/insights-mock-data.test.ts` — shape integrity test

**Modify:**
- `packages/team-server/src/app/team/[slug]/layout.tsx` — add "Insights" sidebar link
- `packages/team-server/src/app/globals.css` — add styling for the new sections

**Note on types:** The taxonomy strings (`WorkingShape`, `DayOutcome`, `DayHelpfulness`) live in `@claude-lens/entries` which is not yet a team-server dependency. For Phase 1 we define minimal local type aliases. Phase 2 will revisit whether to import from `@claude-lens/entries` for a single source of truth.

---

### Task 1: Types + mock data + shape integrity test

**Files:**
- Create: `packages/team-server/src/app/team/[slug]/insights/types.ts`
- Create: `packages/team-server/src/app/team/[slug]/insights/mock-data.ts`
- Test: `packages/team-server/test/app/insights-mock-data.test.ts`

- [ ] **Step 1: Create the types file**

```ts
// packages/team-server/src/app/team/[slug]/insights/types.ts

// Phase-1 local aliases. Phase 2 will revisit importing from @claude-lens/entries.
export type WorkingShape =
  | "spec-review-loop"
  | "chunk-implementation"
  | "research-then-build"
  | "reviewer-triad"
  | "background-coordinated"
  | "solo-continuation"
  | "solo-design"
  | "solo-build";

export type DayOutcome = "shipped" | "partial" | "blocked" | "exploratory" | "trivial";
export type DayHelpfulness = "essential" | "helpful" | "neutral" | "unhelpful";

export type SpotlightFlavor = "cross-team-pattern" | "case-study" | "strength-surfacing";

export type TeamPulse = {
  agent_hours: number;
  agent_hours_wow_delta_pct: number;
  shipped_count: number;
  shipped_wow_delta: number;
  members_active: number;
  members_total: number;
  outcome_mix: Record<DayOutcome, number>;
  helpfulness_mix: Record<DayHelpfulness, number>;
  concurrency_peak: { date: string; peak: number };
};

export type WorkingShapeRow = {
  shape: WorkingShape;
  occurrences: number;
  members_using: number;
  outcome_distribution: Partial<Record<DayOutcome, number>>;
};

export type GoalCategoryRow = {
  category: string;
  minutes: number;
  share_pct: number;
};

export type HowTheyWorked = {
  shapes: WorkingShapeRow[];
  goal_categories: GoalCategoryRow[];
  plan_mode_adopters: number;
  brainstorm_warmup_adopters: number;
};

export type ToolFamilyRow = {
  family: string;
  uses: number;
};

export type UserAuthoredArtifact = {
  name: string;
  members_using: number;
  total_uses: number;
};

export type Harness = {
  tool_families: ToolFamilyRow[];
  user_skills: UserAuthoredArtifact[];
  user_subagents: UserAuthoredArtifact[];
};

export type ProjectRow = {
  name: string;
  display_name: string;
  agent_hours: number;
  members: string[];
  shipped_count: number;
};

export type Spotlight = {
  id: string;
  flavor: SpotlightFlavor;
  author: string; // member display name, or "The team"
  title: string;
  body: string; // multi-paragraph prose
  evidence: string; // 1-line evidence anchor
};

export type RosterRow = {
  membership_id: string;
  display_name: string;
  agent_hours: number;
  shipped_count: number;
};

export type TeamInsightReport = {
  team_slug: string;
  week_monday: string; // YYYY-MM-DD
  generated_at: string; // ISO
  pulse: TeamPulse;
  how_they_worked: HowTheyWorked;
  harness: Harness;
  projects: ProjectRow[];
  spotlights: Spotlight[];
  roster: RosterRow[];
};
```

- [ ] **Step 2: Write the shape integrity test (it will fail because mock-data.ts doesn't exist)**

```ts
// packages/team-server/test/app/insights-mock-data.test.ts

import { describe, it, expect } from "vitest";
import { mockTeamInsightReport } from "../../src/app/team/[slug]/insights/mock-data";

describe("mockTeamInsightReport", () => {
  it("has all six sections populated with non-trivial content", () => {
    const r = mockTeamInsightReport;
    expect(r.week_monday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Pulse
    expect(r.pulse.agent_hours).toBeGreaterThan(0);
    expect(r.pulse.members_active).toBeLessThanOrEqual(r.pulse.members_total);
    expect(Object.values(r.pulse.outcome_mix).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(Object.values(r.pulse.helpfulness_mix).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);

    // How they worked
    expect(r.how_they_worked.shapes.length).toBeGreaterThanOrEqual(3);
    expect(r.how_they_worked.goal_categories.length).toBeGreaterThanOrEqual(3);
    const goalSharePct = r.how_they_worked.goal_categories.reduce((s, g) => s + g.share_pct, 0);
    expect(goalSharePct).toBeGreaterThan(95);
    expect(goalSharePct).toBeLessThan(105);

    // Harness
    expect(r.harness.tool_families.length).toBeGreaterThanOrEqual(3);
    expect(r.harness.user_skills.length).toBeGreaterThanOrEqual(2);
    expect(r.harness.user_subagents.length).toBeGreaterThanOrEqual(1);

    // Projects
    expect(r.projects.length).toBeGreaterThanOrEqual(3);
    r.projects.forEach((p) => {
      expect(p.members.length).toBeGreaterThan(0);
    });

    // Spotlights — three flavors covered
    const flavors = new Set(r.spotlights.map((s) => s.flavor));
    expect(flavors.has("cross-team-pattern")).toBe(true);
    expect(flavors.has("case-study")).toBe(true);
    expect(flavors.has("strength-surfacing")).toBe(true);
    // Every spotlight must have meaningful prose (storytelling requirement).
    r.spotlights.forEach((s) => {
      expect(s.body.length).toBeGreaterThan(200);
    });

    // Roster — count matches the pulse's members_active.
    expect(r.roster.length).toBe(r.pulse.members_active);
  });
});
```

- [ ] **Step 3: Run the test, confirm it fails**

```bash
pnpm -F @claude-lens/team-server test test/app/insights-mock-data.test.ts
```

Expected: FAIL with "Cannot find module '.../mock-data'" or similar.

- [ ] **Step 4: Create the mock data file**

```ts
// packages/team-server/src/app/team/[slug]/insights/mock-data.ts

import type { TeamInsightReport } from "./types";

export const mockTeamInsightReport: TeamInsightReport = {
  team_slug: "acme-eng",
  week_monday: "2026-05-04",
  generated_at: "2026-05-12T09:14:00-07:00",

  pulse: {
    agent_hours: 18.4,
    agent_hours_wow_delta_pct: 12,
    shipped_count: 6,
    shipped_wow_delta: 2,
    members_active: 4,
    members_total: 5,
    outcome_mix: {
      shipped: 9,
      partial: 4,
      blocked: 1,
      exploratory: 3,
      trivial: 1,
    },
    helpfulness_mix: {
      essential: 11,
      helpful: 5,
      neutral: 2,
      unhelpful: 0,
    },
    concurrency_peak: { date: "2026-05-07", peak: 4 },
  },

  how_they_worked: {
    shapes: [
      {
        shape: "spec-review-loop",
        occurrences: 4,
        members_using: 3,
        outcome_distribution: { shipped: 3, partial: 1 },
      },
      {
        shape: "solo-build",
        occurrences: 5,
        members_using: 3,
        outcome_distribution: { shipped: 3, partial: 1, exploratory: 1 },
      },
      {
        shape: "research-then-build",
        occurrences: 2,
        members_using: 2,
        outcome_distribution: { shipped: 1, exploratory: 1 },
      },
      {
        shape: "reviewer-triad",
        occurrences: 1,
        members_using: 1,
        outcome_distribution: { shipped: 1 },
      },
      {
        shape: "background-coordinated",
        occurrences: 2,
        members_using: 1,
        outcome_distribution: { shipped: 1, blocked: 1 },
      },
    ],
    goal_categories: [
      { category: "build", minutes: 462, share_pct: 42 },
      { category: "debug", minutes: 198, share_pct: 18 },
      { category: "refactor", minutes: 154, share_pct: 14 },
      { category: "plan", minutes: 132, share_pct: 12 },
      { category: "review", minutes: 88, share_pct: 8 },
      { category: "research", minutes: 66, share_pct: 6 },
    ],
    plan_mode_adopters: 3,
    brainstorm_warmup_adopters: 2,
  },

  harness: {
    tool_families: [
      { family: "Bash", uses: 321 },
      { family: "Edit", uses: 184 },
      { family: "Write", uses: 72 },
      { family: "Read", uses: 412 },
      { family: "Grep", uses: 156 },
      { family: "Task", uses: 28 },
    ],
    user_skills: [
      { name: "harness-orchestrate", members_using: 3, total_uses: 11 },
      { name: "kipwise-migration-guard", members_using: 1, total_uses: 5 },
      { name: "release-ship-check", members_using: 2, total_uses: 4 },
    ],
    user_subagents: [
      { name: "implement-teammate", members_using: 2, total_uses: 6 },
      { name: "spec-reviewer", members_using: 1, total_uses: 3 },
    ],
  },

  projects: [
    {
      name: "topeka",
      display_name: "topeka",
      agent_hours: 8.2,
      members: ["Charlie", "Alice"],
      shipped_count: 3,
    },
    {
      name: "kipwise-v1",
      display_name: "kipwise-v1",
      agent_hours: 5.1,
      members: ["Bob"],
      shipped_count: 2,
    },
    {
      name: "ops-runbooks",
      display_name: "ops-runbooks",
      agent_hours: 3.4,
      members: ["Alice", "Dana"],
      shipped_count: 1,
    },
    {
      name: "infra-bootstrap",
      display_name: "infra-bootstrap",
      agent_hours: 1.7,
      members: ["Charlie"],
      shipped_count: 0,
    },
  ],

  spotlights: [
    {
      id: "spotlight-cross-team-spec-review",
      flavor: "cross-team-pattern",
      author: "The team",
      title: "Three textures of the spec-review loop",
      body:
        "Three teammates independently reached for spec-review-loop this week, and the three variants are worth comparing side by side. Charlie pinned a reviewer-triad on the spec before any code was written — three reviewer subagents, each with a narrow lens (correctness, ergonomics, rollback). Alice compressed the same shape into a single review pass right before merge, treating the reviewer as a final sanity gate rather than a parallel critique. Bob ran the loop in reverse: ship a draft, get a review, then sweep — using the reviewer as a checklist generator rather than a gatekeeper.\n\nAll three landed shipped, but the texture of the work is meaningfully different. Charlie's variant produced the longest first-PR (most pre-thinking, fewest follow-ups). Alice's was the fastest to merge. Bob's left the most polish work for a Tuesday-morning sweep. Useful to compare in the Friday demo — none of these is the right answer everywhere, but the team is converging on the shape.",
      evidence: "spec-review-loop · Charlie ×2 (Mon, Tue), Alice ×1 (Thu), Bob ×1 (Fri)",
    },
    {
      id: "spotlight-case-study-bob",
      flavor: "case-study",
      author: "Bob",
      title: "A migration that didn't need a rework cycle",
      body:
        "Bob spent most of the week on a single sustained build on kipwise-v1: a column-not-null migration on a 50M-row table. Two long autonomous turns on Wednesday (4.2h and 2.8h) carried the migration end-to-end without a rework cycle, which is unusual for a flag-touching change — typically these come back twice before shipping.\n\nThe load-bearing piece was Bob's kipwise-migration-guard skill, loaded at the start of each session. It gates risky operations (DROP COLUMN, ALTER TABLE, anything touching the audit_log) behind explicit confirmation prompts, and on Wednesday it caught two would-be early commits before they landed. The pattern that emerged: long autonomous runs become safe when there's a deterministic guardrail catching the irreversible moves, even when the LLM is otherwise in a build-fast mode. Worth studying as a template for any future migration touching live tables.",
      evidence: "Wed long-autonomous turns · 4.2h, 2.8h on kipwise-v1 · kipwise-migration-guard loaded ×5",
    },
    {
      id: "spotlight-strength-alice",
      flavor: "strength-surfacing",
      author: "Alice",
      title: "Parallel dispatch that actually shipped",
      body:
        "Alice's harness-orchestrate skill bears watching. It's the only place on the team this week where parallel subagent dispatches consistently shipped without a rework cycle — three out of three Alice-orchestrated multi-agent sessions ended in shipped, against ~50% for solo dispatches across the rest of the team.\n\nThe move that seems to make the difference: harness-orchestrate front-loads a single 'orchestration brief' subagent before any worker dispatches, and that brief becomes the contract every worker reads. The workers don't communicate with each other — they read the brief, do their slice, return. The pattern eliminates the coordination overhead that usually breaks parallel-agent runs. Worth a Friday demo, and worth copying anywhere the team is running parallel agents regularly.",
      evidence: "harness-orchestrate · Alice ×3 sessions, all shipped",
    },
  ],

  roster: [
    {
      membership_id: "mock-membership-charlie",
      display_name: "Charlie",
      agent_hours: 6.8,
      shipped_count: 3,
    },
    {
      membership_id: "mock-membership-alice",
      display_name: "Alice",
      agent_hours: 4.9,
      shipped_count: 1,
    },
    {
      membership_id: "mock-membership-bob",
      display_name: "Bob",
      agent_hours: 5.3,
      shipped_count: 2,
    },
    {
      membership_id: "mock-membership-dana",
      display_name: "Dana",
      agent_hours: 1.4,
      shipped_count: 0,
    },
  ],
};
```

- [ ] **Step 5: Run the test, confirm it passes**

```bash
pnpm -F @claude-lens/team-server test test/app/insights-mock-data.test.ts
```

Expected: PASS — 1 test passing.

- [ ] **Step 6: Run typecheck**

```bash
pnpm -F @claude-lens/team-server typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/team-server/src/app/team/\[slug\]/insights/types.ts \
        packages/team-server/src/app/team/\[slug\]/insights/mock-data.ts \
        packages/team-server/test/app/insights-mock-data.test.ts
git commit -m "feat(team-server): types + mock data for team insight report"
```

---

### Task 2: CSS additions for new report sections

**Files:**
- Modify: `packages/team-server/src/app/globals.css` (append to end of file)

- [ ] **Step 1: Append new CSS rules**

Open `packages/team-server/src/app/globals.css` and append the following block at the end of the file:

```css
/* ───── Team insight report ────────────────────────────────────────────── */

.insights-section {
  margin-bottom: 48px;
}
.insights-section + .insights-section {
  border-top: 1px solid var(--rule-soft);
  padding-top: 36px;
}

.pulse-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
  margin-top: 18px;
}
@media (max-width: 900px) {
  .pulse-grid { grid-template-columns: 1fr; }
}
.pulse-tile {
  border: 1px solid var(--rule);
  background: var(--paper);
  padding: 18px 20px;
  border-radius: 2px;
}
.pulse-tile-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mute);
  margin-bottom: 8px;
}
.pulse-tile-value {
  font-family: "Instrument Serif", serif;
  font-size: 36px;
  line-height: 1.0;
  color: var(--ink);
}
.pulse-tile-suffix {
  font-size: 16px;
  color: var(--mute);
  margin-left: 4px;
}
.pulse-tile-delta {
  margin-top: 8px;
  font-size: 12px;
  color: var(--mute);
}
.pulse-tile-delta.positive { color: var(--positive); }
.pulse-tile-delta.negative { color: var(--danger); }

.stacked-bar {
  display: flex;
  height: 14px;
  border-radius: 2px;
  overflow: hidden;
  margin-top: 10px;
  border: 1px solid var(--rule);
}
.stacked-bar-seg {
  height: 100%;
}
.stacked-bar-legend {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 8px;
  font-size: 11px;
  color: var(--mute);
}
.stacked-bar-legend-swatch {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 6px;
  vertical-align: middle;
  border-radius: 1px;
}

.shape-row {
  display: grid;
  grid-template-columns: 200px 1fr 140px;
  gap: 16px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--rule-soft);
}
.shape-row-label {
  font-family: "JetBrains Mono", monospace;
  font-size: 13px;
  color: var(--ink-soft);
}
.shape-row-bar-track {
  height: 10px;
  background: var(--rule-soft);
  border-radius: 1px;
  overflow: hidden;
}
.shape-row-bar-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 1px;
}
.shape-row-meta {
  font-size: 12px;
  color: var(--mute);
  text-align: right;
}

.goal-mix-strip {
  display: flex;
  margin-top: 16px;
  height: 18px;
  border-radius: 2px;
  overflow: hidden;
  border: 1px solid var(--rule);
}
.goal-mix-seg {
  height: 100%;
}
.goal-mix-legend {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  margin-top: 10px;
  font-size: 12px;
  color: var(--ink-soft);
}

.adoption-meta {
  display: flex;
  gap: 32px;
  margin-top: 16px;
  font-size: 13px;
  color: var(--ink-soft);
}
.adoption-meta strong {
  color: var(--accent);
  font-weight: 600;
}

.harness-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
  margin-top: 14px;
}
@media (max-width: 900px) {
  .harness-grid { grid-template-columns: 1fr; }
}
.harness-block-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mute);
  margin-bottom: 10px;
}
.harness-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid var(--rule-soft);
  font-size: 13px;
  color: var(--ink-soft);
}
.harness-row-name {
  font-family: "JetBrains Mono", monospace;
}
.harness-row-meta {
  color: var(--mute);
  font-size: 11px;
}

.projects-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 12px;
}
.projects-table th,
.projects-table td {
  text-align: left;
  padding: 10px 8px;
  border-bottom: 1px solid var(--rule-soft);
  font-size: 13px;
}
.projects-table th {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mute);
}
.projects-table td.proj-name {
  font-family: "JetBrains Mono", monospace;
  color: var(--ink);
}
.projects-table td.proj-members {
  color: var(--mute);
}

.spotlight-stack {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin-top: 16px;
}
.spotlight-card {
  border: 1px solid var(--rule);
  background: var(--paper);
  padding: 20px 24px;
  border-radius: 2px;
  position: relative;
}
.spotlight-card.flavor-cross-team-pattern { border-left: 3px solid var(--accent); }
.spotlight-card.flavor-case-study         { border-left: 3px solid var(--positive); }
.spotlight-card.flavor-strength-surfacing { border-left: 3px solid var(--warning); }

.spotlight-card-meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mute);
  margin-bottom: 8px;
}
.spotlight-flavor-badge {
  font-weight: 600;
}
.spotlight-flavor-badge.flavor-cross-team-pattern { color: var(--accent); }
.spotlight-flavor-badge.flavor-case-study         { color: var(--positive); }
.spotlight-flavor-badge.flavor-strength-surfacing { color: var(--warning); }

.spotlight-title {
  font-family: "Instrument Serif", serif;
  font-size: 22px;
  line-height: 1.2;
  color: var(--ink);
  margin-bottom: 10px;
}
.spotlight-body p {
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink-soft);
  margin-bottom: 10px;
}
.spotlight-body p:last-child { margin-bottom: 0; }
.spotlight-evidence {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dotted var(--rule);
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  color: var(--mute);
}

.roster-mini-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 12px;
}
.roster-mini-table td {
  padding: 10px 8px;
  border-bottom: 1px solid var(--rule-soft);
  font-size: 13px;
}
.roster-mini-table td.roster-mini-name {
  font-family: "Instrument Serif", serif;
  font-size: 17px;
  color: var(--ink);
}
.roster-mini-table td.roster-mini-stats {
  color: var(--mute);
  font-size: 12px;
}
.roster-mini-table td.roster-mini-link a {
  color: var(--accent);
  text-decoration: none;
  font-size: 12px;
}
.roster-mini-table td.roster-mini-link a:hover { text-decoration: underline; }

.insights-spotlight-empty {
  padding: 24px;
  border: 1px dashed var(--rule);
  background: var(--paper);
  border-radius: 2px;
  margin-top: 16px;
  font-size: 13px;
  color: var(--mute);
  line-height: 1.6;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/team-server/src/app/globals.css
git commit -m "feat(team-server): css for team insight report sections"
```

---

### Task 3: TeamPulse component

**Files:**
- Create: `packages/team-server/src/components/team-pulse.tsx`

- [ ] **Step 1: Create the component**

```tsx
// packages/team-server/src/components/team-pulse.tsx

import type { TeamPulse, DayOutcome, DayHelpfulness } from "../app/team/[slug]/insights/types";

const OUTCOME_COLORS: Record<DayOutcome, string> = {
  shipped: "var(--positive)",
  partial: "var(--warning)",
  blocked: "var(--danger)",
  exploratory: "var(--mute)",
  trivial: "var(--rule)",
};

const HELPFULNESS_COLORS: Record<DayHelpfulness, string> = {
  essential: "var(--accent)",
  helpful: "var(--positive)",
  neutral: "var(--mute)",
  unhelpful: "var(--danger)",
};

const OUTCOME_ORDER: DayOutcome[] = ["shipped", "partial", "blocked", "exploratory", "trivial"];
const HELPFULNESS_ORDER: DayHelpfulness[] = ["essential", "helpful", "neutral", "unhelpful"];

function StackedBar({
  data,
  colors,
  order,
}: {
  data: Record<string, number>;
  colors: Record<string, string>;
  order: string[];
}) {
  const total = order.reduce((s, k) => s + (data[k] ?? 0), 0);
  if (total === 0) return null;
  return (
    <>
      <div className="stacked-bar">
        {order.map((k) => {
          const v = data[k] ?? 0;
          if (v === 0) return null;
          const pct = (v / total) * 100;
          return (
            <div
              key={k}
              className="stacked-bar-seg"
              style={{ width: `${pct}%`, background: colors[k] }}
              title={`${k}: ${v}`}
            />
          );
        })}
      </div>
      <div className="stacked-bar-legend">
        {order.map((k) => {
          const v = data[k] ?? 0;
          if (v === 0) return null;
          return (
            <span key={k}>
              <span className="stacked-bar-legend-swatch" style={{ background: colors[k] }} />
              {k} · {v}
            </span>
          );
        })}
      </div>
    </>
  );
}

function deltaLabel(pct: number, suffix = "%"): { text: string; cls: string } {
  if (pct === 0) return { text: `±0${suffix} vs last week`, cls: "" };
  if (pct > 0) return { text: `+${pct}${suffix} vs last week`, cls: "positive" };
  return { text: `${pct}${suffix} vs last week`, cls: "negative" };
}

function shippedDeltaLabel(count: number): { text: string; cls: string } {
  if (count === 0) return { text: "±0 vs last week", cls: "" };
  if (count > 0) return { text: `+${count} vs last week`, cls: "positive" };
  return { text: `${count} vs last week`, cls: "negative" };
}

export function TeamPulseSection({ pulse }: { pulse: TeamPulse }) {
  const hoursDelta = deltaLabel(pulse.agent_hours_wow_delta_pct);
  const shippedDelta = shippedDeltaLabel(pulse.shipped_wow_delta);

  return (
    <section className="insights-section">
      <div className="subsection-head">
        <h2>Team <em>pulse</em></h2>
        <div className="kicker">This week · agent fleet at a glance</div>
      </div>

      <div className="pulse-grid">
        <div className="pulse-tile">
          <div className="pulse-tile-label">Combined agent time</div>
          <div className="pulse-tile-value">
            {pulse.agent_hours.toFixed(1)}<span className="pulse-tile-suffix">h</span>
          </div>
          <div className={`pulse-tile-delta ${hoursDelta.cls}`}>{hoursDelta.text}</div>
        </div>

        <div className="pulse-tile">
          <div className="pulse-tile-label">Shipped</div>
          <div className="pulse-tile-value">
            {pulse.shipped_count}<span className="pulse-tile-suffix">PRs</span>
          </div>
          <div className={`pulse-tile-delta ${shippedDelta.cls}`}>{shippedDelta.text}</div>
        </div>

        <div className="pulse-tile">
          <div className="pulse-tile-label">Members active</div>
          <div className="pulse-tile-value">
            {pulse.members_active}<span className="pulse-tile-suffix"> of {pulse.members_total}</span>
          </div>
          <div className="pulse-tile-delta">
            Concurrency peak {pulse.concurrency_peak.peak}× on {pulse.concurrency_peak.date}
          </div>
        </div>

        <div className="pulse-tile" style={{ gridColumn: "span 3" }}>
          <div className="pulse-tile-label">Outcome mix (across all session-days)</div>
          <StackedBar data={pulse.outcome_mix} colors={OUTCOME_COLORS} order={OUTCOME_ORDER} />
        </div>

        <div className="pulse-tile" style={{ gridColumn: "span 3" }}>
          <div className="pulse-tile-label">Helpfulness mix (member-day mode)</div>
          <StackedBar data={pulse.helpfulness_mix} colors={HELPFULNESS_COLORS} order={HELPFULNESS_ORDER} />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm -F @claude-lens/team-server typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/team-server/src/components/team-pulse.tsx
git commit -m "feat(team-server): team pulse section component"
```

---

### Task 4: WorkingShapeDistribution component

**Files:**
- Create: `packages/team-server/src/components/working-shape-distribution.tsx`

- [ ] **Step 1: Create the component**

```tsx
// packages/team-server/src/components/working-shape-distribution.tsx

import type { HowTheyWorked } from "../app/team/[slug]/insights/types";

const GOAL_COLORS = [
  "var(--accent)",
  "var(--positive)",
  "var(--warning)",
  "var(--mute)",
  "var(--rule)",
  "var(--ink-soft)",
];

export function WorkingShapeDistributionSection({ data }: { data: HowTheyWorked }) {
  const maxOccurrences = Math.max(...data.shapes.map((s) => s.occurrences), 1);

  return (
    <section className="insights-section">
      <div className="subsection-head">
        <h2>How the team <em>worked</em></h2>
        <div className="kicker">Working shapes · goal mix · adoption signals</div>
      </div>

      <div>
        {data.shapes.map((s) => {
          const widthPct = (s.occurrences / maxOccurrences) * 100;
          const dist = Object.entries(s.outcome_distribution)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ");
          return (
            <div key={s.shape} className="shape-row">
              <div className="shape-row-label">{s.shape}</div>
              <div className="shape-row-bar-track">
                <div className="shape-row-bar-fill" style={{ width: `${widthPct}%` }} />
              </div>
              <div className="shape-row-meta">
                ×{s.occurrences} · {s.members_using} member{s.members_using === 1 ? "" : "s"}
                {dist ? ` · ${dist}` : ""}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 28 }}>
        <div className="harness-block-title">Goal-category minute mix</div>
        <div className="goal-mix-strip">
          {data.goal_categories.map((g, i) => (
            <div
              key={g.category}
              className="goal-mix-seg"
              style={{ width: `${g.share_pct}%`, background: GOAL_COLORS[i % GOAL_COLORS.length] }}
              title={`${g.category}: ${g.minutes} min (${g.share_pct}%)`}
            />
          ))}
        </div>
        <div className="goal-mix-legend">
          {data.goal_categories.map((g, i) => (
            <span key={g.category}>
              <span
                className="stacked-bar-legend-swatch"
                style={{ background: GOAL_COLORS[i % GOAL_COLORS.length] }}
              />
              {g.category} · {g.share_pct}%
            </span>
          ))}
        </div>
      </div>

      <div className="adoption-meta">
        <div>
          <strong>{data.plan_mode_adopters}</strong> member{data.plan_mode_adopters === 1 ? "" : "s"} used Plan Mode
        </div>
        <div>
          <strong>{data.brainstorm_warmup_adopters}</strong> opened a session with a brainstorming skill
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm -F @claude-lens/team-server typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/team-server/src/components/working-shape-distribution.tsx
git commit -m "feat(team-server): working-shape distribution section"
```

---

### Task 5: HarnessDiffusion component

**Files:**
- Create: `packages/team-server/src/components/harness-diffusion.tsx`

- [ ] **Step 1: Create the component**

```tsx
// packages/team-server/src/components/harness-diffusion.tsx

import type { Harness } from "../app/team/[slug]/insights/types";

export function HarnessDiffusionSection({ data }: { data: Harness }) {
  return (
    <section className="insights-section">
      <div className="subsection-head">
        <h2>Tools, skills, and <em>harness</em></h2>
        <div className="kicker">What the team built around the agent fleet this week</div>
      </div>

      <div className="harness-grid">
        <div>
          <div className="harness-block-title">Top tool families</div>
          {data.tool_families.map((t) => (
            <div key={t.family} className="harness-row">
              <span className="harness-row-name">{t.family}</span>
              <span className="harness-row-meta">×{t.uses}</span>
            </div>
          ))}
        </div>

        <div>
          <div className="harness-block-title">User-authored skills</div>
          {data.user_skills.map((s) => (
            <div key={s.name} className="harness-row">
              <span className="harness-row-name">{s.name}</span>
              <span className="harness-row-meta">
                {s.members_using} member{s.members_using === 1 ? "" : "s"} · ×{s.total_uses}
              </span>
            </div>
          ))}
        </div>

        <div>
          <div className="harness-block-title">User-authored subagents</div>
          {data.user_subagents.map((s) => (
            <div key={s.name} className="harness-row">
              <span className="harness-row-name">{s.name}</span>
              <span className="harness-row-meta">
                {s.members_using} member{s.members_using === 1 ? "" : "s"} · ×{s.total_uses}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm -F @claude-lens/team-server typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/team-server/src/components/harness-diffusion.tsx
git commit -m "feat(team-server): harness diffusion section"
```

---

### Task 6: ProjectsTable component

**Files:**
- Create: `packages/team-server/src/components/projects-table.tsx`

- [ ] **Step 1: Create the component**

```tsx
// packages/team-server/src/components/projects-table.tsx

import type { ProjectRow } from "../app/team/[slug]/insights/types";

export function ProjectsTableSection({ projects }: { projects: ProjectRow[] }) {
  return (
    <section className="insights-section">
      <div className="subsection-head">
        <h2>Projects this <em>week</em></h2>
        <div className="kicker">Where the team's agent time landed</div>
      </div>

      <table className="projects-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Agent hours</th>
            <th>Members</th>
            <th>Shipped</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.name}>
              <td className="proj-name">{p.display_name}</td>
              <td>{p.agent_hours.toFixed(1)}h</td>
              <td className="proj-members">{p.members.join(" · ")}</td>
              <td>{p.shipped_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm -F @claude-lens/team-server typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/team-server/src/components/projects-table.tsx
git commit -m "feat(team-server): projects table section"
```

---

### Task 7: SpotlightCard component

**Files:**
- Create: `packages/team-server/src/components/spotlight-card.tsx`

- [ ] **Step 1: Create the component**

```tsx
// packages/team-server/src/components/spotlight-card.tsx

import type { Spotlight, SpotlightFlavor } from "../app/team/[slug]/insights/types";

const FLAVOR_LABEL: Record<SpotlightFlavor, string> = {
  "cross-team-pattern": "Cross-team pattern",
  "case-study": "Case study",
  "strength-surfacing": "Strength surfacing",
};

export function SpotlightCard({ spotlight }: { spotlight: Spotlight }) {
  const paragraphs = spotlight.body.split("\n\n");
  return (
    <article className={`spotlight-card flavor-${spotlight.flavor}`}>
      <div className="spotlight-card-meta">
        <span className={`spotlight-flavor-badge flavor-${spotlight.flavor}`}>
          {FLAVOR_LABEL[spotlight.flavor]}
        </span>
        <span>From {spotlight.author}</span>
      </div>
      <h3 className="spotlight-title">{spotlight.title}</h3>
      <div className="spotlight-body">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <div className="spotlight-evidence">{spotlight.evidence}</div>
    </article>
  );
}

export function SpotlightsSection({ spotlights }: { spotlights: Spotlight[] }) {
  return (
    <section className="insights-section">
      <div className="subsection-head">
        <h2>Spot<em>lights</em></h2>
        <div className="kicker">Member-submitted, opt-in · this week's signal</div>
      </div>

      {spotlights.length === 0 ? (
        <div className="insights-spotlight-empty">
          No spotlights this week. Members can publish sections from their personal Fleetlens at <code>/team-share</code> to add cross-team patterns, individual case studies, or strength surfacings to this report.
        </div>
      ) : (
        <div className="spotlight-stack">
          {spotlights.map((s) => (
            <SpotlightCard key={s.id} spotlight={s} />
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm -F @claude-lens/team-server typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/team-server/src/components/spotlight-card.tsx
git commit -m "feat(team-server): spotlight card + spotlights section"
```

---

### Task 8: RosterSnapshot component

**Files:**
- Create: `packages/team-server/src/components/roster-snapshot.tsx`

- [ ] **Step 1: Create the component**

```tsx
// packages/team-server/src/components/roster-snapshot.tsx

import type { RosterRow } from "../app/team/[slug]/insights/types";

export function RosterSnapshotSection({
  roster,
  teamSlug,
}: {
  roster: RosterRow[];
  teamSlug: string;
}) {
  return (
    <section className="insights-section">
      <div className="subsection-head">
        <h2>Roster <em>snapshot</em></h2>
        <div className="kicker">For 1:1 prep, drill into a member's detail page</div>
      </div>

      <table className="roster-mini-table">
        <tbody>
          {roster.map((r) => (
            <tr key={r.membership_id}>
              <td className="roster-mini-name">{r.display_name}</td>
              <td className="roster-mini-stats">
                {r.agent_hours.toFixed(1)}h · {r.shipped_count} PR{r.shipped_count === 1 ? "" : "s"} shipped
              </td>
              <td className="roster-mini-link">
                <a href={`/team/${teamSlug}/members/${r.membership_id}`}>open member detail →</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm -F @claude-lens/team-server typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/team-server/src/components/roster-snapshot.tsx
git commit -m "feat(team-server): roster snapshot section"
```

---

### Task 9: Page route composing all sections

**Files:**
- Create: `packages/team-server/src/app/team/[slug]/insights/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
// packages/team-server/src/app/team/[slug]/insights/page.tsx

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../../db/pool";
import { validateSession } from "../../../../lib/auth";
import { TeamPulseSection } from "../../../../components/team-pulse";
import { WorkingShapeDistributionSection } from "../../../../components/working-shape-distribution";
import { HarnessDiffusionSection } from "../../../../components/harness-diffusion";
import { ProjectsTableSection } from "../../../../components/projects-table";
import { SpotlightsSection } from "../../../../components/spotlight-card";
import { RosterSnapshotSection } from "../../../../components/roster-snapshot";
import { mockTeamInsightReport } from "./mock-data";

export const dynamic = "force-dynamic";

export default async function TeamInsightsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const pool = getPool();

  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const teamRes = await pool.query("SELECT id FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) return <div>Team not found.</div>;
  const teamId = teamRes.rows[0].id;
  const myMembership = session.memberships.find((m) => m.team_id === teamId);
  if (!myMembership) redirect("/login");

  // Phase 1: hardcoded mock report. Phase 2 swaps this for a real fetch.
  const report = mockTeamInsightReport;

  const weekDate = new Date(`${report.week_monday}T12:00:00`);
  const weekEnd = new Date(weekDate);
  weekEnd.setDate(weekDate.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric" });

  return (
    <>
      <div className="section-head">
        <div>
          <h1>The <em>Insight Report</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            Week of {fmt(weekDate).toUpperCase()} — {fmt(weekEnd).toUpperCase()}
            {" · "}
            {report.pulse.members_active} of {report.pulse.members_total} members active
            {" · "}
            {report.pulse.agent_hours.toFixed(1)}h combined agent time
          </div>
        </div>
        <div className="kicker">Phase 1 · static prototype</div>
      </div>

      <TeamPulseSection pulse={report.pulse} />
      <WorkingShapeDistributionSection data={report.how_they_worked} />
      <HarnessDiffusionSection data={report.harness} />
      <ProjectsTableSection projects={report.projects} />
      <SpotlightsSection spotlights={report.spotlights} />
      <RosterSnapshotSection roster={report.roster} teamSlug={slug} />

      <footer className="page-footer">
        <span>Fleetlens · Team Edition · static prototype</span>
        <span>Generated {report.generated_at}</span>
      </footer>
    </>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm -F @claude-lens/team-server typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/team-server/src/app/team/\[slug\]/insights/page.tsx
git commit -m "feat(team-server): team insight report page route"
```

---

### Task 10: Sidebar nav link

**Files:**
- Modify: `packages/team-server/src/app/team/[slug]/layout.tsx`

- [ ] **Step 1: Add "Insights" link to the sidebar**

In `packages/team-server/src/app/team/[slug]/layout.tsx`, find the existing nav block:

```tsx
          {isAdmin ? (
            <a href={`/team/${slug}`}>Roster <span className="mono">01</span></a>
          ) : (
            <a href={`/team/${slug}/members/${myMembership.id}`}>My profile <span className="mono">01</span></a>
          )}
          {isAdmin && <a href={`/team/${slug}/plan`}>Plan <span className="mono">02</span></a>}
          {isAdmin && <a href={`/team/${slug}/settings`}>Settings <span className="mono">03</span></a>}
```

Replace it with:

```tsx
          {isAdmin ? (
            <a href={`/team/${slug}`}>Roster <span className="mono">01</span></a>
          ) : (
            <a href={`/team/${slug}/members/${myMembership.id}`}>My profile <span className="mono">01</span></a>
          )}
          <a href={`/team/${slug}/insights`}>Insights <span className="mono">02</span></a>
          {isAdmin && <a href={`/team/${slug}/plan`}>Plan <span className="mono">03</span></a>}
          {isAdmin && <a href={`/team/${slug}/settings`}>Settings <span className="mono">04</span></a>}
```

(The numbered badges renumber so the sequence stays contiguous.)

- [ ] **Step 2: Run typecheck**

```bash
pnpm -F @claude-lens/team-server typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/team-server/src/app/team/\[slug\]/layout.tsx
git commit -m "feat(team-server): sidebar link to team insight report"
```

---

### Task 11: Browser verification

**Files:** none (verification only)

- [ ] **Step 1: Run all tests + typecheck**

```bash
pnpm -F @claude-lens/team-server test && pnpm -F @claude-lens/team-server typecheck
```

Expected: all tests pass (including the mock-data shape test), no type errors.

- [ ] **Step 2: Start the team-server dev environment**

The team-server depends on a running Postgres. Use the existing local dev path documented in `packages/team-server/` (typically a docker-compose for Postgres + a `pnpm dev` against it). If the standard local dev path is already running, skip to Step 3.

If starting fresh, follow whatever path is in `packages/team-server/CHANGELOG.md` / README; the canonical command will vary.

- [ ] **Step 3: Sign in as a team member**

In the running team-server, sign in or sign up as a team member, joining a team with slug (e.g., `acme-eng`). The mock data uses `team_slug: "acme-eng"` but the page reads the slug from the URL parameter — any team you're a member of works.

- [ ] **Step 4: Navigate to `/team/<your-team-slug>/insights`**

The page should render with:
- The section-head ("The Insight Report") at the top
- Team Pulse with three numeric tiles plus two stacked bars
- How the team worked, with horizontal bars for shapes + a goal-mix strip
- Tools, skills, and harness in a 3-column grid
- Projects table with 4 rows
- Spotlights — 3 cards in 3 different border colors (accent / positive / warning)
- Roster snapshot with 4 rows
- Footer with generation timestamp

- [ ] **Step 5: Visually verify the three spotlight flavors**

Each spotlight card has a distinctive left border color and badge:
- `cross-team-pattern` (accent / red) — "Three textures of the spec-review loop"
- `case-study` (positive / green) — "A migration that didn't need a rework cycle"
- `strength-surfacing` (warning / amber) — "Parallel dispatch that actually shipped"

The body prose in each is multi-paragraph and reads as if a team-side LLM had synthesized it. If any spotlight reads as placeholder text, the storytelling requirement from spec §8.3 is not met and the mock data should be revised.

- [ ] **Step 6: Confirm sidebar link works**

Click "Insights" in the left nav from another page (e.g., the Roster page) and confirm it navigates back to `/team/<slug>/insights`.

- [ ] **Step 7: Screenshot the running page and share for review**

The user expects to review the static prototype in a browser. Capture the full page (or a tall screenshot covering all six sections + footer) and share the URL of the running dev server.

---

## Self-review against the spec

Cross-checking each spec requirement against the plan:

- **Spec §2 (nomenclature)** — names "team insight report", "spotlight", flavor names all used in code → Tasks 1 (types), 7 (badge labels).
- **Spec §3.1 (keylogger test)** — N/A to Phase 1 (no real data flow).
- **Spec §3.2-3.4 (Tier 1 / Tier 2 / private projects)** — N/A to Phase 1; Phase 2 spec.
- **Spec §3.5 (no team-side LLM commitment)** — honored: mock data is presented as if synthesis happened, with no actual synthesis in the page → Task 1 (mock data), Task 7 (renders verbatim).
- **Spec §4 (Tier mapping)** — N/A to Phase 1.
- **Spec §5 (personal opt-in page)** — explicitly Phase 2; not in this plan.
- **Spec §6.1 (route + access)** — Task 9 implements `/team/[slug]/insights` with the same auth as the roster page.
- **Spec §6.2.1 (Team Pulse)** — Task 3 covers agent-hours + WoW, shipping + WoW, members-active, outcome mix bar, helpfulness mix bar, concurrency peak.
- **Spec §6.2.2 (How the team worked)** — Task 4 covers working-shape distribution, goal-category minute mix, plan-mode adopters, brainstorm-warmup adopters.
- **Spec §6.2.3 (Tools, skills, harness)** — Task 5 covers top tool families, user-authored skills (name/members/uses), user-authored subagents (same).
- **Spec §6.2.4 (Projects)** — Task 6.
- **Spec §6.2.5 (Spotlights, 3 flavors, empty state)** — Task 7 covers all three flavors plus the empty-state explainer pointing to `/team-share`.
- **Spec §6.2.6 (Roster snapshot)** — Task 8 with deep-link to existing member-detail page.
- **Spec §6.2.7 (Footer with disabled prev/next)** — Task 9 footer with timestamp; prev/next is omitted in Phase 1 per §8.2 "no prev/next week navigation."
- **Spec §7 (data flow)** — N/A to Phase 1.
- **Spec §8.1 (Phase 1 components + files)** — every file in §8.1 has a task (Tasks 1-9).
- **Spec §8.2 (what does not ship)** — honored: no DB, no ingest, no personal changes, no prev/next, no real-time refresh, no empty-state-page variant.
- **Spec §8.3 (storytelling requirement)** — Task 1 mock data meets every concrete bullet (plausible pulse numbers, real `WorkingShape` taxonomy, three plausibly-named skills with mixed adoption, three plausibly-named projects with mixed authorship, three spotlight flavors with multi-paragraph prose, roster matching members_active).
- **Spec §9 (open questions)** — tracked in spec; nothing for Phase 1 to do.
- **Spec §10 (cross-references)** — Task 1 type aliases reference the existing `WorkingShape` / `DayOutcome` taxonomies.

**Placeholder scan:** no TBDs, no "add error handling", no "similar to Task N", no references to undefined types. Code blocks complete in every step.

**Type consistency:** `TeamInsightReport` type defined in Task 1 is the single source consumed by every component; component prop types reference back to it. Spotlight `flavor` strings (`cross-team-pattern` / `case-study` / `strength-surfacing`) are consistent across types, mock data, component branches, and CSS class names.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-14-team-insight-report-phase-1.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks, fastest iteration on a UI prototype where each task is self-contained.

2. **Inline Execution** — execute tasks in this session using executing-plans, batch with checkpoints for review.

Which approach?
