-- description: rich per-day rollup of Personal-edition Entry data for team insights

CREATE TABLE "rich_daily_rollups" (
	"team_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"day" date NOT NULL,
	"agent_time_ms" bigint DEFAULT 0 NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"prs" integer DEFAULT 0 NOT NULL,
	"commits" integer DEFAULT 0 NOT NULL,
	"pushes" integer DEFAULT 0 NOT NULL,
	"concurrency_peak" integer DEFAULT 0 NOT NULL,
	"parallel_minutes" integer DEFAULT 0 NOT NULL,
	"long_auto_count" integer DEFAULT 0 NOT NULL,
	"long_auto_total_min" integer DEFAULT 0 NOT NULL,
	"long_auto_max_single_min" integer DEFAULT 0 NOT NULL,
	"tool_errors" integer DEFAULT 0 NOT NULL,
	"brainstorm_warmup_sessions" integer DEFAULT 0 NOT NULL,
	"plan_mode_used" integer DEFAULT 0 NOT NULL,
	"projects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"working_shapes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skills_loaded" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subagents_dispatched" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcome_mix" jsonb,
	"helpfulness_mix" jsonb,
	"goal_mix" jsonb,
	"tokens_input" bigint DEFAULT 0 NOT NULL,
	"tokens_output" bigint DEFAULT 0 NOT NULL,
	"tokens_cache_read" bigint DEFAULT 0 NOT NULL,
	"tokens_cache_write" bigint DEFAULT 0 NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rich_daily_rollups_pkey" PRIMARY KEY ("team_id","membership_id","day")
);
--> statement-breakpoint
ALTER TABLE "rich_daily_rollups" ADD CONSTRAINT "rich_daily_rollups_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rich_daily_rollups" ADD CONSTRAINT "rich_daily_rollups_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_rich_daily_rollups_team_day" ON "rich_daily_rollups" USING btree ("team_id","day" DESC);
