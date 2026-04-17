CREATE TABLE IF NOT EXISTS teams (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                   text UNIQUE NOT NULL,
  name                   text NOT NULL,
  retention_days         int  NOT NULL DEFAULT 365,
  resend_api_key_enc     text,
  custom_domain          text,
  settings               jsonb NOT NULL DEFAULT '{}',
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id           uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  email             text,
  display_name      text,
  role              text NOT NULL CHECK (role IN ('admin','member')),
  bearer_token_hash text NOT NULL,
  joined_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz,
  revoked_at        timestamptz,
  UNIQUE (team_id, email)
);
CREATE INDEX IF NOT EXISTS idx_members_team_active ON members (team_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS invites (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id            uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES members,
  token_hash         text NOT NULL UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  used_at            timestamptz,
  expires_at         timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    uuid NOT NULL REFERENCES members ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  purpose      text NOT NULL DEFAULT 'session' CHECK (purpose IN ('session','recovery')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_used_at timestamptz
);
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'session';

CREATE TABLE IF NOT EXISTS daily_rollups (
  team_id          uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  member_id        uuid NOT NULL REFERENCES members ON DELETE CASCADE,
  day              date NOT NULL,
  agent_time_ms    bigint NOT NULL DEFAULT 0,
  sessions         int NOT NULL DEFAULT 0,
  tool_calls       int NOT NULL DEFAULT 0,
  turns            int NOT NULL DEFAULT 0,
  tokens_input     bigint NOT NULL DEFAULT 0,
  tokens_output    bigint NOT NULL DEFAULT 0,
  tokens_cache_read  bigint NOT NULL DEFAULT 0,
  tokens_cache_write bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, member_id, day)
);
CREATE INDEX IF NOT EXISTS idx_daily_rollups_team_day ON daily_rollups (team_id, day DESC);

CREATE TABLE IF NOT EXISTS events (
  id           bigserial PRIMARY KEY,
  team_id      uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  member_id    uuid REFERENCES members,
  action       text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_team_created ON events (team_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ingest_log (
  ingest_id    text PRIMARY KEY,
  team_id      uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  member_id    uuid NOT NULL REFERENCES members ON DELETE CASCADE,
  received_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ingest_log_received ON ingest_log (received_at);
