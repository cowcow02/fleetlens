-- description: external-system integrations (encrypted credentials per team/provider) + synced GitHub PR facts

CREATE TABLE "team_integrations" (
	"team_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"credentials_enc" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_error" text,
	"last_sync_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_integrations_pk" PRIMARY KEY ("team_id","provider"),
	CONSTRAINT "team_integrations_provider_check" CHECK ("provider" IN ('github', 'jira', 'linear')),
	CONSTRAINT "team_integrations_status_check" CHECK ("status" IN ('active', 'error'))
);
--> statement-breakpoint
ALTER TABLE "team_integrations" ADD CONSTRAINT "team_integrations_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "team_integrations" ADD CONSTRAINT "team_integrations_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "github_pull_requests" (
	"team_id" uuid NOT NULL,
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"author_login" text,
	"state" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"merged_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"first_commit_at" timestamp with time zone,
	"first_review_at" timestamp with time zone,
	"additions" integer DEFAULT 0 NOT NULL,
	"deletions" integer DEFAULT 0 NOT NULL,
	"commits_total" integer DEFAULT 0 NOT NULL,
	"commits_ai" integer DEFAULT 0 NOT NULL,
	"ai_assisted" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_pull_requests_pk" PRIMARY KEY ("team_id","repo","number"),
	CONSTRAINT "github_pull_requests_state_check" CHECK ("state" IN ('open', 'merged', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "github_pull_requests" ADD CONSTRAINT "github_pull_requests_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_github_prs_team_merged" ON "github_pull_requests" USING btree ("team_id","merged_at" DESC);
