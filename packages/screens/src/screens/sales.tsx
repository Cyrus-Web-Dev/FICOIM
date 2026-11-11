import { useState } from 'react';
import { fmtDateTime, formatQty, formatRupiah, todayLocal } from '@ficoim/client';
import { Box, Btn, Field, Sheet, Txt } from '../ui';
import { Async, Card, Chips, FormError, Row, Screen, Section } from '../kit';
import { useAction, useAsync } from '../hooks';
import { useApp } from '../platform';
import { useNav } from '../nav';
import { periodRange, type PeriodKey } from '../util';
import { ReceiptPanel } from './receipt';

export const STATUS_LABEL: Record<string, string> = { paid: 'Lunas', partial: 'Cicilan', unpaid: 'Belum bayar', void: 'Batal' };

const PERIODS: { value: PeriodKey; label: string }[] = [{ value: 'today', label: 'Hari ini' }, { value: '7d', label: '7 hari' }, { value: 'month', label: 'Bulan ini' }, { value: 'lastMonth', label: 'Bulan lalu' }];

export function SalesScreen() {
  const { backend, tz } = useApp();
  const nav = useNav();
  const [period, setPeriod] = useState<PeriodKey>('today');
  const state = useAsync(() => { const r = periodRange(period, todayLocal(tz)); return backend.listSales({ from: r.from, to: r.to, limit: 200 }); }, [period]);
  return (
    <Screen title="Riwayat penjualan">
      <Chips options={PERIODS} value={period} onChange={setPeriod} testID="sales-period" />
      <Async state={state} empty={(d) => d.length === 0}>
        {(list) => (
          <Box className="gap-2">
            <Txt testID="sales-sum" className="text-sm text-slate-500">{list.filter((s) => s.status !== 'void').length} transaksi · {formatRupiah(list.filter((s) => s.status !== 'void').reduce((a, s) => a + s.total, 0))}</Txt>
            {list.map((s) => (
              <Row key={s.id} testID="sale-row" title={`${s.number}${s.party ? ` · ${s.party}` : ''}`} sub={`${fmtDateTime(s.at, tz)} · ${STATUS_LABEL[s.status] ?? s.status}`}
                right={formatRupiah(s.total)} rightSub={s.status === 'partial' ? `dibayar ${formatRupiah(s.paid)}` : null} onPress={() => nav.push('saleDetail', { id: s.id })} />
            ))}
          </Box>
        )}
      </Async>
    </Screen>
  );
}

export function SaleDetailScreen() {
  const { backend, tz, platform } = useApp();
  const nav = useNav();
  const id = (nav.route.params as { id: string }).id;
  const state = useAsync(() => backend.getSale(id), [id]);
  const [voiding, setVoiding] = useState(false);
  return (
    <Screen title="Detail penjualan">
      <Async state={state}>
        {(s) => (
          <>
            <Card className="gap-1">
              <Txt className="text-lg font-bold">{s.number}</Txt>
              <Txt className="text-sm text-slate-500">{fmtDateTime(s.at, tz)}{s.party ? ` · ${s.party}` : ''}</Txt>
              <Txt testID="sale-status" className={`font-bold ${s.status === 'void' ? 'text-rose-600' : s.status === 'paid' ? 'text-emerald-600' : 'text-amber-600'}`}>{STATUS_LABEL[s.status] ?? s.status}</Txt>
              {s.note ? <Txt className="text-sm text-slate-600">{s.note}</Txt> : null}
            </Card>
            <Section title="Barang">
              {s.items.map((i, k) => (
                <Row key={k} title={i.name} sub={`${formatRupiah(i.unitPrice)} × ${formatQty(i.qtyMilli)}${i.discount ? ` − ${formatRupiah(i.discount)}` : ''}`} right={formatRupiah(i.lineTotal)} />
              ))}
            </Section>
            <Card className="gap-1">
              <Box className="flex-row justify-between"><Txt>Subtotal</Txt><Txt>{formatRupiah(s.subtotal)}</Txt></Box>
              {s.discount > 0 ? <Box className="flex-row justify-between"><Txt>Diskon</Txt><Txt>−{formatRupiah(s.discount)}</Txt></Box> : null}
              {s.tax > 0 ? <Box className="flex-row justify-between"><Txt>PPN</Txt><Txt>{formatRupiah(s.tax)}</Txt></Box> : null}
              <Box className="flex-row justify-between"><Txt className="font-bold">Total</Txt><Txt className="font-bold">{formatRupiah(s.total)}</Txt></Box>
              <Box className="flex-row justify-between"><Txt>Dibayar</Txt><Txt>{formatRupiah(s.paid)}</Txt></Box>
            </Card>
            <Section title="Struk"><ReceiptPanel saleId={id} /></Section>
            {s.status !== 'void' ? <Btn label="Batalkan penjualan" variant="danger" onPress={() => setVoiding(true)} testID="void-sale" /> : null}
            {voiding ? <VoidSheet onClose={(done) => { setVoiding(false); if (done) { platform.notify('Penjualan dibatalkan'); state.reload(); } }} onVoid={(r) => backend.voidSale(id, r)} /> : null}
          </>
        )}
      </Async>
    </Screen>
  );
}

export function VoidSheet({ onClose, onVoid }: { onClose: (done: boolean) => void; onVoid: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const act = useAction();
  return (
    <Sheet visible title="Batalkan dokumen" onClose={() => onClose(false)}>
      <Txt className="text-sm text-slate-600">Stok dan uang akan dikembalikan. Riwayatnya tetap tersimpan.</Txt>
      <Field label="Alasan pembatalan" value={reason} onChangeText={setReason} testID="void-reason" />
      <FormError message={act.error} />
      <Btn label="Batalkan" variant="danger" loading={act.busy} disabled={!reason.trim()} testID="void-confirm" onPress={() => act.run(async () => { await onVoid(reason.trim()); onClose(true); })} />
    </Sheet>
  );
}
