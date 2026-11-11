import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCtx, type Db } from '@ficoim/core';
import { AuthError, AuthService, memoryAuthStore, scryptHasher, totp, base32Decode } from '../src/index';
import { newDb } from '../../core/test/helpers';

const FAST = scryptHasher({ logN: 12, r: 8, p: 1 });
const PW = 'Toko-Maju-2026!';

function setup(extra: { lockSec?: number; maxFailed?: number } = {}) {
  const db: Db = newDb();
  const store = memoryAuthStore();
  const clock = { t: Date.parse('2026-10-27T03:00:00.000Z') };
  const auth = new AuthService({ store, hasher: FAST, tenancy: { run: (_b, fn) => fn(db) }, tokenSecret: Buffer.alloc(32, 3), totpKey: Buffer.alloc(32, 4), now: () => clock.t, ...extra });
  return { db, store, clock, auth };
}
const reg = (auth: AuthService, o: Record<string, unknown> = {}) => auth.register({ email: 'Budi@Toko.id', password: PW, displayName: 'Budi', businessName: 'Toko Maju', businessType: 'elektronik', ...o });
const code = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e instanceof AuthError ? e.code : `X:${e}`; } return 'OK'; };

test('register membuat akun + bisnis + pemilik yang tertaut; email tidak peka huruf besar-kecil', async () => {
  const { auth, db } = setup();
  const t = await reg(auth);
  assert.equal(t.role, 'owner');
  assert.equal(t.user.email, 'budi@toko.id');
  const p = await auth.verifyAccess(t.accessToken);
  const ctx = await loadCtx(db, p.businessId, p.memberId);
  assert.equal(ctx.actor.role, 'owner');
  assert.equal(Number((await db.all('SELECT COUNT(*) c FROM members WHERE user_id = ?', [p.userId]))[0]!.c), 1);
  assert.equal(await code(reg(auth, { email: 'BUDI@toko.id' })), 'EMAIL_TAKEN');
  assert.equal(await code(reg(auth, { email: 'bukan-email' })), 'INVALID_EMAIL');
  assert.equal(await code(reg(auth, { email: 'x@y.id', password: '12345678' })), 'WEAK_PASSWORD');
  assert.equal(await code(reg(auth, { email: 'x@y.id', password: 'pendek1' })), 'WEAK_PASSWORD');
  assert.equal(await code(reg(auth, { email: 'x@y.id', displayName: '  ' })), 'VALIDATION');
});

test('register gagal di tengah (jenis usaha salah) tidak meninggalkan akun yatim', async () => {
  const { auth, store } = setup();
  await assert.rejects(reg(auth, { email: 'a@b.id', businessType: 'kripto' }));
  assert.equal(store.users.size, 0);
  assert.ok(await reg(auth, { email: 'a@b.id' })); // email yang sama bisa dipakai lagi
});

test('login: salah sandi & email tak dikenal -> pesan identik; kunci akun setelah 5 gagal (walau sandi benar), terbuka sendiri', async () => {
  const { auth, clock } = setup({ lockSec: 600 });
  await reg(auth);
  const e1 = await auth.login({ email: 'budi@toko.id', password: 'salah' }).catch((e: AuthError) => e);
  const e2 = await auth.login({ email: 'tidak@ada.id', password: 'salah' }).catch((e: AuthError) => e);
  assert.deepEqual([(e1 as AuthError).code, (e1 as AuthError).message, (e1 as AuthError).status], [(e2 as AuthError).code, (e2 as AuthError).message, (e2 as AuthError).status]);
  for (let i = 0; i < 3; i++) await code(auth.login({ email: 'budi@toko.id', password: 'salah' })); // total 4 gagal
  assert.equal(await code(auth.login({ email: 'budi@toko.id', password: PW })), 'OK');               // sukses mereset hitungan
  for (let i = 0; i < 5; i++) await code(auth.login({ email: 'budi@toko.id', password: 'salah' }));
  assert.equal(await code(auth.login({ email: 'budi@toko.id', password: PW })), 'INVALID_CREDENTIALS'); // terkunci
  clock.t += 601_000;
  assert.equal(await code(auth.login({ email: 'budi@toko.id', password: PW })), 'OK');
  assert.equal(await code(auth.login({ email: 'budi@toko.id', password: 12345 as never })), 'INVALID_CREDENTIALS');
  assert.equal(await code(auth.login({ email: { $ne: 1 } as never, password: PW })), 'INVALID_CREDENTIALS');
});

test('refresh berotasi; token lama dipakai ulang = pencurian -> SELURUH keluarga token dicabut', async () => {
  const { auth, clock } = setup();
  const t1 = await reg(auth);
  clock.t += 60_000;
  const t2 = await auth.refresh(t1.refreshToken);
  assert.notEqual(t2.refreshToken, t1.refreshToken);
  assert.ok(await auth.verifyAccess(t2.accessToken));
  assert.equal(await code(auth.refresh(t1.refreshToken)), 'REFRESH_REUSED');   // penyerang memakai token lama
  assert.equal(await code(auth.refresh(t2.refreshToken)), 'INVALID_REFRESH');  // token sah milik korban ikut dicabut
  assert.equal(await code(auth.refresh('x'.repeat(43))), 'INVALID_REFRESH');
  assert.equal(await code(auth.refresh(undefined)), 'INVALID_REFRESH');
  const t3 = await auth.login({ email: 'budi@toko.id', password: PW });         // masuk baru tetap bisa
  assert.equal(await code(auth.refresh(t3.refreshToken)), 'OK');
});

test('refresh kedaluwarsa & logout mencabut; token akses kedaluwarsa ditolak', async () => {
  const { auth, clock } = setup({});
  const t = await reg(auth);
  clock.t += 16 * 60_000;
  await assert.rejects(auth.verifyAccess(t.accessToken), (e: AuthError) => e.code === 'UNAUTHENTICATED');
  const t2 = await auth.refresh(t.refreshToken); // refresh (30 hari) masih hidup
  await auth.logout(t2.refreshToken);
  assert.equal(await code(auth.refresh(t2.refreshToken)), 'INVALID_REFRESH');
  const t3 = await auth.login({ email: 'budi@toko.id', password: PW });
  clock.t += 31 * 86_400_000;
  assert.equal(await code(auth.refresh(t3.refreshToken)), 'INVALID_REFRESH');
});

test('ganti sandi mencabut semua sesi; sandi lama wajib benar; akun dinonaktifkan langsung ditolak', async () => {
  const { auth, store } = setup();
  const t = await reg(auth);
  const p = await auth.verifyAccess(t.accessToken);
  assert.equal(await code(auth.changePassword(p.userId, 'salah', 'Sandi-Baru-2026!')), 'INVALID_CREDENTIALS');
  assert.equal(await code(auth.changePassword(p.userId, PW, '12345678')), 'WEAK_PASSWORD');
  await auth.changePassword(p.userId, PW, 'Sandi-Baru-2026!');
  assert.equal(await code(auth.refresh(t.refreshToken)), 'INVALID_REFRESH');
  assert.equal(await code(auth.login({ email: 'budi@toko.id', password: PW })), 'INVALID_CREDENTIALS');
  const t2 = await auth.login({ email: 'budi@toko.id', password: 'Sandi-Baru-2026!' });
  store.users.get(p.userId)!.disabledAt = Date.now();
  await assert.rejects(auth.verifyAccess(t2.accessToken), (e: AuthError) => e.code === 'UNAUTHENTICATED');
  assert.equal(await code(auth.login({ email: 'budi@toko.id', password: 'Sandi-Baru-2026!' })), 'INVALID_CREDENTIALS');
});

test('2FA TOTP: aktivasi, wajib saat login, kode salah/ulang ditolak, rahasia tersimpan terenkripsi, nonaktifkan', async () => {
  const { auth, clock, store } = setup();
  const t = await reg(auth);
  const p = await auth.verifyAccess(t.accessToken);
  const { base32, otpauthUri } = await auth.totpStart(p.userId);
  assert.match(otpauthUri, /^otpauth:\/\/totp\//);
  const stored = store.users.get(p.userId)!.totpSecretEnc!;
  assert.ok(!stored.includes(base32) && !Buffer.from(stored, 'base64url').includes(base32Decode(base32))); // bukan plaintext
  const secret = base32Decode(base32);
  const now = () => Math.floor(clock.t / 1000);

  assert.equal(await code(auth.totpConfirm(p.userId, '000000')), 'INVALID_CODE');
  await auth.totpConfirm(p.userId, totp(secret, now()));
  assert.equal(await code(auth.totpStart(p.userId)), 'TOTP_ALREADY');

  assert.equal(await code(auth.login({ email: 'budi@toko.id', password: PW })), 'TOTP_REQUIRED');
  assert.equal(await code(auth.login({ email: 'budi@toko.id', password: PW, totp: '123456' })), 'INVALID_CREDENTIALS');
  assert.equal(await code(auth.login({ email: 'budi@toko.id', password: PW, totp: totp(secret, now()) })), 'INVALID_CREDENTIALS'); // langkah yang sama dengan konfirmasi = pemakaian ulang
  clock.t += 30_000;
  const next = totp(secret, now());
  assert.equal(await code(auth.login({ email: 'budi@toko.id', password: PW, totp: next })), 'OK');
  assert.equal(await code(auth.login({ email: 'budi@toko.id', password: PW, totp: next })), 'INVALID_CREDENTIALS'); // kode yang sama tidak bisa dipakai dua kali
  clock.t += 30_000;
  assert.equal(await code(auth.totpDisable(p.userId, 'salah', totp(secret, now()))), 'INVALID_CREDENTIALS');
  await auth.totpDisable(p.userId, PW, totp(secret, now()));
  assert.equal(await code(auth.login({ email: 'budi@toko.id', password: PW })), 'OK');
});

test('tim: pemilik menambah kasir -> kasir bisa masuk dengan peran staf; kasir tidak boleh menambah orang; data bisnis terpisah', async () => {
  const { auth, db } = setup();
  const owner = await reg(auth);
  const op = await auth.verifyAccess(owner.accessToken);
  const octx = await loadCtx(db, op.businessId, op.memberId);
  const r = await auth.provisionStaff(octx, { email: 'sari@toko.id', password: 'Kasir-Sari-2026', displayName: 'Sari', role: 'staff' });
  assert.equal(r.createdUser, true);
  const st = await auth.login({ email: 'sari@toko.id', password: 'Kasir-Sari-2026' });
  assert.equal(st.role, 'staff'); assert.equal(st.businessId, op.businessId);
  const sp = await auth.verifyAccess(st.accessToken);
  const sctx = await loadCtx(db, sp.businessId, sp.memberId);
  assert.equal(sctx.actor.role, 'staff');
  await assert.rejects(auth.provisionStaff(sctx, { email: 'x@y.id', password: 'Xx-12345678', displayName: 'X', role: 'staff' }), /tidak diizinkan/);
  await assert.rejects(auth.provisionStaff(octx, { email: 'o@y.id', password: 'Xx-12345678', displayName: 'X', role: 'owner' }), /pemilik/i);
  // pemilik menonaktifkan anggota -> token yang masih hidup tidak lagi memuat Ctx
  await db.run('UPDATE members SET is_active = 0 WHERE id = ?', [sp.memberId]);
  await assert.rejects(loadCtx(db, sp.businessId, sp.memberId), /tidak aktif/);
});
