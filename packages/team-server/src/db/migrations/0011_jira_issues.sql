-- description: issues synced from the Jira Cloud integration (started_at derived from the changelog's first In-Progress transition)

CREATE TABLE "jira_issues" (
	"team_id" uuid NOT NULL,
	"identifier" text NOT NULL,
	"title" text NOT NULL,
	"state_name" text NOT NULL,
	"state_type" text NOT NULL,
	"jira_project_key" text NOT NULL,
	"assignee" text,
	"estimate" integer,
	"url" text,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jira_issues_pk" PRIMARY KEY ("team_id","identifier")
);
--> statement-breakpoint
ALTER TABLE "jira_issues" ADD CONSTRAINT "jira_issues_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_jira_issues_team_completed" ON "jira_issues" USING btree ("team_id","completed_at" DESC);
