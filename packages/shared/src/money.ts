/**
 * Uang  = bilangan bulat Rupiah (tanpa desimal)  -> tipe BIGINT / INTEGER.
 * Qty   = bilangan bulat dalam 1/1000 satuan ("milli")  -> 1 pcs = 1000, 1,5 kg = 1500.
 * Tidak ada floating point yang disimpan di database, jadi hasil identik di web & mobile.
 */

export function formatRupiah(amount: number, opts: { symbol?: boolean } = {}): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError('Nominal harus bilangan bulat aman');
  const neg = amount < 0;
  const digits = String(Math.abs(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const body = opts.symbol === false ? digits : `Rp ${digits}`;
  return neg ? `-${body}` : body;
}

/** "Rp 1.250.000" / "1250000" -> 1250000. Mengembalikan null bila tidak valid (termasuk desimal). */
export function parseRupiah(input: string): number | null {
  const s = input.replace(/rp/gi, '').replace(/[\s.]/g, '');
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/** 2 -> 2000 ; "1,5" -> 1500 ; null bila tidak valid / lebih dari 3 desimal. */
export function qtyToMilli(input: number | string): number | null {
  if (typeof input === 'number') {
    const m = Math.round(input * 1000);
    return Number.isFinite(input) && Math.abs(input * 1000 - m) < 1e-6 && Number.isSafeInteger(m) ? m : null;
  }
  const s = input.trim().replace(',', '.');
  const match = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(s);
  if (!match) return null;
  const [, sign, whole, frac = ''] = match;
  const m = Number(whole) * 1000 + Number(frac.padEnd(3, '0'));
  if (!Number.isSafeInteger(m)) return null;
  return sign ? -m : m;
}

export function formatQty(milli: number): string {
  if (!Number.isSafeInteger(milli)) throw new RangeError('Qty harus bilangan bulat aman');
  const neg = milli < 0;
  const abs = Math.abs(milli);
  const whole = Math.floor(abs / 1000);
  const frac = String(abs % 1000).padStart(3, '0').replace(/0+$/, '');
  const w = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + (frac ? `${w},${frac}` : w);
}

/** Harga satuan x qty(milli) -> total Rupiah, dibulatkan ke atas pada .5. Melempar bila meluap. */
export function lineTotal(qtyMilli: number, unitPrice: number): number {
  const raw = qtyMilli * unitPrice;
  if (!Number.isSafeInteger(raw)) throw new RangeError('Total baris terlalu besar');
  const sign = raw < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(raw) + 500) / 1000);
}

/** Basis point: 1100 bp = 11%. */
export function percentBp(amount: number, bp: number): number {
  const raw = amount * bp;
  if (!Number.isSafeInteger(raw)) throw new RangeError('Perhitungan persen meluap');
  return Math.floor((raw + 5000) / 10000);
}
