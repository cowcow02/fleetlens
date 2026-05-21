-- description: Multi-use invite share links (token plaintext, revoked_at, label) + per-team signup domain allowlist; revoke all pre-upgrade invites
ALTER TABLE "teams" ADD COLUMN "allowed_signup_domains" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "token" text;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_invites_active_by_config" ON "invites" USING btree ("team_id","role") WHERE "invites"."revoked_at" IS NULL AND "invites"."email" IS NULL;--> statement-breakpoint
UPDATE "invites" SET "revoked_at" = now() WHERE "revoked_at" IS NULL;
