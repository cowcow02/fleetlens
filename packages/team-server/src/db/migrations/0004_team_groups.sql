-- description: Team groups & manager flag; group-scoped invites

CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "groups_team_slug_key" ON "groups" USING btree ("team_id","slug");--> statement-breakpoint

CREATE TABLE "group_members" (
	"group_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"is_manager" boolean DEFAULT false NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" uuid,
	CONSTRAINT "group_members_pkey" PRIMARY KEY ("group_id","membership_id")
);
--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_added_by_user_accounts_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_group_members_membership" ON "group_members" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "idx_group_members_managers" ON "group_members" USING btree ("group_id") WHERE "is_manager" = true;--> statement-breakpoint

ALTER TABLE "invites" ADD COLUMN "group_ids" uuid[] DEFAULT '{}' NOT NULL;
