import type { ReactNode } from 'react';
import type { ReceiptModel } from '@ficoim/client';

/**
 * KONTRAK PRIMITIF UI. Semua layar hanya memakai komponen di berkas ini; web (div/span/input) dan mobile
 * (View/Text/TextInput) masing-masing menyediakan implementasi tipis lewat registerUI(). Dengan begitu satu kode layar
 * berjalan di dua platform, dan satu-satunya kode yang menyentuh react-native / className NativeWind ada di apps/mobile/src/ui.native.tsx.
 *
 * Gaya: hanya utilitas Tailwind yang didukung NativeWind & web (flex, padding, warna, rounded, ukuran teks). Hindari grid, space-*, hover:.
 */
/** Peran visual (opsional). Web memakainya untuk gaya khusus (kaca, bayangan, gradasi); mobile mengabaikannya. */
export type BoxKind = 'card' | 'header' | 'tabbar' | 'tab' | 'tab-on' | 'stat' | 'hero' | 'hero-dash' | 'tile' | 'chip' | 'chip-on' | 'skeleton' | 'bar' | 'bar-on';
export interface BoxProps { className?: string; children?: ReactNode; onPress?: () => void; testID?: string; disabled?: boolean; kind?: BoxKind }
export interface TxtProps { className?: string; children?: ReactNode; numberOfLines?: number; testID?: string }
export type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export interface BtnProps { label: string; onPress: () => void; variant?: BtnVariant; disabled?: boolean; loading?: boolean; className?: string; testID?: string }
export interface FieldProps {
  label?: string; value: string; onChangeText: (t: string) => void; placeholder?: string; secure?: boolean;
  keyboard?: 'default' | 'numeric' | 'decimal' | 'email' | 'phone'; multiline?: boolean; error?: string | null;
  autoFocus?: boolean; onSubmit?: () => void; testID?: string; className?: string; autoCapitalize?: 'none' | 'sentences' | 'words';
}
export interface ScrollProps { className?: string; contentClassName?: string; children?: ReactNode; testID?: string }
/** `locked` = tidak bisa ditutup (tombol ✕, latar, Esc dinonaktifkan) — dipakai saat pembayaran sedang diproses. */
export interface SheetProps { visible: boolean; title: string; onClose: () => void; children?: ReactNode; locked?: boolean }
/** Animasi alur pembayaran layar penuh: memproses (cincin koneksi aman + persen) lalu sukses (centang, confetti, nominal). */
export interface PaymentStageProps { phase: 'processing' | 'success'; amountText: string; onContinue?: () => void }
export interface SpinnerProps { className?: string }
/** Nama ikon yang tersedia. Web menggambar SVG; HP memakai emoji cadangan (ICON_EMOJI). */
export type IconName =
  | 'home' | 'receipt' | 'package' | 'wallet' | 'more' | 'plus' | 'minus' | 'bag' | 'chart' | 'inbox' | 'tag' | 'download' | 'sliders' | 'users' | 'lock'
  | 'alert' | 'clock' | 'trendUp' | 'trendDown' | 'search' | 'camera' | 'image' | 'check' | 'x' | 'chevron' | 'sun' | 'moon' | 'file' | 'history' | 'shield' | 'scan' | 'box' | 'bell';
export interface IconProps { name: IconName; size?: number; className?: string }
export const ICON_EMOJI: Record<IconName, string> = {
  home: '🏠', receipt: '🧾', package: '📦', wallet: '💰', more: '⋯', plus: '➕', minus: '➖', bag: '🛍️', chart: '📊', inbox: '📥', tag: '🏷️', download: '💾', sliders: '⚙️', users: '👥', lock: '🔐',
  alert: '⚠️', clock: '⏰', trendUp: '📈', trendDown: '📉', search: '🔍', camera: '📷', image: '🖼️', check: '✅', x: '✕', chevron: '›', sun: '☀️', moon: '🌙', file: '📄', history: '🕘', shield: '🛡️', scan: '📷', box: '📦', bell: '🔔',
};
export interface QrCodeProps { value: string; className?: string; testID?: string }
/** Titik grafik: `value` deret utama, `value2` deret kedua (opsional, mis. laba kotor). */
export interface ChartPoint { label: string; value: number; value2?: number; /** Teks pendek di tooltip (mis. "5 transaksi"). */ hint?: string }
export interface AreaChartProps { points: ChartPoint[]; format: (n: number) => string; /** Format label sumbu (mis. ringkas "1,5 jt"); bawaan = format. */ formatAxis?: (n: number) => string; seriesLabel?: string; series2Label?: string; testID?: string }
export interface DonutSlice { label: string; value: number; note?: string }
export interface DonutChartProps { slices: DonutSlice[]; centerLabel: string; format: (n: number) => string; testID?: string }
export interface SparklineProps { values: number[]; className?: string }
export interface ImgProps { bytes: Uint8Array; mime: string; className?: string; alt?: string; testID?: string }
/** `index` = urutan kemunculan (untuk jeda bertahap). */
export interface RevealProps { children?: ReactNode; index?: number; className?: string }
export interface AnimatedNumberProps { value: number; format: (n: number) => string; className?: string; testID?: string }
export interface BackdropProps { children?: ReactNode; className?: string }
/** `torn` = kertas disobek (animasi keluar); `playKey` berubah = cetak ulang dari awal. */
export interface ReceiptPaperProps { model: ReceiptModel; torn?: boolean; playKey?: number; /** Logo toko (byte gambar) bila ada. */ logo?: { bytes: Uint8Array; mime: string } | null }

export interface UIImpl {
  Box: (p: BoxProps) => ReactNode;
  Txt: (p: TxtProps) => ReactNode;
  Btn: (p: BtnProps) => ReactNode;
  Field: (p: FieldProps) => ReactNode;
  Scroll: (p: ScrollProps) => ReactNode;
  Sheet: (p: SheetProps) => ReactNode;
  Spinner: (p: SpinnerProps) => ReactNode;
  // ---- opsional: bila tidak diimplementasikan platform, layar tetap berfungsi dengan cadangan polos ----
  Img?: (p: ImgProps) => ReactNode;
  Reveal?: (p: RevealProps) => ReactNode;
  AnimatedNumber?: (p: AnimatedNumberProps) => ReactNode;
  Backdrop?: (p: BackdropProps) => ReactNode;
  /** Struk berupa kertas animasi (web). Bila tidak ada, layar memakai struk teks. */
  ReceiptPaper?: (p: ReceiptPaperProps) => ReactNode;
  /** Ikon vektor (web). Tanpa ini dipakai emoji. */
  Icon?: (p: IconProps) => ReactNode;
  /** Grafik interaktif (web, d3). Tanpa ini layar memakai grafik batang sederhana. */
  AreaChart?: (p: AreaChartProps) => ReactNode;
  DonutChart?: (p: DonutChartProps) => ReactNode;
  Sparkline?: (p: SparklineProps) => ReactNode;
  /** Menggambar struk menjadi PNG (web, lewat canvas). */
  renderReceiptImage?: (model: ReceiptModel, logo?: { bytes: Uint8Array; mime: string } | null) => Promise<Uint8Array>;
  /** QR code vektor (web). Dipakai untuk label produk yang bisa dicetak. */
  QrCode?: (p: QrCodeProps) => ReactNode;
  /** Animasi pembayaran (web). */
  PaymentStage?: (p: PaymentStageProps) => ReactNode;
  /** Apakah animasi diizinkan saat ini (web: tidak bila 'kurangi gerakan'/otomatisasi). */
  animationsEnabled?: () => boolean;
  /** Tombol ganti tema terang/gelap (web). */
  ThemeToggle?: () => ReactNode;
}

let impl: UIImpl | null = null;
const REQUIRED: (keyof UIImpl)[] = ['Box', 'Txt', 'Btn', 'Field', 'Scroll', 'Sheet', 'Spinner'];

/** Panggil SEKALI sebelum render pertama. Gagal cepat bila ada primitif yang belum diimplementasikan. */
export function registerUI(i: UIImpl): void {
  for (const k of REQUIRED) if (typeof i[k] !== 'function') throw new Error(`registerUI: primitif "${k}" belum diimplementasikan`);
  impl = i;
}

function ui(): UIImpl {
  if (!impl) throw new Error('registerUI() belum dipanggil sebelum render.');
  return impl;
}

// Pembungkus stabil: layar memakai ini; implementasi dicari saat render.
export const Box = (p: BoxProps) => { const C = ui().Box; return <C {...p} />; };
export const Txt = (p: TxtProps) => { const C = ui().Txt; return <C {...p} />; };
export const Btn = (p: BtnProps) => { const C = ui().Btn; return <C {...p} />; };
export const Field = (p: FieldProps) => { const C = ui().Field; return <C {...p} />; };
export const Scroll = (p: ScrollProps) => { const C = ui().Scroll; return <C {...p} />; };
export const Sheet = (p: SheetProps) => { const C = ui().Sheet; return <C {...p} />; };
export const Spinner = (p: SpinnerProps) => { const C = ui().Spinner; return <C {...p} />; };

// Primitif opsional: cadangan bila platform tidak menyediakannya.
export const Img = (p: ImgProps) => { const C = ui().Img; return C ? <C {...p} /> : null; };
export const Reveal = (p: RevealProps) => { const C = ui().Reveal; return C ? <C {...p} /> : <>{p.children}</>; };
export const AnimatedNumber = (p: AnimatedNumberProps) => { const C = ui().AnimatedNumber; return C ? <C {...p} /> : <Txt className={p.className} testID={p.testID}>{p.format(p.value)}</Txt>; };
export const Backdrop = (p: BackdropProps) => { const C = ui().Backdrop; return C ? <C {...p} /> : <Box className={p.className ?? 'flex-1'}>{p.children}</Box>; };
export const hasReceiptPaper = (): boolean => !!ui().ReceiptPaper;
export const ReceiptPaper = (p: ReceiptPaperProps) => { const C = ui().ReceiptPaper; return C ? <C {...p} /> : null; };
export const Icon = (p: IconProps) => { const C = ui().Icon; return C ? <C {...p} /> : <Txt className={p.className}>{ICON_EMOJI[p.name]}</Txt>; };
export const ThemeToggle = () => { const C = ui().ThemeToggle; return C ? <C /> : null; };
export const hasPaymentStage = (): boolean => !!ui().PaymentStage && (ui().animationsEnabled?.() ?? true);
export const PaymentStage = (p: PaymentStageProps) => { const C = ui().PaymentStage; return C ? <C {...p} /> : null; };
export const hasQrCode = (): boolean => !!ui().QrCode;
export const QrCode = (p: QrCodeProps) => { const C = ui().QrCode; return C ? <C {...p} /> : null; };
export const hasReceiptImage = (): boolean => !!ui().renderReceiptImage;
export const renderReceiptImage = (m: ReceiptModel, logo?: { bytes: Uint8Array; mime: string } | null): Promise<Uint8Array> => { const f = ui().renderReceiptImage; if (!f) throw new Error('Gambar struk tidak tersedia di perangkat ini.'); return f(m, logo); };
export const hasCharts = (): boolean => !!ui().AreaChart && !!ui().DonutChart;
export const AreaChart = (p: AreaChartProps) => { const C = ui().AreaChart; return C ? <C {...p} /> : null; };
export const DonutChart = (p: DonutChartProps) => { const C = ui().DonutChart; return C ? <C {...p} /> : null; };
export const Sparkline = (p: SparklineProps) => { const C = ui().Sparkline; return C ? <C {...p} /> : null; };
