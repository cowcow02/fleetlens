-- description: AI Fluency scorecards + per-team weekly aggregates

CREATE TABLE "fluency_member_scorecards" (
	"team_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"week_monday" date NOT NULL,
	"scorecard" jsonb NOT NULL,
	"score_numerator" real DEFAULT 0 NOT NULL,
	"score_denominator" integer DEFAULT 11 NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fluency_member_scorecards_pkey" PRIMARY KEY ("team_id","membership_id","week_monday")
);
--> statement-breakpoint
ALTER TABLE "fluency_member_scorecards" ADD CONSTRAINT "fluency_member_scorecards_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fluency_member_scorecards" ADD CONSTRAINT "fluency_member_scorecards_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_fluency_member_scorecards_team_week" ON "fluency_member_scorecards" USING btree ("team_id","week_monday" DESC);--> statement-breakpoint

CREATE TABLE "fluency_team_aggregate" (
	"team_id" uuid NOT NULL,
	"week_monday" date NOT NULL,
	"report" jsonb NOT NULL,
	"members_active" integer DEFAULT 0 NOT NULL,
	"team_score" real DEFAULT 0 NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fluency_team_aggregate_pkey" PRIMARY KEY ("team_id","week_monday")
);
--> statement-breakpoint
ALTER TABLE "fluency_team_aggregate" ADD CONSTRAINT "fluency_team_aggregate_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_fluency_team_aggregate_team_week" ON "fluency_team_aggregate" USING btree ("team_id","week_monday" DESC);
