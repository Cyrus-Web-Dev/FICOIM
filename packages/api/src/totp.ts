import { createHmac, randomBytes } from 'node:crypto';
import { safeEqual } from './security';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(data: Uint8Array): string {
  let bits = 0, value = 0, out = '';
  for (const byte of data) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Karakter base32 tidak valid');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** RFC 6238 (HMAC-SHA1). */
export function totp(secret: Uint8Array, timeSec: number, o: { step?: number; digits?: number } = {}): string {
  const step = o.step ?? 30, digits = o.digits ?? 6;
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeSec / step)));
  const h = createHmac('sha1', secret).update(counter).digest();
  const off = (h[19] as number) & 0xf;
  const bin = (((h[off] as number) & 0x7f) << 24) | (((h[off + 1] as number) & 0xff) << 16) | (((h[off + 2] as number) & 0xff) << 8) | ((h[off + 3] as number) & 0xff);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/**
 * Memverifikasi kode dengan toleransi ±window langkah. Mengembalikan nomor langkah yang cocok (untuk mencegah pemakaian ulang
 * kode yang sama: pemanggil menolak bila langkah <= langkah terakhir yang tersimpan), atau null.
 */
export function verifyTotp(secret: Uint8Array, code: string, nowSec: number, o: { window?: number; step?: number; digits?: number } = {}): number | null {
  const step = o.step ?? 30, w = o.window ?? 1, digits = o.digits ?? 6;
  if (!new RegExp(`^\\d{${digits}}$`).test(code)) return null;
  const cur = Math.floor(nowSec / step);
  let hit: number | null = null;
  for (let d = -w; d <= w; d++) {
    const ok = safeEqual(totp(secret, (cur + d) * step, { step, digits }), code); // tidak berhenti dini
    if (ok && hit === null) hit = cur + d;
  }
  return hit;
}

export function generateTotpSecret(): { secret: Buffer; base32: string } {
  const secret = randomBytes(20);
  return { secret, base32: base32Encode(secret) };
}

export function otpauthUri(issuer: string, account: string, base32: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${base32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
