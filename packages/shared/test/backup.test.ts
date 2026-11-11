import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeRuntime as rt } from '../src/backup/runtime-node';
import { BackupError } from '../src/backup/errors';
import {
  HEADER_LENGTH, createBackup, inspectBackupHeader, openBackup, suggestBackupFileName, summarizeBackup,
  type BackupManifest,
} from '../src/backup/format';
import { migrateTables, migrations } from '../src/backup/migrations';
import { buildSample } from '../src/testing/sample';
import { toHex, utf8Encode } from '../src/utf8';

const PW = 'Toko-Maju-2026!';
const FAST = { logN: 14, r: 8, p: 1 };
const SRC = { platform: 'mobile', appVersion: '0.1.0' } as const;

const make = (over: Partial<Parameters<typeof createBackup>[0]> = {}) => {
  const s = buildSample();
  return createBackup({ tables: s.tables, blobs: s.blobs, password: PW, source: SRC, kdf: FAST, ...over }, rt);
};
const code = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return e instanceof BackupError ? e.code : `BUKAN-BackupError: ${e}`; }
  return 'TIDAK-ERROR';
};

/** Encoder independen menurut bagian "Format backup" di README.md — dipakai untuk membuat file "nakal" yang sah secara enkripsi. */
async function forge(mutate: (m: BackupManifest) => void, opts: { trailing?: Uint8Array; blobOverride?: Uint8Array[] } = {}) {
  const s = buildSample();
  const good = await createBackup({ tables: s.tables, blobs: s.blobs, password: PW, source: SRC, kdf: FAST }, rt);
  const opened = await openBackup(good, PW, rt);
  const m = structuredClone(opened.manifest);
  mutate(m);
  const metaGz = await rt.gzip(utf8Encode(JSON.stringify(m)));
  const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, metaGz.length, false);
  const blobs = opts.blobOverride ?? s.blobs.map((b) => b.data);
  const parts = [len, metaGz, ...blobs, ...(opts.trailing ? [opts.trailing] : [])];
  const plain = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { plain.set(p, o); o += p.length; }
  const header = good.slice(0, HEADER_LENGTH);
  const key = await rt.scrypt(utf8Encode(PW), header.slice(12, 28), FAST);
  const ct = await rt.aesGcmEncrypt(key, header.slice(28, 40), header, plain);
  const out = new Uint8Array(HEADER_LENGTH + ct.length); out.set(header); out.set(ct, HEADER_LENGTH);
  return out;
}

test('round-trip: data & lampiran kembali persis sama', async () => {
  const s = buildSample();
  const file = await createBackup({ tables: s.tables, blobs: s.blobs, password: PW, source: SRC, kdf: FAST }, rt);
  const r = await openBackup(file, PW, rt);
  assert.equal(r.manifest.formatVersion, 1);
  assert.equal(r.manifest.business.name, 'Toko Maju Elektronik');
  assert.equal(r.manifest.counts.products, 2);
  // user_id & storage_key sengaja dibuang saat ekspor; selain itu identik
  const expected = structuredClone(s.tables);
  for (const m of expected.members!) m.user_id = null;
  for (const a of expected.attachments!) a.storage_key = null;
  assert.deepEqual(r.tables, expected);
  assert.equal(r.blobs.length, 1);
  assert.deepEqual(r.blobs[0]!.data, s.blobs[0]!.data);
  assert.equal(r.blobs[0]!.id, s.blobs[0]!.id);
});

test('ekspor tidak membocorkan tautan akun & lokasi file perangkat', async () => {
  const r = await openBackup(await make(), PW, rt);
  assert.ok(r.tables.members!.every((m) => m.user_id === null));
  assert.ok(r.tables.attachments!.every((a) => a.storage_key === null));
});

test('berkas terenkripsi: tidak ada teks asli yang terbaca, dan tiap backup unik (salt/nonce acak)', async () => {
  const a = await make(); const b = await make();
  const text = Buffer.from(a).toString('latin1');
  for (const needle of ['Toko Maju', 'Ponsel', 'Rina', 'business_id', 'ficoim-backup']) assert.ok(!text.includes(needle), `bocor: ${needle}`);
  assert.notDeepEqual(a, b);
  assert.deepEqual([...a.slice(0, 6)], [...utf8Encode('FICOIM')]);
});

test('kata sandi salah / kosong ditolak', async () => {
  const f = await make();
  assert.equal(await code(openBackup(f, 'salah-total-123', rt)), 'WRONG_PASSWORD_OR_CORRUPT');
  assert.equal(await code(openBackup(f, '', rt)), 'WRONG_PASSWORD_OR_CORRUPT');
  assert.equal(await code(openBackup(f, PW + ' ', rt)), 'WRONG_PASSWORD_OR_CORRUPT');
});

test('kata sandi dinormalisasi NFKC: é (satu karakter) = e + aksen terpisah; angka lebar-penuh = ASCII', async () => {
  const f = await make({ password: 'kata-sandi-caf\u00e9-2026' });
  assert.ok((await openBackup(f, 'kata-sandi-cafe\u0301-2026', rt)).manifest);
  const g = await make({ password: '12345678' });
  assert.ok((await openBackup(g, '１２３４５６７８', rt)).manifest);
});

test('kata sandi terlalu pendek ditolak saat membuat backup', async () => {
  assert.equal(await code(make({ password: 'pendek' })), 'WEAK_PASSWORD');
});

test('integritas: mengubah 1 byte di bagian mana pun membuat backup ditolak', async () => {
  const f = await make();
  const flip = (i: number) => { const c = f.slice(); c[i] = (c[i] as number) ^ 0x01; return c; };
  assert.equal(await code(openBackup(flip(0), PW, rt)), 'NOT_A_BACKUP');            // magic
  assert.equal(await code(openBackup(flip(6), PW, rt)), 'UNSUPPORTED_FORMAT');      // versi
  assert.equal(await code(openBackup(flip(7), PW, rt)), 'UNSUPPORTED_FORMAT');      // kdf id
  assert.equal(await code(openBackup(flip(11), PW, rt)), 'UNSUPPORTED_FORMAT');     // cadangan
  for (const i of [9, 12, 20, 28, 35]) assert.equal(await code(openBackup(flip(i), PW, rt)), 'WRONG_PASSWORD_OR_CORRUPT', `header byte ${i}`);
  assert.equal(await code(openBackup(flip(10), PW, rt)), 'INVALID_KDF_PARAMS'); // p: 1 -> 0 di luar batas
  const c = f.slice(); c[8] = 15; // logN lain yang sah -> kunci beda + AAD beda
  assert.equal(await code(openBackup(c, PW, rt)), 'WRONG_PASSWORD_OR_CORRUPT');
  for (const i of [HEADER_LENGTH, HEADER_LENGTH + 100, f.length - 17, f.length - 1])
    assert.equal(await code(openBackup(flip(i), PW, rt)), 'WRONG_PASSWORD_OR_CORRUPT', `byte ${i}`);
});

test('berkas terpotong / bukan backup', async () => {
  const f = await make();
  assert.equal(await code(openBackup(f.slice(0, f.length - 1), PW, rt)), 'WRONG_PASSWORD_OR_CORRUPT');
  assert.equal(await code(openBackup(f.slice(0, HEADER_LENGTH + 5), PW, rt)), 'NOT_A_BACKUP');
  assert.equal(await code(openBackup(new Uint8Array(0), PW, rt)), 'NOT_A_BACKUP');
  assert.equal(await code(openBackup(utf8Encode('{"ini":"json biasa, bukan backup, panjang sekali sekali sekali"}'), PW, rt)), 'NOT_A_BACKUP');
});

test('parameter KDF di luar batas ditolak SEBELUM komputasi berat (anti-DoS)', async () => {
  const f = await make();
  for (const [off, val] of [[8, 20], [8, 10], [9, 0], [9, 64], [10, 0], [10, 9]] as const) {
    const c = f.slice(); c[off] = val;
    const t0 = Date.now();
    assert.equal(await code(openBackup(c, PW, rt)), 'INVALID_KDF_PARAMS', `byte ${off}=${val}`);
    assert.ok(Date.now() - t0 < 200);
  }
  assert.equal(inspectBackupHeader(f).kdf.logN, 14);
});

test('data tidak valid ditolak saat membuat backup (dengan daftar masalah)', async () => {
  const s = buildSample();
  s.tables.sales![0]!.total = -5;
  try { await createBackup({ tables: s.tables, password: PW, source: SRC, kdf: FAST }, rt); assert.fail('harusnya error'); }
  catch (e) { assert.ok(e instanceof BackupError && e.code === 'INVALID_CONTENT' && e.issues!.length > 0); }
});

test('backup dari versi skema yang lebih baru ditolak dengan pesan jelas', async () => {
  const f = await forge((m) => { m.schemaVersion = 999; });
  assert.equal(await code(openBackup(f, PW, rt)), 'SCHEMA_TOO_NEW');
});

test('isi sah-enkripsi tapi rusak/berbahaya ditolak oleh validasi', async () => {
  assert.equal(await code(openBackup(await forge((m) => { m.format = 'lain' as never; }), PW, rt)), 'INVALID_CONTENT');
  assert.equal(await code(openBackup(await forge((m) => { (m.tables.sales![0] as Record<string, unknown>).total = 'banyak'; }), PW, rt)), 'INVALID_CONTENT');
  assert.equal(await code(openBackup(await forge((m) => { m.tables.transactions![0]!.wallet_id = '00000000-0000-7000-8000-000000000abc'; }), PW, rt)), 'INVALID_CONTENT');
  assert.equal(await code(openBackup(await forge((m) => { m.tables.users = [{ id: 'x' }] as never; }), PW, rt)), 'INVALID_CONTENT');
});

test('lampiran: checksum salah, data terpotong, dan data berlebih ditolak', async () => {
  assert.equal(await code(openBackup(await forge((m) => { m.blobs[0]!.sha256 = '0'.repeat(64); }), PW, rt)), 'INVALID_CONTENT');
  assert.equal(await code(openBackup(await forge((m) => { m.blobs[0]!.size += 10; }), PW, rt)), 'INVALID_CONTENT');
  assert.equal(await code(openBackup(await forge(() => {}, { trailing: Uint8Array.of(1, 2, 3) }), PW, rt)), 'INVALID_CONTENT');
  // sanity: forge tanpa mutasi = berkas sah
  assert.ok((await openBackup(await forge(() => {}), PW, rt)).manifest);
});

test('migrasi skema: jalur ada -> dijalankan berurutan; jalur putus -> ditolak', async () => {
  const t = buildSample().tables;
  migrations[1] = (x) => { for (const p of x.products!) p.tag = 'v2'; return x; };
  migrations[2] = (x) => { for (const p of x.products!) p.tag += '+v3'; return x; };
  try {
    const out = migrateTables(structuredClone(t), 1, 3);
    assert.equal(out.products![0]!.tag, 'v2+v3');
  } finally { delete migrations[1]; delete migrations[2]; }
  assert.throws(() => migrateTables(t, 1, 2), (e: unknown) => e instanceof BackupError && e.code === 'UNSUPPORTED_FORMAT');
  assert.throws(() => migrateTables(t, 5, 1), (e: unknown) => e instanceof BackupError && e.code === 'SCHEMA_TOO_NEW');
});

test('backup besar: 20.000 transaksi + 30 foto @200KB', async () => {
  const s = buildSample();
  const biz = s.tables.businesses![0]!.id as string;
  const wallet = s.tables.wallets![0]!.id as string, cat = s.tables.finance_categories![0]!.id as string;
  const { uuidv7 } = await import('../src/ids');
  const ts = '2026-10-02T00:00:00.000Z';
  for (let i = 0; i < 20_000; i++)
    s.tables.transactions!.push({ id: uuidv7(), business_id: biz, wallet_id: wallet, category_id: cat, type: 'income', amount: 1000 + i, occurred_on: '2026-10-02', description: `Tx ${i}`, ref_table: null, ref_id: null, receipt_attachment_id: null, created_by: null, created_at: ts, updated_at: ts, deleted_at: null });
  for (let i = 0; i < 30; i++) {
    const id = uuidv7(); const data = new Uint8Array(200_000).map((_, j) => (j * 7 + i) & 255);
    s.blobs.push({ id, mime: 'image/jpeg', data });
    s.tables.attachments!.push({ id, business_id: biz, owner_table: null, owner_id: null, file_name: `f${i}.jpg`, mime: 'image/jpeg', size_bytes: data.length, sha256: toHex(await rt.sha256(data)), storage_key: null, created_at: ts, updated_at: ts, deleted_at: null });
  }
  const t0 = Date.now();
  const f = await createBackup({ tables: s.tables, blobs: s.blobs, password: PW, source: SRC, kdf: FAST }, rt);
  const r = await openBackup(f, PW, rt);
  console.log(`  # backup besar: ${(f.length / 1e6).toFixed(1)} MB, buat+buka ${Date.now() - t0} ms (runtime Node)`);
  assert.equal(r.tables.transactions!.length, 20_002); // 2 dari sampel + 20.000
  assert.equal(r.blobs.length, 31);
});

test('bantuan UI: nama file & ringkasan pratinjau', async () => {
  assert.equal(suggestBackupFileName('Toko Maju Elektronik!', new Date(2026, 9, 27, 14, 5)), 'ficoim-toko-maju-elektronik-20261027-1405.ficoim');
  assert.equal(suggestBackupFileName('???'), suggestBackupFileName('???').replace(/ficoim-.*?-(\d{8})/, 'ficoim-bisnis-$1'));
  const sum = summarizeBackup(await openBackup(await make(), PW, rt));
  assert.deepEqual([sum.products, sum.sales, sum.assets, sum.attachments], [2, 1, 1, 1]);
});
