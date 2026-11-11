import { useState } from 'react';
import { buildReportPdf, buildReportWorkbook, fmtDate, formatQty, formatRupiah, todayLocal } from '@ficoim/client';
import { Box, Btn, Txt } from '../ui';
import { Async, BarChart, Card, Chips, Row, Screen, Section, CategoryMargins, TrendChart } from '../kit';
import { useAction, useAsync } from '../hooks';
import { useApp } from '../platform';
import { PERIOD_OPTIONS, periodRange, fmtShortDay, type PeriodKey } from '../util';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function ReportsScreen() {
  const { backend, tz, businessName, platform } = useApp();
  const exp = useAction();
  const [period, setPeriod] = useState<PeriodKey>('month');
  const { from, to } = periodRange(period, todayLocal(tz));
  const state = useAsync(async () => {
    const [pl, top, days, stock, expiring, trend, cats] = await Promise.all([backend.profitLoss(from, to), backend.topProducts(from, to, 5), backend.salesByDay(from, to), backend.stockValue(), backend.expiring(30), backend.monthlyTrend(6), backend.categoryBreakdown(from, to)]);
    return { pl, top, days, stock, expiring, trend, cats };
  }, [period]);
  return (
    <Screen title="Laporan">
      <Chips options={PERIOD_OPTIONS} value={period} onChange={setPeriod} testID="report-period" />
      <Box className="flex-row items-center justify-between gap-2">
        <Txt className="flex-1 text-xs text-slate-500">{fmtDate(from)} – {fmtDate(to)}</Txt>
        <Btn label="📄 PDF" variant="secondary" testID="export-pdf" loading={exp.busy}
          onPress={() => exp.run(async () => {
            const f = await buildReportPdf(backend, { from, to, tzOffsetMinutes: tz, businessName: businessName || 'Bisnis' });
            await platform.saveFile({ bytes: f.bytes, fileName: f.fileName, mime: f.mime });
            platform.notify(`PDF siap: ${f.fileName}`);
          })} />
        <Btn label="📥 Excel" variant="secondary" testID="export-xlsx" loading={exp.busy}
          onPress={() => exp.run(async () => {
            const f = await buildReportWorkbook(backend, { from, to, tzOffsetMinutes: tz, businessName: businessName || 'Bisnis' });
            await platform.saveFile({ bytes: f.bytes, fileName: f.fileName, mime: f.mime });
            platform.notify(`Laporan ${f.sheets} sheet siap: ${f.fileName}`);
          })} />
      </Box>
      {exp.error ? <Txt className="text-sm text-rose-600">{exp.error}</Txt> : null}
      <Async state={state}>
        {({ pl, top, days, stock, expiring, trend, cats }) => (
          <>
            <Card testID="pl-card" className="gap-1">
              <Txt className="text-sm font-bold uppercase text-slate-500">Laba rugi</Txt>
              <Line label={`Penjualan (${pl.salesCount} transaksi)`} value={formatRupiah(pl.grossSales)} />
              {pl.tax > 0 ? <Line label="PPN (bukan pendapatan)" value={`−${formatRupiah(pl.tax)}`} /> : null}
              <Line label="Pendapatan bersih" value={formatRupiah(pl.netRevenue)} bold />
              <Line label="Harga pokok (HPP)" value={`−${formatRupiah(pl.cogs)}`} />
              <Line label="Laba kotor" value={formatRupiah(pl.grossProfit)} bold testID="pl-gross" />
              {pl.otherIncome > 0 ? <Line label="Pemasukan lain" value={formatRupiah(pl.otherIncome)} /> : null}
              {pl.expensesByCategory.map((e) => <Line key={e.category} label={`Biaya: ${e.category}`} value={`−${formatRupiah(e.total)}`} />)}
              <Line label="LABA BERSIH" value={formatRupiah(pl.netProfit)} bold tone={pl.netProfit >= 0 ? 'good' : 'bad'} testID="pl-net" />
            </Card>
            <Card className="gap-1">
              <Txt className="text-sm font-bold uppercase text-slate-500">Arus kas</Txt>
              <Line label="Masuk" value={formatRupiah(pl.cashIn)} />
              <Line label="Keluar" value={`−${formatRupiah(pl.cashOut)}`} />
              <Txt className="text-xs text-slate-500">Tidak termasuk transfer antar dompet.</Txt>
            </Card>
            {days.length > 1 && days.length <= 31 ? <Section title="Penjualan harian"><BarChart items={days.map((d) => ({ label: fmtShortDay(d.date).split(' ')[0] as string, value: d.total }))} /></Section> : null}
            <Section title="Tren 6 bulan"><TrendChart testID="trend-chart" aLabel="Pendapatan bersih" bLabel="Laba kotor" items={trend.map((m) => ({ label: MONTHS[Number(m.month.slice(5, 7)) - 1] ?? m.month, a: m.revenue, b: m.grossProfit }))} /></Section>
            {cats.length > 0 ? <Section title="Margin per kategori"><CategoryMargins rows={cats} /></Section> : null}
            <Section title="Produk terlaris">
              {top.length === 0 ? <Txt className="text-slate-500">Belum ada penjualan pada periode ini.</Txt> : null}
              {top.map((t, i) => <Row key={t.variantId} testID="top-row" title={`${i + 1}. ${t.name}`} sub={`Terjual ${formatQty(t.qtyMilli)} · laba ${formatRupiah(t.profit)}`} right={formatRupiah(t.revenue)} />)}
            </Section>
            <Section title="Nilai persediaan">
              <Card><Txt testID="stock-value" className="text-xl font-bold">{formatRupiah(stock.value)}</Txt><Txt className="text-xs text-slate-500">{stock.items} varian berstok, dihitung dari harga beli</Txt></Card>
            </Section>
            {expiring.length > 0 ? (
              <Section title="Kedaluwarsa ≤ 30 hari">
                {expiring.map((e) => <Row key={e.variantId} title={e.name} sub={`${e.expired ? 'SUDAH LEWAT · ' : ''}${fmtDate(e.expiryDate)}`} right={formatQty(e.stockQtyMilli)} />)}
              </Section>
            ) : null}
          </>
        )}
      </Async>
    </Screen>
  );
}

function Line({ label, value, bold, tone, testID }: { label: string; value: string; bold?: boolean; tone?: 'good' | 'bad'; testID?: string }) {
  const color = tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-rose-600' : 'text-slate-900';
  return <Box className="flex-row justify-between gap-2"><Txt className={`flex-1 ${bold ? 'font-bold' : 'text-slate-600'}`}>{label}</Txt><Txt testID={testID} className={`${bold ? 'font-bold' : ''} ${color}`}>{value}</Txt></Box>;
}
