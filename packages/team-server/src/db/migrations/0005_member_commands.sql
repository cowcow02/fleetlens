-- description: Server-issued commands to member daemons (backfill, etc.)

CREATE TABLE member_commands (
  id              text PRIMARY KEY,
  team_id         uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  membership_id   uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  command_type    text NOT NULL,
  params          jsonb NOT NULL DEFAULT '{}'::jsonb,
  issued_by_id    uuid NOT NULL REFERENCES user_accounts(id),
  issued_at       timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  completed_at    timestamptz,
  result          jsonb
);

CREATE INDEX idx_member_commands_pending
  ON member_commands (membership_id, completed_at)
  WHERE completed_at IS NULL;

CREATE INDEX idx_member_commands_team_recent
  ON member_commands (team_id, issued_at DESC);
