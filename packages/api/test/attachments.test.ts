import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeRuntime } from '@ficoim/shared/backup/runtime-node';
import { memoryBlobStore } from '@ficoim/core';
import { AuthService, RateLimiter, createApi, createHttpServer, fileBlobStore, memoryAuthStore, scryptHasher } from '../src/index';
import { newDb } from '../../core/test/helpers';

const PW = 'Toko-Maju-2026!', BPW = 'Backup-Rahasia-77!';
const servers: Server[] = [];
const tmp: string[] = [];
after(() => { for (const s of servers) s.close(); for (const d of tmp) rmSync(d, { recursive: true, force: true }); });

const jpeg = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i < 3 ? [0xff, 0xd8, 0xff][i]! : (i * 31 + seed) & 255));

async function boot(o: { blobStore?: 'memory' | 'file' | 'none' } = {}) {
  const db = newDb();
  const kind = o.blobStore ?? 'memory';
  let dir = '';
  if (kind === 'file') { dir = mkdtempSync(join(tmpdir(), 'ficoim-att-')); tmp.push(dir); }
  const auth = new AuthService({ store: memoryAuthStore(), hasher: scryptHasher({ logN: 12, r: 8, p: 1 }), tenancy: { run: (_b, fn) => fn(db) }, tokenSecret: Buffer.alloc(32, 9), totpKey: Buffer.alloc(32, 5) });
  const api = createApi({
    auth, tenancy: { run: (_b, fn) => fn(db) }, runtime: nodeRuntime, allowedOrigins: ['https://app.ficoim.id'], appVersion: '0.1.0', secureCookies: true,
    limits: { authPerMin: 1000, defaultPerMin: 100000, backupPerMin: 1000 }, rateLimiter: new RateLimiter(),
    safetyBackupSink: async () => {}, blobStore: kind === 'none' ? undefined : kind === 'file' ? fileBlobStore(dir) : memoryBlobStore(),
  });
  const srv = createHttpServer(api);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  servers.push(srv);
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api`;

  const json = async (method: string, path: string, token?: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const buf = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, bytes: buf, json: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(Buffer.from(buf).toString('utf8')) : null };
  };
  const upload = async (token: string | undefined, bytes: Uint8Array, name = 'foto.jpg', type = 'image/jpeg') => {
    const res = await fetch(`${base}/attachments?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'content-type': type, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: bytes as BodyInit });
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  };
  const signup = async (email: string, biz = 'Toko Maju') => {
    const r = await json('POST', '/auth/register', undefined, { email, password: PW, displayName: 'Budi', businessName: biz, businessType: 'elektronik', openingCash: 100_000 });
    assert.equal(r.status, 201);
    return r.json.accessToken as string;
  };
  return { json, upload, signup, dir };
}

test('unggah & unduh foto lewat HTTP: byte identik, jenis dari isi, header aman; tanpa token ditolak', async () => {
  const { json, upload, signup } = await boot();
  const T = await signup('budi@toko.id');
  const img = jpeg(1_200_000); // > 1 MB: lolos karena rute unggah punya batas sendiri (2 MB), bukan batas JSON 1 MB
  const up = await upload(T, img, 'etalase kaca.jpg');
  assert.equal(up.status, 201, JSON.stringify(up.json));
  assert.deepEqual([up.json.mime, up.json.sizeBytes, up.json.fileName], ['image/jpeg', 1_200_000, 'etalase kaca.jpg']);

  const get = await json('GET', `/attachments/${up.json.id}`, T);
  assert.equal(get.status, 200);
  assert.equal(get.headers.get('content-type'), 'image/jpeg');
  assert.equal(get.headers.get('x-content-type-options'), 'nosniff');
  assert.match(get.headers.get('cache-control') ?? '', /^private/);
  assert.match(get.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  assert.deepEqual(get.bytes, img);

  assert.equal((await upload(undefined, img)).status, 401);
  assert.equal((await json('GET', `/attachments/${up.json.id}`)).status, 401);
});

test('unggah ditolak: bukan gambar, kosong, > 2 MB; ukuran > 1,5 MB (batas gambar) juga ditolak', async () => {
  const { upload, signup } = await boot();
  const T = await signup('budi@toko.id');
  const notImg = await upload(T, new TextEncoder().encode('<script>alert(1)</script>'), 'x.jpg');
  assert.equal(notImg.status, 400); assert.equal(notImg.json.error.code, 'VALIDATION');
  assert.equal((await upload(T, new Uint8Array(0))).status, 400);
  assert.equal((await upload(T, jpeg(1_600_000))).status, 400);   // lolos batas badan, ditolak batas gambar
  assert.equal((await upload(T, jpeg(2_200_000))).status, 413);   // melewati batas badan rute
});

test('izin & isolasi: kasir tidak boleh unggah; akun lain tidak bisa membaca foto orang lain', async () => {
  const { json, upload, signup } = await boot();
  const A = await signup('a@toko.id', 'Toko A'), B = await signup('b@toko.id', 'Toko B');
  const up = await upload(A, jpeg(500));
  assert.equal((await json('GET', `/attachments/${up.json.id}`, B)).status, 404);

  await json('POST', '/members', A, { email: 'sari@toko.id', password: 'Kasir-Sari-2026', displayName: 'Sari', role: 'staff' });
  const S = (await json('POST', '/auth/login', undefined, { email: 'sari@toko.id', password: 'Kasir-Sari-2026' })).json.accessToken as string;
  assert.equal((await upload(S, jpeg(500))).status, 403);
  assert.equal((await json('GET', `/attachments/${up.json.id}`, S)).status, 200); // kasir boleh MELIHAT foto produk di layar kasir
  assert.equal((await json('GET', '/attachments/bukan-uuid', A)).status, 404);
});

test('server tanpa penyimpanan gambar: 501 yang jelas, bukan galat 500', async () => {
  const { upload, signup } = await boot({ blobStore: 'none' });
  const T = await signup('budi@toko.id');
  const r = await upload(T, jpeg(100));
  assert.equal(r.status, 501);
  assert.equal(r.json.error.code, 'NOT_IMPLEMENTED');
});

test('BACKUP via HTTP membawa foto (backup > 1 MB tetap bisa dipulihkan) — penyimpanan berkas di disk', async () => {
  const { json, upload, signup, dir } = await boot({ blobStore: 'file' });
  const T = await signup('budi@toko.id');
  const img = jpeg(1_300_000, 7);
  const up = await upload(T, img);
  const p = await json('POST', '/products', T, { name: 'PC', photoAttachmentId: up.json.id, variants: [{ sellPrice: 15_000_000 }] });
  assert.equal(p.status, 201);
  assert.equal((await json('GET', '/products', T)).json[0].photoAttachmentId, up.json.id);
  assert.equal(readdirSync(dir).length, 1);
  assert.match(readdirSync(dir)[0]!, /^[0-9a-f-]{36}\.jpg$/); // nama berkas = id + ekstensi dari isi, bukan nama kiriman

  const exp = await json('POST', '/backup/export', T, { password: BPW });
  assert.equal(exp.status, 200);
  assert.ok(exp.bytes.length > 1_300_000, 'backup harus memuat byte foto');
  const res = await json('POST', '/backup/restore', T, { password: BPW, mode: 'replace', dataBase64: Buffer.from(exp.bytes).toString('base64') });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const T2 = res.json.session?.accessToken ?? T;
  const after = await json('GET', `/attachments/${up.json.id}`, T2);
  assert.equal(after.status, 200);
  assert.deepEqual(after.bytes, img);
});
