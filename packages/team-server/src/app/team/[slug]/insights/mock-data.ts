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
    concurrency_peak: { date: "2026-05-07", peak: 4 },
  },

  how_they_worked: {
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
      id: "spotlight-charlie-mon-spec-review",
      flavor: "case-study",
      author: "Charlie",
      session_meta: {
        date: "2026-05-04",
        project: "topeka",
        duration_hours: 3.1,
        shipped: 1,
      },
      title: "A reviewer-triad before any code was written",
      body:
        "Charlie opened Monday on topeka by pinning a reviewer-triad on the spec before writing any code. Three reviewer subagents dispatched in parallel — one with a correctness lens, one with an ergonomics lens, one with a rollback lens — each reading the full spec and returning structured findings. Charlie merged the three reviews into a revised spec, then started implementation only after the spec converged.\n\nThe session ran 3.1 active hours and produced one shipped PR with zero follow-up review cycles needed. The upfront triad caught edge cases that would normally surface during the first review pass — a meaningful pattern for any spec where the cost of a revert is high.",
      harness_signature:
        "skills: superpowers:writing-plans, superpowers:brainstorming · subagents: spec-reviewer ×3 (parallel dispatch) · tools: Read ×84, Edit ×26, Write ×11",
    },
    {
      id: "spotlight-bob-wed-migration",
      flavor: "case-study",
      author: "Bob",
      session_meta: {
        date: "2026-05-06",
        project: "kipwise-v1",
        duration_hours: 7.0,
        shipped: 1,
      },
      title: "A migration that didn't need a rework cycle",
      body:
        "Bob spent Wednesday on a column-not-null migration on a 50M-row table. Two long autonomous turns (4.2h and 2.8h) carried the migration end-to-end without a rework cycle, which is unusual for a flag-touching change — typically these come back twice before shipping.\n\nThe load-bearing piece was Bob's kipwise-migration-guard skill, loaded at session start. It gates risky operations (DROP COLUMN, ALTER TABLE, anything touching audit_log) behind explicit confirmation prompts, and on Wednesday it caught two would-be early commits before they landed. The pattern: long autonomous runs become safe when there's a deterministic guardrail catching the irreversible moves, even when the LLM is otherwise in a build-fast mode. Worth studying as a template for any future migration touching live tables.",
      harness_signature:
        "skills: kipwise-migration-guard ×5 · long-autonomous turns: 4.2h, 2.8h · tools: Bash ×142, Edit ×38, Read ×96",
    },
    {
      id: "spotlight-alice-tue-parallel",
      flavor: "strength-surfacing",
      author: "Alice",
      session_meta: {
        date: "2026-05-05",
        project: "topeka",
        duration_hours: 0.78,
        shipped: 1,
      },
      title: "Four parallel workers, one orchestration brief",
      body:
        "Alice on Tuesday afternoon dispatched four worker subagents in parallel against topeka, all reading a single orchestration brief that Alice loaded first via harness-orchestrate. The workers had no cross-communication — each took its slice, ran in isolation, and returned its diff. The orchestration brief was the contract.\n\nResult: 47 minutes of wall-clock to a shipped PR. The same work split across four sequential sessions would have taken closer to three hours. Across the team this week, this is the only session in which parallel dispatch shipped on the first pass — the brief-as-contract pattern eliminated the coordination overhead that typically breaks parallel-agent runs. Worth a Friday demo, and worth copying anywhere on the team that's running parallel agents regularly.",
      harness_signature:
        "skills: harness-orchestrate ×1 (brief loaded once) · subagents: implement-teammate ×4 (parallel dispatch) · tools: Task ×4, Edit ×12, Bash ×31",
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
