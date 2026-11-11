/**
 * Argon2id untuk produksi (rekomendasi OWASP: m=19 MiB, t=2, p=1). STATUS: belum dijalankan di lingkungan pengembangan
 * (paket `argon2` belum ter-install); antarmukanya sama dengan scryptHasher sehingga tinggal diganti saat membuat API.
 */
import type { PasswordHasher } from './security';

export async function argon2Hasher(): Promise<PasswordHasher> {
  const argon2 = (await import('argon2')).default;
  return {
    hash: (pw) => argon2.hash(pw.normalize('NFKC'), { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }),
    verify: (pw, stored) => argon2.verify(stored, pw.normalize('NFKC')).catch(() => false),
  };
}
