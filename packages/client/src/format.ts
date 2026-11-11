import { formatQty, formatRupiah } from '@ficoim/shared';

export { formatQty, formatRupiah };
export const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'] as const;

const pad = (n: number) => String(n).padStart(2, '0');

/** Tanggal lokal bisnis (YYYY-MM-DD) dari waktu UTC. Default WIB (+420 menit). */
export function todayLocal(tzOffsetMinutes = 420, now: Date = new Date()): string {
  return new Date(now.getTime() + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

export function addDaysStr(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function monthRange(date: string): { from: string; to: string } {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}` };
}

export function fmtDate(isoOrDate: string, tzOffsetMinutes = 420): string {
  const d = isoOrDate.length > 10 ? new Date(new Date(isoOrDate).getTime() + tzOffsetMinutes * 60_000).toISOString().slice(0, 10) : isoOrDate;
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return `${day} ${MONTHS_ID[m - 1]} ${y}`;
}

export function fmtDateTime(iso: string, tzOffsetMinutes = 420): string {
  const t = new Date(new Date(iso).getTime() + tzOffsetMinutes * 60_000).toISOString();
  return `${fmtDate(t.slice(0, 10))} ${t.slice(11, 16)}`;
}

/** Singkat untuk grafik: 1.250.000 -> "1,3 jt". */
export function compactRupiah(n: number): string {
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1_000_000_000) return `${s}${(a / 1_000_000_000).toFixed(1).replace('.', ',')} M`;
  if (a >= 1_000_000) return `${s}${(a / 1_000_000).toFixed(1).replace('.', ',')} jt`;
  if (a >= 1_000) return `${s}${Math.round(a / 1_000)} rb`;
  return `${s}${a}`;
}

/** Pesan galat yang aman & ramah untuk ditampilkan (tidak pernah menampilkan stack/objek mentah). */
export function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return 'Terjadi kesalahan. Coba lagi.';
}
