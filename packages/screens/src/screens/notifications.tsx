import { fmtDate, formatQty, formatRupiah, labelOf, todayLocal } from '@ficoim/client';
import { Box, Txt } from '../ui';
import { Async, Card, Empty, IconBubble, Row, Screen, Section } from '../kit';
import { useAsync } from '../hooks';
import { useApp } from '../platform';
import { useNav } from '../nav';

/** Pusat notifikasi: semua yang perlu ditindak hari ini. Sumber yang tidak boleh diakses peran Anda (mis. kasir) dilewati begitu saja. */
export function NotificationsScreen() {
  const { backend, tz } = useApp();
  const nav = useNav();
  const state = useAsync(async () => {
    const today = todayLocal(tz);
    const [low, exp, bills, debts] = await Promise.all([
      backend.listProducts({ lowStockOnly: true, limit: 100 }).catch(() => []),
      backend.expiring(30).catch(() => []),
      backend.dueBills(7).catch(() => []),
      backend.listDebts({ kind: 'receivable', onlyOpen: true }).catch(() => []),
    ]);
    return { low, exp, bills, late: debts.filter((d) => d.dueDate && d.dueDate < today) };
  }, []);
  return (
    <Screen title="Notifikasi">
      <Async state={state}>
        {({ low, exp, bills, late }) => {
          const total = low.length + exp.length + bills.length + late.length;
          if (total === 0) return <Box testID="notif-empty"><Empty icon="check" text="Semua aman. Tidak ada yang perlu ditindak hari ini." /></Box>;
          return (
            <>
              <Card className="flex-row items-center gap-3"><IconBubble icon="bell" tint="indigo" size={36} /><Txt className="flex-1 text-sm text-slate-700"><Txt className="font-bold">{total}</Txt> hal perlu perhatian</Txt></Card>
              {low.length > 0 ? (
                <Section title={`Stok menipis (${low.length})`}>
                  {low.map((v) => <Row key={v.id} testID="notif-low" title={labelOf(v)} sub={`Minimum ${formatQty(v.minStockMilli)} ${v.unit}`} right={`${formatQty(v.stockQtyMilli)} ${v.unit}`} rightSub={v.stockQtyMilli <= 0 ? 'Habis' : 'Menipis'} onPress={() => nav.push('productDetail', { productId: v.productId, productName: v.productName })} />)}
                </Section>
              ) : null}
              {exp.length > 0 ? (
                <Section title={`Kedaluwarsa (${exp.length})`}>
                  {exp.map((e) => <Row key={e.variantId} testID="notif-exp" title={e.name} sub={`${e.expired ? 'Sudah lewat' : 'Kedaluwarsa'} ${fmtDate(e.expiryDate)}`} right={`${formatQty(e.stockQtyMilli)}`} rightSub={e.expired ? 'Lewat' : 'Segera'} />)}
                </Section>
              ) : null}
              {bills.length > 0 ? (
                <Section title={`Tagihan jatuh tempo (${bills.length})`}>
                  {bills.map((b) => <Row key={b.id} testID="notif-bill" title={b.description ?? b.categoryName} sub={`${b.overdue ? 'Terlambat · ' : ''}${fmtDate(b.nextDueDate)}`} right={formatRupiah(b.amount)} onPress={() => nav.goTab('finance')} />)}
                </Section>
              ) : null}
              {late.length > 0 ? (
                <Section title={`Piutang lewat jatuh tempo (${late.length})`}>
                  {late.map((d) => <Row key={d.id} testID="notif-late" title={d.partyName} sub={`Jatuh tempo ${fmtDate(d.dueDate!)}`} right={formatRupiah(d.remaining)} onPress={() => nav.goTab('finance')} />)}
                </Section>
              ) : null}
            </>
          );
        }}
      </Async>
    </Screen>
  );
}
