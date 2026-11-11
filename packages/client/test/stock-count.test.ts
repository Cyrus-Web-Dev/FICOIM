import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeRuntime } from '@ficoim/shared/backup/runtime-node';
import { memoryBlobStore } from '@ficoim/core';
import { LocalBackend } from '../src/local';
import { applyCount, buildCountSheetXlsx, describeDiff, fetchAll, mapCountRows, planCount, readXlsx } from '../src/index';
import { newDb } from '../../core/test/helpers';

async function setup() {
  const b = new LocalBackend({ db: newDb(), runtime: nodeRuntime, appVersion: 't', blobStore: memoryBlobStore() });
  await b.createBusiness({ name: 'Toko', businessType: 'elektronik', ownerName: 'Budi', openingCash: 0 });
  await b.createProduct({ name: 'Kabel', variants: [{ sku: 'KBL', barcode: '8991', costPrice: 8000, sellPrice: 25_000, openingQtyMilli: 40_000 }] });
  await b.createProduct({ name: 'Kaos', variants: [{ name: 'Hitam M', sku: 'KP-M', sellPrice: 65_000, openingQtyMilli: 12_000 }, { name: 'Hitam L', sku: 'KP-L', sellPrice: 65_000, openingQtyMilli: 8_000 }] });
  await b.createProduct({ name: 'Servis', trackStock: false, variants: [{ sku: 'SRV', sellPrice: 50_000 }] });
  const variants = await fetchAll((limit, offset) => b.listProducts({ limit, offset }), 500);
  return { b, variants };
}

test('mapCountRows: header di bawah judul, alias, angka format Indonesia, kosong ≠ 0, galat per baris', () => {
  const rows = mapCountRows([['Judul'], [], ['Nama', 'SKU', 'Barcode', 'Stok Sistem', 'Stok Fisik'], ['Kabel', 'KBL', '', 40, 35], ['Kaos', 'kp-m', '', 12, '8,5'], ['X', 'KP-L', '', 8, null], ['Y', 'Z', '', 1, 'abc'], ['W', 'W', '', 1, 0]]);
  assert.deepEqual(rows.map((r) => [r.line, r.counted]), [[4, 35_000], [5, 8500], [6, null], [7, null], [8, 0]]);
  assert.match(rows[3]!.errors.join(), /tidak valid/);
  assert.throws(() => mapCountRows([['Nama', 'Harga'], ['a', 1]]), /Stok Fisik/);
});

test('planCount: cocok lewat SKU atau barcode (tanpa beda huruf), selisih, dilewati/tak berubah, kode asing, kembar, jasa', async () => {
  const { variants } = await setup();
  const rows = mapCountRows([['SKU', 'Barcode', 'Stok Fisik'],
    ['kbl', '', 35],          // SKU huruf kecil, selisih -5
    ['', '8991', 40],          // barcode, sama persis dengan stok sistem -> tak berubah, tapi barcode kembar dengan baris 1 (produk sama)
    ['KP-M', '', 12],          // tak berubah
    ['KP-L', '', ''],          // kosong -> dilewati
    ['NOPE', '', 3],           // tidak ditemukan
    ['SRV', '', 1]]);          // jasa
  const plan = planCount(rows, variants);
  assert.equal(plan.skippedBlank, 1);
  const by = Object.fromEntries(plan.items.map((i) => [i.line, i]));
  assert.deepEqual([by[2]!.name, by[2]!.system, by[2]!.counted, by[2]!.diff, by[2]!.errors], ['Kabel', 40_000, 35_000, -5000, []]);
  assert.match(by[3]!.errors.join(), /sudah ada di baris 2/);
  assert.deepEqual([by[4]!.name, by[4]!.diff, by[4]!.errors], ['Kaos Hitam M', 0, []]);
  assert.match(by[6]!.errors.join(), /tidak ditemukan/);
  assert.match(by[7]!.errors.join(), /jasa/);
  assert.equal(plan.unchanged, 1);
  assert.equal(describeDiff(-5000, 'pcs'), '−5 pcs'); assert.equal(describeDiff(1500, 'kg'), '+1,5 kg'); assert.equal(describeDiff(0, 'pcs'), 'sama');
});

test('applyCount: stok menjadi sama dengan hitungan, tercatat sebagai opname di kartu stok; yang tak berubah/galat tidak disentuh', async () => {
  const { b, variants } = await setup();
  const plan = planCount(mapCountRows([['SKU', 'Stok Fisik'], ['KBL', 35], ['KP-M', 12], ['KP-L', '10,5'], ['NOPE', 1]]), variants);
  const progress: number[] = [];
  const res = await applyCount(b, plan.items, 'Opname akhir bulan', (d) => progress.push(d));
  assert.deepEqual([res.updated, res.failed.length], [2, 0]);   // Kabel & Kaos L; Kaos M tak berubah; NOPE galat
  assert.deepEqual(progress, [1, 2]);
  const after = await fetchAll((limit, offset) => b.listProducts({ limit, offset }), 500);
  const st = Object.fromEntries(after.map((v) => [v.sku, v.stockQtyMilli]));
  assert.deepEqual([st.KBL, st['KP-M'], st['KP-L']], [35_000, 12_000, 10_500]);
  const kabel = after.find((v) => v.sku === 'KBL')!;
  const card = await b.stockCard(kabel.id);
  assert.ok(card.some((m) => m.type === 'opname' && m.deltaMilli === -5000 && m.note === 'Opname akhir bulan'));
});

test('daftar hitung: berkas .xlsx berisi produk yang melacak stok, Stok Fisik kosong, dan bisa dibaca ulang oleh pemetaan', async () => {
  const { variants } = await setup();
  const t = await readXlsx(buildCountSheetXlsx(variants));
  const header = t.find((r) => r.includes('Stok Fisik'))!;
  assert.deepEqual(header, ['Nama', 'SKU', 'Barcode', 'Satuan', 'Stok Sistem', 'Stok Fisik', 'ID']);
  const rows = mapCountRows(t);
  assert.equal(rows.length, 3);                       // jasa tidak ikut
  assert.ok(rows.every((r) => r.counted === null));   // belum ada yang dihitung
  assert.equal(planCount(rows, variants).skippedBlank, 3);
});

test('produk tanpa SKU/barcode dicocokkan lewat kolom ID dari daftar hitung (roundtrip penuh)', async () => {
  const { b } = await setup();
  await b.createProduct({ name: 'Tanpa Kode', variants: [{ sellPrice: 1000, openingQtyMilli: 5000 }] });
  const variants = await fetchAll((limit, offset) => b.listProducts({ limit, offset }), 500);
  const target = variants.find((v) => v.productName === 'Tanpa Kode')!;
  const t = (await readXlsx(buildCountSheetXlsx(variants))).map((r) => [...r]);
  const hi = t.findIndex((r) => r.includes('Stok Fisik')), fi = t[hi]!.indexOf('Stok Fisik');
  t.forEach((r, i) => { if (i > hi && r[0] === 'Tanpa Kode') r[fi] = 9; });
  const plan = planCount(mapCountRows(t), variants);
  assert.equal(plan.items.length, 1);
  assert.deepEqual([plan.items[0]!.variantId, plan.items[0]!.errors, plan.items[0]!.diff], [target.id, [], 4000]);
  assert.equal((await applyCount(b, plan.items, '')).updated, 1);
  assert.equal((await fetchAll((l, o) => b.listProducts({ limit: l, offset: o }), 500)).find((v) => v.id === target.id)!.stockQtyMilli, 9000);
  // ID palsu tidak cocok ke produk lain
  const bad = planCount(mapCountRows([['ID', 'Stok Fisik'], ['00000000-0000-7000-8000-000000000000', 1]]), variants);
  assert.match(bad.items[0]!.errors.join(), /tidak ditemukan/);
});
