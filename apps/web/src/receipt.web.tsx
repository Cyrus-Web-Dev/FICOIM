import { useEffect, useMemo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { code39Modules, type ReceiptModel } from '@ficoim/client';
import type { ReceiptPaperProps } from '@ficoim/screens';
import { motionAllowed } from './motion';

const PRINT_SECONDS = 1.7;

function Barcode({ value }: { value: string }) {
  const mods = code39Modules(value);
  const total = mods.reduce((a, b) => a + b, 0);
  let x = 0;
  const bars: { x: number; w: number }[] = [];
  mods.forEach((w, i) => { if (i % 2 === 0) bars.push({ x, w }); x += w; });
  return (
    <svg viewBox={`0 0 ${total} 40`} preserveAspectRatio="none" className="rcpt-barcode" role="img" aria-label={`Barcode ${value}`}>
      {bars.map((b, i) => <rect key={i} x={b.x} y={0} width={b.w} height={40} fill="#0f172a" />)}
    </svg>
  );
}

function Logo({ logo }: { logo: ReceiptPaperProps['logo'] }) {
  const url = useMemo(() => (logo ? URL.createObjectURL(new Blob([logo.bytes.slice().buffer as ArrayBuffer], { type: logo.mime })) : null), [logo]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url ? <img className="rcpt-logo rcpt-logo-img" src={url} alt="" /> : <div className="rcpt-logo" aria-hidden="true">F</div>;
}

function Paper({ m, logo }: { m: ReceiptModel; logo?: ReceiptPaperProps['logo'] }) {
  const stampTone = m.status === 'paid' ? 'paid' : m.status === 'void' ? 'void' : 'due';
  return (
    <div className="rcpt-paper" data-testid="receipt-paper-sheet">
      <div className="rcpt-head">
        <div>
          <div className="rcpt-biz">{m.businessName}</div>
          <div className="rcpt-sub">Struk penjualan</div>
          {m.address ? <div className="rcpt-sub">{m.address}</div> : null}
          {m.phone ? <div className="rcpt-sub">Telp {m.phone}</div> : null}
        </div>
        <Logo logo={logo ?? null} />
      </div>

      <div className="rcpt-meta"><span>{m.number}</span><span>{m.party ? `Pelanggan: ${m.party}` : 'Pelanggan umum'}</span></div>
      <div className="rcpt-total-big">{m.totalText}</div>
      <div className="rcpt-sub rcpt-date">{m.dateText}</div>
      <div className={`rcpt-stamp rcpt-stamp-${stampTone}`} data-stamp>
        <span>{m.statusLabel}</span><small>{m.stampDate}</small>
      </div>

      <hr className="rcpt-dash" />
      {m.items.map((i, k) => (
        <div key={k} className="rcpt-item">
          <div className="rcpt-row"><span className="rcpt-name">{i.name}</span><span>{i.totalText}</span></div>
          <div className="rcpt-sub">{i.qtyText} × {i.unitPriceText}{i.discountText ? ` · diskon ${i.discountText}` : ''}</div>
        </div>
      ))}
      <hr className="rcpt-dash" />
      {m.rows.map((r) => <div key={r.label} className={`rcpt-row rcpt-light${r.tone === 'neg' ? ' rcpt-neg' : ''}`}><span>{r.label}</span><span>{r.value}</span></div>)}
      <hr className="rcpt-solid" />
      <div className="rcpt-row rcpt-grand"><span>TOTAL</span><span>{m.totalText}</span></div>
      <div className="rcpt-row rcpt-light"><span>Dibayar</span><span>{m.paidText}</span></div>
      {m.dueText ? <div className="rcpt-row rcpt-due"><span>Sisa (piutang)</span><span>{m.dueText}</span></div> : null}
      {m.footer ? <div className="rcpt-foot">{m.footer}</div> : <div className="rcpt-foot">Terima kasih sudah berbelanja!</div>}
      <Barcode value={m.barcode} />
      <div className="rcpt-code">{m.barcode}</div>
    </div>
  );
}

/**
 * Kertas struk yang "dicetak" dari printer: kertas meluncur keluar dari celah, lalu stempel menghantam.
 * Tanpa gerak (reduce-motion / otomatisasi): kertas langsung tampil. `torn` = kertas disobek lalu jatuh; `playKey` berubah = cetak ulang.
 */
export function ReceiptPaperWeb({ model, torn = false, playKey = 0, logo = null }: ReceiptPaperProps) {
  const animate = motionAllowed();
  return (
    <div className="rcpt-stage" data-testid="receipt-stage">
      <div className="rcpt-printer" aria-hidden="true"><div className="rcpt-slot" /></div>
      <div className="rcpt-window">
        {torn ? null : animate ? (
          <motion.div key={playKey} className="rcpt-paper-wrap" initial={{ y: '-101%' }} animate={{ y: 0 }} transition={{ duration: PRINT_SECONDS, ease: [0.33, 0, 0.2, 1] }}>
            <StampLayer><Paper m={model} logo={logo} /></StampLayer>
          </motion.div>
        ) : (
          <div className="rcpt-paper-wrap"><Paper m={model} logo={logo} /></div>
        )}
      </div>
      {torn && animate ? (
        <motion.div className="rcpt-paper-wrap rcpt-torn" initial={{ y: 0, rotate: 0, opacity: 1 }} animate={{ y: 360, x: 36, rotate: 7, opacity: 0 }} transition={{ duration: 0.75, ease: 'easeIn' }}>
          <Paper m={model} logo={logo} />
        </motion.div>
      ) : null}
    </div>
  );
}

/** Menunda tampilnya stempel sampai kertas selesai keluar (CSS menganimasikan [data-stamp] di dalamnya). */
function StampLayer({ children }: { children: ReactNode }) {
  return <div className="rcpt-stamp-delay" style={{ ['--print-delay' as string]: `${PRINT_SECONDS}s` }}>{children}</div>;
}
