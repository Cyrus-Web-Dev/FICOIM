import { useEffect, useState } from 'react';
import { fmtDate, formatRupiah, todayLocal, type DebtView } from '@ficoim/client';
import { Box, Btn, Field, Sheet, Txt } from '../ui';
import { Async, Card, Chips, FormError, MoneyField, ProgressBar, Row, Screen, Section } from '../kit';
import { useAction, useAsync } from '../hooks';
import { useApp } from '../platform';
import { Photo, PhotoField } from '../photos';
import { periodRange, type PeriodKey } from '../util';

type Seg = 'wallets' | 'tx' | 'debts' | 'budget' | 'bills' | 'goals';
const SEGS: { value: Seg; label: string }[] = [
  { value: 'wallets', label: 'Dompet' }, { value: 'tx', label: 'Transaksi' }, { value: 'debts', label: 'Hutang/Piutang' }, { value: 'budget', label: 'Anggaran' }, { value: 'bills', label: 'Tagihan' }, { value: 'goals', label: 'Target' },
];

export function FinanceScreen() {
  const [seg, setSeg] = useState<Seg>('wallets');
  return (
    <Screen title="Keuangan">
      <Chips options={SEGS} value={seg} onChange={setSeg} testID="fin-seg" />
      {seg === 'wallets' ? <WalletsSection /> : null}
      {seg === 'tx' ? <TxSection /> : null}
      {seg === 'debts' ? <DebtsSection /> : null}
      {seg === 'budget' ? <BudgetSection /> : null}
      {seg === 'bills' ? <BillsSection /> : null}
      {seg === 'goals' ? <GoalsSection /> : null}
    </Screen>
  );
}

// ------------------------------------------------------------------ pemilih
function WalletPicker({ value, onChange, label = 'Dompet' }: { value: string; onChange: (id: string) => void; label?: string }) {
  const { backend } = useApp();
  const state = useAsync(() => backend.listWallets(), []);
  useEffect(() => { const first = state.data?.[0]; if (!value && first) onChange(first.id); }, [state.data]);
  return (<><Txt className="text-sm text-slate-600">{label}</Txt><Async state={state}>{(list) => <Chips options={list.map((w) => ({ value: w.id, label: `${w.name} (${formatRupiah(w.balance)})` }))} value={value} onChange={onChange} testID="wallet-picker" />}</Async></>);
}

function CategoryPicker({ type, value, onChange }: { type: 'income' | 'expense'; value: string; onChange: (id: string) => void }) {
  const { backend } = useApp();
  const state = useAsync(() => backend.listFinanceCategories(), []);
  const opts = (state.data ?? []).filter((c) => c.type === type && !c.isSystem);
  useEffect(() => { if (opts.length && !opts.some((o) => o.id === value)) onChange((opts[0] as { id: string }).id); }, [state.data, type]);
  return (<><Txt className="text-sm text-slate-600">Kategori</Txt><Async state={state}>{() => <Chips options={opts.map((c) => ({ value: c.id, label: `${c.icon ?? ''} ${c.name}`.trim() }))} value={value} onChange={onChange} testID="category-picker" />}</Async></>);
}

// ------------------------------------------------------------------ dompet
function WalletsSection() {
  const { backend } = useApp();
  const state = useAsync(() => backend.listWallets(), []);
  const [sheet, setSheet] = useState<'wallet' | 'transfer' | null>(null);
  const close = (reload?: boolean) => { setSheet(null); if (reload) state.reload(); };
  return (
    <Section title="Dompet" action={<Box className="flex-row gap-2"><Btn label="Transfer" variant="secondary" onPress={() => setSheet('transfer')} testID="open-transfer" /><Btn label="+ Dompet" onPress={() => setSheet('wallet')} testID="open-wallet" /></Box>}>
      <Async state={state}>
        {(list) => (
          <>
            <Card><Txt className="text-xs text-slate-500">Total saldo</Txt><Txt testID="wallet-total" className="text-2xl font-bold">{formatRupiah(list.reduce((s, w) => s + w.balance, 0))}</Txt></Card>
            {list.map((w) => <Row key={w.id} testID="wallet-row" title={w.name} sub={w.type} right={formatRupiah(w.balance)} />)}
          </>
        )}
      </Async>
      {sheet === 'wallet' ? <NewWalletSheet onClose={close} /> : null}
      {sheet === 'transfer' ? <TransferSheet onClose={close} /> : null}
    </Section>
  );
}

function NewWalletSheet({ onClose }: { onClose: (r?: boolean) => void }) {
  const { backend } = useApp();
  const [name, setName] = useState(''); const [type, setType] = useState('bank'); const [open, setOpen] = useState<number | null>(null);
  const act = useAction();
  return (
    <Sheet visible title="Dompet baru" onClose={() => onClose()}>
      <Field label="Nama (mis. BCA, GoPay)" value={name} onChangeText={setName} testID="nw-name" />
      <Chips options={[{ value: 'cash', label: 'Tunai' }, { value: 'bank', label: 'Bank' }, { value: 'ewallet', label: 'E-wallet' }, { value: 'other', label: 'Lainnya' }]} value={type} onChange={setType} />
      <MoneyField label="Saldo awal" value={open} onChange={setOpen} testID="nw-open" />
      <FormError message={act.error} />
      <Btn label="Simpan" loading={act.busy} disabled={!name.trim()} testID="nw-save" onPress={() => act.run(async () => { await backend.createWallet({ name: name.trim(), type, openingBalance: open ?? 0 }); onClose(true); })} />
    </Sheet>
  );
}

function TransferSheet({ onClose }: { onClose: (r?: boolean) => void }) {
  const { backend, platform } = useApp();
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [amount, setAmount] = useState<number | null>(null); const [note, setNote] = useState('');
  const act = useAction();
  return (
    <Sheet visible title="Transfer antar dompet" onClose={() => onClose()}>
      <WalletPicker label="Dari" value={from} onChange={setFrom} />
      <WalletPicker label="Ke" value={to} onChange={setTo} />
      <MoneyField label="Nominal" value={amount} onChange={setAmount} testID="tr-amount" />
      <Field label="Catatan (opsional)" value={note} onChangeText={setNote} />
      <FormError message={act.error} />
      <Btn label="Transfer" loading={act.busy} disabled={!amount || !from || !to} testID="tr-save" onPress={() => act.run(async () => { await backend.transfer({ fromWalletId: from, toWalletId: to, amount: amount ?? 0, note: note || null }); platform.notify('Transfer berhasil'); onClose(true); })} />
    </Sheet>
  );
}

// ------------------------------------------------------------------ transaksi
function TxSection() {
  const { backend, tz, platform } = useApp();
  const [period, setPeriod] = useState<PeriodKey>('month');
  const state = useAsync(() => { const r = periodRange(period, todayLocal(tz)); return backend.listTransactions({ from: r.from, to: r.to, limit: 200 }); }, [period]);
  const [adding, setAdding] = useState(false);
  const act = useAction();
  const remove = (id: string) => act.run(async () => {
    if (!(await platform.confirm('Hapus transaksi?', 'Saldo dompet akan dikoreksi.', { destructive: true, confirmLabel: 'Hapus' }))) return;
    await backend.deleteTransaction(id); state.reload();
  });
  return (
    <Section title="Transaksi" action={<Btn label="+ Catat" onPress={() => setAdding(true)} testID="open-add-tx" />}>
      <Chips options={[{ value: 'today', label: 'Hari ini' }, { value: '7d', label: '7 hari' }, { value: 'month', label: 'Bulan ini' }, { value: 'lastMonth', label: 'Bulan lalu' }]} value={period} onChange={setPeriod} />
      <FormError message={act.error} />
      <Async state={state} empty={(d) => d.length === 0}>
        {(list) => (
          <Box className="gap-2">
            {list.map((t) => (
              <Row key={t.id} testID="tx-row" leading={t.receiptAttachmentId ? <Photo id={t.receiptAttachmentId} icon="receipt" /> : undefined} title={t.description ?? t.categoryName} sub={`${fmtDate(t.occurredOn)} · ${t.categoryName} · ${t.walletName}${t.auto ? ' · otomatis' : ''}`}
                right={`${t.type === 'income' ? '+' : '−'}${formatRupiah(t.amount)}`} onPress={t.auto ? undefined : () => remove(t.id)} />
            ))}
            <Txt className="text-xs text-slate-500">Ketuk transaksi manual untuk menghapus. Transaksi otomatis dibatalkan lewat dokumen asalnya.</Txt>
          </Box>
        )}
      </Async>
      {adding ? <AddTxSheet onClose={(r) => { setAdding(false); if (r) state.reload(); }} /> : null}
    </Section>
  );
}

function AddTxSheet({ onClose }: { onClose: (r?: boolean) => void }) {
  const { backend, tz } = useApp();
  const [type, setType] = useState<'income' | 'expense'>('expense'); const [walletId, setWalletId] = useState(''); const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState<number | null>(null); const [date, setDate] = useState(todayLocal(tz)); const [desc, setDesc] = useState('');
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const act = useAction();
  return (
    <Sheet visible title="Catat transaksi" onClose={() => onClose()}>
      <Chips options={[{ value: 'expense', label: 'Pengeluaran' }, { value: 'income', label: 'Pemasukan' }]} value={type} onChange={setType} testID="tx-type" />
      <WalletPicker value={walletId} onChange={setWalletId} />
      <CategoryPicker type={type} value={categoryId} onChange={setCategoryId} />
      <MoneyField label="Nominal" value={amount} onChange={setAmount} testID="tx-amount" />
      <Field label="Tanggal (YYYY-MM-DD)" value={date} onChangeText={setDate} testID="tx-date" />
      <Field label="Keterangan" value={desc} onChangeText={setDesc} testID="tx-desc" />
      <PhotoField label="Foto bukti / struk (opsional)" value={receiptId} onChange={setReceiptId} testID="tx-receipt" icon="receipt" />
      <FormError message={act.error} />
      <Btn label="Simpan" loading={act.busy} disabled={!amount || !walletId || !categoryId} testID="tx-save"
        onPress={() => act.run(async () => { await backend.addTransaction({ walletId, categoryId, type, amount: amount ?? 0, occurredOn: date, description: desc || null, receiptAttachmentId: receiptId }); onClose(true); })} />
    </Sheet>
  );
}

// ------------------------------------------------------------------ hutang & piutang
function DebtsSection() {
  const { backend } = useApp();
  const [kind, setKind] = useState<'receivable' | 'payable'>('receivable');
  const state = useAsync(() => backend.listDebts({ kind, onlyOpen: true }), [kind]);
  const [pay, setPay] = useState<DebtView | null>(null); const [adding, setAdding] = useState(false);
  return (
    <Section title="Hutang & piutang" action={<Btn label="+ Manual" variant="secondary" onPress={() => setAdding(true)} />}>
      <Chips options={[{ value: 'receivable', label: 'Piutang (pelanggan)' }, { value: 'payable', label: 'Hutang (pemasok)' }]} value={kind} onChange={setKind} testID="debt-kind" />
      <Async state={state} empty={(d) => d.length === 0}>
        {(list) => (
          <Box className="gap-2">
            <Txt testID="debt-sum" className="text-sm text-slate-500">Total sisa: {formatRupiah(list.reduce((s, d) => s + d.remaining, 0))}</Txt>
            {list.map((d) => <Row key={d.id} testID="debt-row" title={d.partyName} sub={`${d.dueDate ? `Jatuh tempo ${fmtDate(d.dueDate)}` : 'Tanpa jatuh tempo'}${d.note ? ` · ${d.note}` : ''}`} right={formatRupiah(d.remaining)} rightSub={d.paidAmount > 0 ? `dari ${formatRupiah(d.amount)}` : null} onPress={() => setPay(d)} />)}
          </Box>
        )}
      </Async>
      {pay ? <PayDebtSheet debt={pay} onClose={(r) => { setPay(null); if (r) state.reload(); }} /> : null}
      {adding ? <NewDebtSheet onClose={(r) => { setAdding(false); if (r) state.reload(); }} /> : null}
    </Section>
  );
}

function PayDebtSheet({ debt, onClose }: { debt: DebtView; onClose: (r?: boolean) => void }) {
  const { backend, platform } = useApp();
  const [amount, setAmount] = useState<number | null>(debt.remaining); const [walletId, setWalletId] = useState('');
  const act = useAction();
  return (
    <Sheet visible title={`${debt.kind === 'receivable' ? 'Terima pelunasan' : 'Bayar hutang'} — ${debt.partyName}`} onClose={() => onClose()}>
      <Txt className="text-slate-600">Sisa: {formatRupiah(debt.remaining)}</Txt>
      <MoneyField label="Nominal" value={amount} onChange={setAmount} testID="debt-amount" />
      <WalletPicker value={walletId} onChange={setWalletId} label={debt.kind === 'receivable' ? 'Masuk ke dompet' : 'Dibayar dari dompet'} />
      <FormError message={act.error} />
      <Btn label="Simpan" loading={act.busy} disabled={!amount || !walletId} testID="debt-pay-save"
        onPress={() => act.run(async () => { const r = await backend.payDebt(debt.id, { amount: amount ?? 0, walletId }); platform.notify(r.status === 'settled' ? 'Lunas ✅' : `Sisa ${formatRupiah(r.remaining)}`); onClose(true); })} />
    </Sheet>
  );
}

function NewDebtSheet({ onClose }: { onClose: (r?: boolean) => void }) {
  const { backend } = useApp();
  const [kind, setKind] = useState<'receivable' | 'payable'>('receivable'); const [party, setParty] = useState(''); const [amount, setAmount] = useState<number | null>(null); const [due, setDue] = useState('');
  const act = useAction();
  return (
    <Sheet visible title="Catat hutang/piutang manual" onClose={() => onClose()}>
      <Chips options={[{ value: 'receivable', label: 'Piutang' }, { value: 'payable', label: 'Hutang' }]} value={kind} onChange={setKind} />
      <Field label="Nama pihak" value={party} onChangeText={setParty} testID="nd-party" />
      <MoneyField label="Jumlah" value={amount} onChange={setAmount} testID="nd-amount" />
      <Field label="Jatuh tempo (YYYY-MM-DD, opsional)" value={due} onChangeText={setDue} />
      <FormError message={act.error} />
      <Btn label="Simpan" loading={act.busy} disabled={!party.trim() || !amount} testID="nd-save" onPress={() => act.run(async () => { await backend.createDebt({ kind, partyName: party.trim(), amount: amount ?? 0, dueDate: due || null }); onClose(true); })} />
    </Sheet>
  );
}

// ------------------------------------------------------------------ anggaran
function BudgetSection() {
  const { backend, tz } = useApp();
  const t = todayLocal(tz); const month = Number(t.slice(5, 7)), year = Number(t.slice(0, 4));
  const state = useAsync(() => backend.budgetStatus(month, year), []);
  const [adding, setAdding] = useState(false);
  return (
    <Section title="Anggaran bulan ini" action={<Btn label="+ Atur" onPress={() => setAdding(true)} testID="open-budget" />}>
      <Async state={state} empty={(d) => d.length === 0}>
        {(list) => (
          <Box className="gap-2">
            {list.map((b) => (
              <Card key={b.budgetId} testID="budget-row" className="gap-1">
                <Box className="flex-row justify-between"><Txt className="font-semibold">{b.categoryName}</Txt><Txt className={b.percentUsed >= 100 ? 'font-bold text-rose-600' : 'text-slate-600'}>{b.percentUsed}%</Txt></Box>
                <ProgressBar percent={b.percentUsed} />
                <Txt className="text-xs text-slate-500">{formatRupiah(b.spent)} dari {formatRupiah(b.limit)} · sisa {formatRupiah(b.remaining)}</Txt>
              </Card>
            ))}
          </Box>
        )}
      </Async>
      {adding ? <BudgetSheet month={month} year={year} onClose={(r) => { setAdding(false); if (r) state.reload(); }} /> : null}
    </Section>
  );
}

function BudgetSheet({ month, year, onClose }: { month: number; year: number; onClose: (r?: boolean) => void }) {
  const { backend } = useApp();
  const [categoryId, setCategoryId] = useState(''); const [amount, setAmount] = useState<number | null>(null);
  const act = useAction();
  return (
    <Sheet visible title="Atur anggaran bulan ini" onClose={() => onClose()}>
      <CategoryPicker type="expense" value={categoryId} onChange={setCategoryId} />
      <MoneyField label="Batas pengeluaran" value={amount} onChange={setAmount} testID="bg-amount" />
      <FormError message={act.error} />
      <Btn label="Simpan" loading={act.busy} disabled={!amount || !categoryId} testID="bg-save" onPress={() => act.run(async () => { await backend.setBudget({ categoryId, amountLimit: amount ?? 0, month, year }); onClose(true); })} />
    </Sheet>
  );
}

// ------------------------------------------------------------------ tagihan berulang
function BillsSection() {
  const { backend, platform } = useApp();
  const state = useAsync(() => backend.dueBills(60), []);
  const [adding, setAdding] = useState(false);
  const act = useAction();
  const payBill = (id: string) => act.run(async () => { const r = await backend.payBill(id); platform.notify(`Dibayar. Jatuh tempo berikut ${fmtDate(r.nextDueDate)}`); state.reload(); });
  return (
    <Section title="Tagihan (60 hari ke depan)" action={<Btn label="+ Tagihan" onPress={() => setAdding(true)} testID="open-bill" />}>
      <FormError message={act.error} />
      <Async state={state} empty={(d) => d.length === 0}>
        {(list) => (
          <Box className="gap-2">
            {list.map((b) => (
              <Card key={b.id} testID="bill-row" className="flex-row items-center gap-2">
                <Box className="flex-1"><Txt className="font-semibold">{b.description ?? b.categoryName}</Txt><Txt className={`text-xs ${b.overdue ? 'text-rose-600' : 'text-slate-500'}`}>{b.overdue ? 'Terlambat · ' : ''}{fmtDate(b.nextDueDate)} · {b.frequency}</Txt></Box>
                <Txt className="font-bold">{formatRupiah(b.amount)}</Txt>
                <Btn label="Bayar" variant="secondary" onPress={() => payBill(b.id)} testID="bill-pay" />
              </Card>
            ))}
          </Box>
        )}
      </Async>
      {adding ? <BillSheet onClose={(r) => { setAdding(false); if (r) state.reload(); }} /> : null}
    </Section>
  );
}

function BillSheet({ onClose }: { onClose: (r?: boolean) => void }) {
  const { backend, tz } = useApp();
  const [walletId, setWalletId] = useState(''); const [categoryId, setCategoryId] = useState(''); const [amount, setAmount] = useState<number | null>(null);
  const [desc, setDesc] = useState(''); const [freq, setFreq] = useState('monthly'); const [next, setNext] = useState(todayLocal(tz));
  const act = useAction();
  return (
    <Sheet visible title="Tagihan berulang" onClose={() => onClose()}>
      <Field label="Keterangan (mis. Listrik toko)" value={desc} onChangeText={setDesc} testID="bl-desc" />
      <WalletPicker value={walletId} onChange={setWalletId} label="Dibayar dari" />
      <CategoryPicker type="expense" value={categoryId} onChange={setCategoryId} />
      <MoneyField label="Nominal" value={amount} onChange={setAmount} testID="bl-amount" />
      <Chips options={[{ value: 'weekly', label: 'Mingguan' }, { value: 'monthly', label: 'Bulanan' }, { value: 'yearly', label: 'Tahunan' }]} value={freq} onChange={setFreq} />
      <Field label="Jatuh tempo berikut (YYYY-MM-DD)" value={next} onChangeText={setNext} />
      <FormError message={act.error} />
      <Btn label="Simpan" loading={act.busy} disabled={!amount || !walletId || !categoryId} testID="bl-save" onPress={() => act.run(async () => { await backend.createBill({ walletId, categoryId, amount: amount ?? 0, description: desc || null, frequency: freq, nextDueDate: next }); onClose(true); })} />
    </Sheet>
  );
}

// ------------------------------------------------------------------ target
function GoalsSection() {
  const { backend } = useApp();
  const state = useAsync(() => backend.listGoals(), []);
  const [adding, setAdding] = useState(false); const [contrib, setContrib] = useState<string | null>(null);
  return (
    <Section title="Target tabungan" action={<Btn label="+ Target" onPress={() => setAdding(true)} testID="open-goal" />}>
      <Async state={state} empty={(d) => d.length === 0}>
        {(list) => (
          <Box className="gap-2">
            {list.map((g) => (
              <Card key={g.id} testID="goal-row" onPress={() => setContrib(g.id)} className="gap-1">
                <Box className="flex-row justify-between"><Txt className="font-semibold">{g.title}</Txt><Txt className="font-bold">{g.percent}%</Txt></Box>
                <ProgressBar percent={g.percent} tone="good" />
                <Txt className="text-xs text-slate-500">{formatRupiah(g.currentAmount)} dari {formatRupiah(g.targetAmount)}{g.targetDate ? ` · target ${fmtDate(g.targetDate)}` : ''}</Txt>
              </Card>
            ))}
          </Box>
        )}
      </Async>
      {adding ? <GoalSheet onClose={(r) => { setAdding(false); if (r) state.reload(); }} /> : null}
      {contrib ? <ContributeSheet id={contrib} onClose={(r) => { setContrib(null); if (r) state.reload(); }} /> : null}
    </Section>
  );
}

function GoalSheet({ onClose }: { onClose: (r?: boolean) => void }) {
  const { backend } = useApp();
  const [title, setTitle] = useState(''); const [target, setTarget] = useState<number | null>(null); const [date, setDate] = useState('');
  const act = useAction();
  return (
    <Sheet visible title="Target baru" onClose={() => onClose()}>
      <Field label="Nama target" value={title} onChangeText={setTitle} testID="gl-title" />
      <MoneyField label="Jumlah target" value={target} onChange={setTarget} testID="gl-target" />
      <Field label="Tanggal target (opsional)" value={date} onChangeText={setDate} placeholder="2027-03-31" />
      <FormError message={act.error} />
      <Btn label="Simpan" loading={act.busy} disabled={!title.trim() || !target} testID="gl-save" onPress={() => act.run(async () => { await backend.createGoal({ title: title.trim(), targetAmount: target ?? 0, targetDate: date || null }); onClose(true); })} />
    </Sheet>
  );
}

function ContributeSheet({ id, onClose }: { id: string; onClose: (r?: boolean) => void }) {
  const { backend } = useApp();
  const [amount, setAmount] = useState<number | null>(null);
  const act = useAction();
  return (
    <Sheet visible title="Tambah tabungan" onClose={() => onClose()}>
      <MoneyField label="Nominal" value={amount} onChange={setAmount} testID="gc-amount" />
      <FormError message={act.error} />
      <Btn label="Tambah" loading={act.busy} disabled={!amount} testID="gc-save" onPress={() => act.run(async () => { await backend.contributeGoal(id, amount ?? 0); onClose(true); })} />
    </Sheet>
  );
}
