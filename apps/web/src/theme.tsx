import { useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'ficoim-theme';

function read(): ThemeChoice {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; }
}

/** Menerapkan pilihan tema ke <html data-theme>. 'system' = ikuti pengaturan perangkat. */
export function applyTheme(choice: ThemeChoice = read()): void {
  const dark = choice === 'dark' || (choice === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0b1020' : '#4338ca');
}

/** Tombol bulat: terang ↔ gelap. Pilihan disimpan di peramban (hanya preferensi tampilan, bukan data sensitif). */
export function ThemeToggleWeb() {
  const [choice, setChoice] = useState<ThemeChoice>(read);
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const on = () => { if (read() === 'system') { applyTheme('system'); setDark(document.documentElement.dataset.theme === 'dark'); } };
    mq?.addEventListener?.('change', on);
    return () => mq?.removeEventListener?.('change', on);
  }, []);
  const toggle = () => {
    const next: ThemeChoice = dark ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch { /* penyimpanan diblokir: tema berlaku untuk sesi ini saja */ }
    setChoice(next); applyTheme(next); setDark(next === 'dark');
  };
  void choice;
  return (
    <button type="button" data-testid="theme-toggle" onClick={toggle} aria-label={dark ? 'Ganti ke tema terang' : 'Ganti ke tema gelap'} className="theme-toggle">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {dark ? <><circle cx="12" cy="12" r="4" /><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" /></> : <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />}
      </svg>
      <span>{dark ? 'Terang' : 'Gelap'}</span>
    </button>
  );
}
