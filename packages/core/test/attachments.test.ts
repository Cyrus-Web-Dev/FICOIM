import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeRuntime } from '@ficoim/shared/backup/runtime-node';
import {
  MAX_IMAGE_BYTES, addTransaction, createAsset, createProduct, createPurchase, deleteProduct, exportBackup, listAssets, listProducts, listPurchases,
  listTransactions, loadCtx, memoryBlobStore, readImage, restoreBackup, saveImage, sniffImageMime, updateProduct,
} from '../src/index';
import { addSupplier, bootstrap, code, memberCtx, mk, newDb, q1 } from './helpers';

// Gambar-mini asli (header valid) — yang diuji adalah deteksi dari isi, bukan dekoder gambar.
const jpeg = (n = 64, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i < 3 ? [0xff, 0xd8, 0xff][i]! : (i * 7 + seed) & 255));
const png = () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const webp = () => Uint8Array.from([...'RIFF'].map((c) => c.charCodeAt(0)).concat([1, 0, 0, 0], [...'WEBP'].map((c) => c.charCodeAt(0)), [9, 9]));
const deps = () => ({ blobStore: memoryBlobStore(), runtime: nodeRuntime });

test('sniffImageMime: mengenali dari isi, menolak selain JPEG/PNG/WebP', () => {
  assert.equal(sniffImageMime(jpeg()), 'image/jpeg');
  assert.equal(sniffImageMime(png()), 'image/png');
  assert.equal(sniffImageMime(webp()), 'image/webp');
  assert.equal(sniffImageMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffImageMime(new TextEncoder().encode('MZ\x90\x00 program.exe')), null);
  assert.equal(sniffImageMime(new Uint8Array(0)), null);
  assert.equal(sniffImageMime(Uint8Array.from([0xff, 0xd8])), null); // terpotong
});

test('saveImage/readImage: byte kembali persis; mime dari isi (bukan nama); metadata & hash tercatat', async () => {
  const w = await bootstrap(), d = deps();
  const img = jpeg(500);
  const saved = await saveImage(w.ctx, d, { fileName: 'C:\\Users\\budi\\foto-saya.png', bytes: img }); // nama berbohong soal jenis & berisi jalur
  assert.equal(saved.mime, 'image/jpeg');
  assert.equal(saved.fileName, 'foto-saya.png');
  const back = await readImage(w.ctx, d.blobStore, saved.id);
  assert.deepEqual(back.bytes, img);
  assert.equal(back.mime, 'image/jpeg');
  const row = await q1(w.db, 'SELECT * FROM attachments WHERE id = ?', [saved.id]);
  assert.equal(row.size_bytes, 500);
  assert.match(String(row.sha256), /^[0-9a-f]{64}$/);
  assert.equal(row.owner_table, null);
  assert.equal(await code(readImage(w.ctx, d.blobStore, '018f0000-0000-7000-8000-000000000000')), 'NOT_FOUND');
});

test('saveImage menolak: kosong, bukan gambar (walau bernama .jpg), SVG, terlalu besar', async () => {
  const w = await bootstrap(), d = deps();
  assert.equal(await code(saveImage(w.ctx, d, { bytes: new Uint8Array(0) })), 'VALIDATION');
  assert.equal(await code(saveImage(w.ctx, d, { fileName: 'a.jpg', bytes: new TextEncoder().encode('bukan gambar sama sekali') })), 'VALIDATION');
  assert.equal(await code(saveImage(w.ctx, d, { fileName: 'a.svg', bytes: new TextEncoder().encode('<svg onload="alert(1)"/>') })), 'VALIDATION');
  assert.equal(await code(saveImage(w.ctx, d, { bytes: jpeg(MAX_IMAGE_BYTES + 1) })), 'VALIDATION');
  assert.equal((await saveImage(w.ctx, d, { bytes: jpeg(MAX_IMAGE_BYTES) })).sizeBytes, MAX_IMAGE_BYTES); // tepat di batas lolos
  assert.equal(d.blobStore.files.size, 1, 'penolakan tidak boleh meninggalkan berkas');
});

test('izin: kasir (staf) tidak boleh unggah tetapi boleh membaca; manajer boleh', async () => {
  const w = await bootstrap(), d = deps();
  const staff = await memberCtx(w, 'staff'), manager = await memberCtx(w, 'manager');
  assert.equal(await code(saveImage(staff, d, { bytes: jpeg() })), 'FORBIDDEN');
  const saved = await saveImage(manager, d, { bytes: jpeg() });
  assert.equal((await readImage(staff, d.blobStore, saved.id)).mime, 'image/jpeg');
});

test('isolasi: bisnis lain tidak bisa membaca atau menautkan lampiran bisnis ini', async () => {
  const A = await bootstrap(), d = deps();
  const B = await bootstrap({ db: A.db, name: 'Toko Lain' });
  const saved = await saveImage(A.ctx, d, { bytes: jpeg() });
  assert.equal(await code(readImage(B.ctx, d.blobStore, saved.id)), 'NOT_FOUND');
  assert.equal(await code(createProduct(B.ctx, { name: 'X', photoAttachmentId: saved.id })), 'NOT_FOUND');
});

test('foto produk: pasang saat buat, ganti (foto lama dibuang), hapus, dan satu foto tidak boleh dipakai dua produk', async () => {
  const w = await bootstrap(), d = deps();
  const a = await saveImage(w.ctx, d, { bytes: jpeg(100, 1) }), b = await saveImage(w.ctx, d, { bytes: jpeg(100, 2) });
  const { productId } = await createProduct(w.ctx, { name: 'PC', photoAttachmentId: a.id, variants: [{ sellPrice: 1000 }] });
  assert.equal((await listProducts(w.ctx))[0]!.photoAttachmentId, a.id);
  assert.equal((await q1(w.db, 'SELECT owner_table t, owner_id i FROM attachments WHERE id = ?', [a.id])).i, productId);

  // dipakai produk lain -> ditolak, tidak ada yang berubah
  assert.equal(await code(createProduct(w.ctx, { name: 'Lain', photoAttachmentId: a.id })), 'CONFLICT');
  assert.equal((await listProducts(w.ctx)).length, 1);

  await updateProduct(w.ctx, productId, { photoAttachmentId: b.id });
  assert.equal((await listProducts(w.ctx))[0]!.photoAttachmentId, b.id);
  assert.notEqual((await q1(w.db, 'SELECT deleted_at d FROM attachments WHERE id = ?', [a.id])).d, null, 'foto lama harus dibuang');
  assert.equal(await code(readImage(w.ctx, d.blobStore, a.id)), 'NOT_FOUND');

  await updateProduct(w.ctx, productId, { photoAttachmentId: null });
  assert.equal((await listProducts(w.ctx))[0]!.photoAttachmentId, null);
  assert.notEqual((await q1(w.db, 'SELECT deleted_at d FROM attachments WHERE id = ?', [b.id])).d, null);

  // mengubah bidang lain tidak menyentuh foto
  const c = await saveImage(w.ctx, d, { bytes: jpeg(100, 3) });
  await updateProduct(w.ctx, productId, { photoAttachmentId: c.id });
  await updateProduct(w.ctx, productId, { name: 'PC Gaming' });
  assert.equal((await listProducts(w.ctx))[0]!.photoAttachmentId, c.id);

  await deleteProduct(w.ctx, productId);
  assert.notEqual((await q1(w.db, 'SELECT deleted_at d FROM attachments WHERE id = ?', [c.id])).d, null, 'produk diarsipkan -> fotonya tidak ikut backup');
});

test('nota pembelian & bukti transaksi: tertaut, tampil di daftar, gagal total bila lampiran tidak sah', async () => {
  const w = await bootstrap(), d = deps();
  const v = await mk(w.ctx, 'Kabel', 8000, 25_000, 0), sup = await addSupplier(w.ctx);
  const nota = await saveImage(w.ctx, d, { fileName: 'nota.jpg', bytes: jpeg(200, 5) });
  const po = await createPurchase(w.ctx, { items: [{ variantId: v, qtyMilli: 10_000, unitCost: 8000 }], supplierId: sup, receiptAttachmentId: nota.id });
  const list = await listPurchases(w.ctx);
  assert.equal(list[0]!.id, po.purchaseId);
  assert.equal(list[0]!.receiptAttachmentId, nota.id);

  // lampiran palsu -> pembelian TIDAK tercatat (stok tidak berubah)
  const before = (await listPurchases(w.ctx)).length;
  assert.equal(await code(createPurchase(w.ctx, { items: [{ variantId: v, qtyMilli: 1000, unitCost: 8000 }], receiptAttachmentId: '018f0000-0000-7000-8000-000000000000' })), 'NOT_FOUND');
  assert.equal((await listPurchases(w.ctx)).length, before);
  assert.equal(Number((await q1(w.db, 'SELECT stock_qty_milli s FROM product_variants WHERE id = ?', [v])).s), 10_000);

  // bukti biaya
  const cat = String((await q1(w.db, `SELECT id FROM finance_categories WHERE name = 'Sewa'`)).id);
  const bukti = await saveImage(w.ctx, d, { bytes: png() });
  const tx = await addTransaction(w.ctx, { walletId: w.walletId, categoryId: cat, type: 'expense', amount: 50_000, receiptAttachmentId: bukti.id });
  const row = (await listTransactions(w.ctx)).find((t) => t.id === tx)!;
  assert.equal(row.receiptAttachmentId, bukti.id);
  assert.equal(await code(addTransaction(w.ctx, { walletId: w.walletId, categoryId: cat, type: 'expense', amount: 1, receiptAttachmentId: bukti.id })), 'CONFLICT');
});

test('foto aset', async () => {
  const w = await bootstrap(), d = deps();
  const ph = await saveImage(w.ctx, d, { bytes: webp() });
  await createAsset(w.ctx, { name: 'Etalase', kind: 'furniture', photoAttachmentId: ph.id });
  assert.equal((await listAssets(w.ctx))[0]!.photoAttachmentId, ph.id);
});

test('BACKUP: foto ikut terbawa ke perangkat lain dan terbaca di sana; foto yang dibuang tidak ikut', async () => {
  const A = await bootstrap(), d = deps();
  const keep = await saveImage(A.ctx, d, { bytes: jpeg(300, 8) }), gone = await saveImage(A.ctx, d, { bytes: jpeg(300, 9) });
  const { productId } = await createProduct(A.ctx, { name: 'PC', photoAttachmentId: keep.id });
  await createProduct(A.ctx, { name: 'Lampu', photoAttachmentId: gone.id }).then((r) => updateProduct(A.ctx, r.productId, { photoAttachmentId: null }));
  const file = await exportBackup(A.ctx, { password: 'Toko-Maju-2026!', runtime: nodeRuntime, source: { platform: 'server', appVersion: 't' }, kdf: { logN: 14, r: 8, p: 1 }, blobStore: d.blobStore });

  const db2 = newDb(), store2 = memoryBlobStore();
  const rep = await restoreBackup(db2, file, { password: 'Toko-Maju-2026!', runtime: nodeRuntime, mode: 'replace', blobStore: store2 });
  assert.equal(rep.blobsWritten, 1);
  const ctx2 = await loadCtx(db2, A.businessId, A.ownerId);
  const prod = (await listProducts(ctx2)).find((p) => p.productId === productId)!;
  assert.equal(prod.photoAttachmentId, keep.id);
  assert.deepEqual((await readImage(ctx2, store2, keep.id)).bytes, jpeg(300, 8));
});
