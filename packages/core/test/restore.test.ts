import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeRuntime } from '@ficoim/shared/backup/runtime-node';
import { BackupError } from '@ficoim/shared';
import {
  addTransaction, createProduct, createPurchase, createSale, createAsset, exportBackup, exportTables, insertRow, listProducts, loadCtx, memoryBlobStore, payDebt, listDebts,
  restoreBackup, stdRow, updateProduct, type Ctx, type Db, type RestoreOptions,
} from '../src/index';
import { addCustomer, addSupplier, bootstrap, code, count, makeClock, memberCtx, mk, n, newDb, q1, stockOf, wallet, type World } from './helpers';

const PW = 'Toko-Maju-2026!';
const KDF = { logN: 14, r: 8, p: 1 };
const SRC = { platform: 'mobile', appVersion: '0.1.0' } as const;
const base = { password: PW, runtime: nodeRuntime };

const backup = (ctx: Ctx, blobStore?: ReturnType<typeof memoryBlobStore>) => exportBackup(ctx, { ...base, source: SRC, kdf: KDF, blobStore });
const restore = (db: Db, bytes: Uint8Array, o: Partial<RestoreOptions> & Pick<RestoreOptions, 'mode'>) => restoreBackup(db, bytes, { ...base, ...o });

/** Toko dengan sejarah lengkap: produk, pembelian, penjualan (kredit sebagian), pelunasan, biaya, aset, dan satu foto. */
async function scenario(w: World, store = memoryBlobStore()) {
  const cust = await addCustomer(w.ctx), sup = await addSupplier(w.ctx);
  const v = await mk(w.ctx, 'Ponsel X1', 2_100_000, 2_499_000, 3, {});
  const k = await mk(w.ctx, 'Kabel', 8000, 25_000, 40);
  await createPurchase(w.ctx, { items: [{ variantId: v, qtyMilli: 5000, unitCost: 2_150_000 }], supplierId: sup, paid: 5_000_000 });
  await createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 2000 }, { variantId: k, qtyMilli: 3000 }], customerId: cust, paid: 1_000_000, discount: 10_000 });
  await payDebt(w.ctx, { debtId: (await listDebts(w.ctx, { kind: 'receivable' }))[0]!.id, amount: 300_000 });
  await addTransaction(w.ctx, { walletId: w.walletId, categoryId: String((await q1(w.db, `SELECT id FROM finance_categories WHERE name = 'Sewa'`)).id), type: 'expense', amount: 400_000 });
  await createAsset(w.ctx, { name: 'Etalase Kaca', kind: 'furniture', purchasePrice: 3_000_000, code: 'AST-1' });
  const bytes = Uint8Array.from({ length: 3000 }, (_, i) => (i * 13 + 5) & 255);
  const att = stdRow(w.ctx, { owner_table: 'products', owner_id: null, file_name: 'x1.jpg', mime: 'image/jpeg', size_bytes: bytes.length, sha256: '0'.repeat(64), storage_key: 'mem://asli' });
  await insertRow(w.db, 'attachments', att);
  store.files.set('mem://asli', bytes);
  return { v, k, store, attId: att.id as string, bytes };
}

const strip = (tables: Record<string, Record<string, unknown>[]>) => {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const [t, rows] of Object.entries(tables)) {
    out[t] = rows
      .filter((r) => !(t === 'audit_log' && r.action === 'restore'))
      .map((r) => { const c = { ...r }; if (t === 'members') delete c.user_id; if (t === 'attachments') delete c.storage_key; return c; })
      .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
  }
  return out;
};

test('IMPOR BARU: backup dibuka di perangkat kosong -> data, saldo, stok, piutang, dan foto identik', async () => {
  const A = await bootstrap({ openingCash: 3_000_000 });
  const sc = await scenario(A);
  const file = await backup(A.ctx, sc.store);

  const db2 = newDb(), store2 = memoryBlobStore();
  const rep = await restore(db2, file, { mode: 'replace', blobStore: store2 });
  assert.deepEqual([rep.importedAsNew, rep.businessId, rep.blobsWritten, rep.updated, rep.skipped], [true, A.businessId, 1, 0, 0]);

  const ctx2 = await loadCtx(db2, A.businessId, A.ownerId);
  assert.deepEqual(strip(await exportTables(ctx2)), strip(await exportTables(A.ctx)));
  assert.equal(await wallet(db2, A.walletId), await wallet(A.db, A.walletId));
  assert.equal(await stockOf(db2, sc.v), await stockOf(A.db, sc.v));
  assert.equal((await listDebts(ctx2))[0]!.remaining, (await listDebts(A.ctx))[0]!.remaining);
  const att = (await q1(db2, 'SELECT storage_key k FROM attachments')).k as string;
  assert.notEqual(att, 'mem://asli'); // lokasi baru di perangkat baru
  assert.deepEqual(store2.files.get(att), sc.bytes);
  assert.deepEqual((await db2.all('PRAGMA foreign_key_check')), []);
  // pemulihan berikutnya ke bisnis yang sama tanpa target = ditolak (hindari menimpa tanpa sengaja)
  assert.equal(await code(restore(db2, file, { mode: 'replace' })), 'FORBIDDEN');                       // tanpa hak -> ditolak lebih dulu
  assert.equal(await code(restore(db2, file, { mode: 'replace', actor: ctx2.actor })), 'CONFLICT');     // pemilik pun harus menyebut bisnis tujuan
});

test('TIMPA: kembali persis ke keadaan backup; wajib pemilik; backup pengaman dipanggil; kegagalan pengaman membatalkan', async () => {
  const A = await bootstrap();
  const sc = await scenario(A);
  const file = await backup(A.ctx, sc.store);
  const snapshot = strip(await exportTables(A.ctx));

  // kondisi berubah setelah backup
  await createSale(A.ctx, { items: [{ variantId: sc.k, qtyMilli: 5000 }] });
  await createProduct(A.ctx, { name: 'Produk Baru Setelah Backup' });
  assert.notDeepEqual(strip(await exportTables(A.ctx)), snapshot);

  const mgr = await memberCtx(A, 'manager'), staff = await memberCtx(A, 'staff');
  assert.equal(await code(restore(A.db, file, { mode: 'replace', targetBusinessId: A.businessId })), 'FORBIDDEN');                          // tanpa actor
  assert.equal(await code(restore(A.db, file, { mode: 'replace', targetBusinessId: A.businessId, actor: mgr.actor })), 'FORBIDDEN');       // manager
  assert.equal(await code(restore(A.db, file, { mode: 'replace', targetBusinessId: A.businessId, actor: staff.actor })), 'FORBIDDEN');     // staf
  assert.equal(await count(A.db, 'products', `name = 'Produk Baru Setelah Backup'`), 1); // belum ada yang berubah

  await assert.rejects(restore(A.db, file, { mode: 'replace', targetBusinessId: A.businessId, actor: A.ctx.actor, makeSafetyBackup: async () => { throw new Error('disk penuh'); } }), /disk penuh/);
  assert.equal(await count(A.db, 'products', `name = 'Produk Baru Setelah Backup'`), 1); // pengaman gagal -> restore dibatalkan

  let safety = 0;
  const rep = await restore(A.db, file, { mode: 'replace', targetBusinessId: A.businessId, actor: A.ctx.actor, blobStore: sc.store, makeSafetyBackup: async () => { safety++; } });
  assert.equal(safety, 1);
  assert.equal(rep.importedAsNew, false);
  assert.equal(rep.replacementMemberId, null); // anggota pelaku ikut dipulihkan dengan id yang sama
  const ctxAfter = await loadCtx(A.db, A.businessId, A.ownerId);
  assert.deepEqual(strip(await exportTables(ctxAfter)), snapshot);
  assert.equal(await count(A.db, 'audit_log', `action = 'restore'`), 1);
  assert.deepEqual(await A.db.all('PRAGMA foreign_key_check'), []);
});

test('kata sandi salah / berkas rusak: tidak ada yang berubah, tidak ada lampiran tertulis', async () => {
  const A = await bootstrap();
  const sc = await scenario(A);
  const file = await backup(A.ctx, sc.store);
  const before = strip(await exportTables(A.ctx));
  const store = memoryBlobStore();
  await assert.rejects(restore(A.db, file, { mode: 'replace', targetBusinessId: A.businessId, actor: A.ctx.actor, password: 'salah-semua-123', blobStore: store }), (e: unknown) => e instanceof BackupError && e.code === 'WRONG_PASSWORD_OR_CORRUPT');
  const bad = file.slice(); bad[bad.length - 5] = (bad[bad.length - 5] as number) ^ 1;
  await assert.rejects(restore(A.db, bad, { mode: 'replace', targetBusinessId: A.businessId, actor: A.ctx.actor, blobStore: store }), BackupError);
  assert.equal(store.files.size, 0);
  assert.deepEqual(strip(await exportTables(A.ctx)), before);
});

test('restore bersifat atomik: kegagalan di tengah jalan (mis. trigger menolak) mengembalikan data lama utuh', async () => {
  const A = await bootstrap();
  const sc = await scenario(A);
  const file = await backup(A.ctx, sc.store);
  await createProduct(A.ctx, { name: 'Data Terbaru' });
  const before = strip(await exportTables(A.ctx));
  await A.db.run(`CREATE TRIGGER boom BEFORE INSERT ON sale_items BEGIN SELECT RAISE(ABORT, 'boom'); END`);
  await assert.rejects(restore(A.db, file, { mode: 'replace', targetBusinessId: A.businessId, actor: A.ctx.actor }), /boom/);
  assert.deepEqual(strip(await exportTables(A.ctx)), before); // penghapusan sebelumnya ikut dibatalkan
});

test('PINDAH BISNIS: backup bisnis A dimuat ke bisnis B (business_id ditulis ulang); data lama B diganti', async () => {
  const db = newDb(), clock = makeClock();
  const A = await bootstrap({ db: newDb(), clock, name: 'Toko A' });
  const sc = await scenario(A);
  const file = await backup(A.ctx, sc.store);
  const B = await bootstrap({ db, clock, name: 'Toko B' });
  await mk(B.ctx, 'Barang Lama B', 1, 2, 3);
  await restore(db, file, { mode: 'replace', targetBusinessId: B.businessId, actor: B.ctx.actor });
  assert.equal(await count(db, 'businesses'), 1);
  assert.equal(String((await q1(db, 'SELECT id i FROM businesses')).i), B.businessId);
  assert.equal(await count(db, 'products', `business_id <> ?`, [B.businessId]), 0);
  assert.equal(await count(db, 'products', `name = 'Barang Lama B'`), 0);
  assert.equal(await count(db, 'products', `name = 'Ponsel X1'`), 1);
  assert.deepEqual(await db.all('PRAGMA foreign_key_check'), []);
});

/** Dua perangkat yang berawal dari backup yang sama lalu berjalan sendiri-sendiri. */
async function fork() {
  const clock = makeClock();
  const A = await bootstrap({ clock, openingCash: 2_000_000 });
  const sc = await scenario(A);
  const baseFile = await backup(A.ctx, sc.store);
  const db2 = newDb(), store2 = memoryBlobStore();
  await restore(db2, baseFile, { mode: 'replace', blobStore: store2 });
  const ctx2 = await loadCtx(db2, A.businessId, A.ownerId, { now: clock.now });
  return { A, ctx1: A.ctx, ctx2, db2, sc, clock };
}

test('GABUNG: transaksi dari dua perangkat digabung; nomor dokumen bentrok diberi sufiks; stok & saldo dihitung ulang', async () => {
  const { A, ctx1, ctx2, db2, sc, clock } = await fork();
  clock.advanceMin(30);
  await createSale(ctx1, { items: [{ variantId: sc.k, qtyMilli: 2000 }] });                         // perangkat 1: PJ-…-000002
  clock.advanceMin(1);
  await createSale(ctx2, { items: [{ variantId: sc.k, qtyMilli: 5000 }], paid: 100_000, customerId: String((await q1(db2, 'SELECT id i FROM customers')).i) }); // perangkat 2: juga PJ-…-000002
  const numbers2 = (await db2.all('SELECT number n FROM sales ORDER BY number')).map((r) => r.n);
  assert.deepEqual(numbers2, ['PJ-202610-000001', 'PJ-202610-000002']);

  const file1 = await backup(ctx1);
  const rep = await restore(db2, file1, { mode: 'merge', actor: ctx2.actor });
  assert.equal(rep.renumbered, 1);
  assert.ok(rep.inserted > 0);
  assert.deepEqual((await db2.all('SELECT number n FROM sales ORDER BY number')).map((r) => r.n), ['PJ-202610-000001', 'PJ-202610-000002', 'PJ-202610-000002-M1']);
  // stok Kabel: awal 40, -3 (penjualan sejarah), -2 (perangkat 1), -5 (perangkat 2)
  assert.equal(await stockOf(db2, sc.k), 40_000 - 3000 - 2000 - 5000);
  // saldo dompet = saldo awal + semua transaksi masuk/keluar dari kedua perangkat
  const exp = n((await q1(db2, `SELECT w.opening_balance + COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE -t.amount END),0) b FROM wallets w LEFT JOIN transactions t ON t.wallet_id = w.id AND t.deleted_at IS NULL GROUP BY w.id`)).b);
  assert.equal(await wallet(db2, A.walletId), exp);
  assert.deepEqual(await db2.all('PRAGMA foreign_key_check'), []);

  // idempoten: menggabung backup yang sama lagi tidak menambah apa pun
  const before = strip(await exportTables(ctx2));
  const again = await restore(db2, file1, { mode: 'merge', actor: ctx2.actor });
  assert.deepEqual([again.inserted, again.updated], [0, 0]);
  assert.deepEqual(strip(await exportTables(await loadCtx(db2, A.businessId, A.ownerId))).sales!.length, before.sales!.length);
  assert.equal(await count(db2, 'sale_items'), (before.sale_items as unknown[]).length);
});

test('GABUNG: last-write-wins — yang lebih baru menang, yang lebih lama tidak menimpa', async () => {
  const { ctx1, ctx2, db2, sc, clock, A } = await fork();
  const pid = String((await q1(A.db, 'SELECT product_id p FROM product_variants WHERE id = ?', [sc.v])).p);
  clock.advanceMin(10);
  await updateProduct(ctx2, pid, { name: 'Nama dari Perangkat 2 (lebih lama)' });
  clock.advanceMin(10);
  await updateProduct(ctx1, pid, { name: 'Nama dari Perangkat 1 (lebih baru)' });
  const f1 = await backup(ctx1), f2 = await backup(ctx2);

  const rep = await restore(db2, f1, { mode: 'merge', actor: ctx2.actor });             // yang baru masuk ke yang lama -> menang
  assert.ok(rep.updated >= 1);
  assert.equal((await q1(db2, 'SELECT name n FROM products WHERE id = ?', [pid])).n, 'Nama dari Perangkat 1 (lebih baru)');
  await restore(A.db, f2, { mode: 'merge', actor: ctx1.actor });                         // yang lama masuk ke yang baru -> diabaikan
  assert.equal((await q1(A.db, 'SELECT name n FROM products WHERE id = ?', [pid])).n, 'Nama dari Perangkat 1 (lebih baru)');
});

test('GABUNG: produk yang sama (SKU sama) dibuat terpisah di dua perangkat -> varian digabung, tidak ada produk yatim', async () => {
  const { ctx1, ctx2, db2, A } = await fork();
  await createProduct(ctx1, { name: 'Kopi', variants: [{ sku: 'KOPI-1', costPrice: 100, sellPrice: 200, openingQtyMilli: 5000 }] });
  await createProduct(ctx2, { name: 'Kopi Susu', variants: [{ sku: 'KOPI-1', costPrice: 100, sellPrice: 200, openingQtyMilli: 7000 }] });
  const rep = await restore(db2, await backup(ctx1), { mode: 'merge', actor: ctx2.actor });
  assert.ok(rep.remapped >= 1);
  assert.equal(await count(db2, 'product_variants', `sku = 'KOPI-1' AND deleted_at IS NULL`), 1);
  const names = (await listProducts(ctx2, { search: 'kopi' })).map((p) => p.productName);
  assert.deepEqual(names, ['Kopi Susu']); // tidak ada "Kopi" yatim
  assert.equal(await stockOf(db2, String((await q1(db2, `SELECT id i FROM product_variants WHERE sku = 'KOPI-1'`)).i)), 12_000); // kedua stok awal tercatat
  assert.deepEqual(await db2.all('PRAGMA foreign_key_check'), []);
  void A;
});

test('GABUNG dua bisnis yang dibuat terpisah: dompet "Kas Toko" & kategori bawaan tidak berlipat ganda; profil bisnis tujuan tidak tertimpa', async () => {
  const clock = makeClock();
  const A = await bootstrap({ clock, name: 'Toko A', openingCash: 1_000_000 });
  const sc = await scenario(A);
  const B = await bootstrap({ clock, name: 'Toko B', openingCash: 500_000 });
  clock.advanceMin(5);
  await restore(B.db, await backup(A.ctx, sc.store), { mode: 'merge', targetBusinessId: B.businessId, actor: B.ctx.actor });
  assert.equal((await q1(B.db, 'SELECT name n FROM businesses')).n, 'Toko B');
  assert.equal(await count(B.db, 'wallets', `name = 'Kas Toko' AND deleted_at IS NULL`), 1);
  assert.equal(await count(B.db, 'finance_categories', `name = 'Penjualan' AND deleted_at IS NULL`), 1);
  assert.equal(await count(B.db, 'product_categories', `name = 'Handphone & Tablet' AND deleted_at IS NULL`), 1);
  assert.equal(await count(B.db, 'sales'), 1);
  assert.equal(await count(B.db, 'products', `business_id <> ?`, [B.businessId]), 0);
  assert.deepEqual(await B.db.all('PRAGMA foreign_key_check'), []);
  // sistem tetap berfungsi setelah penggabungan (kategori sistem tunggal)
  const v = String((await q1(B.db, `SELECT id i FROM product_variants WHERE sku IS NULL AND barcode IS NULL LIMIT 1`)).i);
  await createSale(B.ctx, { items: [{ variantId: v, qtyMilli: 1000 }] });
});

test('SALINAN (regenerateIds): backup dipulihkan ke bisnis LAIN di database yang sama; tabrakan ID dilaporkan jelas', async () => {
  const db = newDb(), clock = makeClock();
  const A = await bootstrap({ db, clock, name: 'Toko A' });
  const sc = await scenario(A);
  const file = await backup(A.ctx, sc.store);
  const B = await bootstrap({ db, clock, name: 'Toko B' });
  await mk(B.ctx, 'Barang Lama B', 1, 2, 3);
  const before = strip(await exportTables(B.ctx));

  // tanpa regenerateIds: ID baris A masih dipakai A -> ditolak dengan pesan jelas, dan B tidak berubah sama sekali
  try { await restore(db, file, { mode: 'replace', targetBusinessId: B.businessId, actor: B.ctx.actor }); assert.fail('harusnya gagal'); }
  catch (e) { assert.equal((e as { code: string }).code, 'CONFLICT'); assert.equal((e as { details: { code: string } }).details.code, 'ID_COLLISION'); }
  assert.deepEqual(strip(await exportTables(B.ctx)), before);

  const store = memoryBlobStore();
  const rep = await restore(db, file, { mode: 'replace', targetBusinessId: B.businessId, actor: B.ctx.actor, regenerateIds: true, blobStore: store });
  // anggota lama pemilik B terhapus oleh restore -> dilaporkan agar akunnya bisa ditautkan ulang (kalau tidak, ia terkunci)
  assert.ok(rep.replacementMemberId);
  assert.equal(await code(loadCtx(db, B.businessId, B.ownerId)), 'FORBIDDEN');
  const ctxB = await loadCtx(db, B.businessId, rep.replacementMemberId as string);
  assert.equal(ctxB.actor.role, 'owner');
  assert.equal(await count(db, 'audit_log', `business_id = ? AND action = 'restore' AND member_id = ?`, [B.businessId, rep.replacementMemberId]), 1);
  const tb = await exportTables(ctxB), ta = await exportTables(A.ctx);
  assert.deepEqual(tb.products!.map((r) => r.name).sort(), ta.products!.map((r) => r.name).sort());
  const idsA = new Set(Object.values(ta).flat().map((r) => r.id)), idsB = Object.entries(tb).filter(([t]) => t !== 'businesses').flatMap(([, rows]) => rows.map((r) => r.id));
  assert.ok(idsB.every((id) => !idsA.has(id)), 'tidak boleh ada ID yang sama dengan bisnis A');
  assert.equal(await count(db, 'products', `business_id = ?`, [A.businessId]), 2); // A utuh
  assert.deepEqual(await db.all('PRAGMA foreign_key_check'), []);
  assert.equal(await wallet(db, String((await q1(db, `SELECT id i FROM wallets WHERE business_id = ?`, [B.businessId])).i)), await wallet(db, A.walletId));
  assert.equal(await count(db, 'debts', `business_id = ?`, [B.businessId]), 2); // piutang penjualan + hutang pembelian
  // referensi polimorfik (transaksi -> penjualan) ikut diperbarui
  const t = await q1(db, `SELECT t.ref_id r, s.id sid FROM transactions t JOIN sales s ON s.id = t.ref_id WHERE t.business_id = ? AND t.ref_table = 'sales'`, [B.businessId]);
  assert.equal(t.r, t.sid);
  const att = (await q1(db, `SELECT id, storage_key k FROM attachments WHERE business_id = ?`, [B.businessId]));
  assert.deepEqual(store.files.get(String(att.k)), sc.bytes); // berkas mengikuti id baru
  assert.equal(String(att.k), `mem://${att.id}`);
});
