import test from 'node:test';
import assert from 'node:assert/strict';
import { formatQty, formatRupiah, lineTotal, parseRupiah, percentBp, qtyToMilli } from '../src/money';
import { isUuid, uuidv7 } from '../src/ids';
import { utf8DecodeJs, utf8EncodeJs } from '../src/utf8';
import { checkBackupPassword } from '../src/password';

test('uang: format & parse Rupiah', () => {
  assert.equal(formatRupiah(1250000), 'Rp 1.250.000');
  assert.equal(formatRupiah(-5000), '-Rp 5.000');
  assert.equal(formatRupiah(0), 'Rp 0');
  assert.equal(formatRupiah(999, { symbol: false }), '999');
  assert.equal(parseRupiah('Rp 1.250.000'), 1250000);
  assert.equal(parseRupiah('1250000'), 1250000);
  assert.equal(parseRupiah('12,50'), null); // desimal ditolak
  assert.equal(parseRupiah('abc'), null);
  assert.throws(() => formatRupiah(1.5));
});

test('qty milli: konversi, format, dan total baris tanpa floating point', () => {
  assert.equal(qtyToMilli('1,5'), 1500);
  assert.equal(qtyToMilli(2), 2000);
  assert.equal(qtyToMilli('0.001'), 1);
  assert.equal(qtyToMilli('1,2345'), null);
  assert.equal(qtyToMilli(0.1 + 0.2), 300); // 0.30000000000000004 tetap dikenali sebagai 0,3
  assert.equal(formatQty(1500), '1,5');
  assert.equal(formatQty(2000), '2');
  assert.equal(formatQty(1_234_567), '1.234,567');
  assert.equal(lineTotal(1500, 20000), 30000);   // 1,5 kg x 20.000
  assert.equal(lineTotal(333, 1000), 333);
  assert.equal(lineTotal(1, 1500), 2);           // 1,5 dibulatkan ke 2 (setengah naik)
  assert.throws(() => lineTotal(2 ** 40, 2 ** 20)); // meluap -> error, bukan angka salah
  assert.equal(percentBp(1_000_000, 1100), 110_000); // PPN 11%
});

test('uuid v7: format, versi, urut waktu, unik', () => {
  const a = uuidv7(1_700_000_000_000);
  const b = uuidv7(1_700_000_000_001);
  assert.ok(isUuid(a));
  assert.equal(a[14], '7');
  assert.ok('89ab'.includes(a[19] as string));
  assert.ok(a < b, 'ID yang dibuat belakangan harus lebih besar secara leksikografis');
  assert.equal(new Set(Array.from({ length: 5000 }, () => uuidv7())).size, 5000);
  assert.ok(!isUuid('ABCDEF00-0000-7000-8000-000000000000')); // huruf besar ditolak (kanonik = huruf kecil)
});

test('uuid v7: monoton ketat — urutan pembuatan = urutan leksikografis, juga dalam milidetik yang sama & saat jam mundur', () => {
  const ids = Array.from({ length: 20_000 }, () => uuidv7(1_800_000_000_000)); // semua "ms" sama -> penghitung meluap & maju ke ms berikut
  for (let i = 1; i < ids.length; i++) assert.ok((ids[i - 1] as string) < (ids[i] as string), `tidak monoton di ${i}`);
  assert.ok(isUuid(ids[0]) && isUuid(ids[19_999]));
  const later = uuidv7(1_700_000_000_000); // jam mundur
  assert.ok((ids[19_999] as string) < later);
});

test('utf8: fallback JS identik dengan TextEncoder (termasuk emoji)', () => {
  const s = 'Kata sandi: é ñ 日本語 🔐🙏 ٣٤';
  assert.deepEqual(utf8EncodeJs(s), new TextEncoder().encode(s));
  assert.equal(utf8DecodeJs(new TextEncoder().encode(s)), s);
});

test('kata sandi backup: aturan kekuatan', () => {
  assert.equal(checkBackupPassword('abc').ok, false);
  assert.equal(checkBackupPassword('12345678').ok, false);
  assert.equal(checkBackupPassword('password123').ok, false);
  assert.equal(checkBackupPassword('aaaaaaaaaaaa').ok, false);
  assert.equal(checkBackupPassword('Toko-Maju-2026!').ok, true);
  assert.ok(checkBackupPassword('Toko-Maju-2026!').score >= 3);
});
