import { AuthError, type AccessRec, type AuthStore, type RefreshRec, type UserRec } from './auth';

/** Penyimpanan akun di memori: untuk pengujian dan server dev. (Produksi: store-pg.ts) */
export function memoryAuthStore(): AuthStore & { users: Map<string, UserRec>; refresh: Map<string, RefreshRec> } {
  const users = new Map<string, UserRec>();
  const access: AccessRec[] = [];
  const refresh = new Map<string, RefreshRec>();
  return {
    users, refresh,
    async createUser(u) {
      for (const x of users.values()) if (x.email === u.email) throw new AuthError(409, 'EMAIL_TAKEN', 'Email sudah terdaftar.');
      users.set(u.id, { ...u });
    },
    async deleteUser(id) { users.delete(id); for (let i = access.length - 1; i >= 0; i--) if (access[i]!.userId === id) access.splice(i, 1); },
    async findUserByEmail(e) { for (const u of users.values()) if (u.email === e) return { ...u }; return null; },
    async findUserById(id) { const u = users.get(id); return u ? { ...u } : null; },
    async updateUser(id, patch) { const u = users.get(id); if (u) Object.assign(u, patch); },
    async addAccess(a) { const i = access.findIndex((x) => x.userId === a.userId && x.businessId === a.businessId); if (i >= 0) access[i] = { ...a }; else access.push({ ...a }); },
    async listAccess(userId) { return access.filter((a) => a.userId === userId).map((a) => ({ ...a })); },
    async insertRefresh(r) { refresh.set(r.id, { ...r }); },
    async findRefreshByHash(h) { for (const r of refresh.values()) if (r.tokenHash === h) return { ...r }; return null; },
    async markRefreshUsed(id, now) { const r = refresh.get(id); if (!r || r.usedAt !== null || r.revokedAt !== null) return false; r.usedAt = now; return true; },
    async revokeFamily(f, now) { for (const r of refresh.values()) if (r.familyId === f && r.revokedAt === null) r.revokedAt = now; },
    async revokeAllForUser(uid, now) { for (const r of refresh.values()) if (r.userId === uid && r.revokedAt === null) r.revokedAt = now; },
  };
}
