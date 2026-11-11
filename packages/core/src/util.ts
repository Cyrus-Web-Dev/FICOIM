import type { Ctx } from './ctx';
import { validation } from './errors';

// ---------- validasi input ----------
export function requireText(v: unknown, field: string, max = 200): string {
  if (typeof v !== 'string') throw validation(`${field} wajib diisi.`);
  const s = v.trim();
  if (!s) throw validation(`${field} wajib diisi.`);
  if (s.length > max) throw validation(`${field} maksimal ${max} karakter.`);
  return s;
}

export function optText(v: unknown, field: string, max = 500): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw validation(`${field} tidak valid.`);
  const s = v.trim();
  if (!s) return null;
  if (s.length > max) throw validation(`${field} maksimal ${max} karakter.`);
  return s;
}

export function requireInt(v: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw validation(`${field} harus bilangan bulat.`);
  if (v < min) throw validation(`${field} minimal ${min}.`);
  if (v > max) throw validation(`${field} maksimal ${max}.`);
  return v;
}

export function optInt(v: unknown, field: string, def: number, min = 0): number {
  return v === undefined || v === null ? def : requireInt(v, field, min);
}

export function requireDate(v: unknown, field: string): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || localDateIsInvalid(v)) throw validation(`${field} harus tanggal YYYY-MM-DD yang valid.`);
  return v;
}

function localDateIsInvalid(s: string): boolean {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d;
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw validation(`${field} harus salah satu dari: ${allowed.join(', ')}.`);
  return v as T;
}

/** SKU/barcode: dipangkas; kosong -> null. */
export function code(v: unknown, field: string): string | null {
  const s = optText(v, field, 64);
  return s;
}

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ---------- tanggal & zona waktu ----------
const fmt = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Tanggal lokal bisnis (YYYY-MM-DD) dari sebuah waktu UTC. */
export function localDate(d: Date, offsetMinutes: number): string {
  return new Date(d.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

export const today = (ctx: Ctx): string => localDate(ctx.now(), ctx.tzOffsetMinutes);

/** Awal hari lokal (00:00) sebagai ISO UTC. */
export function dayStartUtc(date: string, offsetMinutes: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) - offsetMinutes * 60_000).toISOString();
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Maju satu periode tagihan. Bulanan/tahunan memotong ke hari terakhir bulan (31 Jan -> 28 Feb). */
export function addPeriod(date: string, freq: 'weekly' | 'monthly' | 'yearly'): string {
  if (freq === 'weekly') return addDays(date, 7);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const mi = m - 1 + (freq === 'monthly' ? 1 : 12);
  const ty = y + Math.floor(mi / 12);
  const tm = mi % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return fmt(ty, tm + 1, Math.min(d, last));
}

/** Rentang [from, to] tanggal lokal inklusif -> batas waktu UTC [fromIso, toIsoExclusive). */
export function rangeUtc(ctx: Ctx, from: string, to: string): { fromIso: string; toIso: string } {
  requireDate(from, 'Tanggal awal');
  requireDate(to, 'Tanggal akhir');
  if (from > to) throw validation('Tanggal awal tidak boleh setelah tanggal akhir.');
  return { fromIso: dayStartUtc(from, ctx.tzOffsetMinutes), toIso: dayStartUtc(addDays(to, 1), ctx.tzOffsetMinutes) };
}

// ---------- penomoran dokumen ----------
/** PJ-202610-000001 (penjualan) / PB-… (pembelian). Nomor tidak pernah dipakai ulang (void & hapus-lunak ikut dihitung). */
export async function nextNumber(ctx: Ctx, table: 'sales' | 'purchases', prefix: 'PJ' | 'PB'): Promise<string> {
  const ym = localDate(ctx.now(), ctx.tzOffsetMinutes).slice(0, 7).replace('-', '');
  const base = `${prefix}-${ym}-`;
  const rows = await ctx.db.all(
    `SELECT "number" FROM "${table}" WHERE "business_id" = ? AND "number" LIKE ? ORDER BY "number" DESC LIMIT 1`,
    [ctx.businessId, `${base}%`],
  );
  const last = rows[0] ? parseInt(String(rows[0].number).slice(base.length), 10) : 0;
  return `${base}${String((Number.isFinite(last) ? last : 0) + 1).padStart(6, '0')}`;
}
