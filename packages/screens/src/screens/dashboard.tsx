import { useState } from 'react';
import { addDaysStr, buildInsights, compactRupiah, fetchAll, fillDays, formatDelta, formatQty, formatRupiah, todayLocal, deltaPct, type DaySales, type Insight } from '@ficoim/client';
import { AnimatedNumber, AreaChart, Box, DonutChart, Icon, Sparkline, Txt, hasCharts, type IconName } from '../ui';
import { Async, BarChart, CategoryMargins, Chips, IconBubble, Screen, Section, Stat, Tile, progressWidthClass, type Tint } from '../kit';
import { useAsync } from '../hooks';
import { useApp } from '../platform';
import { useNav } from '../nav';
import { fmtShortDay } from '../util';

type Insights = Awaited<ReturnType<typeof loadInsights>>;

async function loadInsights(backend: ReturnType<typeof useApp>['backend'], today: string) {
  const monthStart = `${today.slice(0, 8)}01`, from = addDaysStr(today, -29);
  const ok = <T,>(p: Promise<T>): Promise<T | null> => p.then((v) => v, () => null); // satu sumber gagal tidak mematikan seluruh beranda
  const [daysRaw, trend, top, cats, pl, variants, debts] = await Promise.all([
    ok(backend.salesByDay(from, today)), ok(backend.monthlyTrend(6)), ok(backend.topProducts(monthStart, today, 5)), ok(backend.categoryBreakdown(monthStart, today)),
    ok(backend.profitLoss(monthStart, today)), ok(fetchAll((limit, offset) => backend.listProducts({ limit, offset }), 500, 5000)), ok(backend.listDebts({ kind: 'receivable', onlyOpen: true })),
  ]);
  const days = fillDays(from, today, daysRaw ?? []);
  let safe = 0, low = 0, out = 0;
  for (const v of variants ?? []) {
    if (!v.isActive || !v.trackStock) continue;
    if (v.stockQtyMilli <= 0) out++; else if (v.minStockMilli > 0 && v.stockQtyMilli <= v.minStockMilli) low++; else safe++;
  }
  const overdue = (debts ?? []).filter((d) => d.dueDate && d.dueDate < today).reduce((a, d) => a + d.remaining, 0);
  const stock = variants ? { safe, low, out } : undefined;
  const insights = buildInsights({ days, top: top ?? undefined, categories: cats ?? undefined, stock, cash: pl ? { cashIn: pl.cashIn, cashOut: pl.cashOut } : undefined, overdueReceivable: overdue });
  return { days, trend, top, cats, pl, stock, insights };
}

export function DashboardScreen() {
  const { backend, businessName, tz } = useApp();
  const nav = useNav();
  const state = useAsync(async () => {
    const dash = await backend.dashboard();
    const today = todayLocal(tz);
    const ins = dash.profitToday === null ? null : await loadInsights(backend, today); // kasir: tanpa laporan
    return { dash, today, ins };
  }, []);
  return (
    <Screen title={businessName || 'Beranda'} right={state.data ? <Bell count={state.data.dash.lowStockCount + state.data.dash.expiringCount + state.data.dash.dueBillsCount} onPress={() => nav.push('notifications')} /> : null}>
      <Async state={state}>
        {({ dash, ins }) => {
          const last7 = ins?.days.slice(-7).map((d) => d.total) ?? [];
          const dod = ins && ins.days.length >= 2 ? deltaPct(ins.days[ins.days.length - 1]!.total, ins.days[ins.days.length - 2]!.total) : null;
          return (
            <>
              <Box kind="hero-dash" className="gap-3 rounded-3xl bg-indigo-600 p-4">
                <Box className="flex-row items-center justify-between gap-2">
                  <Txt className="text-sm font-semibold text-indigo-100">Penjualan hari ini</Txt>
                  <Box className="rounded-full bg-white/20 px-3 py-1"><Txt testID="stat-count" className="text-xs font-bold text-white">{dash.salesToday.count} transaksi</Txt></Box>
                </Box>
                <AnimatedNumber value={dash.salesToday.total} format={formatRupiah} testID="stat-sales" className="text-3xl font-extrabold text-white" />
                {dod !== null ? (
                  <Box className="flex-row items-center gap-1" testID="stat-delta">
                    <Icon name={dod >= 0 ? 'trendUp' : 'trendDown'} size={14} className="text-white" />
                    <Txt className="text-xs font-semibold text-white">{formatDelta(dod)} dibanding kemarin</Txt>
                  </Box>
                ) : null}
                {last7.length > 1 ? <Box className="h-9"><Sparkline values={last7} /></Box> : null}
                {dash.profitToday !== null || dash.cashBalance !== null ? (
                  <Box className="flex-row gap-3 border-t border-white/20 pt-3">
                    {dash.profitToday !== null ? (
                      <Box className="flex-1 gap-0.5">
                        <Box className="flex-row items-center gap-1"><Icon name={dash.profitToday >= 0 ? 'trendUp' : 'trendDown'} size={14} className="text-indigo-100" /><Txt className="text-xs text-indigo-100">Laba kotor</Txt></Box>
                        <AnimatedNumber value={dash.profitToday} format={formatRupiah} testID="stat-profit" className="text-base font-bold text-white" />
                      </Box>
                    ) : null}
                    {dash.cashBalance !== null ? (
                      <Box className="flex-1 gap-0.5">
                        <Box className="flex-row items-center gap-1"><Icon name="wallet" size={14} className="text-indigo-100" /><Txt className="text-xs text-indigo-100">Saldo kas</Txt></Box>
                        <AnimatedNumber value={dash.cashBalance} format={formatRupiah} testID="stat-cash" className="text-base font-bold text-white" />
                      </Box>
                    ) : null}
                  </Box>
                ) : null}
              </Box>

              <Section title="Aksi cepat">
                <Box className="flex-row gap-2">
                  <Tile icon="receipt" label="Kasir" tint="indigo" onPress={() => nav.goTab('pos')} testID="qa-pos" />
                  <Tile icon="plus" label="Produk baru" tint="emerald" onPress={() => nav.push('productForm')} testID="qa-product" />
                  <Tile icon="inbox" label="Pembelian" tint="sky" onPress={() => nav.push('purchaseForm')} testID="qa-purchase" />
                  <Tile icon="chart" label="Laporan" tint="amber" onPress={() => nav.push('reports')} testID="qa-reports" />
                </Box>
              </Section>

              {ins && ins.insights.length > 0 ? <InsightsCard items={ins.insights} /> : null}

              {dash.receivable !== null || dash.payable !== null ? (
                <Box className="flex-row gap-2">
                  {dash.receivable !== null ? <Stat label="Piutang" icon="users" tint="amber" value={formatRupiah(dash.receivable)} amount={dash.receivable} format={formatRupiah} tone="warn" onPress={() => nav.goTab('finance')} testID="stat-receivable" /> : null}
                  {dash.payable !== null ? <Stat label="Hutang" icon="inbox" tint="rose" value={formatRupiah(dash.payable)} amount={dash.payable} format={formatRupiah} tone="warn" onPress={() => nav.goTab('finance')} testID="stat-payable" /> : null}
                </Box>
              ) : null}

              {ins ? <TrendCard ins={ins} /> : null}
              {ins?.pl ? <CashflowCard pl={ins.pl} /> : null}
              {ins?.cats && ins.cats.length > 0 ? <CategoryCard cats={ins.cats} /> : null}
              {ins?.top && ins.top.length > 0 ? <TopProductsCard top={ins.top} /> : null}
              {ins?.stock && ins.stock.safe + ins.stock.low + ins.stock.out > 0 ? <StockHealthCard stock={ins.stock} onPress={() => nav.goTab('products')} /> : null}

              {dash.lowStockCount + dash.expiringCount + dash.dueBillsCount > 0 ? (
                <Section title="Perlu perhatian">
                  {dash.lowStockCount > 0 ? <Alert testID="alert-low" tint="amber" icon="alert" text={`${dash.lowStockCount} produk stoknya menipis`} onPress={() => nav.goTab('products')} /> : null}
                  {dash.expiringCount > 0 ? <Alert testID="alert-exp" tint="rose" icon="clock" text={`${dash.expiringCount} produk mendekati/lewat kedaluwarsa`} onPress={() => nav.push('reports')} /> : null}
                  {dash.dueBillsCount > 0 ? <Alert testID="alert-bills" tint="amber" icon="receipt" text={`${dash.dueBillsCount} tagihan jatuh tempo ≤ 7 hari`} onPress={() => nav.goTab('finance')} /> : null}
                </Section>
              ) : null}
            </>
          );
        }}
      </Async>
    </Screen>
  );
}

const TONE: Record<Insight['tone'], { tint: Tint }> = { good: { tint: 'emerald' }, warn: { tint: 'amber' }, info: { tint: 'sky' } };

/** Ringkasan cerdas: wawasan singkat dari data (kenaikan, margin tipis, stok habis, kas, piutang terlambat). */
function InsightsCard({ items }: { items: Insight[] }) {
  return (
    <Section title="Ringkasan cerdas">
      <Box kind="card" testID="insights" className="gap-3 rounded-2xl border border-slate-200 bg-white p-3">
        {items.map((i) => (
          <Box key={i.id} testID="insight" className="flex-row items-start gap-3">
            <IconBubble icon={i.icon as IconName} tint={TONE[i.tone].tint} size={32} />
            <Txt className="flex-1 pt-1 text-sm leading-snug text-slate-700">{i.text}</Txt>
          </Box>
        ))}
      </Box>
    </Section>
  );
}

type Range = '7' | '30' | '6m';

/** Tren penjualan interaktif: 7 hari / 30 hari / 6 bulan; ringkasan total, rata-rata, dan perubahan periode. */
function TrendCard({ ins }: { ins: Insights }) {
  const [range, setRange] = useState<Range>('7');
  const dayPoints = (ds: DaySales[]) => ds.map((d) => ({ label: fmtShortDay(d.date), value: d.total, hint: d.count ? `${d.count} transaksi` : 'tanpa transaksi' }));
  const sel = range === '7' ? ins.days.slice(-7) : ins.days;
  const prev = range === '7' ? ins.days.slice(-14, -7) : [];
  let points = dayPoints(sel), total = sel.reduce((a, d) => a + d.total, 0), avgLabel = 'Rata-rata/hari', avg = Math.round(total / Math.max(1, sel.length));
  let delta: number | null = range === '7' && prev.length === 7 ? deltaPct(total, prev.reduce((a, d) => a + d.total, 0)) : null;
  let periodText = range === '7' ? '7 hari terakhir' : '30 hari terakhir';
  if (range === '6m') {
    const t = ins.trend ?? [];
    points = t.map((m) => ({ label: MONTHS[Number(m.month.slice(5, 7)) - 1] ?? m.month, value: m.revenue, value2: m.grossProfit, hint: `laba bersih ${compactRupiah(m.netProfit)}` }));
    total = t.reduce((a, m) => a + m.revenue, 0); avg = Math.round(total / Math.max(1, t.length)); avgLabel = 'Rata-rata/bulan'; periodText = '6 bulan terakhir';
    delta = t.length >= 2 ? deltaPct(t[t.length - 1]!.revenue, t[t.length - 2]!.revenue) : null;
  }
  return (
    <Section title="Tren penjualan">
      <Box kind="card" testID="trend-card" className="gap-3 rounded-2xl border border-slate-200 bg-white p-3">
        <Chips options={[{ value: '7', label: '7 hari' }, { value: '30', label: '30 hari' }, ...(ins.trend ? [{ value: '6m', label: '6 bulan' }] : [])]} value={range} onChange={(v) => setRange(v as Range)} testID="trend-range" />
        <Box className="flex-row items-end justify-between gap-2">
          <Box>
            <Txt className="text-xs text-slate-500">Total {periodText}</Txt>
            <Txt testID="trend-total" className="text-xl font-extrabold text-slate-900">{formatRupiah(total)}</Txt>
          </Box>
          <Box className="items-end">
            {delta !== null ? <Box className={`flex-row items-center gap-1 rounded-full px-2 py-0.5 ${delta >= 0 ? 'bg-emerald-100' : 'bg-rose-100'}`}><Icon name={delta >= 0 ? 'trendUp' : 'trendDown'} size={12} className={delta >= 0 ? 'text-emerald-600' : 'text-rose-600'} /><Txt className={`text-xs font-bold ${delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatDelta(delta)}</Txt></Box> : null}
            <Txt className="pt-0.5 text-xs text-slate-500">{avgLabel} {compactRupiah(avg)}</Txt>
          </Box>
        </Box>
        {hasCharts()
          ? <AreaChart testID="trend-chart" points={points} format={formatRupiah} formatAxis={compactRupiah} seriesLabel={range === '6m' ? 'Pendapatan bersih' : 'Penjualan'} series2Label="Laba kotor" />
          : <BarChart testID="trend-chart" items={points.slice(-7).map((p) => ({ label: p.label.split(' ')[0] ?? p.label, value: p.value }))} />}
        {range === '6m' ? <Box className="flex-row items-center justify-center gap-4"><Box className="flex-row items-center gap-1"><Box className="h-2.5 w-2.5 rounded-full bg-indigo-500" /><Txt className="text-xs text-slate-500">Pendapatan bersih</Txt></Box><Box className="flex-row items-center gap-1"><Box className="h-2.5 w-2.5 rounded-full bg-emerald-400" /><Txt className="text-xs text-slate-500">Laba kotor</Txt></Box></Box> : null}
      </Box>
    </Section>
  );
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Kas masuk vs keluar bulan ini dan laba bersih. */
function CashflowCard({ pl }: { pl: NonNullable<Insights['pl']> }) {
  const max = Math.max(1, pl.cashIn, pl.cashOut);
  return (
    <Section title="Arus kas bulan ini">
      <Box kind="card" testID="cashflow-card" className="gap-3 rounded-2xl border border-slate-200 bg-white p-3">
        {([['Kas masuk', pl.cashIn, 'bg-emerald-500', 'text-emerald-600'], ['Kas keluar', pl.cashOut, 'bg-rose-500', 'text-rose-600']] as const).map(([label, v, bar, txt]) => (
          <Box key={label} className="gap-1">
            <Box className="flex-row justify-between"><Txt className="text-sm text-slate-600">{label}</Txt><Txt className={`text-sm font-bold ${txt}`}>{formatRupiah(v)}</Txt></Box>
            <Box className="h-2.5 w-full rounded-full bg-slate-100"><Box className={`h-2.5 rounded-full ${bar} ${progressWidthClass((v / max) * 100)}`} /></Box>
          </Box>
        ))}
        <Box className="flex-row items-center justify-between border-t border-slate-100 pt-2">
          <Txt className="text-sm font-semibold text-slate-700">Laba bersih</Txt>
          <Txt className={`text-base font-extrabold ${pl.netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatRupiah(pl.netProfit)}</Txt>
        </Box>
      </Box>
    </Section>
  );
}

/** Komposisi penjualan per kategori (donat bila tersedia, jika tidak daftar margin). */
function CategoryCard({ cats }: { cats: NonNullable<Insights['cats']> }) {
  return (
    <Section title="Penjualan per kategori">
      <Box kind="card" testID="category-card" className="gap-2 rounded-2xl border border-slate-200 bg-white p-3">
        {hasCharts()
          ? <DonutChart testID="category-donut" centerLabel="Bulan ini" format={formatRupiah} slices={cats.map((c) => ({ label: c.category, value: c.revenue, note: `margin ${c.marginPct.toString().replace('.', ',')}%` }))} />
          : <CategoryMargins rows={cats} />}
      </Box>
    </Section>
  );
}

function TopProductsCard({ top }: { top: NonNullable<Insights['top']> }) {
  const max = Math.max(1, ...top.map((t) => t.revenue));
  return (
    <Section title="Produk terlaris bulan ini">
      <Box kind="card" testID="top-card" className="gap-3 rounded-2xl border border-slate-200 bg-white p-3">
        {top.map((t, i) => (
          <Box key={t.name} testID="top-row" className="gap-1">
            <Box className="flex-row items-center gap-3">
              <Box className={`h-7 w-7 items-center justify-center rounded-full ${i === 0 ? 'bg-amber-100' : 'bg-slate-100'}`}><Txt className={`text-xs font-extrabold ${i === 0 ? 'text-amber-600' : 'text-slate-500'}`}>{i + 1}</Txt></Box>
              <Box className="flex-1"><Txt className="text-sm font-semibold text-slate-900" numberOfLines={1}>{t.name}</Txt><Txt className="text-xs text-slate-500">{formatQty(t.qtyMilli)} terjual</Txt></Box>
              <Txt className="text-sm font-bold text-slate-900">{compactRupiah(t.revenue)}</Txt>
            </Box>
            <Box className="ml-10 h-1.5 rounded-full bg-slate-100"><Box className={`h-1.5 rounded-full bg-indigo-500 ${progressWidthClass((t.revenue / max) * 100)}`} /></Box>
          </Box>
        ))}
      </Box>
    </Section>
  );
}

/** Kesehatan stok: berapa produk aman, menipis, habis. */
function StockHealthCard({ stock, onPress }: { stock: { safe: number; low: number; out: number }; onPress: () => void }) {
  const total = stock.safe + stock.low + stock.out;
  return (
    <Section title="Kesehatan stok">
      <Box kind="card" testID="stock-card" onPress={onPress} className="gap-3 rounded-2xl border border-slate-200 bg-white p-3">
        {([['Aman', stock.safe, 'bg-emerald-500', 'text-emerald-600'], ['Menipis', stock.low, 'bg-amber-500', 'text-amber-600'], ['Habis', stock.out, 'bg-rose-500', 'text-rose-600']] as const).map(([label, n, bar, txt]) => (
          <Box key={label} className="gap-1">
            <Box className="flex-row justify-between"><Txt className="text-sm text-slate-600">{label}</Txt><Txt className={`text-sm font-bold ${txt}`}>{n} produk</Txt></Box>
            <Box className="h-2 w-full rounded-full bg-slate-100"><Box className={`h-2 rounded-full ${bar} ${progressWidthClass((n / total) * 100)}`} /></Box>
          </Box>
        ))}
      </Box>
    </Section>
  );
}

function Alert({ icon, tint, text, onPress, testID }: { icon: IconName; tint: Tint; text: string; onPress: () => void; testID: string }) {
  return (
    <Box kind="card" testID={testID} onPress={onPress} className="flex-row items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
      <IconBubble icon={icon} tint={tint} size={36} />
      <Txt className="flex-1 text-sm font-medium text-slate-800">{text}</Txt>
      <Icon name="chevron" size={18} className="text-slate-400" />
    </Box>
  );
}

/** Lonceng notifikasi dengan lencana jumlah peringatan. */
function Bell({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <Box testID="bell" onPress={onPress} className="h-10 w-10 items-center justify-center rounded-full bg-slate-100">
      <Icon name="bell" size={20} className="text-slate-700" />
      {count > 0 ? <Box className="absolute -right-1 -top-1 min-w-[18px] items-center rounded-full bg-rose-600 px-1"><Txt testID="bell-count" className="text-[10px] font-bold text-white">{count > 99 ? '99+' : count}</Txt></Box> : null}
    </Box>
  );
}
