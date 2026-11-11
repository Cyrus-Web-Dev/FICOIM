import { useState } from 'react';
import { fmtDateTime, formatRupiah, labelOf } from '@ficoim/client';
import { lineTotal } from '@ficoim/shared';
import { Box, Btn, Field, Sheet, Txt } from '../ui';
import { Async, Card, Chips, FormError, MoneyField, Row, Screen, Section } from '../kit';
import { useAction, useAsync, useDebounced } from '../hooks';
import { useApp } from '../platform';
import { useNav } from '../nav';
import { qtyToMilli } from '../util';
import { STATUS_LABEL, VoidSheet } from './sales';
import { Photo, PhotoField } from '../photos';

export function PurchasesScreen() {
  const { backend, tz, platform } = useApp();
  const nav = useNav();
  const state = useAsync(() => backend.listPurchases({ limit: 100 }), []);
  const [voidId, setVoidId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ id: string; number: string; receipt: string | null; status: string } | null>(null);
  return (
    <Screen title="Pembelian stok" right={<Btn label="+ Baru" onPress={() => nav.push('purchaseForm')} testID="add-purchase" />}>
      <Async state={state} empty={(d) => d.length === 0}>
        {(list) => (
          <Box className="gap-2">
            {list.map((p) => (
              <Row key={p.id} testID="purchase-row" leading={p.receiptAttachmentId ? <Photo id={p.receiptAttachmentId} icon="receipt" /> : undefined} title={`${p.number}${p.party ? ` · ${p.party}` : ''}`} sub={`${fmtDateTime(p.at, tz)} · ${STATUS_LABEL[p.status] ?? p.status}`}
                right={formatRupiah(p.total)} rightSub={p.status === 'partial' ? `dibayar ${formatRupiah(p.paid)}` : null} onPress={p.status !== 'void' || p.receiptAttachmentId ? () => setViewing({ id: p.id, number: p.number, receipt: p.receiptAttachmentId, status: p.status }) : undefined} />
            ))}
            <Txt className="text-xs text-slate-500">Ketuk pembelian untuk melihat nota atau membatalkannya.</Txt>
          </Box>
        )}
      </Async>
      {viewing ? (
        <Sheet visible title={viewing.number} onClose={() => setViewing(null)}>
          {viewing.receipt ? <Photo id={viewing.receipt} className="h-72 w-full rounded-xl" icon="receipt" testID="nota-full" /> : <Txt className="text-slate-500">Tidak ada foto nota.</Txt>}
          {viewing.status !== 'void' ? <Btn label="Batalkan pembelian" variant="danger" testID="purchase-void-open" onPress={() => { setVoidId(viewing.id); setViewing(null); }} /> : null}
        </Sheet>
      ) : null}
      {voidId ? <VoidSheet onClose={(done) => { setVoidId(null); if (done) { platform.notify('Pembelian dibatalkan'); state.reload(); } }} onVoid={(r) => backend.voidPurchase(voidId, r)} /> : null}
    </Screen>
  );
}

interface Line { variantId: string; name: string; qty: string; cost: number | null }

export function PurchaseFormScreen() {
  const { backend, platform } = useApp();
  const nav = useNav();
  const suppliers = useAsync(() => backend.listSuppliers(), []);
  const [q, setQ] = useState(''); const dq = useDebounced(q, 250);
  const found = useAsync(() => (dq.trim() ? backend.listProducts({ search: dq, limit: 8 }) : Promise.resolve([])), [dq]);
  const [lines, setLines] = useState<Line[]>([]);
  const [supplierId, setSupplierId] = useState(''); const [newSup, setNewSup] = useState('');
  const [notaId, setNotaId] = useState<string | null>(null);
  const [discount, setDiscount] = useState<number | null>(null); const [paid, setPaid] = useState<number | null>(null); const [due, setDue] = useState('');
  const act = useAction();

  const patch = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const subtotal = lines.reduce((s, l) => { const q2 = qtyToMilli(l.qty); return s + (q2 && q2 > 0 ? lineTotal(q2, l.cost ?? 0) : 0); }, 0);
  const total = Math.max(0, subtotal - Math.min(discount ?? 0, subtotal));
  const paidNow = paid === null ? total : Math.min(paid, total);

  const addSupplier = () => act.run(async () => { if (!newSup.trim()) return; const id = await backend.createSupplier({ name: newSup.trim() }); setSupplierId(id); setNewSup(''); suppliers.reload(); });
  const save = () => act.run(async () => {
    const items = lines.map((l, i) => {
      const m = qtyToMilli(l.qty);
      if (m === null || m <= 0) throw new Error(`Jumlah baris ${i + 1} tidak valid.`);
      return { variantId: l.variantId, qtyMilli: m, unitCost: l.cost ?? 0 };
    });
    await backend.createPurchase({ items, supplierId: supplierId || null, discount: Math.min(discount ?? 0, subtotal), paid: paidNow, dueDate: paidNow < total && due ? due : null, receiptAttachmentId: notaId });
    platform.notify('Pembelian tersimpan, stok bertambah');
    nav.back();
  });

  return (
    <Screen title="Pembelian baru">
      <Field value={q} onChangeText={setQ} placeholder="Cari produk untuk ditambah…" testID="pur-search" autoCapitalize="none" />
      <Async state={found}>
        {(list) => (
          <Box className="gap-1">
            {list.map((v) => <Row key={v.id} testID="pur-result" title={labelOf(v)} sub={`Modal terakhir ${formatRupiah(v.costPrice)}`} onPress={() => { setLines((ls) => [...ls, { variantId: v.id, name: labelOf(v), qty: '1', cost: v.costPrice }]); setQ(''); }} />)}
          </Box>
        )}
      </Async>
      <Section title={`Barang (${lines.length})`}>
        {lines.map((l, i) => (
          <Card key={`${l.variantId}-${i}`} testID={`pur-line-${i}`} className="gap-2">
            <Box className="flex-row items-center justify-between"><Txt className="flex-1 font-semibold">{l.name}</Txt><Btn label="Hapus" variant="ghost" onPress={() => setLines((ls) => ls.filter((_, k) => k !== i))} /></Box>
            <Box className="flex-row gap-2">
              <Box className="flex-1"><Field label="Jumlah" value={l.qty} onChangeText={(t) => patch(i, { qty: t })} keyboard="decimal" testID={`pur-qty-${i}`} /></Box>
              <Box className="flex-1"><MoneyField label="Harga beli satuan" value={l.cost} onChange={(n) => patch(i, { cost: n })} testID={`pur-cost-${i}`} /></Box>
            </Box>
          </Card>
        ))}
      </Section>
      <Txt className="text-sm text-slate-600">Pemasok</Txt>
      <Async state={suppliers}>{(list) => <Chips options={[{ value: '', label: 'Tanpa pemasok' }, ...list.slice(0, 12).map((s) => ({ value: s.id, label: s.name }))]} value={supplierId} onChange={setSupplierId} />}</Async>
      <Box className="flex-row items-end gap-2"><Box className="flex-1"><Field value={newSup} onChangeText={setNewSup} placeholder="Pemasok baru…" testID="pur-new-supplier" /></Box><Btn label="Tambah" variant="secondary" onPress={addSupplier} /></Box>
      <PhotoField label="Foto nota belanja (opsional)" value={notaId} onChange={setNotaId} testID="pur-nota" icon="receipt" />
      <MoneyField label="Diskon" value={discount} onChange={setDiscount} />
      <MoneyField label="Dibayar sekarang (kosong = lunas)" value={paid} onChange={setPaid} testID="pur-paid" />
      {paidNow < total ? <Field label="Jatuh tempo hutang (YYYY-MM-DD)" value={due} onChangeText={setDue} placeholder="2026-12-31" /> : null}
      <Card className="gap-1"><Box className="flex-row justify-between"><Txt className="font-bold">Total</Txt><Txt testID="pur-total" className="font-bold">{formatRupiah(total)}</Txt></Box>{paidNow < total ? <Txt className="text-amber-700">Sisa {formatRupiah(total - paidNow)} jadi hutang (pemasok wajib dipilih)</Txt> : null}</Card>
      <FormError message={act.error} />
      <Btn label="Simpan pembelian" onPress={save} loading={act.busy} disabled={lines.length === 0} testID="pur-save" />
    </Screen>
  );
}
