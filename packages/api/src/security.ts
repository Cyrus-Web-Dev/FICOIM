import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export const b64u = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
export const fromB64u = (s: string): Buffer => Buffer.from(s, 'base64url');
export const sha256hex = (s: string | Uint8Array): string => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export function safeEqual(a: string | Uint8Array, b: string | Uint8Array): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ------------------------------------------------------------ hash password
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
}

/**
 * scrypt (bawaan Node, tanpa dependensi) — default untuk dev/uji. Produksi disarankan memakai Argon2id (argon2-hasher.ts).
 * Format: scrypt$logN$r$p$salt$hash. Parameter dari string tersimpan dibatasi agar data korup tidak menghabiskan memori.
 */
export function scryptHasher(params: { logN: number; r: number; p: number } = { logN: 15, r: 8, p: 1 }): PasswordHasher {
  const derive = (pw: string, salt: Buffer, logN: number, r: number, p: number) =>
    new Promise<Buffer>((res, rej) => {
      const N = 2 ** logN;
      scrypt(pw.normalize('NFKC'), salt, 32, { N, r, p, maxmem: 128 * N * r * 2 + 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k)));
    });
  return {
    async hash(pw) {
      const salt = randomBytes(16);
      const k = await derive(pw, salt, params.logN, params.r, params.p);
      return `scrypt$${params.logN}$${params.r}$${params.p}$${b64u(salt)}$${b64u(k)}`;
    },
    async verify(pw, stored) {
      const [alg, ln, r, p, salt, hash] = stored.split('$');
      if (alg !== 'scrypt' || !ln || !r || !p || !salt || !hash) return false;
      const logN = Number(ln), rr = Number(r), pp = Number(p);
      if (!(logN >= 10 && logN <= 17 && rr >= 1 && rr <= 16 && pp >= 1 && pp <= 4)) return false;
      const k = await derive(pw, fromB64u(salt), logN, rr, pp);
      return safeEqual(k, fromB64u(hash));
    },
  };
}

// ------------------------------------------------------------ token akses (HS256)
const HEADER = b64u(Buffer.from('{"alg":"HS256","typ":"JWT"}'));

export function signToken(payload: Record<string, unknown>, secret: Buffer, nowSec: number, ttlSec: number): string {
  if (secret.length < 32) throw new Error('Rahasia token minimal 32 byte.');
  const body = b64u(Buffer.from(JSON.stringify({ ...payload, iat: nowSec, exp: nowSec + ttlSec })));
  const sig = b64u(createHmac('sha256', secret).update(`${HEADER}.${body}`).digest());
  return `${HEADER}.${body}.${sig}`;
}

/** Mengembalikan payload bila tanda tangan sah dan belum kedaluwarsa; selain itu null. Header dikunci (alg:none/algoritma lain ditolak). */
export function verifyToken(token: string, secret: Buffer, nowSec: number): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, b, s] = parts as [string, string, string];
  if (h !== HEADER) return null;
  const expected = createHmac('sha256', secret).update(`${h}.${b}`).digest();
  if (!safeEqual(expected, fromB64u(s))) return null;
  try {
    const p = JSON.parse(fromB64u(b).toString('utf8')) as Record<string, unknown>;
    if (typeof p.exp !== 'number' || p.exp <= nowSec) return null;
    return p;
  } catch { return null; }
}

// ------------------------------------------------------------ enkripsi rahasia (rahasia TOTP di database)
export function sealSecret(plain: Uint8Array, key: Buffer): string {
  if (key.length !== 32) throw new Error('Kunci enkripsi harus 32 byte.');
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return b64u(Buffer.concat([nonce, ct, c.getAuthTag()]));
}

export function openSecret(sealed: string, key: Buffer): Buffer | null {
  try {
    const raw = fromB64u(sealed);
    if (raw.length < 12 + 16) return null;
    const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(raw.length - 16));
    return Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]);
  } catch { return null; }
}
