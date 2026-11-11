/**
 * Sumber acak yang aman (CSPRNG) yang bisa diganti per platform.
 * - Web / Node 20+: memakai globalThis.crypto.getRandomValues secara otomatis.
 * - React Native (Hermes): panggil setRandomSource() sekali saat startup,
 *   misalnya dengan expo-crypto:  setRandomSource((n) => getRandomBytes(n))
 */
export type RandomSource = (length: number) => Uint8Array;

let source: RandomSource | null = null;

export function setRandomSource(fn: RandomSource): void {
  source = fn;
}

export function secureRandomBytes(length: number): Uint8Array {
  if (source) return source(length);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const out = new Uint8Array(length);
    c.getRandomValues(out);
    return out;
  }
  throw new Error(
    'Tidak ada sumber acak aman. Di React Native panggil setRandomSource() dengan expo-crypto saat startup.',
  );
}
