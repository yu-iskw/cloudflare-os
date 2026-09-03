-- Kernel ledger. Capability records only — never persist RPC stubs.
-- Auth Proxy is not a pooler: keep the client max at 2–5 per Cloud Run replica.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash_hash BYTEA,
  session_token TEXT UNIQUE,
  preferred_model TEXT,
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  pinned BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS leases (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  holder TEXT NOT NULL,
  generation INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  UNIQUE (chat_id, sequence)
);

CREATE TABLE IF NOT EXISTS gadgets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  commit_id TEXT
);

-- Pointers only. Object bytes live in Cloud Storage (`git/{oid}`), never in this table.
CREATE TABLE IF NOT EXISTS git_objects (
  oid TEXT PRIMARY KEY,
  gcs_key TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS capability_records (
  id BIGSERIAL PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  vendor_id TEXT NOT NULL,
  account_label TEXT NOT NULL,
  resource_url TEXT,
  access_token TEXT
);

CREATE TABLE IF NOT EXISTS action_queue (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  capability_id BIGINT NOT NULL REFERENCES capability_records (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE TABLE IF NOT EXISTS admin_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  signups_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  site_name TEXT NOT NULL DEFAULT '',
  instance_instructions TEXT NOT NULL DEFAULT '',
  announcement TEXT NOT NULL DEFAULT '',
  banner TEXT NOT NULL DEFAULT '',
  banner_color TEXT NOT NULL DEFAULT 'blue',
  accent_color TEXT NOT NULL DEFAULT ''
);

INSERT INTO admin_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
