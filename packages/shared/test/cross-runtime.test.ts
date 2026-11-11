/**
 * Menjamin runtime Node (server) dan runtime universal (@noble + fflate; dipakai web & HP)
 * saling bisa membuka backup satu sama lain. Otomatis dilewati bila dependency belum di-install.
 * WAJIB hijau setelah `npm install` — inilah yang membuktikan "backup HP bisa dipakai di web & sebaliknya".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeRuntime } from '../src/backup/runtime-node';
import { createBackup, openBackup } from '../src/backup/format';
import { buildSample } from '../src/testing/sample';

let universal: typeof import('../src/backup/runtime-universal')['universalRuntime'] | null = null;
try { universal = (await import('../src/backup/runtime-universal')).universalRuntime; } catch { /* dependency belum ada */ }

const PW = 'Toko-Maju-2026!';
const opts = { password: PW, source: { platform: 'web', appVersion: '0.1.0' } as const, kdf: { logN: 14, r: 8, p: 1 } };

test('primitif identik: scrypt, AES-GCM, sha256, gzip lintas runtime', { skip: universal ? false : '@noble/fflate belum ter-install (npm install)' }, async () => {
  const u = universal!, n = nodeRuntime;
  const pw = new TextEncoder().encode('kata-sandi'), salt = Uint8Array.from({ length: 16 }, (_, i) => i);
  const kN = await n.scrypt(pw, salt, { logN: 14, r: 8, p: 1 }), kU = await u.scrypt(pw, salt, { logN: 14, r: 8, p: 1 });
  assert.deepEqual(kU, kN);
  const nonce = Uint8Array.from({ length: 12 }, (_, i) => 100 + i), aad = Uint8Array.of(1, 2, 3), msg = new TextEncoder().encode('halo FICOIM 🔐');
  const cN = await n.aesGcmEncrypt(kN, nonce, aad, msg), cU = await u.aesGcmEncrypt(kN, nonce, aad, msg);
  assert.deepEqual(cU, cN);
  assert.deepEqual(await u.aesGcmDecrypt(kN, nonce, aad, cN), msg);
  assert.deepEqual(await n.aesGcmDecrypt(kN, nonce, aad, cU), msg);
  assert.deepEqual(await u.sha256(msg), await n.sha256(msg));
  assert.deepEqual(await n.gunzip(await u.gzip(msg), 1e6), msg);
  assert.deepEqual(await u.gunzip(await n.gzip(msg), 1e6), msg);
  await assert.rejects(u.aesGcmDecrypt(kN, nonce, Uint8Array.of(9), cN)); // AAD berbeda ditolak
});

test('backup dibuat oleh runtime universal (web/HP) bisa dibuka runtime Node, dan sebaliknya', { skip: universal ? false : '@noble/fflate belum ter-install (npm install)' }, async () => {
  const s = buildSample();
  const fromU = await createBackup({ ...opts, tables: s.tables, blobs: s.blobs }, universal!);
  const fromN = await createBackup({ ...opts, tables: s.tables, blobs: s.blobs }, nodeRuntime);
  for (const [file, rt] of [[fromU, nodeRuntime], [fromN, universal!], [fromU, universal!]] as const) {
    const r = await openBackup(file, PW, rt);
    assert.equal(r.tables.products!.length, 2);
    assert.deepEqual(r.blobs[0]!.data, s.blobs[0]!.data);
  }
});
