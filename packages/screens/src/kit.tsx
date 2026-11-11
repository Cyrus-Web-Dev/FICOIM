import type { ReactNode } from 'react';
import { compactRupiah, formatRupiah } from '@ficoim/client';
import { AnimatedNumber, Box, Btn, Field, Icon, Reveal, Scroll, Txt, type IconName } from './ui';
import { useNav } from './nav';

// ------------------------------------------------------------------ kerangka layar
export function Screen({ title, children, right, scroll = true }: { title: string; children?: ReactNode; right?: ReactNode; scroll?: boolean }) {
  const nav = useNav();
  const body = <Reveal className="gap-3 p-4">{children}</Reveal>;
  return (
    <Box className="flex-1 bg-slate-50">
      <Box kind="header" className="flex-row items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
        {nav.depth > 1 ? <Box onPress={nav.back} testID="back" className="px-2 py-1"><Txt className="text-lg text-slate-700">←</Txt></Box> : null}
        <Txt className="flex-1 text-lg font-bold text-slate-900" numberOfLines={1}>{title}</Txt>
        {right}
      </Box>
      {scroll ? <Scroll className="flex-1" contentClassName="pb-24">{body}</Scroll> : body}
    </Box>
  );
}

export function Card({ children, className = '', onPress, testID }: { children?: ReactNode; className?: string; onPress?: () => void; testID?: string }) {
  return <Box kind="card" onPress={onPress} testID={testID} className={`rounded-xl border border-slate-200 bg-white p-3 ${className}`}>{children}</Box>;
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <Box className="gap-2">
      <Box className="flex-row items-center justify-between"><Txt className="text-sm font-bold uppercase text-slate-500">{title}</Txt>{action}</Box>
      {children}
    </Box>
  );
}

export function Row({ title, sub, right, rightSub, onPress, testID, leading }: { title: string; sub?: string | null; right?: string; rightSub?: string | null; onPress?: () => void; testID?: string; leading?: ReactNode }) {
  return (
    <Card onPress={onPress} testID={testID} className="flex-row items-center gap-3">
      {leading}
      <Box className="flex-1">
        <Txt className="text-base font-semibold text-slate-900" numberOfLines={1}>{title}</Txt>
        {sub ? <Txt className="text-sm text-slate-500" numberOfLines={2}>{sub}</Txt> : null}
      </Box>
      {right !== undefined ? (
        <Box className="items-end">
          <Txt className="text-base font-bold text-slate-900">{right}</Txt>
          {rightSub ? <Txt className="text-xs text-slate-500">{rightSub}</Txt> : null}
        </Box>
      ) : null}
    </Card>
  );
}

export type Tint = 'indigo' | 'emerald' | 'amber' | 'rose' | 'sky';
// Kelas ditulis literal agar Tailwind/NativeWind memasukkannya ke CSS.
export const TINT: Record<Tint, { bg: string; fg: string }> = {
  indigo: { bg: 'bg-indigo-100', fg: 'text-indigo-600' }, emerald: { bg: 'bg-emerald-100', fg: 'text-emerald-600' },
  amber: { bg: 'bg-amber-100', fg: 'text-amber-600' }, rose: { bg: 'bg-rose-100', fg: 'text-rose-600' }, sky: { bg: 'bg-sky-100', fg: 'text-sky-600' },
};

/** Lingkaran berwarna berisi ikon. */
export function IconBubble({ icon, tint = 'indigo', size = 36 }: { icon: IconName; tint?: Tint; size?: number }) {
  const t = TINT[tint];
  const dim = size <= 28 ? 'h-7 w-7' : size <= 36 ? 'h-9 w-9' : size <= 44 ? 'h-11 w-11' : 'h-14 w-14';
  return <Box className={`items-center justify-center rounded-full ${dim} ${t.bg}`}><Icon name={icon} size={Math.round(size * 0.5)} className={t.fg} /></Box>;
}

/** Tombol aksi cepat berbentuk ubin: ikon besar + label. */
export function Tile({ icon, label, onPress, tint = 'indigo', testID }: { icon: IconName; label: string; onPress: () => void; tint?: Tint; testID?: string }) {
  return (
    <Box kind="tile" onPress={onPress} testID={testID} className="min-w-[72px] flex-1 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-2 py-3">
      <IconBubble icon={icon} tint={tint} size={44} />
      <Txt className="text-center text-xs font-semibold text-slate-700">{label}</Txt>
    </Box>
  );
}

export function Stat({ label, value, tone = 'default', onPress, testID, amount, format, icon, tint = 'indigo' }: { label: string; value: string; tone?: 'default' | 'good' | 'bad' | 'warn'; onPress?: () => void; testID?: string; /** Bila diisi, web menganimasikan angka dari 0 (teks akhir tetap = value). */ amount?: number; format?: (n: number) => string; icon?: IconName; tint?: Tint }) {
  const color = tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-600' : 'text-slate-900';
  // Nilai panjang (mis. "Rp 15.000.000") dikecilkan, BUKAN dipotong "…": angka uang tidak boleh terpotong.
  const size = value.length <= 11 ? 'text-xl' : value.length <= 14 ? 'text-lg' : 'text-base';
  const cls = `${size} font-bold ${color}`;
  return (
    <Box kind="stat" onPress={onPress} testID={testID} className="min-w-[140px] flex-1 gap-1 rounded-2xl border border-slate-200 bg-white p-3">
      <Box className="flex-row items-center gap-2">
        {icon ? <IconBubble icon={icon} tint={tint} size={28} /> : null}
        <Txt className="flex-1 text-xs text-slate-500" numberOfLines={1}>{label}</Txt>
      </Box>
      {amount !== undefined && format ? <AnimatedNumber value={amount} format={format} className={cls} /> : <Txt className={cls}>{value}</Txt>}
    </Box>
  );
}

// ------------------------------------------------------------------ status
/** Kerangka pemuatan (skeleton): lebih tenang daripada spinner dan menjaga tata letak. */
export const Loading = () => (
  <Box testID="loading" className="gap-2">
    {[0, 1, 2].map((i) => <Box key={i} kind="skeleton" className="h-16 rounded-2xl bg-slate-200" />)}
  </Box>
);
export const Empty = ({ text, icon = 'box' }: { text: string; icon?: IconName }) => (
  <Box className="items-center gap-3 p-8">
    <IconBubble icon={icon} tint="indigo" size={56} />
    <Txt className="text-center text-slate-500">{text}</Txt>
  </Box>
);

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card testID="error-box" className="gap-2 border-rose-200 bg-rose-50">
      <Txt className="text-rose-700">{message}</Txt>
      {onRetry ? <Btn label="Coba lagi" variant="secondary" onPress={onRetry} /> : null}
    </Card>
  );
}

export const FormError = ({ message }: { message: string | null }) => (message ? <Txt testID="form-error" className="text-sm text-rose-600">{message}</Txt> : null);

/** Menampilkan hasil useAsync: memuat / galat / kosong / isi. */
export function Async<T>({ state, empty, children }: { state: { data: T | undefined; error: string | null; loading: boolean; reload: () => void }; empty?: (d: T) => boolean; children: (d: T) => ReactNode }) {
  if (state.error) return <ErrorBox message={state.error} onRetry={state.reload} />;
  if (state.data === undefined) return <Loading />;
  if (empty && empty(state.data)) return <Empty text="Belum ada data." />;
  return <>{children(state.data)}</>;
}

// ------------------------------------------------------------------ kontrol
export function Chips<T extends string>({ options, value, onChange, testID }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; testID?: string }) {
  return (
    <Box className="flex-row flex-wrap gap-2" testID={testID}>
      {options.map((o) => (
        <Box key={o.value} kind={o.value === value ? 'chip-on' : 'chip'} testID={`chip-${o.value}`} onPress={() => onChange(o.value)} className={`rounded-full border px-3 py-1 ${o.value === value ? 'border-indigo-600 bg-indigo-600' : 'border-slate-300 bg-white'}`}>
          <Txt className={`text-sm ${o.value === value ? 'font-bold text-white' : 'text-slate-700'}`}>{o.label}</Txt>
        </Box>
      ))}
    </Box>
  );
}

export function Toggle({ label, value, onChange, testID }: { label: string; value: boolean; onChange: (v: boolean) => void; testID?: string }) {
  return (
    <Box onPress={() => onChange(!value)} testID={testID} className="flex-row items-center justify-between py-1">
      <Txt className="flex-1 text-slate-800">{label}</Txt>
      <Box className={`h-6 w-11 justify-center rounded-full px-0.5 ${value ? 'items-end bg-indigo-600' : 'items-start bg-slate-300'}`}><Box className="h-5 w-5 rounded-full bg-white" /></Box>
    </Box>
  );
}

/** Input Rupiah: hanya digit, tampil dengan titik ribuan. value null = kosong. */
export function MoneyField({ label, value, onChange, error, testID, placeholder }: { label?: string; value: number | null; onChange: (n: number | null) => void; error?: string | null; testID?: string; placeholder?: string }) {
  const text = value === null ? '' : formatRupiah(value, { symbol: false });
  return (
    <Field label={label} testID={testID} value={text} keyboard="numeric" error={error} placeholder={placeholder ?? '0'}
      onChangeText={(t) => { const d = t.replace(/\D/g, ''); if (d.length > 15) return; onChange(d === '' ? null : Number(d)); }} />
  );
}

export function Currency({ n, className = '' }: { n: number; className?: string }) {
  return <Txt className={className}>{formatRupiah(n)}</Txt>;
}

// ------------------------------------------------------------------ grafik batang (tanpa pustaka)
// Kelas ketinggian ditulis literal agar Tailwind (web & NativeWind) memasukkannya ke CSS.
const H = ['h-1', 'h-2', 'h-4', 'h-6', 'h-8', 'h-12', 'h-16', 'h-20', 'h-24', 'h-32'] as const;

export function barHeightClass(value: number, max: number): string {
  if (max <= 0 || value <= 0) return H[0];
  return H[Math.min(H.length - 1, Math.max(0, Math.round((value / max) * (H.length - 1))))] as string;
}

export function BarChart({ items, testID }: { items: { label: string; value: number }[]; testID?: string }) {
  const max = items.reduce((m, i) => Math.max(m, i.value), 0);
  return (
    <Box testID={testID} className="h-44 flex-row items-end gap-2 rounded-2xl border border-slate-200 bg-white p-3">
      {items.map((i, k) => {
        const last = k === items.length - 1;
        return (
          <Box key={`${i.label}-${k}`} className="flex-1 items-center justify-end gap-1">
            {last && i.value > 0 ? <Txt className="text-[10px] font-bold text-indigo-700" numberOfLines={1}>{compactRupiah(i.value)}</Txt> : null}
            <Box className={`w-full rounded-t-lg ${last ? 'bg-indigo-600' : 'bg-indigo-200'} ${barHeightClass(i.value, max)}`} />
            <Txt className={`text-[10px] ${last ? 'font-bold text-indigo-700' : 'text-slate-500'}`} numberOfLines={1}>{i.label}</Txt>
          </Box>
        );
      })}
    </Box>
  );
}

/** Dua deret per bulan (mis. pendapatan & laba kotor) berdampingan. Nilai negatif digambar setinggi minimum. */
export function TrendChart({ items, aLabel, bLabel, testID }: { items: { label: string; a: number; b: number }[]; aLabel: string; bLabel: string; testID?: string }) {
  const max = items.reduce((m, i) => Math.max(m, i.a, i.b), 0);
  return (
    <Box className="gap-2" testID={testID}>
      <Box className="h-44 flex-row items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3">
        {items.map((i, k) => (
          <Box key={`${i.label}-${k}`} className="flex-1 items-center justify-end gap-1">
            <Box className="w-full flex-row items-end justify-center gap-1">
              <Box className={`flex-1 rounded-t-md bg-indigo-500 ${barHeightClass(i.a, max)}`} />
              <Box className={`flex-1 rounded-t-md bg-emerald-400 ${barHeightClass(i.b, max)}`} />
            </Box>
            <Txt className={`text-[10px] ${k === items.length - 1 ? 'font-bold text-indigo-700' : 'text-slate-500'}`} numberOfLines={1}>{i.label}</Txt>
          </Box>
        ))}
      </Box>
      <Box className="flex-row items-center justify-center gap-4">
        <Box className="flex-row items-center gap-1"><Box className="h-2.5 w-2.5 rounded-full bg-indigo-500" /><Txt className="text-xs text-slate-500">{aLabel}</Txt></Box>
        <Box className="flex-row items-center gap-1"><Box className="h-2.5 w-2.5 rounded-full bg-emerald-400" /><Txt className="text-xs text-slate-500">{bLabel}</Txt></Box>
      </Box>
    </Box>
  );
}

// Lebar bar progres: kelas literal agar Tailwind/NativeWind menyertakannya (dua belas langkah).
const W = ['w-0', 'w-1/12', 'w-2/12', 'w-3/12', 'w-4/12', 'w-5/12', 'w-6/12', 'w-7/12', 'w-8/12', 'w-9/12', 'w-10/12', 'w-11/12', 'w-full'] as const;
export const progressWidthClass = (percent: number): string => W[Math.max(0, Math.min(12, Math.round(percent / (100 / 12))))] as string;

export function ProgressBar({ percent, tone, testID }: { percent: number; tone?: 'good' | 'warn' | 'bad'; testID?: string }) {
  const t = tone ?? (percent >= 100 ? 'bad' : percent >= 80 ? 'warn' : 'good');
  const color = t === 'bad' ? 'bg-rose-500' : t === 'warn' ? 'bg-amber-500' : 'bg-emerald-500';
  return <Box testID={testID} className="h-2 w-full overflow-hidden rounded-full bg-slate-200"><Box className={`h-2 rounded-full ${color} ${progressWidthClass(percent)}`} /></Box>;
}

/** Margin per kategori: panjang bar = porsi pendapatan; warna = sehat (≥30%), sedang (15–30%), tipis (<15%). */
export function CategoryMargins({ rows }: { rows: { category: string; revenue: number; profit: number; marginPct: number }[] }) {
  const total = rows.reduce((a, r) => a + r.revenue, 0);
  return (
    <Box className="gap-3 rounded-2xl border border-slate-200 bg-white p-3" testID="category-margins">
      {rows.map((r) => {
        const tone = r.marginPct >= 30 ? 'bg-emerald-500' : r.marginPct >= 15 ? 'bg-amber-500' : 'bg-rose-500';
        const txt = r.marginPct >= 30 ? 'text-emerald-600' : r.marginPct >= 15 ? 'text-amber-600' : 'text-rose-600';
        return (
          <Box key={r.category} className="gap-1" testID="category-row">
            <Box className="flex-row items-center justify-between gap-2">
              <Txt className="flex-1 text-sm font-semibold text-slate-900" numberOfLines={1}>{r.category}</Txt>
              <Txt className={`text-sm font-bold ${txt}`}>{r.marginPct.toString().replace('.', ',')}%</Txt>
            </Box>
            <Box className="h-2 w-full rounded-full bg-slate-100"><Box className={`h-2 rounded-full ${tone} ${progressWidthClass(total > 0 ? (r.revenue / total) * 100 : 0)}`} /></Box>
            <Txt className="text-xs text-slate-500">Pendapatan {formatRupiah(r.revenue)} · laba kotor {formatRupiah(r.profit)}</Txt>
          </Box>
        );
      })}
    </Box>
  );
}
