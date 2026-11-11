-- ============================================================================
-- 002_server_auth.sql — tabel KHUSUS SERVER (web/API). Ditulis tangan.
-- Tabel ini TIDAK pernah masuk file backup dan tidak ada di SQLite mobile.
-- STATUS: belum diuji pada PostgreSQL sungguhan (sandbox pengembangan tanpa Postgres).
-- ============================================================================

CREATE TABLE app_users (
  id              uuid PRIMARY KEY,
  email           text NOT NULL,
  password_hash   text NOT NULL,              -- Argon2id (string PHC); tidak pernah plaintext
  display_name    text NOT NULL,
  totp_secret_enc text,                       -- rahasia TOTP, dienkripsi di aplikasi (AES-GCM, kunci dari env)
  totp_enabled    boolean NOT NULL DEFAULT false,
  totp_last_step  bigint,                     -- langkah TOTP terakhir yang dipakai (cegah pemakaian ulang kode)
  failed_logins   integer NOT NULL DEFAULT 0,
  locked_until    bigint,                     -- epoch milidetik (tipe sama di SQLite dev & PostgreSQL)
  disabled_at     bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_app_users_email ON app_users (lower(email));

-- Pemetaan akun -> bisnis. Sengaja TANPA RLS: dibaca saat login untuk mengetahui bisnis mana yang boleh
-- diakses, SEBELUM app.business_id di-set. API wajib memverifikasi baris ini lebih dulu.
CREATE TABLE business_access (
  user_id     uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL,                  -- baris di members (tanpa FK: members ikut dihapus/dipulihkan oleh backup)
  role        text NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, business_id)
);
CREATE INDEX ix_business_access_business ON business_access (business_id);

-- Refresh token berotasi. Yang disimpan hanya hash SHA-256; token yang dipakai ulang
-- (used_at terisi) berarti pencurian -> seluruh family dicabut.
CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,
  token_hash  text NOT NULL,                  -- SHA-256 (hex) dari token; token asli tidak disimpan
  business_id uuid NOT NULL,
  expires_at  bigint NOT NULL,                -- epoch milidetik
  used_at     bigint,
  revoked_at  bigint,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_refresh_tokens_hash ON refresh_tokens (token_hash);
CREATE INDEX ix_refresh_tokens_family ON refresh_tokens (family_id);
CREATE INDEX ix_refresh_tokens_user ON refresh_tokens (user_id);

CREATE TABLE login_attempts (
  id           bigserial PRIMARY KEY,
  email_lower  text,
  ip           inet,
  succeeded    boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_login_attempts_email ON login_attempts (email_lower, attempted_at);
CREATE INDEX ix_login_attempts_ip ON login_attempts (ip, attempted_at);

-- audit_log bersifat append-only. DELETE hanya diizinkan saat restore/penghapusan bisnis:
--   SET LOCAL app.restore_mode = 'on';
CREATE FUNCTION audit_log_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_log bersifat append-only';
  END IF;
  IF coalesce(current_setting('app.restore_mode', true), '') <> 'on' THEN
    RAISE EXCEPTION 'audit_log tidak boleh dihapus';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_audit_log_guard BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_guard();
