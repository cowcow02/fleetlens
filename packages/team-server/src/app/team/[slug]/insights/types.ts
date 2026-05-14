// Phase-1 local aliases. Phase 2 will revisit importing from @claude-lens/entries.
// Outcome / helpfulness / working-shape signals exist on the underlying digest
// but are intentionally NOT surfaced in the team report — they're too noisy as
// team metrics. We aggregate via skills/agents/tools/goal-mix instead.

export type SpotlightFlavor = "case-study" | "strength-surfacing";

export type TeamPulse = {
  agent_hours: number;
  agent_hours_wow_delta_pct: number;
  shipped_count: number;
  shipped_wow_delta: number;
  members_active: number;
  members_total: number;
  concurrency_peak: { date: string; peak: number };
};

export type GoalCategoryRow = {
  category: string;
  minutes: number;
  share_pct: number;
};

export type HowTheyWorked = {
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

export type SpotlightSessionMeta = {
  date: string; // YYYY-MM-DD
  project: string;
  duration_hours: number;
  shipped: number;
};

export type Spotlight = {
  id: string;
  flavor: SpotlightFlavor;
  author: string;
  // Each spotlight anchors to a specific opted-in session — that's the unit
  // the member chose to share, and it's what the team-side synthesizer reads
  // to compose the narrative.
  session_meta: SpotlightSessionMeta;
  title: string;
  body: string;
  // Concrete harness/agent signature for the session (top skills, subagents,
  // tools, etc.) — rendered as a mono-spaced footer under the prose.
  harness_signature: string;
};

export type RosterRow = {
  membership_id: string;
  display_name: string;
  agent_hours: number;
  shipped_count: number;
};

export type TeamInsightReport = {
  team_slug: string;
  week_monday: string;
  generated_at: string;
  pulse: TeamPulse;
  how_they_worked: HowTheyWorked;
  harness: Harness;
  projects: ProjectRow[];
  spotlights: Spotlight[];
  roster: RosterRow[];
};
