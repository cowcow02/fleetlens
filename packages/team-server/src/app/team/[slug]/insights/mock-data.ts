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
