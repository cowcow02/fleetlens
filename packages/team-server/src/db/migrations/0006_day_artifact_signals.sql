-- description: artifact-authoring signals (per-member day) + team-wide skill catalog

CREATE TABLE "day_artifact_signals" (
	"team_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"day" date NOT NULL,
	"skills_authored" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skills_edited" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subagents_authored" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"slash_commands_authored" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"claudemd_line_delta" integer DEFAULT 0 NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "day_artifact_signals_pk" PRIMARY KEY ("team_id","membership_id","day")
);
--> statement-breakpoint
ALTER TABLE "day_artifact_signals" ADD CONSTRAINT "day_artifact_signals_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "day_artifact_signals" ADD CONSTRAINT "day_artifact_signals_membership_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_day_artifact_signals_team_day" ON "day_artifact_signals" USING btree ("team_id","day" DESC);
--> statement-breakpoint
CREATE TABLE "team_skill_catalog" (
	"team_id" uuid NOT NULL,
	"path_hash" text NOT NULL,
	"kind" text NOT NULL,
	"originator_membership_id" uuid,
	"originator_first_seen" date,
	"adopter_membership_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"loads_total" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_skill_catalog_pk" PRIMARY KEY ("team_id","path_hash"),
	CONSTRAINT "team_skill_catalog_kind_check" CHECK ("kind" IN ('skill', 'subagent', 'slash-command'))
);
--> statement-breakpoint
ALTER TABLE "team_skill_catalog" ADD CONSTRAINT "team_skill_catalog_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "team_skill_catalog" ADD CONSTRAINT "team_skill_catalog_originator_membership_id_fk" FOREIGN KEY ("originator_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_team_skill_catalog_team_kind" ON "team_skill_catalog" USING btree ("team_id","kind");
