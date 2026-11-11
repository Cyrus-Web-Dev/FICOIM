import { parseRupiah, qtyToMilli } from '@ficoim/shared';
import type { Backend } from './backend';
import { errorMessage } from './format';
import { buildXlsx, type ExportSheet } from './xlsx';

export type RawCell = string | number | null;

// ------------------------------------------------------------------ CSV
/** CSV (koma/titik-koma/tab, kutip ganda, BOM). Pemisah dideteksi dari baris pertama — Excel Indonesia menyimpan CSV dengan titik-koma. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (c: string) => (first.match(new RegExp(c === '\t' ? '\\t' : `\\${c}`, 'g')) ?? []).length;
  const delim = [';', ',', '\t'].reduce((best, c) => (count(c) > count(best) ? c : best), ',');
  const rows: string[][] = []; let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"' && cur === '') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row.some((c) => c.trim() !== '') ? row : []); row = []; } // baris kosong dipertahankan agar nomor baris tetap sama dengan berkas
    else cur += ch;
  }
  row.push(cur); if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

// ------------------------------------------------------------------ XLSX (pembaca)
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const colIndex = (ref: string): number => { let n = 0; for (const ch of /^[A-Z]+/.exec(ref)![0]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('Peramban/perangkat ini tidak bisa membuka .xlsx terkompresi. Simpan file sebagai CSV lalu coba lagi.');
  const stream = new Blob([data.slice().buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Membaca ZIP (stored/deflate) lewat direktori pusat. Ukuran dibatasi agar berkas jahat tidak menghabiskan memori. */
async function unzip(z: Uint8Array, wanted: (name: string) => boolean, maxBytes = 20_000_000): Promise<Map<string, Uint8Array>> {
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  let e = z.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Berkas bukan .xlsx yang valid.');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  const out = new Map<string, Uint8Array>(); let total = 0;
  for (let i = 0; i < n; i++) {
    if (p + 46 > z.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('Berkas .xlsx rusak.');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec(z.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
    if (!wanted(name)) continue;
    total += usize; if (total > maxBytes) throw new Error('Berkas .xlsx terlalu besar.');
    const lnl = dv.getUint16(off + 26, true), lxl = dv.getUint16(off + 28, true), start = off + 30 + lnl + lxl;
    const raw = z.subarray(start, start + csize);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, await inflateRaw(raw));
    else throw new Error('Metode kompresi .xlsx tidak didukung.');
  }
  return out;
}

/** Sheet pertama sebuah .xlsx -> baris sel (teks atau angka). Rumus tidak dihitung (dibaca nilai terakhirnya). */
export async function readXlsx(bytes: Uint8Array): Promise<RawCell[][]> {
  const files = await unzip(bytes, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  const wb = files.get('xl/workbook.xml'); if (!wb) throw new Error('Berkas bukan .xlsx yang valid.');
  const rels = dec(files.get('xl/_rels/workbook.xml.rels') ?? new Uint8Array());
  const firstSheet = /<sheet\b[^>]*r:id="([^"]+)"/.exec(dec(wb))?.[1];
  const target = firstSheet ? new RegExp(`<Relationship\\b[^>]*Id="${firstSheet}"[^>]*>`).exec(rels)?.[0].match(/Target="([^"]+)"/)?.[1] : undefined;
  const sheetPath = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target}`) : 'xl/worksheets/sheet1.xml';
  const sheet = files.get(sheetPath); if (!sheet) throw new Error('Sheet pertama tidak ditemukan.');

  const shared: string[] = [];
  const ss = files.get('xl/sharedStrings.xml');
  if (ss) for (const m of dec(ss).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(unesc([...m[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));

  const rows: RawCell[][] = [];
  for (const rm of dec(sheet).matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const row: RawCell[] = [];
    const rowNo = Number(/\br="(\d+)"/.exec(rm[1]!)?.[1] ?? rows.length + 1);
    if (rowNo > 100_000) continue;
    for (const cm of rm[2]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]!, body = cm[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1]; if (!ref) continue;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let val: RawCell = null;
      if (type === 's') val = v !== undefined ? shared[Number(v)] ?? null : null;
      else if (type === 'inlineStr') val = unesc([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
      else if (type === 'str') val = v !== undefined ? unesc(v) : null;
      else if (type === 'b') val = v === '1' ? 'ya' : 'tidak';
      else if (v !== undefined && v !== '') { const num = Number(v); val = Number.isFinite(num) ? num : unesc(v); }
      row[colIndex(ref)] = val;
    }
    while (rows.length < rowNo - 1) rows.push([]); // baris kosong dipertahankan: nomor baris = nomor di Excel
    rows[rowNo - 1] = Array.from(row, (c) => c ?? null);
  }
  return rows;
}

// ------------------------------------------------------------------ pemetaan kolom & validasi
export interface ImportRow {
  /** Nomor baris di berkas (sama dengan nomor baris di Excel). */
  line: number; name: string; variant: string; category: string; brand: string; unit: string; sku: string; barcode: string;
  costPrice: number; sellPrice: number; stockMilli: number; minStockMilli: number; errors: string[];
}
type Field = 'name' | 'variant' | 'category' | 'brand' | 'unit' | 'sku' | 'barcode' | 'cost' | 'sell' | 'stock' | 'min';
const ALIASES: Record<Field, string[]> = {
  name: ['nama', 'namaproduk', 'produk', 'namabarang', 'barang', 'name', 'productname', 'product', 'item'],
  variant: ['varian', 'variant', 'ukuranwarna', 'tipe'],
  category: ['kategori', 'category', 'jenis'],
  brand: ['merek', 'merk', 'brand'],
  unit: ['satuan', 'unit', 'uom'],
  sku: ['sku', 'kode', 'kodeproduk', 'kodebarang', 'code'],
  barcode: ['barcode', 'kodebarcode', 'ean', 'upc'],
  cost: ['hargabeli', 'hargamodal', 'modal', 'hargapokok', 'hpp', 'cost', 'costprice', 'buyprice'],
  sell: ['hargajual', 'harga', 'price', 'sellprice', 'hargaeceran'],
  stock: ['stok', 'stock', 'stokawal', 'qty', 'jumlah', 'quantity'],
  min: ['stokminimum', 'minstok', 'stokmin', 'minimum', 'min', 'minstock', 'batasstok'],
};
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export interface ParsedImport { rows: ImportRow[]; mapped: Field[]; unknownHeaders: string[] }

function toMoney(v: RawCell, label: string, errors: string[]): number {
  if (v === null || v === undefined || String(v).trim() === '') return 0;
  if (typeof v === 'number') { if (Number.isInteger(v) && v >= 0) return v; errors.push(`${label} harus bilangan bulat Rupiah ≥ 0`); return 0; }
  const n = parseRupiah(v);
  if (n === null || n < 0) { errors.push(`${label} "${v}" tidak valid`); return 0; }
  return n;
}
function toQty(v: RawCell, label: string, errors: string[]): number {
  if (v === null || v === undefined || String(v).trim() === '') return 0;
  const m = qtyToMilli(typeof v === 'number' ? v : String(v));
  if (m === null || m < 0) { errors.push(`${label} "${v}" tidak valid`); return 0; }
  return m;
}
const txt = (v: RawCell): string => (v === null || v === undefined ? '' : String(typeof v === 'number' ? v : v).trim());

/** Header dicari di 15 baris pertama (template punya judul di atasnya). Kolom dikenali dari nama (huruf besar/kecil & tanda baca diabaikan); wajib ada kolom nama. */
export function mapRows(table: RawCell[][]): ParsedImport {
  const hi = table.findIndex((r, i) => i < 15 && r.some((c) => ALIASES.name.includes(norm(c))));
  if (hi < 0) throw new Error('Kolom "Nama" tidak ditemukan di baris awal berkas. Unduh template untuk melihat format yang benar.');
  const header = table[hi]!.map(norm);
  const col = {} as Partial<Record<Field, number>>;
  (Object.keys(ALIASES) as Field[]).forEach((f) => { const i = header.findIndex((h) => h && ALIASES[f].includes(h)); if (i >= 0) col[f] = i; });
  const known = new Set(Object.values(col));
  const unknownHeaders = table[hi]!.map((h, i) => (known.has(i) || !txt(h) ? null : txt(h))).filter((x): x is string => !!x);
  const get = (r: RawCell[], f: Field) => (col[f] === undefined ? null : r[col[f]!] ?? null);
  const rows: ImportRow[] = table.map((r, i) => ({ r, i })).slice(hi + 1).filter(({ r }) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== '')).map(({ r, i }) => {
    const errors: string[] = [];
    const name = txt(get(r, 'name'));
    if (!name) errors.push('Nama produk kosong'); else if (name.length > 120) errors.push('Nama produk terlalu panjang (maks 120)');
    const row: ImportRow = {
      line: i + 1, name, variant: txt(get(r, 'variant')), category: txt(get(r, 'category')), brand: txt(get(r, 'brand')), unit: txt(get(r, 'unit')),
      sku: txt(get(r, 'sku')), barcode: txt(get(r, 'barcode')),
      costPrice: toMoney(get(r, 'cost'), 'Harga beli', errors), sellPrice: toMoney(get(r, 'sell'), 'Harga jual', errors),
      stockMilli: toQty(get(r, 'stock'), 'Stok', errors), minStockMilli: toQty(get(r, 'min'), 'Stok minimum', errors), errors,
    };
    return row;
  });
  // SKU/barcode kembar di dalam berkas yang sama
  for (const key of ['sku', 'barcode'] as const) {
    const seen = new Map<string, number>();
    for (const r of rows) { const v = r[key].toLowerCase(); if (!v) continue; const prev = seen.get(v); if (prev !== undefined) r.errors.push(`${key === 'sku' ? 'SKU' : 'Barcode'} "${r[key]}" kembar dengan baris ${prev}`); else seen.set(v, r.line); }
  }
  if (rows.length === 0) throw new Error('Tidak ada baris data di bawah header.');
  return { rows, mapped: Object.keys(col) as Field[], unknownHeaders };
}

/** Berkas (CSV/XLSX) -> tabel mentah, dipilih dari nama berkas / isi. */
export async function readTable(bytes: Uint8Array, fileName: string): Promise<RawCell[][]> {
  const isZip = bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip || /\.xlsx$/i.test(fileName)) return readXlsx(bytes);
  if (/\.xls$/i.test(fileName)) throw new Error('Format .xls lama tidak didukung. Simpan sebagai .xlsx atau CSV.');
  return parseCsv(dec(bytes));
}

// ------------------------------------------------------------------ eksekusi
export interface ImportResult { products: number; variants: number; categoriesCreated: number; failed: { line: number; name: string; message: string }[] }

/**
 * Mengimpor baris valid. Baris yang namanya sama DAN punya kolom varian digabung menjadi satu produk bervarian; selain itu satu baris = satu produk.
 * Tiap produk dibuat dalam transaksinya sendiri: yang gagal (mis. SKU sudah dipakai) dilaporkan, yang lain tetap masuk.
 */
export async function runImport(backend: Backend, rows: ImportRow[], onProgress?: (done: number, total: number) => void): Promise<ImportResult> {
  const valid = rows.filter((r) => r.errors.length === 0);
  const cats = new Map((await backend.listProductCategories()).map((c) => [c.name.toLowerCase(), c.id]));
  const res: ImportResult = { products: 0, variants: 0, categoriesCreated: 0, failed: [] };

  const groups: ImportRow[][] = []; const byName = new Map<string, ImportRow[]>();
  for (const r of valid) {
    if (r.variant) { const k = r.name.toLowerCase(); const g = byName.get(k); if (g) { g.push(r); continue; } const ng = [r]; byName.set(k, ng); groups.push(ng); }
    else groups.push([r]);
  }
  let done = 0;
  for (const g of groups) {
    const first = g[0]!;
    try {
      let categoryId: string | null = null;
      if (first.category) {
        const k = first.category.toLowerCase();
        if (!cats.has(k)) { cats.set(k, await backend.createProductCategory(first.category)); res.categoriesCreated++; }
        categoryId = cats.get(k)!;
      }
      await backend.createProduct({
        name: first.name, categoryId, brand: first.brand || null, ...(first.unit ? { unit: first.unit } : {}),
        variants: g.map((r) => ({ name: r.variant || 'Default', sku: r.sku || null, barcode: r.barcode || null, costPrice: r.costPrice, sellPrice: r.sellPrice, openingQtyMilli: r.stockMilli, minStockMilli: r.minStockMilli })),
      });
      res.products++; res.variants += g.length;
    } catch (e) { for (const r of g) res.failed.push({ line: r.line, name: r.name, message: errorMessage(e) }); }
    done += g.length; onProgress?.(done, valid.length);
  }
  return res;
}

// ------------------------------------------------------------------ template
export const IMPORT_HEADERS = ['Nama', 'Varian', 'Kategori', 'Merek', 'Satuan', 'SKU', 'Barcode', 'Harga Beli', 'Harga Jual', 'Stok', 'Stok Minimum'];
export const IMPORT_EXAMPLES: (string | number)[][] = [
  ['Kabel USB-C 2m', '', 'Aksesoris', 'Anker', 'pcs', 'KBL-C2', '8991234567890', 8000, 25000, 40, 5],
  ['Kaos Polos', 'Hitam M', 'Fashion', '', 'pcs', 'KP-HTM', '', 35000, 65000, 12, 3],
  ['Kaos Polos', 'Hitam L', 'Fashion', '', 'pcs', 'KP-HTL', '', 35000, 65000, 8, 3],
  ['Beras Premium', '', 'Sembako', '', 'kg', 'BRS-P', '', 12000, 15000, 25.5, 10],
];
export function buildImportTemplateXlsx(): Uint8Array {
  const sheet: ExportSheet = {
    name: 'Produk', title: 'Template Impor Produk FICOIM', subtitle: 'Isi mulai baris 5. Hanya kolom Nama yang wajib. Baris dengan Nama sama + Varian terisi digabung jadi satu produk bervarian.',
    columns: IMPORT_HEADERS.map((h, i) => ({ header: h, kind: i >= 7 && i !== 9 && i !== 10 ? 'money' as const : i >= 9 ? 'qty' as const : 'text' as const, width: i === 0 ? 28 : 14 })),
    rows: IMPORT_EXAMPLES.map((r) => [...r]),
  };
  return buildXlsx([sheet]);
}
export const buildImportTemplateCsv = (): string => '\uFEFF' + [IMPORT_HEADERS, ...IMPORT_EXAMPLES].map((r) => r.map((c) => (/[;,"\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(';')).join('\r\n') + '\r\n';
