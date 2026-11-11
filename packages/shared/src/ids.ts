import { secureRandomBytes } from './random';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

let lastMs = -1;
let seq = 0;

/**
 * UUID v7 (RFC 9562): 48-bit timestamp milidetik + 12-bit penghitung + acak.
 * - Dibuat di mana saja (HP offline / server) tanpa bentrok, dan terurut waktu sehingga index database efisien.
 * - MONOTON dalam satu proses (RFC 9562 §6.2): ID yang dibuat lebih akhir selalu lebih besar, bahkan dalam milidetik yang sama.
 *   Ini penting karena urutan riwayat (mis. kartu stok) memakai id sebagai pemutus seri.
 * - Bila `nowMs` lebih lama dari ID terakhir, waktu terakhir dipakai (jam mundur tidak merusak urutan).
 */
export function uuidv7(nowMs: number = Date.now()): string {
  const b = secureRandomBytes(16).slice();
  let ms = nowMs;
  if (ms > lastMs) {
    seq = (((b[6] as number) & 0x07) << 8) | (b[7] as number); // awal acak di separuh bawah (sisakan ruang naik)
  } else {
    ms = lastMs;
    seq++;
    if (seq > 0xfff) { ms = lastMs + 1; seq = 0; }
  }
  lastMs = ms;
  b[0] = Math.floor(ms / 2 ** 40) & 0xff;
  b[1] = Math.floor(ms / 2 ** 32) & 0xff;
  b[2] = (ms >>> 24) & 0xff;
  b[3] = (ms >>> 16) & 0xff;
  b[4] = (ms >>> 8) & 0xff;
  b[5] = ms & 0xff;
  b[6] = 0x70 | ((seq >> 8) & 0x0f); // versi 7 + 4 bit atas penghitung
  b[7] = seq & 0xff;
  b[8] = ((b[8] as number) & 0x3f) | 0x80; // varian RFC
  const h = (i: number) => HEX[b[i] ?? 0] as string;
  return (
    h(0) + h(1) + h(2) + h(3) + '-' + h(4) + h(5) + '-' + h(6) + h(7) + '-' +
    h(8) + h(9) + '-' + h(10) + h(11) + h(12) + h(13) + h(14) + h(15)
  );
}
