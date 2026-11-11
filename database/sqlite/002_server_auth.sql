-- Tabel autentikasi untuk server DEV berbasis SQLite (padanan database/postgres/002_server_auth.sql).
-- Tidak ikut backup. JANGAN dipakai untuk produksi multi-pengguna.
CREATE TABLE app_users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL, password_hash TEXT NOT NULL, display_name TEXT NOT NULL,
  totp_secret_enc TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, totp_last_step INTEGER,
  failed_logins INTEGER NOT NULL DEFAULT 0, locked_until INTEGER, disabled_at INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX ux_app_users_email ON app_users (lower(email));
CREATE TABLE business_access (
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE, business_id TEXT NOT NULL, member_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','staff')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (user_id, business_id)
);
CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE, family_id TEXT NOT NULL,
  token_hash TEXT NOT NULL, business_id TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, revoked_at INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX ux_refresh_tokens_hash ON refresh_tokens (token_hash);
CREATE INDEX ix_refresh_tokens_family ON refresh_tokens (family_id);
CREATE INDEX ix_refresh_tokens_user ON refresh_tokens (user_id);
