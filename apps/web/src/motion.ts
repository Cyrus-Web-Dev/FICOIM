/**
 * Gerak (Framer Motion, GSAP, Three.js) hanya aktif bila pengguna tidak meminta "kurangi gerakan" dan peramban
 * bukan otomatisasi (Playwright/Selenium mengatur navigator.webdriver) — sehingga uji e2e tetap deterministik.
 * Paksa nyala untuk percobaan: tambahkan ?motion=on pada URL.
 */
let cached: boolean | null = null;

export function motionAllowed(): boolean {
  if (cached !== null) return cached;
  try {
    if (new URLSearchParams(window.location.search).get('motion') === 'on') return (cached = true);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    cached = !reduced && !navigator.webdriver;
  } catch { cached = false; }
  return cached;
}
