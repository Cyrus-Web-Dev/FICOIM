import test from 'node:test';
import assert from 'node:assert/strict';
import type { SaleDetail } from '@ficoim/core';
import { RECEIPT_WIDTH, buildReceiptText } from '../src/receipt';

const biz = { name: 'Toko Maju Jaya', address: 'Jl. Sudirman No. 12, Padang', phone: '0751-123456', receiptFooter: 'Terima kasih sudah berbelanja!' };
const sale = (o: Partial<SaleDetail> = {}): SaleDetail => ({
  id: 'x', number: 'PJ-202611-000002', at: '2026-11-07T14:05:00.000Z', party: 'Rina', total: 5_574_975, paid: 5_574_975, status: 'paid', receiptAttachmentId: null,
  subtotal: 5_032_500, discount: 10_000, tax: 552_475, note: null,
  items: [{ name: 'Ponsel X1 128GB', qtyMilli: 2000, unitPrice: 2_500_000, discount: 0, lineTotal: 5_000_000 }, { name: 'Kabel USB Type-C Fast Charging Panjang 2 Meter', qtyMilli: 1500, unitPrice: 25_000, discount: 5000, lineTotal: 32_500 }],
  ...o,
});

test('struk teks: isi lengkap, tanggal dalam zona bisnis (WIB), tidak ada baris melebihi lebar', () => {
  const t = buildReceiptText(biz, sale(), 420);
  assert.match(t, /TOKO MAJU JAYA/);
  assert.match(t, /Telp 0751-123456/);
  assert.match(t, /PJ-202611-000002/);
  assert.match(t, /7 Nov 2026 21:05/);              // 14:05 UTC = 21:05 WIB
  assert.match(t, /Pelanggan\s+Rina/);
  assert.match(t, /2 x 2\.500\.000\s+5\.000\.000/);
  assert.match(t, /1,5 x 25\.000/);
  assert.match(t, /Diskon\s+-5\.000/);              // diskon baris
  assert.match(t, /Diskon\s+-Rp 10\.000/);          // diskon pesanan
  assert.match(t, /PPN\s+Rp 552\.475/);
  assert.match(t, /TOTAL\s+Rp 5\.574\.975/);
  assert.match(t, /LUNAS/);
  assert.match(t, /Terima kasih sudah berbelanja!/);
  assert.doesNotMatch(t, /Sisa/);
  for (const line of t.split('\n')) assert.ok(line.length <= RECEIPT_WIDTH, `baris terlalu panjang (${line.length}): ${line}`);
});

test('struk: cicilan menampilkan sisa piutang; batal bertanda BATAL; tanpa pelanggan/PPN/footer tidak ada barisnya', () => {
  const t = buildReceiptText({ ...biz, receiptFooter: null, address: null, phone: null }, sale({ paid: 1_000_000, status: 'partial', party: null, tax: 0, discount: 0 }), 420);
  assert.match(t, /Sisa \(piutang\)\s+Rp 4\.574\.975/);
  assert.match(t, /CICILAN/);
  assert.doesNotMatch(t, /Pelanggan|PPN|Telp/);
  const v = buildReceiptText(biz, sale({ status: 'void', paid: 0 }), 420);
  assert.match(v, /BATAL/);
  assert.doesNotMatch(v, /Sisa/);
});

test('struk: nama sangat panjang / tanpa spasi dipotong, tidak pernah melampaui lebar', () => {
  const t = buildReceiptText({ ...biz, name: 'X'.repeat(80) }, sale({ items: [{ name: 'Y'.repeat(70), qtyMilli: 1000, unitPrice: 1000, discount: 0, lineTotal: 1000 }] }), 420);
  for (const line of t.split('\n')) assert.ok(line.length <= RECEIPT_WIDTH, line);
});

import { CODE39_PATTERNS, code39Modules, code39Text } from '../src/barcode';
import { buildReceiptModel } from '../src/receipt';

test('model struk: angka & teks sama dengan struk teks; sisa piutang hanya bila belum lunas', () => {
  const m = buildReceiptModel(biz, sale(), 420);
  assert.equal(m.totalText, 'Rp 5.574.975');
  assert.equal(m.statusLabel, 'LUNAS');
  assert.equal(m.dueText, null);
  assert.deepEqual(m.rows.map((r) => r.label), ['Subtotal', 'Diskon', 'PPN']);
  assert.equal(m.items[1]!.discountText, '-Rp 5.000');
  assert.equal(m.items[1]!.qtyText, '1,5');
  assert.equal(m.dateText, '7 Nov 2026 21:05');
  assert.equal(m.stampDate, '7 NOV 2026');
  const c = buildReceiptModel(biz, sale({ paid: 1_000_000, status: 'partial', tax: 0, discount: 0 }), 420);
  assert.equal(c.dueText, 'Rp 4.574.975');
  assert.deepEqual(c.rows.map((r) => r.label), ['Subtotal']);
  assert.equal(buildReceiptModel(biz, sale({ status: 'void', paid: 0 }), 420).dueText, null);
});

test('Code 39: tabel valid (44 karakter unik, tiap karakter 9 elemen dengan tepat 3 lebar); modul benar', () => {
  const keys = Object.keys(CODE39_PATTERNS);
  assert.equal(keys.length, 44);
  assert.equal(new Set(Object.values(CODE39_PATTERNS)).size, 44);
  for (const [k, p] of Object.entries(CODE39_PATTERNS)) {
    assert.equal(p.length, 9, k);
    assert.equal([...p].filter((c) => c === 'w').length, 3, `karakter ${k} harus punya tepat 3 elemen lebar`);
  }
  assert.equal(code39Text('pj-202611-000002'), 'PJ-202611-000002');
  assert.equal(code39Text('a_b#c'), 'A-B-C');
  // "A" dibungkus * : 3 karakter x 9 elemen + 2 jarak antar-karakter = 29 elemen; mulai & akhir = garis (indeks genap)
  const m = code39Modules('A');
  assert.equal(m.length, 29);
  assert.ok(m.every((w) => w === 1 || w === 3));
  assert.equal(code39Modules('PJ-1').length, 6 * 9 + 5);
});

test('struk teks: kertas 80 mm (42 kolom) dipakai bila diatur; semua baris ≤ 42; bawaan tetap 32', () => {
  const t = buildReceiptText({ ...biz, receiptCols: 42 }, sale(), 420);
  const lens = t.split('\n').map((l) => l.length);
  assert.ok(Math.max(...lens) <= 42 && Math.max(...lens) > 32, `maks ${Math.max(...lens)}`);
  assert.ok(t.split('\n').some((l) => l === '-'.repeat(42)));
  assert.ok(Math.max(...buildReceiptText({ ...biz, receiptCols: 99 }, sale(), 420).split('\n').map((l) => l.length)) <= 32); // nilai tak dikenal -> 32
  assert.equal(buildReceiptModel({ ...biz, logoAttachmentId: 'abc' }, sale(), 420).logoAttachmentId, 'abc');
  assert.equal(buildReceiptModel(biz, sale(), 420).logoAttachmentId, null);
});
