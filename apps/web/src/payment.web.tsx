import { useEffect, useMemo, useRef, useState } from 'react';
import type { PaymentStageProps } from '@ficoim/screens';

/** Menghitung naik dari 0 ke `target` (persen) dengan rAF; berhenti di `target`. Tanpa pustaka. */
function useCountTo(target: number, ms: number): number {
  const [n, setN] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      setN(Math.round(target * (1 - Math.pow(1 - p, 2.2)))); // melambat di akhir
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);
  return n;
}

const CIRC = 2 * Math.PI * 54;
const CONFETTI = ['#22c55e', '#6366f1', '#f59e0b', '#ec4899', '#06b6d4', '#a78bfa', '#f43f5e'];

function Processing() {
  const pct = useCountTo(92, 1700); // berhenti ±92% sampai server selesai (lalu layar sukses menggantikan)
  return (
    <div className="pay-stage" data-testid="pay-processing" role="status" aria-live="polite">
      <div className="pay-rings" aria-hidden="true"><i /><i /><i /><i /></div>
      <svg className="pay-progress" viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="54" className="pay-track" />
        <circle cx="60" cy="60" r="54" className="pay-arc" strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - pct / 100)} />
      </svg>
      <div className="pay-lock" aria-hidden="true">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
      </div>
      <div className="pay-caption">Koneksi aman</div>
      <div className="pay-pct">{pct}%</div>
    </div>
  );
}

function Success({ amountText, onContinue }: { amountText: string; onContinue?: () => void }) {
  // Confetti: posisi/warna acak sekali per tampilan; hanya CSS yang menganimasikan
  const bits = useMemo(() => Array.from({ length: 28 }, (_, i) => {
    const a = (i / 28) * Math.PI * 2 + Math.random() * 0.4, d = 90 + Math.random() * 90;
    return { dx: Math.cos(a) * d, dy: Math.sin(a) * d - 20, rot: Math.random() * 540 - 270, color: CONFETTI[i % CONFETTI.length]!, delay: Math.random() * 0.12, round: i % 3 === 0 };
  }), []);
  return (
    <div className="pay-stage pay-success" data-testid="pay-success" role="status" aria-live="polite">
      <div className="pay-burst" aria-hidden="true">
        <span className="pay-wave" />
        {bits.map((b, i) => (
          <i key={i} className={b.round ? 'round' : ''} style={{ ['--dx' as string]: `${b.dx}px`, ['--dy' as string]: `${b.dy}px`, ['--rot' as string]: `${b.rot}deg`, background: b.color, animationDelay: `${b.delay}s` }} />
        ))}
        <div className="pay-check">
          <svg viewBox="0 0 52 52" width="58" height="58" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"><path className="pay-tick" d="M14 27l8 8 16-17" /></svg>
        </div>
      </div>
      <div className="pay-title">Pembayaran Berhasil</div>
      <div className="pay-amount" data-testid="pay-amount">{amountText}</div>
      <div className="pay-sub">Transaksi tercatat. Terima kasih!</div>
      {onContinue ? <button type="button" className="pay-continue" data-testid="pay-continue" onClick={onContinue}>🧾 Lihat struk</button> : null}
    </div>
  );
}

/** Alur pembayaran bergaya "checkout": memproses (cincin + persen) → sukses (centang, confetti, nominal). Selalu bertema gelap agar kontras di tema apa pun. */
export function PaymentStageWeb({ phase, amountText, onContinue }: PaymentStageProps) {
  return phase === 'processing' ? <Processing /> : <Success amountText={amountText} onContinue={onContinue} />;
}
