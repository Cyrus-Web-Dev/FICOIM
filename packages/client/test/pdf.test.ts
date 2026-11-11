import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPdf, formatId, textWidth } from '../src/pdf';

const dec = (b: Uint8Array) => new TextDecoder().decode(b);

test('textWidth: cocok dengan metrik Helvetica resmi (nilai acuan dari reportlab)', () => {
  assert.ok(Math.abs(textWidth('Hello World', 10, false) - 51.67) < 0.01);
  assert.ok(Math.abs(textWidth('Hello World', 10, true) - 55.56) < 0.01);
  assert.ok(Math.abs(textWidth('Rp 1.234.567,89 (Total) @ #', 10, false) - 126.88) < 0.01);
  assert.ok(Math.abs(textWidth('Rp 1.234.567,89 (Total) @ #', 10, true) - 128.69) < 0.01);
});

test('formatId: ribuan titik, desimal koma, negatif', () => {
  assert.equal(formatId(1234567), '1.234.567'); assert.equal(formatId(-5000), '-5.000'); assert.equal(formatId(0), '0');
  assert.equal(formatId(1.5, 3), '1,5'); assert.equal(formatId(1000.25, 3), '1.000,25'); assert.equal(formatId(2, 3), '2');
});

test('buildPdf: struktur valid (header, xref menunjuk objek yang benar, halaman bertambah, tabel kosong tetap sah)', () => {
  const rows = Array.from({ length: 80 }, (_, i) => [`Baris ${i}`, i * 1000]);
  const pdf = buildPdf([
    { name: 'A', title: 'Uji (A)', subtitle: 's', columns: [{ header: 'Nama' }, { header: 'Rp', kind: 'money' }], rows },
    { name: 'B', title: 'Kosong', columns: [{ header: 'X' }], rows: [] },
  ], { title: 'T', footer: 'kaki' });
  const s = dec(pdf);
  assert.ok(s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'));
  const pages = (s.match(/\/Type \/Page /g) ?? []).length;
  assert.ok(pages >= 3, `halaman ${pages}`);                      // 80 baris > 1 halaman + 1 halaman sheet kosong
  assert.match(s, new RegExp(`/Count ${pages}`));
  const xref = Number(/startxref\n(\d+)/.exec(s)![1]);
  assert.equal(s.slice(xref, xref + 4), 'xref');
  const entries = [...s.slice(xref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
  entries.forEach((off, i) => assert.equal(s.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `objek ${i + 1}`));
  assert.match(s, /Halaman 1 \/|<486[0-9a-f]/); // kaki halaman ada (heksadesimal)
});

test('buildPdf: teks berbahaya tidak merusak berkas (tanda kurung, backslash, emoji, panjang sekali)', () => {
  const evil = ')(\\ ☕ ' + 'x'.repeat(500);
  const s = dec(buildPdf([{ name: 'E', title: evil, columns: [{ header: evil }], rows: [[evil]] }], { title: evil, footer: evil }));
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.doesNotMatch(s.split('stream')[1] ?? '', /\)\(\\/); // semua teks heksadesimal, tidak ada string literal mentah
});
