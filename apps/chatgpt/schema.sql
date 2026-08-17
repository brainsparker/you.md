-- you.md ChatGPT app — profile store schema.
--
-- Markdown is the canonical artifact. `structured` is advisory metadata the
-- model may attach; nothing in the service reads it back.
--
-- Apply with: psql "$DATABASE_URL" -f apps/chatgpt/schema.sql

CREATE TABLE IF NOT EXISTS youmd_users (
  id               TEXT PRIMARY KEY,
  provider         TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id)
);

-- One profile per user in V0. The UNIQUE constraint is what makes
-- youmd_create_profile safe against two conversations racing.
CREATE TABLE IF NOT EXISTS youmd_profiles (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL UNIQUE REFERENCES youmd_users (id) ON DELETE CASCADE,
  current_version INTEGER NOT NULL DEFAULT 1,
  markdown        TEXT NOT NULL,
  structured      JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every version is kept, so an edit can always be reviewed or rolled back.
CREATE TABLE IF NOT EXISTS youmd_profile_versions (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES youmd_profiles (id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  markdown   TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'chatgpt',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, version)
);

CREATE INDEX IF NOT EXISTS youmd_profile_versions_profile_idx
  ON youmd_profile_versions (profile_id, version DESC);
