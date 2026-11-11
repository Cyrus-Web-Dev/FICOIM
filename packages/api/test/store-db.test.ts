import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCtx, type Db } from '@ficoim/core';
import { sqliteNodeDb } from '@ficoim/core/adapters/sqlite-node';
import { AuthError, AuthService, dbAuthStore, memoryAuthStore, scryptHasher, totp, base32Decode, type AuthStore, type UserRec } from '../src/index';
import { newDb } from '../../core/test/helpers';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
function authDb(): Db {
  const h = new DatabaseSync(':memory:'); h.exec('PRAGMA foreign_keys = ON');
  h.exec(readFileSync(resolve(root, 'database/sqlite/002_server_auth.sql'), 'utf8'));
  return sqliteNodeDb(h);
}
const user = (o: Partial<UserRec> = {}): UserRec => ({ id: 'u1', email: 'a@b.id', passwordHash: 'h', displayName: 'A', totpSecretEnc: null, totpEnabled: false, totpLastStep: null, failedLogins: 0, lockedUntil: null, disabledAt: null, ...o });

const stores: [string, () => AuthStore][] = [['memori', () => memoryAuthStore()], ['SQL (SQLite)', () => dbAuthStore(authDb())]];

for (const [name, make] of stores) {
  test(`kontrak AuthStore [${name}]: akun, akses, refresh atomik, pencabutan`, async () => {
    const s = make();
    await s.createUser(user());
    await assert.rejects(s.createUser(user({ id: 'u2' })), (e: AuthError) => e.code === 'EMAIL_TAKEN');
    assert.equal((await s.findUserByEmail('a@b.id'))!.id, 'u1');
    assert.equal(await s.findUserByEmail('x@y.id'), null);
    await s.updateUser('u1', { totpEnabled: true, totpLastStep: 123, failedLogins: 3, lockedUntil: 999, totpSecretEnc: 'abc' });
    assert.deepEqual(await s.findUserById('u1'), user({ totpEnabled: true, totpLastStep: 123, failedLogins: 3, lockedUntil: 999, totpSecretEnc: 'abc' }));
    await s.updateUser('u1', { lockedUntil: null, totpEnabled: false });
    assert.deepEqual([(await s.findUserById('u1'))!.lockedUntil, (await s.findUserById('u1'))!.totpEnabled], [null, false]);

    await s.addAccess({ userId: 'u1', businessId: 'b1', memberId: 'm1', role: 'owner' });
    await s.addAccess({ userId: 'u1', businessId: 'b1', memberId: 'm2', role: 'owner' }); // upsert
    await s.addAccess({ userId: 'u1', businessId: 'b2', memberId: 'm3', role: 'staff' });
    assert.deepEqual((await s.listAccess('u1')).map((a) => [a.businessId, a.memberId, a.role]).sort(), [['b1', 'm2', 'owner'], ['b2', 'm3', 'staff']]);

    const r = { id: 'r1', userId: 'u1', familyId: 'f1', businessId: 'b1', tokenHash: 'hash1', expiresAt: 5000, usedAt: null, revokedAt: null };
    await s.insertRefresh(r); await s.insertRefresh({ ...r, id: 'r2', tokenHash: 'hash2' }); await s.insertRefresh({ ...r, id: 'r3', tokenHash: 'hash3', familyId: 'f2' });
    assert.deepEqual(await s.findRefreshByHash('hash1'), r);
    const race = await Promise.all([s.markRefreshUsed('r1', 10), s.markRefreshUsed('r1', 11), s.markRefreshUsed('r1', 12)]);
    assert.equal(race.filter(Boolean).length, 1); // ATOMIK: hanya satu yang menang
    assert.equal((await s.findRefreshByHash('hash1'))!.usedAt !== null, true);
    await s.revokeFamily('f1', 20);
    assert.equal((await s.findRefreshByHash('hash2'))!.revokedAt, 20);
    assert.equal((await s.findRefreshByHash('hash3'))!.revokedAt, null);
    assert.equal(await s.markRefreshUsed('r2', 30), false); // sudah dicabut
    await s.revokeAllForUser('u1', 40);
    assert.equal((await s.findRefreshByHash('hash3'))!.revokedAt, 40);
    await s.deleteUser('u1');
    assert.equal(await s.findUserById('u1'), null);
    assert.deepEqual(await s.listAccess('u1'), []);
  });
}

test('AuthService di atas penyimpanan SQL: daftar, login, rotasi & deteksi pencurian refresh, 2FA, kunci akun', async () => {
  const biz = newDb();
  const clock = { t: Date.parse('2026-10-27T03:00:00.000Z') };
  const auth = new AuthService({ store: dbAuthStore(authDb()), hasher: scryptHasher({ logN: 12, r: 8, p: 1 }), tenancy: { run: (_b, fn) => fn(biz) }, tokenSecret: Buffer.alloc(32, 3), totpKey: Buffer.alloc(32, 4), now: () => clock.t, lockSec: 600 });
  const PW = 'Toko-Maju-2026!';
  const t1 = await auth.register({ email: 'Budi@Toko.id', password: PW, displayName: 'Budi', businessName: 'Toko', businessType: 'fashion' });
  await assert.rejects(auth.register({ email: 'budi@toko.id', password: PW, displayName: 'B', businessName: 'T', businessType: 'fashion' }), (e: AuthError) => e.code === 'EMAIL_TAKEN');
  const p = await auth.verifyAccess(t1.accessToken);
  assert.equal((await loadCtx(biz, p.businessId, p.memberId)).actor.role, 'owner');

  const t2 = await auth.refresh(t1.refreshToken);
  await assert.rejects(auth.refresh(t1.refreshToken), (e: AuthError) => e.code === 'REFRESH_REUSED');
  await assert.rejects(auth.refresh(t2.refreshToken), (e: AuthError) => e.code === 'INVALID_REFRESH');

  const { base32 } = await auth.totpStart(p.userId);
  await auth.totpConfirm(p.userId, totp(base32Decode(base32), clock.t / 1000));
  await assert.rejects(auth.login({ email: 'budi@toko.id', password: PW }), (e: AuthError) => e.code === 'TOTP_REQUIRED');
  clock.t += 30_000;
  assert.ok(await auth.login({ email: 'budi@toko.id', password: PW, totp: totp(base32Decode(base32), clock.t / 1000) }));

  for (let i = 0; i < 5; i++) await auth.login({ email: 'budi@toko.id', password: 'salah' }).catch(() => undefined);
  clock.t += 30_000;
  await assert.rejects(auth.login({ email: 'budi@toko.id', password: PW, totp: totp(base32Decode(base32), clock.t / 1000) }), (e: AuthError) => e.code === 'INVALID_CREDENTIALS'); // terkunci
});
