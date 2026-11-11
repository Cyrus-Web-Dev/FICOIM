import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { nodeRuntime } from '@ficoim/shared/backup/runtime-node';
import { memoryBlobStore } from '@ficoim/core';
import { LocalBackend } from '../src/local';
import { buildXlsx, colLetter, crc32, sheetName, zipStore, buildReportWorkbook, fetchAll, localDateTime, todayLocal } from '../src/index';
import { newDb } from '../../core/test/helpers';

/** Pembaca ZIP independen (hanya "stored") untuk memeriksa keluaran penulis. */
function readZip(z: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  let e = z.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  assert.ok(e >= 0, 'EOCD tidak ditemukan');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < n; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(z.subarray(p + 46, p + 46 + nl));
    assert.equal(dv.getUint32(off, true), 0x04034b50);
    const lnl = dv.getUint16(off + 26, true), lxl = dv.getUint16(off + 28, true);
    const data = z.subarray(off + 30 + lnl + lxl, off + 30 + lnl + lxl + size);
    assert.equal(crc32(data), crc, `CRC ${name}`);
    out.set(name, data); p += 46 + nl + xl + cl;
  }
  return out;
}

test('crc32: vektor standar; ZIP stored dapat dibaca ulang dengan CRC benar', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const files = readZip(zipStore([{ name: 'a.txt', data: new TextEncoder().encode('halo') }, { name: 'dir/é.txt', data: new Uint8Array(0) }]));
  assert.equal(new TextDecoder().decode(files.get('a.txt')), 'halo');
  assert.ok(files.has('dir/é.txt'));
});

test('colLetter & sheetName: A..Z, AA..; nama dibersihkan, dipotong 31, unik', () => {
  assert.deepEqual([0, 25, 26, 27, 701, 702].map(colLetter), ['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  const used = new Set<string>();
  assert.equal(sheetName('Laba/Rugi: [2026]', used), 'Laba Rugi 2026');
  assert.equal(sheetName('laba rugi 2026', used), 'laba rugi 2026 (2)');
  assert.equal(sheetName('x'.repeat(50), used).length, 31);
  assert.equal(sheetName('', used), 'Sheet');
});

test('buildXlsx: struktur paket lengkap; teks dilepas (XML & kontrol); angka asli; rumus tidak dieksekusi', () => {
  const z = readZip(buildXlsx([{ name: 'Uji', title: 'Judul <&>', subtitle: 'sub', columns: [{ header: 'Nama' }, { header: 'Rp', kind: 'money' }], rows: [['=1+1 "x" & <b>', 1234567], ['ctrl\u0001char', null]], boldRows: [1] }]));
  for (const f of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) assert.ok(z.has(f), f);
  const sheet = new TextDecoder().decode(z.get('xl/worksheets/sheet1.xml'));
  assert.match(sheet, /Judul &lt;&amp;&gt;/);
  assert.match(sheet, /=1\+1 &quot;x&quot; &amp; &lt;b&gt;/);      // teks, bukan <f>
  assert.doesNotMatch(sheet, /<f>/);
  assert.match(sheet, /<v>1234567<\/v>/);
  assert.doesNotMatch(sheet, /\u0001/);
  assert.match(sheet, /state="frozen"/);
  assert.throws(() => buildXlsx([]));
});

test('fetchAll mengambil semua halaman & berhenti di halaman terakhir/batas', async () => {
  const data = Array.from({ length: 1230 }, (_, i) => i);
  let calls = 0;
  const all = await fetchAll(async (l, o) => { calls++; return data.slice(o, o + l); }, 500);
  assert.equal(all.length, 1230); assert.equal(calls, 3);
  assert.equal((await fetchAll(async (l, o) => data.slice(o, o + l), 500, 700)).length, 700);
  assert.equal(localDateTime('2026-11-07T14:05:00.000Z', 420), '2026-11-07 21:05');
});

test('laporan Excel dari data nyata: 8 sheet, angka cocok dengan laporan, nama berkas aman', async () => {
  const b = new LocalBackend({ db: newDb(), runtime: nodeRuntime, appVersion: 't', blobStore: memoryBlobStore() });
  await b.createBusiness({ name: 'Toko "Maju" & Jaya', businessType: 'elektronik', ownerName: 'Budi', openingCash: 1_000_000 });
  const p = await b.createProduct({ name: 'Kabel', variants: [{ costPrice: 8000, sellPrice: 25_000, openingQtyMilli: 40_000 }] });
  const cu = await b.createCustomer({ name: 'Rina' });
  await b.createSale({ items: [{ variantId: p.variantIds[0]!, qtyMilli: 2000 }] });
  await b.createSale({ items: [{ variantId: p.variantIds[0]!, qtyMilli: 1000 }], customerId: cu, paid: 10_000 });
  const today = todayLocal();
  const out = await buildReportWorkbook(b, { from: today, to: today, tzOffsetMinutes: 420, businessName: 'Toko "Maju" & Jaya' });
  assert.equal(out.sheets, 8);
  assert.match(out.fileName, /^FICOIM-laporan-toko-maju-jaya-\d{4}-\d\d-\d\d_\d{4}-\d\d-\d\d\.xlsx$/);
  const z = readZip(out.bytes);
  const wb = new TextDecoder().decode(z.get('xl/workbook.xml'));
  for (const nm of ['Laba Rugi', 'Penjualan', 'Penjualan Harian', 'Produk Terlaris', 'Pembelian', 'Kas', 'Hutang Piutang', 'Persediaan']) assert.ok(wb.includes(`name="${nm}"`), nm);
  const sales = new TextDecoder().decode(z.get('xl/worksheets/sheet2.xml'));
  assert.match(sales, /<v>50000<\/v>/);  // total penjualan #1 (2 x 25.000)
  assert.match(sales, /Rina/);
  const pl = new TextDecoder().decode(z.get('xl/worksheets/sheet1.xml'));
  assert.match(pl, /LABA BERSIH/);
  if (process.env.WRITE_XLSX) writeFileSync(process.env.WRITE_XLSX, out.bytes);
});
