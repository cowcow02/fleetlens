-- description: add cli_version to memberships so the team dashboard can show each member's installed Fleetlens CLI version

ALTER TABLE "memberships" ADD COLUMN "cli_version" text;
