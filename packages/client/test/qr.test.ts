import test from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix, qrSvgPath } from '../src/qr';

const text = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(48 + (i % 40))).join('');

test('QR: ukuran sesuai versi untuk batas kapasitas byte (level M)', () => {
  const cases: [number, number][] = [[1, 21], [14, 21], [15, 25], [26, 25], [27, 29], [42, 29], [43, 33], [62, 33], [63, 37], [84, 37], [85, 41], [106, 41], [107, 45], [122, 45], [123, 49], [152, 49], [153, 53], [180, 53], [181, 57], [213, 57]];
  for (const [n, size] of cases) { const m = qrMatrix(text(n)); assert.equal(m.length, size, `${n} byte`); assert.ok(m.every((r) => r.length === size)); }
});

test('QR: pola finder di tiga sudut, timing, modul gelap tetap; deterministik; UTF-8', () => {
  const m = qrMatrix('FIC-A1B2C3'), n = m.length;
  const finder = (x: number, y: number) => { for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) { const edge = dx === 0 || dx === 6 || dy === 0 || dy === 6, core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4; assert.equal(m[y + dy]![x + dx], edge || core); } };
  finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
  for (let i = 8; i < n - 8; i++) { assert.equal(m[6]![i], i % 2 === 0); assert.equal(m[i]![6], i % 2 === 0); }
  assert.equal(m[n - 8]![8], true);
  assert.deepEqual(qrMatrix('FIC-A1B2C3'), m);
  assert.notDeepEqual(qrMatrix('FIC-A1B2C4'), m);
  assert.ok(qrMatrix('Kopi ☕ — Rp 15.000').length >= 21);
});

test('QR: menolak kosong & terlalu panjang; path SVG valid', () => {
  assert.throws(() => qrMatrix(''), /kosong/);
  assert.throws(() => qrMatrix(text(214)), /terlalu panjang/);
  const { d, size } = qrSvgPath(qrMatrix('A'), 4);
  assert.equal(size, 29);
  assert.match(d, /^M\d+ \d+h\d+v1h-\d+z/);
});
