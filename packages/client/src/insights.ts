import { addDaysStr, compactRupiah, formatQty, formatRupiah } from './format';

export interface DaySales { date: string; total: number; count: number }
export interface InsightInput {
  /** Penjualan harian berurutan lama→baru, sampai hari ini (hari kosong = 0). Disarankan 30 hari. */
  days: DaySales[];
  top?: { name: string; revenue: number; qtyMilli: number }[];
  categories?: { category: string; revenue: number; marginPct: number }[];
  stock?: { safe: number; low: number; out: number };
  cash?: { cashIn: number; cashOut: number };
  overdueReceivable?: number;
}
export type InsightIcon = 'trendUp' | 'trendDown' | 'alert' | 'chart' | 'package' | 'wallet' | 'tag' | 'clock';
export interface Insight { id: string; tone: 'good' | 'warn' | 'info'; icon: InsightIcon; text: string }

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const weekday = (date: string): number => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))).getUTCDay();

/** Melengkapi hari yang tidak ada di hasil query dengan 0, sehingga deret selalu kontinu dari `from` ke `to`. */
export function fillDays(from: string, to: string, rows: DaySales[]): DaySales[] {
  const by = new Map(rows.map((r) => [r.date, r]));
  const out: DaySales[] = [];
  for (let d = from, guard = 0; d <= to && guard < 400; d = addDaysStr(d, 1), guard++) out.push(by.get(d) ?? { date: d, total: 0, count: 0 });
  return out;
}

/** Teks perubahan untuk tampilan: persentase ekstrem (>300%) tidak informatif, jadi dinyatakan sebagai ">300%". */
export const formatDelta = (d: number): string => `${Math.abs(d) > 300 ? '>' : ''}${d >= 0 ? '+' : '−'}${Math.min(300, Math.abs(d))}%`;

/** Perubahan persen cur terhadap prev; null bila prev = 0 (tidak bisa dibandingkan). Dibulatkan ke bilangan bulat. */
export function deltaPct(cur: number, prev: number): number | null {
  return prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
}

const sum = (xs: DaySales[]) => xs.reduce((a, d) => a + d.total, 0);

/** Wawasan singkat dari data dashboard. Peringatan dulu, lalu kabar baik, lalu info; maksimal `max`. Murni (tanpa efek samping). */
export function buildInsights(i: InsightInput, max = 4): Insight[] {
  const out: Insight[] = [];
  const n = i.days.length, today = i.days[n - 1], yest = i.days[n - 2];
  if (today && yest) {
    const d = deltaPct(today.total, yest.total);
    if (d !== null && d > 300) out.push({ id: 'vs-yesterday', tone: 'good', icon: 'trendUp', text: `Penjualan hari ini melonjak jauh di atas kemarin (${compactRupiah(today.total)} vs ${compactRupiah(yest.total)}).` });
    else if (d !== null && d >= 10) out.push({ id: 'vs-yesterday', tone: 'good', icon: 'trendUp', text: `Penjualan hari ini naik ${d}% dibanding kemarin (${compactRupiah(today.total)} vs ${compactRupiah(yest.total)}).` });
    else if (d !== null && d <= -10 && today.total > 0) out.push({ id: 'vs-yesterday', tone: 'warn', icon: 'trendDown', text: `Penjualan hari ini turun ${Math.abs(d)}% dibanding kemarin. Hari masih berjalan — pantau terus.` });
    else if (yest.total === 0 && today.total > 0) out.push({ id: 'vs-yesterday', tone: 'good', icon: 'trendUp', text: `Penjualan hari ini sudah ${compactRupiah(today.total)}; kemarin belum ada penjualan.` });
  }
  if (n >= 14) {
    const cur = sum(i.days.slice(n - 7)), prev = sum(i.days.slice(n - 14, n - 7)), d = deltaPct(cur, prev);
    if (d !== null && d > 300) out.push({ id: 'week', tone: 'good', icon: 'trendUp', text: `7 hari terakhir melonjak jauh di atas 7 hari sebelumnya (${compactRupiah(cur)}).` });
    else if (d !== null && d >= 10) out.push({ id: 'week', tone: 'good', icon: 'trendUp', text: `7 hari terakhir naik ${d}% dari 7 hari sebelumnya (${compactRupiah(cur)}).` });
    else if (d !== null && d <= -10) out.push({ id: 'week', tone: 'warn', icon: 'trendDown', text: `7 hari terakhir turun ${Math.abs(d)}% dari 7 hari sebelumnya (${compactRupiah(cur)}). Cek stok dan promosi.` });
  }
  if (n >= 21) { // hari terbaik: rata-rata per hari-dalam-pekan dibanding rata-rata keseluruhan
    const acc = Array.from({ length: 7 }, () => ({ s: 0, c: 0 }));
    for (const d of i.days) { const w = weekday(d.date); acc[w]!.s += d.total; acc[w]!.c++; }
    const avgs = acc.map((a) => (a.c ? a.s / a.c : 0)), overall = sum(i.days) / n;
    const best = avgs.indexOf(Math.max(...avgs));
    if (overall > 0 && avgs[best]! > overall * 1.25) out.push({ id: 'best-day', tone: 'info', icon: 'chart', text: `${DAY_NAMES[best]} biasanya hari terbaik: rata-rata ${compactRupiah(Math.round(avgs[best]!))} (${Math.min(300, Math.round((avgs[best]! / overall - 1) * 100))}% di atas rata-rata).` });
  }
  const total = i.categories?.reduce((a, c) => a + c.revenue, 0) ?? 0;
  const thin = i.categories?.filter((c) => total > 0 && c.revenue / total >= 0.1 && c.marginPct < 15).sort((a, b) => a.marginPct - b.marginPct)[0];
  if (thin) out.push({ id: 'thin-margin', tone: 'warn', icon: 'tag', text: `Margin kategori ${thin.category} hanya ${thin.marginPct.toString().replace('.', ',')}% padahal porsinya besar. Tinjau harga jual/beli.` });
  if (i.stock && i.stock.out > 0) out.push({ id: 'out', tone: 'warn', icon: 'alert', text: `${i.stock.out} produk habis stok. Segera belanja ulang agar tidak kehilangan penjualan.` });
  else if (i.stock && i.stock.low > 0) out.push({ id: 'low', tone: 'info', icon: 'package', text: `${i.stock.low} produk stoknya menipis.` });
  if (i.cash && i.cash.cashOut > i.cash.cashIn && i.cash.cashOut > 0) out.push({ id: 'cash', tone: 'warn', icon: 'wallet', text: `Bulan ini kas keluar (${compactRupiah(i.cash.cashOut)}) melebihi kas masuk (${compactRupiah(i.cash.cashIn)}).` });
  if (i.overdueReceivable && i.overdueReceivable > 0) out.push({ id: 'overdue', tone: 'warn', icon: 'clock', text: `Piutang lewat jatuh tempo ${formatRupiah(i.overdueReceivable)} belum tertagih.` });
  const t = i.top?.[0];
  if (t && t.revenue > 0) out.push({ id: 'top', tone: 'info', icon: 'package', text: `Terlaris bulan ini: ${t.name} (${formatQty(t.qtyMilli)} terjual, ${compactRupiah(t.revenue)}).` });
  const rank = { warn: 0, good: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]).slice(0, max);
}
