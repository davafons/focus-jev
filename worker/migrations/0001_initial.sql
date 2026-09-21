PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS installations (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  monthly_limit INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS monthly_usage (
  installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  decision_count INTEGER NOT NULL DEFAULT 0 CHECK (decision_count >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (installation_id, month)
);

CREATE TABLE IF NOT EXISTS global_usage (
  month TEXT PRIMARY KEY,
  decision_count INTEGER NOT NULL DEFAULT 0 CHECK (decision_count >= 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS request_nonces (
  installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  nonce_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (installation_id, nonce_hash)
);

CREATE INDEX IF NOT EXISTS request_nonces_expiry ON request_nonces(expires_at);
