import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import gsap from 'gsap';
import type { AnimatedNumberProps, BackdropProps, BoxProps, BtnProps, FieldProps, ImgProps, RevealProps, ScrollProps, SheetProps, SpinnerProps, TxtProps, UIImpl } from '@ficoim/screens';
import { motionAllowed } from './motion';
import { ReceiptPaperWeb } from './receipt.web';
import { IconWeb } from './icons';
import { PaymentStageWeb } from './payment.web';
import { QrCodeWeb } from './qr.web';
import { AreaChartWeb, DonutChartWeb, SparklineWeb } from './charts.web';
import { renderReceiptPng } from './receipt-image';
import { ThemeToggleWeb } from './theme';

const Hero3D = lazy(() => import('./hero3d'));

const cx = (...a: (string | false | null | undefined)[]): string => a.filter(Boolean).join(' ');

function Box({ className, children, onPress, testID, disabled, kind }: BoxProps) {
  if (!onPress) return <div data-testid={testID} data-kind={kind} className={cx('rn', className)}>{children}</div>;
  return (
    <div
      role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled ? true : undefined} data-testid={testID} data-kind={kind}
      className={cx('rn cursor-pointer select-none', disabled && 'opacity-50', className)}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onPress(); }}
      onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); onPress(); } }}
    >{children}</div>
  );
}

function Txt({ className, children, numberOfLines, testID }: TxtProps) {
  const style = numberOfLines && numberOfLines > 1 ? { display: '-webkit-box', WebkitLineClamp: numberOfLines, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' } : undefined;
  return <span data-testid={testID} className={cx('rn-t', numberOfLines === 1 && 'truncate', className)} style={style}>{children}</span>;
}

const VARIANT = { primary: 'bg-indigo-600 text-white', secondary: 'bg-slate-200 text-slate-900', danger: 'bg-rose-600 text-white', ghost: 'bg-transparent text-indigo-700' } as const;

function Btn({ label, onPress, variant = 'primary', disabled, loading, className, testID }: BtnProps) {
  const off = disabled || loading;
  const cls = cx('btn rounded-xl px-4 py-2 text-center font-semibold', VARIANT[variant], off && 'opacity-50', className);
  const text = loading ? 'Memproses…' : label;
  if (!motionAllowed() || off) return <button type="button" data-testid={testID} data-variant={variant} disabled={off} onClick={onPress} className={cls}>{text}</button>;
  return (
    <motion.button type="button" data-testid={testID} data-variant={variant} onClick={onPress} className={cls} whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}>
      {text}
    </motion.button>
  );
}

function Field(p: FieldProps) {
  const type = p.secure ? 'password' : p.keyboard === 'email' ? 'email' : p.keyboard === 'phone' ? 'tel' : 'text';
  const inputMode = p.keyboard === 'numeric' ? 'numeric' : p.keyboard === 'decimal' ? 'decimal' : undefined;
  const cls = cx('w-full rounded-lg border bg-white px-3 py-2 text-slate-900', p.error ? 'border-rose-500' : 'border-slate-300');
  return (
    <label className={cx('rn gap-1', p.className)}>
      {p.label ? <span className="text-sm text-slate-600">{p.label}</span> : null}
      {p.multiline
        ? <textarea rows={3} value={p.value} placeholder={p.placeholder} autoFocus={p.autoFocus} data-testid={p.testID} className={cls} onChange={(e) => p.onChangeText(e.target.value)} />
        : <input type={type} inputMode={inputMode} value={p.value} placeholder={p.placeholder} autoFocus={p.autoFocus} data-testid={p.testID} className={cls}
            autoCapitalize={p.autoCapitalize} autoComplete={p.secure ? 'current-password' : 'off'} onChange={(e) => p.onChangeText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && p.onSubmit) { e.preventDefault(); p.onSubmit(); } }} />}
      {p.error ? <span className="text-sm text-rose-600">{p.error}</span> : null}
    </label>
  );
}

function Scroll({ className, contentClassName, children, testID }: ScrollProps) {
  return <div data-testid={testID} className={cx('min-h-0 overflow-y-auto', className)}><div className={cx('rn', contentClassName)}>{children}</div></div>;
}

function Sheet({ visible, title, onClose: onCloseProp, children, locked }: SheetProps) {
  const onClose = locked ? () => {} : onCloseProp;
  useEffect(() => {
    if (!visible || locked) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [visible, locked, onClose]);
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-lg font-bold text-slate-900">{title}</span>
        {locked ? null : <button type="button" data-testid="sheet-close" aria-label="Tutup" onClick={onClose} className="px-2 text-xl text-slate-500">✕</button>}
      </div>
      {children}
    </>
  );
  const dialogCls = 'sheet-panel rn max-h-[90vh] w-full max-w-lg gap-3 overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl';
  if (!motionAllowed()) {
    if (!visible) return null;
    return (
      <div className="sheet-backdrop fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="presentation" onClick={onClose}>
        <div role="dialog" aria-label={title} data-testid="sheet" className={dialogCls} onClick={(e) => e.stopPropagation()}>{inner}</div>
      </div>
    );
  }
  return (
    <AnimatePresence>
      {visible ? (
        <motion.div key="sheet" className="sheet-backdrop fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="presentation" onClick={onClose}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
          <motion.div role="dialog" aria-label={title} data-testid="sheet" className={dialogCls} onClick={(e) => e.stopPropagation()}
            initial={{ y: 48, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 24, opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }}>
            {inner}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function Spinner({ className }: SpinnerProps) {
  return <div role="status" aria-label="Memuat" className={cx('h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600', className)} />;
}

/** Gambar dari byte (foto produk/nota). URL objek dibuat sekali per gambar dan dilepas saat tidak dipakai. */
function Img({ bytes, mime, className, alt, testID }: ImgProps) {
  const url = useMemo(() => URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime })), [bytes, mime]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt={alt ?? ''} data-testid={testID} loading="lazy" decoding="async" className={cx('object-cover', className)} />;
}

/** Muncul perlahan dari bawah; `index` memberi jeda bertahap. Tanpa gerak: wadah biasa. */
function Reveal({ children, index = 0, className }: RevealProps) {
  if (!motionAllowed()) return <div className={cx('rn', className)}>{children}</div>;
  return (
    <motion.div className={cx('rn', className)} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.38, delay: Math.min(index, 8) * 0.06, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  );
}

/** Angka berhitung naik (GSAP). Teks akhir selalu = format(value); bila gerak dimatikan langsung tampil. */
function AnimatedNumber({ value, format, className, testID }: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = format(value);
    if (!motionAllowed()) return;
    const o = { v: 0 };
    el.textContent = format(0);
    const tween = gsap.to(o, { v: value, duration: 0.9, ease: 'power2.out', onUpdate: () => { el.textContent = format(Math.round(o.v)); }, onComplete: () => { el.textContent = format(value); } });
    const safety = setTimeout(() => { el.textContent = format(value); }, 1500); // pengaman: angka akhir selalu tampil walau animasi gagal
    return () => { clearTimeout(safety); tween.kill(); el.textContent = format(value); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <span ref={ref} data-testid={testID} className={cx('rn-t', className)}>{format(value)}</span>;
}

/** Latar layar masuk: gradasi aurora (CSS) + adegan 3D (Three.js, dimuat malas, hanya bila gerak diizinkan). */
function Backdrop({ children, className }: BackdropProps) {
  return (
    <div className={cx('rn relative isolate overflow-hidden', className)}>
      <div className="aurora absolute inset-0 -z-10" aria-hidden="true">
        {motionAllowed() ? <Suspense fallback={null}><Hero3D /></Suspense> : null}
      </div>
      {children}
    </div>
  );
}

export const webUI: UIImpl = { Box, Txt, Btn, Field, Scroll, Sheet, Spinner, Img, Reveal, AnimatedNumber, Backdrop, ReceiptPaper: ReceiptPaperWeb, Icon: IconWeb, ThemeToggle: ThemeToggleWeb, PaymentStage: PaymentStageWeb, QrCode: QrCodeWeb, AreaChart: AreaChartWeb, DonutChart: DonutChartWeb, Sparkline: SparklineWeb, renderReceiptImage: renderReceiptPng, animationsEnabled: motionAllowed };
