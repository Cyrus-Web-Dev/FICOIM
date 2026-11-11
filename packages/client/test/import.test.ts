import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nodeRuntime } from '@ficoim/shared/backup/runtime-node';
import { memoryBlobStore } from '@ficoim/core';
import { LocalBackend } from '../src/local';
import { IMPORT_HEADERS, buildImportTemplateCsv, buildImportTemplateXlsx, mapRows, parseCsv, readTable, readXlsx, runImport } from '../src/index';
import { newDb } from '../../core/test/helpers';

const fixture = () => new Uint8Array(Buffer.from(readFileSync(new URL('./fixture-import.b64.txt', import.meta.url), 'utf8'), 'base64'));
const newLocal = async () => { const b = new LocalBackend({ db: newDb(), runtime: nodeRuntime, appVersion: 't', blobStore: memoryBlobStore() }); await b.createBusiness({ name: 'Toko', businessType: 'elektronik', ownerName: 'Budi', openingCash: 0 }); return b; };

test('parseCsv: titik-koma/koma/tab, kutip & kutip ganda, newline dalam sel, BOM, nomor baris tetap', () => {
  assert.deepEqual(parseCsv('\uFEFFNama;Harga\r\n"Kabel; ""C""";25.000\r\n\r\nPaku;1,5\n'), [['Nama', 'Harga'], ['Kabel; "C"', '25.000'], [], ['Paku', '1,5']]);
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a\tb\n"x\ny"\t2'), [['a', 'b'], ['x\ny', '2']]);
});

test('readXlsx: berkas dari openpyxl (deflate + sharedStrings + angka + sel kosong), nomor baris = nomor di Excel', async () => {
  const t = await readXlsx(fixture());
  assert.deepEqual(t[0], ['Daftar barang toko']); assert.deepEqual(t[1], []);
  assert.deepEqual(t[2]!.slice(0, 4), ['Nama Produk', 'Varian', 'Kategori', 'SKU']);
  assert.equal(t[3]![0], 'Kabel "USB" <C> & Co');     // entitas XML dilepas
  assert.equal(t[3]![4], 8000); assert.equal(typeof t[3]![4], 'number');
  assert.equal(t[4]![4], '35.000');                    // teks tetap teks
  assert.equal(t[5]![6], 8.5);
});

test('readXlsx: membaca berkas buatan penulis FICOIM (stored); menolak sampah/rusak', async () => {
  const t = await readXlsx(buildImportTemplateXlsx());
  assert.deepEqual(t[3], IMPORT_HEADERS); assert.equal(t[4]![0], 'Kabel USB-C 2m');
  await assert.rejects(readXlsx(new Uint8Array([1, 2, 3, 4])), /xlsx/i);
  const bad = buildImportTemplateXlsx(); bad[bad.length - 30] = 0; // merusak direktori akhir
  await assert.rejects(readXlsx(bad));
});

test('mapRows: header dicari di bawah judul; alias kolom; angka format Indonesia; kesalahan per baris; duplikat dalam berkas', async () => {
  const p = mapRows(await readXlsx(fixture()));
  assert.deepEqual(p.unknownHeaders, ['Kolom Asing']);
  assert.equal(p.rows.length, 5);                       // baris kosong dilewati
  const [kabel, m, l, beras, tph] = p.rows as [typeof p.rows[0], ...typeof p.rows];
  assert.deepEqual([kabel!.line, kabel!.name, kabel!.costPrice, kabel!.sellPrice, kabel!.stockMilli, kabel!.errors], [4, 'Kabel "USB" <C> & Co', 8000, 25000, 40_000, []]);
  assert.deepEqual([m!.costPrice, m!.sellPrice, m!.variant], [35000, 65000, 'Hitam M']);   // "35.000" -> 35000
  assert.equal(l!.stockMilli, 8500);
  assert.match(beras!.errors.join('|'), /Harga beli/);  // 12000.5 bukan Rupiah bulat
  assert.equal(beras!.stockMilli, 1500);                // "1,5"
  assert.deepEqual([tph!.errors, tph!.sellPrice], [[], 0]); // harga kosong = 0, bukan galat
  const dup = mapRows([['Nama', 'SKU'], ['A', 'x1'], ['B', 'X1'], ['', '']]);
  assert.match(dup.rows[1]!.errors.join(), /SKU "X1" kembar dengan baris 2/);
  assert.throws(() => mapRows([['foo', 'bar'], ['1', '2']]), /Nama/);
  assert.throws(() => mapRows([['Nama']]), /data/i);
});

test('readTable memilih pembaca dari isi/nama; template CSV bisa dibaca ulang', async () => {
  const csv = new TextEncoder().encode(buildImportTemplateCsv());
  const t = await readTable(csv, 'template.csv');
  assert.deepEqual(t[0], IMPORT_HEADERS);
  assert.equal(mapRows(t).rows.length, 4);
  assert.equal(mapRows(await readTable(fixture(), 'apa-saja.bin')).rows.length, 5);  // dikenali dari isi ZIP
  await assert.rejects(readTable(new Uint8Array([1]), 'lama.xls'), /xls/);
});

test('runImport: produk & varian dibuat, kategori baru dibuat sekali, stok awal tercatat, baris gagal dilaporkan tanpa membatalkan yang lain', async () => {
  const b = await newLocal();
  await b.createProduct({ name: 'Sudah Ada', variants: [{ sku: 'KBL-1', sellPrice: 1 }] });   // SKU bentrok dengan baris Kabel
  const parsed = mapRows(await readXlsx(fixture()));
  const progress: number[] = [];
  const res = await runImport(b, parsed.rows, (d) => progress.push(d));
  // valid: Kabel (SKU bentrok -> gagal), Kaos (2 varian -> 1 produk), Tanpa Harga ; Beras punya galat -> dilewati
  assert.deepEqual([res.products, res.variants, res.categoriesCreated], [2, 3, 1]); // 'Aksesoris' sudah bawaan jenis usaha; hanya 'Fashion' yang baru
  assert.equal(res.failed.length, 1); assert.equal(res.failed[0]!.line, 4); assert.match(res.failed[0]!.message, /KBL-1/);
  assert.equal(progress.at(-1), 4);
  const list = await b.listProducts({});
  const kaos = list.filter((v) => v.productName === 'Kaos Polos');
  assert.deepEqual(kaos.map((v) => [v.variantName, v.stockQtyMilli, v.sellPrice, v.categoryName]).sort(), [['Hitam L', 8500, 65000, 'Fashion'], ['Hitam M', 12000, 65000, 'Fashion']]);
  assert.equal(list.find((v) => v.productName === 'Tanpa Harga')!.sellPrice, 0);
  assert.equal((await b.listProductCategories()).filter((c) => c.name === 'Fashion').length, 1);
});
