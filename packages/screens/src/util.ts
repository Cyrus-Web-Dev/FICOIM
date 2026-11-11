import { MONTHS_ID } from '@ficoim/client';

/** "2026-10-27" -> "27 Okt" */
export function fmtShortDay(date: string): string {
  const [, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS_ID[m - 1]}`;
}

/** Periode laporan bawaan, dihitung dari tanggal lokal bisnis. */
export type PeriodKey = 'today' | '7d' | 'month' | 'lastMonth';
export const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: 'today', label: 'Hari ini' }, { value: '7d', label: '7 hari' }, { value: 'month', label: 'Bulan ini' }, { value: 'lastMonth', label: 'Bulan lalu' },
];

export function periodRange(key: PeriodKey, today: string): { from: string; to: string } {
  const add = (d: string, n: number) => { const [y, m, day] = d.split('-').map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, day + n)).toISOString().slice(0, 10); };
  const [y, m] = today.split('-').map(Number) as [number, number];
  const last = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const p = (n: number) => String(n).padStart(2, '0');
  if (key === 'today') return { from: today, to: today };
  if (key === '7d') return { from: add(today, -6), to: today };
  if (key === 'month') return { from: `${y}-${p(m)}-01`, to: today };
  const ly = m === 1 ? y - 1 : y, lm = m === 1 ? 12 : m - 1;
  return { from: `${ly}-${p(lm)}-01`, to: `${ly}-${p(lm)}-${p(last(ly, lm))}` };
}

/** Teks qty untuk input (koma desimal) -> milli; null bila tidak valid. */
export { qtyToMilli, formatQty } from '@ficoim/shared';
