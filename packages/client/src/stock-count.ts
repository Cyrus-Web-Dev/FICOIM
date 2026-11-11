import { formatQty, qtyToMilli } from '@ficoim/shared';
import type { Backend } from './backend';
import type { VariantView } from '@ficoim/core';
import { errorMessage } from './format';
import { buildXlsx, type ExportSheet } from './xlsx';
import type { RawCell } from './import-products';

/** Stok opname massal: hasil hitung fisik dari Excel/CSV dicocokkan ke produk lewat SKU/barcode, ditampilkan selisihnya, lalu diterapkan. */
export interface CountRow { line: number; id: string; sku: string; barcode: string; name: string; counted: number | null; errors: string[] }
export interface CountItem {
  line: number; code: string; variantId: string | null; name: string; unit: string;
  system: number; counted: number; diff: number; errors: string[];
}
export interface CountPlan { items: CountItem[]; skippedBlank: number; unchanged: number }

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const SKU = ['sku', 'kode', 'kodeproduk', 'kodebarang', 'code'], BARCODE = ['barcode', 'ean', 'upc', 'kodebarcode'];
const ID = ['id', 'idvarian', 'variantid', 'kodesistem'];
const NAME = ['nama', 'namaproduk', 'produk', 'name', 'barang'];
const COUNT = ['stokfisik', 'fisik', 'hasilhitung', 'hitung', 'stokhitung', 'stokopname', 'opname', 'countedstock', 'stokaktual', 'aktual'];
const txt = (v: RawCell): string => (v === null || v === undefined ? '' : String(v).trim());

export function mapCountRows(table: RawCell[][]): CountRow[] {
  const hi = table.findIndex((r, i) => i < 15 && r.some((c) => COUNT.includes(norm(c))) && r.some((c) => SKU.includes(norm(c)) || BARCODE.includes(norm(c)) || ID.includes(norm(c))));
  if (hi < 0) throw new Error('Kolom "ID" atau "SKU" (atau "Barcode") dan "Stok Fisik" tidak ditemukan. Unduh daftar stok dari layar ini untuk mendapat format yang benar.');
  const h = table[hi]!.map(norm);
  const col = (names: string[]) => h.findIndex((x) => x && names.includes(x));
  const [cs, cb, cn, cc, ci] = [col(SKU), col(BARCODE), col(NAME), col(COUNT), col(ID)];
  const rows: CountRow[] = [];
  table.forEach((r, i) => {
    if (i <= hi || !r.some((c) => c !== null && c !== undefined && String(c).trim() !== '')) return;
    const errors: string[] = [];
    const raw = cc >= 0 ? r[cc] ?? null : null;
    let counted: number | null = null;
    if (raw !== null && String(raw).trim() !== '') {
      const m = qtyToMilli(typeof raw === 'number' ? raw : String(raw));
      if (m === null || m < 0) errors.push(`Stok fisik "${raw}" tidak valid`); else counted = m;
    }
    rows.push({ line: i + 1, id: ci >= 0 ? txt(r[ci] ?? null) : '', sku: cs >= 0 ? txt(r[cs] ?? null) : '', barcode: cb >= 0 ? txt(r[cb] ?? null) : '', name: cn >= 0 ? txt(r[cn] ?? null) : '', counted, errors });
  });
  if (rows.length === 0) throw new Error('Tidak ada baris data di bawah header.');
  return rows;
}

/** Mencocokkan baris dengan varian. Baris tanpa hitungan (kosong) dilewati; kode tak dikenal/kembar/jasa menjadi galat. */
export function planCount(rows: CountRow[], variants: VariantView[]): CountPlan {
  const bySku = new Map<string, VariantView>(), byBar = new Map<string, VariantView>(), byId = new Map<string, VariantView>();
  for (const v of variants) { byId.set(v.id.toLowerCase(), v); if (v.sku) bySku.set(v.sku.toLowerCase(), v); if (v.barcode) byBar.set(v.barcode.toLowerCase(), v); }
  const seen = new Map<string, number>();
  const items: CountItem[] = []; let skippedBlank = 0, unchanged = 0;
  for (const r of rows) {
    const code = r.id || r.sku || r.barcode;
    const v = (r.id && byId.get(r.id.toLowerCase())) || (r.sku && bySku.get(r.sku.toLowerCase())) || (r.barcode && byBar.get(r.barcode.toLowerCase())) || null;
    const errors = [...r.errors];
    if (r.counted === null && errors.length === 0) { skippedBlank++; continue; }
    if (!code) errors.push('ID/SKU/Barcode kosong');
    else if (!v) errors.push(`Kode "${code}" tidak ditemukan`);
    else {
      if (!v.trackStock) errors.push('Produk ini tidak melacak stok (jasa)');
      const prev = seen.get(v.id); if (prev !== undefined) errors.push(`Produk ini sudah ada di baris ${prev}`); else seen.set(v.id, r.line);
    }
    const system = v?.stockQtyMilli ?? 0, counted = r.counted ?? 0;
    if (errors.length === 0 && counted === system) unchanged++;
    items.push({ line: r.line, code, variantId: v?.id ?? null, name: v ? (v.variantName === 'Default' ? v.productName : `${v.productName} ${v.variantName}`) : r.name, unit: v?.unit ?? '', system, counted, diff: counted - system, errors });
  }
  return { items, skippedBlank, unchanged };
}

export interface CountResult { updated: number; failed: { line: number; name: string; message: string }[] }

/** Menerapkan hasil hitung (mode "set": stok menjadi sama dengan hitungan). Tiap produk transaksinya sendiri; kartu stok mencatat selisih sebagai "opname". */
export async function applyCount(backend: Backend, items: CountItem[], note: string, onProgress?: (done: number, total: number) => void): Promise<CountResult> {
  const todo = items.filter((i) => i.errors.length === 0 && i.variantId && i.diff !== 0);
  const res: CountResult = { updated: 0, failed: [] };
  let done = 0;
  for (const it of todo) {
    try { await backend.adjustStock(it.variantId!, { mode: 'set', qtyMilli: it.counted, reason: 'opname', note: note || 'Stok opname massal' }); res.updated++; }
    catch (e) { res.failed.push({ line: it.line, name: it.name, message: errorMessage(e) }); }
    onProgress?.(++done, todo.length);
  }
  return res;
}

/** Daftar stok sistem saat ini untuk dihitung di lapangan; kolom "Stok Fisik" dibiarkan kosong. */
export function buildCountSheetXlsx(variants: VariantView[]): Uint8Array {
  const rows = variants.filter((v) => v.isActive && v.trackStock);
  const sheet: ExportSheet = {
    name: 'Stok', title: 'Daftar Hitung Stok (Opname)', subtitle: 'Isi kolom "Stok Fisik" dengan hasil hitungan. Kolom kosong = tidak dihitung (stok tidak diubah). Jangan ubah kolom ID (dipakai untuk mencocokkan produk, termasuk yang belum punya SKU/barcode).',
    columns: [{ header: 'Nama', width: 36 }, { header: 'SKU', width: 16 }, { header: 'Barcode', width: 18 }, { header: 'Satuan', width: 10 }, { header: 'Stok Sistem', kind: 'qty' }, { header: 'Stok Fisik', kind: 'qty' }, { header: 'ID', width: 38 }],
    rows: rows.map((v) => [v.variantName === 'Default' ? v.productName : `${v.productName} ${v.variantName}`, v.sku ?? '', v.barcode ?? '', v.unit, v.stockQtyMilli / 1000, null, v.id]),
  };
  return buildXlsx([sheet]);
}

export const describeDiff = (diff: number, unit: string): string => (diff === 0 ? 'sama' : `${diff > 0 ? '+' : '−'}${formatQty(Math.abs(diff))} ${unit}`.trim());
