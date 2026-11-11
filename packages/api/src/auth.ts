import { checkBackupPassword, uuidv7 } from '@ficoim/shared';
import { createBusiness, createMember, updateRow, type BusinessType, type Ctx, type Db, type Role } from '@ficoim/core';
import { openSecret, randomToken, scryptHasher, sealSecret, sha256hex, signToken, verifyToken, type PasswordHasher } from './security';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';

export class AuthError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = 'AuthError'; }
}
const invalidCreds = () => new AuthError(401, 'INVALID_CREDENTIALS', 'Email atau kata sandi salah.');

export interface UserRec {
  id: string; email: string; passwordHash: string; displayName: string;
  totpSecretEnc: string | null; totpEnabled: boolean; totpLastStep: number | null;
  failedLogins: number; lockedUntil: number | null; disabledAt: number | null;
}
export interface AccessRec { userId: string; businessId: string; memberId: string; role: Role }
export interface RefreshRec { id: string; userId: string; familyId: string; businessId: string; tokenHash: string; expiresAt: number; usedAt: number | null; revokedAt: number | null }

export interface AuthStore {
  /** Melempar AuthError(409, 'EMAIL_TAKEN') bila email sudah ada. */
  createUser(u: UserRec): Promise<void>;
  deleteUser(id: string): Promise<void>;
  findUserByEmail(emailLower: string): Promise<UserRec | null>;
  findUserById(id: string): Promise<UserRec | null>;
  updateUser(id: string, patch: Partial<Omit<UserRec, 'id'>>): Promise<void>;
  /** Upsert per (userId, businessId). */
  addAccess(a: AccessRec): Promise<void>;
  listAccess(userId: string): Promise<AccessRec[]>;
  insertRefresh(r: RefreshRec): Promise<void>;
  findRefreshByHash(hash: string): Promise<RefreshRec | null>;
  /** ATOMIK: true hanya untuk satu pemanggil (yang menandai pertama kali). */
  markRefreshUsed(id: string, nowMs: number): Promise<boolean>;
  revokeFamily(familyId: string, nowMs: number): Promise<void>;
  revokeAllForUser(userId: string, nowMs: number): Promise<void>;
}

/** Menjalankan fn dalam konteks satu bisnis (PostgreSQL: transaksi + app.business_id untuk RLS; SQLite: langsung). */
export interface Tenancy { run<T>(businessId: string, fn: (db: Db) => Promise<T>): Promise<T> }

export interface Tokens { accessToken: string; refreshToken: string; expiresIn: number; businessId: string; role: Role; user: { id: string; email: string; displayName: string; totpEnabled: boolean } }
export interface Principal { userId: string; businessId: string; memberId: string }

export interface AuthDeps {
  store: AuthStore; tenancy: Tenancy; tokenSecret: Buffer; totpKey: Buffer;
  hasher?: PasswordHasher; now?: () => number; accessTtlSec?: number; refreshTtlSec?: number; maxFailed?: number; lockSec?: number; issuer?: string;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]+$/;

export function assertAccountPassword(pw: unknown): asserts pw is string {
  if (typeof pw !== 'string' || pw.length > 200) throw new AuthError(400, 'WEAK_PASSWORD', 'Kata sandi tidak valid.');
  const c = checkBackupPassword(pw);
  if (pw.length < 8 || c.score < 2) throw new AuthError(400, 'WEAK_PASSWORD', `Kata sandi terlalu lemah. ${c.issues.join(' ')}`.trim());
}

export class AuthService {
  private readonly hasher: PasswordHasher;
  private readonly now: () => number;
  private readonly accessTtl: number; private readonly refreshTtl: number;
  private readonly maxFailed: number; private readonly lockMs: number;
  private dummy: Promise<string> | null = null;

  constructor(private readonly d: AuthDeps) {
    if (d.tokenSecret.length < 32) throw new Error('tokenSecret minimal 32 byte');
    if (d.totpKey.length !== 32) throw new Error('totpKey harus 32 byte');
    this.hasher = d.hasher ?? scryptHasher();
    this.now = d.now ?? Date.now;
    this.accessTtl = d.accessTtlSec ?? 900;
    this.refreshTtl = d.refreshTtlSec ?? 30 * 86400;
    this.maxFailed = d.maxFailed ?? 5;
    this.lockMs = (d.lockSec ?? 900) * 1000;
  }

  private normEmail(e: unknown): string | null {
    if (typeof e !== 'string') return null;
    const s = e.trim().toLowerCase();
    return s.length <= 254 && EMAIL_RE.test(s) ? s : null;
  }

  /** Menyamakan waktu respons untuk email yang tidak ada (anti-enumerasi lewat timing). */
  private async dummyVerify(pw: unknown): Promise<void> {
    this.dummy ??= this.hasher.hash(randomToken(12));
    await this.hasher.verify(typeof pw === 'string' ? pw : '', await this.dummy);
  }

  private async issue(user: UserRec, access: AccessRec, familyId?: string): Promise<Tokens> {
    const nowMs = this.now();
    const raw = randomToken(32);
    await this.d.store.insertRefresh({
      id: uuidv7(nowMs), userId: user.id, familyId: familyId ?? uuidv7(nowMs), businessId: access.businessId,
      tokenHash: sha256hex(raw), expiresAt: nowMs + this.refreshTtl * 1000, usedAt: null, revokedAt: null,
    });
    const accessToken = signToken({ sub: user.id, bid: access.businessId, mid: access.memberId }, this.d.tokenSecret, Math.floor(nowMs / 1000), this.accessTtl);
    return {
      accessToken, refreshToken: raw, expiresIn: this.accessTtl, businessId: access.businessId, role: access.role,
      user: { id: user.id, email: user.email, displayName: user.displayName, totpEnabled: user.totpEnabled },
    };
  }

  async register(i: { email: unknown; password: unknown; displayName: unknown; businessName: unknown; businessType: unknown; openingCash?: unknown }): Promise<Tokens> {
    const email = this.normEmail(i.email);
    if (!email) throw new AuthError(400, 'INVALID_EMAIL', 'Format email tidak valid.');
    assertAccountPassword(i.password);
    if (typeof i.displayName !== 'string' || !i.displayName.trim()) throw new AuthError(400, 'VALIDATION', 'Nama wajib diisi.');
    const nowMs = this.now();
    const user: UserRec = {
      id: uuidv7(nowMs), email, passwordHash: await this.hasher.hash(i.password), displayName: i.displayName.trim().slice(0, 120),
      totpSecretEnc: null, totpEnabled: false, totpLastStep: null, failedLogins: 0, lockedUntil: null, disabledAt: null,
    };
    await this.d.store.createUser(user); // gagal bila email sudah dipakai
    const businessId = uuidv7(nowMs);
    try {
      const created = await this.d.tenancy.run(businessId, async (db) => {
        const c = await createBusiness(db, {
          name: i.businessName as string, businessType: i.businessType as BusinessType, ownerName: user.displayName,
          openingCash: i.openingCash === undefined ? 0 : (i.openingCash as number),
        }, { businessId, now: () => new Date(this.now()) });
        await updateRow(db, 'members', businessId, c.ownerMemberId, { user_id: user.id });
        return c;
      });
      const access: AccessRec = { userId: user.id, businessId, memberId: created.ownerMemberId, role: 'owner' };
      await this.d.store.addAccess(access);
      return this.issue(user, access);
    } catch (e) {
      await this.d.store.deleteUser(user.id).catch(() => undefined); // jangan tinggalkan akun tanpa bisnis
      throw e;
    }
  }

  private async registerFailure(u: UserRec): Promise<void> {
    const failed = u.failedLogins + 1;
    if (failed >= this.maxFailed) await this.d.store.updateUser(u.id, { failedLogins: 0, lockedUntil: this.now() + this.lockMs });
    else await this.d.store.updateUser(u.id, { failedLogins: failed });
  }

  async login(i: { email: unknown; password: unknown; totp?: unknown; businessId?: unknown }): Promise<Tokens> {
    const email = this.normEmail(i.email);
    const user = email ? await this.d.store.findUserByEmail(email) : null;
    const nowMs = this.now();
    // Akun terkunci/nonaktif/tidak ada dijawab sama persis dengan password salah (tidak membocorkan keberadaan akun).
    if (!user || user.disabledAt || (user.lockedUntil !== null && user.lockedUntil > nowMs)) { await this.dummyVerify(i.password); throw invalidCreds(); }
    if (typeof i.password !== 'string' || !(await this.hasher.verify(i.password, user.passwordHash))) { await this.registerFailure(user); throw invalidCreds(); }

    if (user.totpEnabled) {
      if (i.totp === undefined || i.totp === null || i.totp === '') throw new AuthError(401, 'TOTP_REQUIRED', 'Masukkan kode verifikasi 2 langkah.');
      const secret = user.totpSecretEnc ? openSecret(user.totpSecretEnc, this.d.totpKey) : null;
      const step = secret && typeof i.totp === 'string' ? verifyTotp(secret, i.totp.trim(), Math.floor(nowMs / 1000)) : null;
      if (step === null || (user.totpLastStep !== null && step <= user.totpLastStep)) { await this.registerFailure(user); throw invalidCreds(); }
      await this.d.store.updateUser(user.id, { totpLastStep: step });
    }
    await this.d.store.updateUser(user.id, { failedLogins: 0, lockedUntil: null });

    const accesses = await this.d.store.listAccess(user.id);
    const access = (typeof i.businessId === 'string' ? accesses.find((a) => a.businessId === i.businessId) : accesses[0]);
    if (!access) throw new AuthError(403, 'NO_BUSINESS', 'Akun ini belum terhubung ke bisnis mana pun.');
    return this.issue(user, access);
  }

  async refresh(raw: unknown): Promise<Tokens> {
    if (typeof raw !== 'string' || raw.length < 20 || raw.length > 200) throw new AuthError(401, 'INVALID_REFRESH', 'Sesi tidak valid. Silakan masuk lagi.');
    const rec = await this.d.store.findRefreshByHash(sha256hex(raw));
    const nowMs = this.now();
    if (!rec || rec.revokedAt !== null || rec.expiresAt <= nowMs) throw new AuthError(401, 'INVALID_REFRESH', 'Sesi berakhir. Silakan masuk lagi.');
    // Token yang sudah dipakai lalu muncul lagi = kemungkinan dicuri -> seluruh keluarga token dicabut.
    if (rec.usedAt !== null || !(await this.d.store.markRefreshUsed(rec.id, nowMs))) {
      await this.d.store.revokeFamily(rec.familyId, nowMs);
      throw new AuthError(401, 'REFRESH_REUSED', 'Sesi tidak valid. Silakan masuk lagi.');
    }
    const user = await this.d.store.findUserById(rec.userId);
    if (!user || user.disabledAt) throw new AuthError(401, 'INVALID_REFRESH', 'Akun tidak aktif.');
    const access = (await this.d.store.listAccess(user.id)).find((a) => a.businessId === rec.businessId);
    if (!access) throw new AuthError(401, 'INVALID_REFRESH', 'Akses ke bisnis telah dicabut.');
    return this.issue(user, access, rec.familyId);
  }

  /**
   * Dipanggil setelah restore yang mengganti anggota pengguna: menautkan akses akun ke anggota baru (pemilik hasil restore)
   * dan menerbitkan sesi baru. Token akses lama otomatis tidak berlaku (claim mid tidak lagi cocok).
   */
  async relinkAndIssue(userId: string, businessId: string, memberId: string): Promise<Tokens> {
    const user = await this.d.store.findUserById(userId);
    if (!user || user.disabledAt) throw new AuthError(401, 'UNAUTHENTICATED', 'Sesi tidak valid.');
    const access: AccessRec = { userId, businessId, memberId, role: 'owner' };
    await this.d.store.addAccess(access);
    return this.issue(user, access);
  }

  async logout(raw: unknown): Promise<void> {
    if (typeof raw !== 'string') return;
    const rec = await this.d.store.findRefreshByHash(sha256hex(raw));
    if (rec) await this.d.store.revokeFamily(rec.familyId, this.now());
  }

  /** Memeriksa token akses + keberadaan akun & akses bisnis (peran sebenarnya selalu dibaca dari tabel members saat memuat Ctx). */
  async verifyAccess(token: string): Promise<Principal> {
    const p = verifyToken(token, this.d.tokenSecret, Math.floor(this.now() / 1000));
    if (!p || typeof p.sub !== 'string' || typeof p.bid !== 'string' || typeof p.mid !== 'string') throw new AuthError(401, 'UNAUTHENTICATED', 'Sesi tidak valid atau kedaluwarsa.');
    const user = await this.d.store.findUserById(p.sub);
    if (!user || user.disabledAt) throw new AuthError(401, 'UNAUTHENTICATED', 'Sesi tidak valid atau kedaluwarsa.');
    if (!(await this.d.store.listAccess(user.id)).some((a) => a.businessId === p.bid && a.memberId === p.mid))
      throw new AuthError(401, 'UNAUTHENTICATED', 'Akses ke bisnis telah dicabut.');
    return { userId: user.id, businessId: p.bid, memberId: p.mid };
  }

  async me(userId: string): Promise<{ id: string; email: string; displayName: string; totpEnabled: boolean; businesses: { businessId: string; role: Role }[] }> {
    const u = await this.d.store.findUserById(userId);
    if (!u) throw new AuthError(401, 'UNAUTHENTICATED', 'Sesi tidak valid.');
    return { id: u.id, email: u.email, displayName: u.displayName, totpEnabled: u.totpEnabled, businesses: (await this.d.store.listAccess(userId)).map((a) => ({ businessId: a.businessId, role: a.role })) };
  }

  async changePassword(userId: string, oldPw: unknown, newPw: unknown): Promise<void> {
    const u = await this.d.store.findUserById(userId);
    if (!u || typeof oldPw !== 'string' || !(await this.hasher.verify(oldPw, u.passwordHash))) throw new AuthError(403, 'INVALID_CREDENTIALS', 'Kata sandi lama salah.');
    assertAccountPassword(newPw);
    await this.d.store.updateUser(userId, { passwordHash: await this.hasher.hash(newPw) });
    await this.d.store.revokeAllForUser(userId, this.now()); // semua perangkat harus masuk ulang
  }

  // ------------------------------------------------ 2FA (TOTP)
  async totpStart(userId: string): Promise<{ base32: string; otpauthUri: string }> {
    const u = await this.d.store.findUserById(userId);
    if (!u) throw new AuthError(401, 'UNAUTHENTICATED', 'Sesi tidak valid.');
    if (u.totpEnabled) throw new AuthError(409, 'TOTP_ALREADY', '2FA sudah aktif.');
    const { secret, base32 } = generateTotpSecret();
    await this.d.store.updateUser(userId, { totpSecretEnc: sealSecret(secret, this.d.totpKey), totpEnabled: false, totpLastStep: null });
    return { base32, otpauthUri: otpauthUri(this.d.issuer ?? 'FICOIM', u.email, base32) };
  }

  async totpConfirm(userId: string, code: unknown): Promise<void> {
    const u = await this.d.store.findUserById(userId);
    const secret = u?.totpSecretEnc ? openSecret(u.totpSecretEnc, this.d.totpKey) : null;
    const step = secret && typeof code === 'string' ? verifyTotp(secret, code.trim(), Math.floor(this.now() / 1000)) : null;
    if (!u || step === null) throw new AuthError(400, 'INVALID_CODE', 'Kode salah. Pastikan jam perangkat Anda akurat.');
    await this.d.store.updateUser(userId, { totpEnabled: true, totpLastStep: step });
  }

  async totpDisable(userId: string, password: unknown, code: unknown): Promise<void> {
    const u = await this.d.store.findUserById(userId);
    if (!u || !u.totpEnabled || typeof password !== 'string' || !(await this.hasher.verify(password, u.passwordHash))) throw new AuthError(403, 'INVALID_CREDENTIALS', 'Kata sandi salah.');
    const secret = u.totpSecretEnc ? openSecret(u.totpSecretEnc, this.d.totpKey) : null;
    const step = secret && typeof code === 'string' ? verifyTotp(secret, code.trim(), Math.floor(this.now() / 1000)) : null;
    if (step === null || (u.totpLastStep !== null && step <= u.totpLastStep)) throw new AuthError(400, 'INVALID_CODE', 'Kode salah.');
    await this.d.store.updateUser(userId, { totpEnabled: false, totpSecretEnc: null, totpLastStep: null });
    await this.d.store.revokeAllForUser(userId, this.now());
  }

  // ------------------------------------------------ tim
  /** Pemilik menambah kasir/manajer: membuat anggota + akun login (atau menautkan akun yang sudah ada dengan email sama). */
  async provisionStaff(ctx: Ctx, i: { email: unknown; password: unknown; displayName: string; role: string; canViewReports?: boolean; canDelete?: boolean }): Promise<{ memberId: string; userId: string; createdUser: boolean }> {
    const email = this.normEmail(i.email);
    if (!email) throw new AuthError(400, 'INVALID_EMAIL', 'Format email tidak valid.');
    const memberId = await createMember(ctx, { displayName: i.displayName, role: i.role, canViewReports: i.canViewReports, canDelete: i.canDelete });
    let user = await this.d.store.findUserByEmail(email);
    let created = false;
    if (!user) {
      assertAccountPassword(i.password);
      user = {
        id: uuidv7(this.now()), email, passwordHash: await this.hasher.hash(i.password), displayName: i.displayName.trim().slice(0, 120),
        totpSecretEnc: null, totpEnabled: false, totpLastStep: null, failedLogins: 0, lockedUntil: null, disabledAt: null,
      };
      await this.d.store.createUser(user);
      created = true;
    }
    await updateRow(ctx.db, 'members', ctx.businessId, memberId, { user_id: user.id });
    await this.d.store.addAccess({ userId: user.id, businessId: ctx.businessId, memberId, role: i.role as Role });
    return { memberId, userId: user.id, createdUser: created };
  }
}
