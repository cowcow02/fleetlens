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
  author: string;
  title: string;
  body: string;
  evidence: string;
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
