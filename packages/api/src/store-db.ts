import { asBool, dbBool, num, type Db } from '@ficoim/core';
import { AuthError, type AccessRec, type AuthStore, type RefreshRec, type UserRec } from './auth';

const toUser = (r: Record<string, unknown>): UserRec => ({
  id: String(r.id), email: String(r.email), passwordHash: String(r.password_hash), displayName: String(r.display_name),
  totpSecretEnc: (r.totp_secret_enc as string | null) ?? null, totpEnabled: asBool(r.totp_enabled), totpLastStep: r.totp_last_step == null ? null : num(r.totp_last_step),
  failedLogins: num(r.failed_logins), lockedUntil: r.locked_until == null ? null : num(r.locked_until), disabledAt: r.disabled_at == null ? null : num(r.disabled_at),
});
const toRefresh = (r: Record<string, unknown>): RefreshRec => ({
  id: String(r.id), userId: String(r.user_id), familyId: String(r.family_id), businessId: String(r.business_id), tokenHash: String(r.token_hash),
  expiresAt: num(r.expires_at), usedAt: r.used_at == null ? null : num(r.used_at), revokedAt: r.revoked_at == null ? null : num(r.revoked_at),
});

const USER_COLS: Record<string, string> = {
  passwordHash: 'password_hash', displayName: 'display_name', totpSecretEnc: 'totp_secret_enc', totpEnabled: 'totp_enabled', totpLastStep: 'totp_last_step',
  failedLogins: 'failed_logins', lockedUntil: 'locked_until', disabledAt: 'disabled_at', email: 'email',
};

/**
 * Penyimpanan akun di atas antarmuka Db yang sama dengan mesin bisnis: SQLite (server dev) maupun PostgreSQL (produksi,
 * lewat pgPoolDb). Tabel: database/{sqlite,postgres}/002_server_auth.sql. SQL-nya portabel (placeholder `?`).
 */
export function dbAuthStore(db: Db): AuthStore {
  const isDup = (e: unknown) => e instanceof Error && /UNIQUE constraint failed|duplicate key value/i.test(e.message);
  return {
    async createUser(u) {
      try {
        await db.run(
          `INSERT INTO "app_users" ("id", "email", "password_hash", "display_name", "totp_secret_enc", "totp_enabled", "totp_last_step", "failed_logins", "locked_until", "disabled_at")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [u.id, u.email, u.passwordHash, u.displayName, u.totpSecretEnc, dbBool(db, u.totpEnabled), u.totpLastStep, u.failedLogins, u.lockedUntil, u.disabledAt]);
      } catch (e) { if (isDup(e)) throw new AuthError(409, 'EMAIL_TAKEN', 'Email sudah terdaftar.'); throw e; }
    },
    async deleteUser(id) { await db.run(`DELETE FROM "app_users" WHERE "id" = ?`, [id]); },
    async findUserByEmail(e) { const r = (await db.all(`SELECT * FROM "app_users" WHERE LOWER("email") = ? LIMIT 1`, [e]))[0]; return r ? toUser(r) : null; },
    async findUserById(id) { const r = (await db.all(`SELECT * FROM "app_users" WHERE "id" = ? LIMIT 1`, [id]))[0]; return r ? toUser(r) : null; },
    async updateUser(id, patch) {
      const keys = Object.keys(patch).filter((k) => k in USER_COLS);
      if (!keys.length) return;
      const vals = keys.map((k) => { const v = (patch as Record<string, unknown>)[k]; return typeof v === 'boolean' ? dbBool(db, v) : v ?? null; });
      await db.run(`UPDATE "app_users" SET ${keys.map((k) => `"${USER_COLS[k]}" = ?`).join(', ')} WHERE "id" = ?`, [...vals, id]);
    },
    async addAccess(a: AccessRec) {
      await db.run(`DELETE FROM "business_access" WHERE "user_id" = ? AND "business_id" = ?`, [a.userId, a.businessId]);
      await db.run(`INSERT INTO "business_access" ("user_id", "business_id", "member_id", "role") VALUES (?, ?, ?, ?)`, [a.userId, a.businessId, a.memberId, a.role]);
    },
    async listAccess(userId) {
      return (await db.all(`SELECT "user_id", "business_id", "member_id", "role" FROM "business_access" WHERE "user_id" = ? ORDER BY "created_at", "business_id"`, [userId]))
        .map((r) => ({ userId: String(r.user_id), businessId: String(r.business_id), memberId: String(r.member_id), role: r.role as AccessRec['role'] }));
    },
    async insertRefresh(r) {
      await db.run(`INSERT INTO "refresh_tokens" ("id", "user_id", "family_id", "token_hash", "business_id", "expires_at", "used_at", "revoked_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.id, r.userId, r.familyId, r.tokenHash, r.businessId, r.expiresAt, r.usedAt, r.revokedAt]);
    },
    async findRefreshByHash(h) { const r = (await db.all(`SELECT * FROM "refresh_tokens" WHERE "token_hash" = ? LIMIT 1`, [h]))[0]; return r ? toRefresh(r) : null; },
    // UPDATE bersyarat = atomik di kedua database: hanya satu pemanggil yang melihat changes === 1.
    async markRefreshUsed(id, now) { return (await db.run(`UPDATE "refresh_tokens" SET "used_at" = ? WHERE "id" = ? AND "used_at" IS NULL AND "revoked_at" IS NULL`, [now, id])).changes === 1; },
    async revokeFamily(f, now) { await db.run(`UPDATE "refresh_tokens" SET "revoked_at" = ? WHERE "family_id" = ? AND "revoked_at" IS NULL`, [now, f]); },
    async revokeAllForUser(uid, now) { await db.run(`UPDATE "refresh_tokens" SET "revoked_at" = ? WHERE "user_id" = ? AND "revoked_at" IS NULL`, [now, uid]); },
  };
}
