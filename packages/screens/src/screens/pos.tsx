import { useEffect, useState } from 'react';
import { addToCart, formatQty, formatRupiah, labelOf, setLineDiscount, setLinePrice, setOrderDiscount, setQty, stockWarnings, toSaleInput, totals, type Cart, type CartLine, type SaleResult } from '@ficoim/client';
import { Box, Btn, Field, PaymentStage, Sheet, Txt, hasPaymentStage } from '../ui';
import { Async, Card, Chips, FormError, MoneyField, Screen, Section } from '../kit';
import { useAction, useAsync, useDebounced } from '../hooks';
import { useApp } from '../platform';
import { useCart } from '../cart-store';
import { qtyToMilli } from '../util';
import { Photo } from '../photos';
import { ReceiptPanel } from './receipt';

const PROCESS_MS = 1900, SUCCESS_MS = 2600;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function PosScreen() {
  const { backend, platform, taxBp } = useApp();
  const { cart, setCart } = useCart();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const results = useAsync(() => backend.listProducts({ search: dq, limit: 30 }), [dq]);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [checkout, setCheckout] = useState(false);
  const act = useAction();
  const t = totals(cart, taxBp);
  const warnings = stockWarnings(cart);

  const addCode = async (code: string): Promise<boolean> => {
    const v = await backend.findByCode(code);
    if (!v) return false;
    setCart((c) => addToCart(c, v));
    return true;
  };
  // Pemindai USB/Bluetooth bertindak sebagai keyboard + Enter: kode persis langsung masuk keranjang.
  const submit = () => act.run(async () => { const code = q.trim(); if (code && (await addCode(code))) setQ(''); });
  const scan = () => act.run(async () => {
    const code = await platform.scanBarcode?.();
    if (code && !(await addCode(code))) platform.notify(`Kode ${code} tidak ditemukan`, 'error');
  });

  return (
    <Screen title="Kasir">
      <Box className="flex-row items-end gap-2">
        <Box className="flex-1"><Field value={q} onChangeText={setQ} placeholder="Cari nama / SKU / scan barcode" testID="pos-search" onSubmit={submit} autoCapitalize="none" /></Box>
        {platform.scanBarcode ? <Btn label="📷" variant="secondary" onPress={scan} testID="pos-scan" /> : null}
      </Box>
      <FormError message={act.error} />

      <Section title={`Keranjang (${cart.lines.length})`}>
        {cart.lines.length === 0 ? <Txt className="text-slate-500">Keranjang kosong. Ketuk produk di bawah untuk menambah.</Txt> : null}
        {cart.lines.map((l, i) => <CartRow key={`${l.variantId}-${i}`} line={l} index={i} cart={cart} onEdit={() => setEditIdx(i)} />)}
        {warnings.map((w) => <Txt key={w} className="text-sm text-amber-700">⚠️ {w}</Txt>)}
        {cart.lines.length > 0 ? (
          <Card className="gap-1">
            <Box className="flex-row justify-between"><Txt className="text-slate-600">Subtotal</Txt><Txt>{formatRupiah(t.subtotal)}</Txt></Box>
            {t.tax > 0 ? <Box className="flex-row justify-between"><Txt className="text-slate-600">PPN</Txt><Txt>{formatRupiah(t.tax)}</Txt></Box> : null}
            <Box className="flex-row justify-between"><Txt className="text-lg font-bold">Total</Txt><Txt testID="cart-total" className="text-lg font-bold text-indigo-700">{formatRupiah(t.total)}</Txt></Box>
            <Btn label={`Bayar ${formatRupiah(t.total)}`} onPress={() => setCheckout(true)} testID="pay" />
            <Btn label="Kosongkan" variant="ghost" onPress={() => setCart({ lines: [], discount: 0 })} />
          </Card>
        ) : null}
      </Section>

      <Section title="Produk">
        <Async state={results} empty={(d) => d.length === 0}>
          {(list) => (
            <Box className="flex-row flex-wrap gap-2">
              {list.map((v) => {
                const out = v.trackStock && v.stockQtyMilli <= 0;
                return (
                  <Box key={v.id} kind="card" testID="pos-result" onPress={() => setCart((c) => addToCart(c, v))} className="w-[48.5%] gap-2 rounded-2xl border border-slate-200 bg-white p-2">
                    <Photo id={v.photoAttachmentId} className="h-28 w-full rounded-xl" />
                    <Txt className="min-h-[2.5rem] text-sm font-semibold text-slate-900" numberOfLines={2}>{labelOf(v)}</Txt>
                    <Box className="flex-row items-center justify-between gap-1">
                      <Txt className="text-sm font-bold text-indigo-700">{formatRupiah(v.sellPrice)}</Txt>
                      <Txt className={`text-[11px] ${out ? 'font-bold text-rose-600' : 'text-slate-500'}`}>{v.trackStock ? (out ? 'Habis' : `${formatQty(v.stockQtyMilli)} ${v.unit}`) : 'Jasa'}</Txt>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          )}
        </Async>
      </Section>

      {editIdx !== null && cart.lines[editIdx] ? <LineEditor index={editIdx} line={cart.lines[editIdx] as CartLine} onClose={() => setEditIdx(null)} /> : null}
      {checkout ? <CheckoutSheet onClose={() => setCheckout(false)} /> : null}
    </Screen>
  );
}

function CartRow({ line, index, cart, onEdit }: { line: CartLine; index: number; cart: Cart; onEdit: () => void }) {
  const { setCart } = useCart();
  const lineTotalText = formatRupiah(Math.round((line.qtyMilli * line.unitPrice) / 1000) - line.discount);
  return (
    <Card testID={`cart-line-${index}`} className="flex-row items-center gap-2">
      <Box className="flex-1" onPress={onEdit}>
        <Txt className="font-semibold text-slate-900" numberOfLines={1}>{line.name}</Txt>
        <Txt className="text-xs text-slate-500">{formatRupiah(line.unitPrice)} × {formatQty(line.qtyMilli)} {line.unit}{line.discount > 0 ? ` − ${formatRupiah(line.discount)}` : ''}</Txt>
      </Box>
      <Box onPress={() => setCart(setQty(cart, index, line.qtyMilli - 1000))} testID={`qty-minus-${index}`} className="h-9 w-9 items-center justify-center rounded-full bg-slate-200"><Txt className="text-lg font-bold">−</Txt></Box>
      <Txt testID={`qty-${index}`} className="min-w-[32px] text-center font-bold">{formatQty(line.qtyMilli)}</Txt>
      <Box onPress={() => setCart(setQty(cart, index, line.qtyMilli + 1000))} testID={`qty-plus-${index}`} className="h-9 w-9 items-center justify-center rounded-full bg-indigo-600"><Txt className="text-lg font-bold text-white">+</Txt></Box>
      <Txt className="min-w-[80px] text-right font-bold">{lineTotalText}</Txt>
    </Card>
  );
}

function LineEditor({ index, line, onClose }: { index: number; line: CartLine; onClose: () => void }) {
  const { cart, setCart } = useCart();
  const [qty, setQtyText] = useState(formatQty(line.qtyMilli));
  const [price, setPrice] = useState<number | null>(line.unitPrice);
  const [disc, setDisc] = useState<number | null>(line.discount);
  const [err, setErr] = useState<string | null>(null);
  const save = () => {
    const m = qtyToMilli(qty);
    if (m === null || m <= 0) { setErr('Jumlah tidak valid. Contoh: 2 atau 1,5'); return; }
    let c = setQty(cart, index, m);
    c = setLinePrice(c, index, price ?? 0);
    c = setLineDiscount(c, index, disc ?? 0);
    setCart(c); onClose();
  };
  return (
    <Sheet visible title={line.name} onClose={onClose}>
      <Field label={`Jumlah (${line.unit}) — boleh desimal`} value={qty} onChangeText={setQtyText} keyboard="decimal" testID="line-qty" />
      <MoneyField label="Harga satuan (nego)" value={price} onChange={setPrice} testID="line-price" />
      <MoneyField label="Diskon baris" value={disc} onChange={setDisc} testID="line-discount" />
      <FormError message={err} />
      <Btn label="Simpan" onPress={save} testID="line-save" />
      <Btn label="Hapus dari keranjang" variant="danger" onPress={() => { setCart(setQty(cart, index, 0)); onClose(); }} />
    </Sheet>
  );
}

function roundUps(total: number): number[] {
  const out = new Set<number>();
  for (const step of [5000, 10_000, 50_000, 100_000]) { const v = Math.ceil(total / step) * step; if (v > total) out.add(v); }
  return [...out].sort((a, b) => a - b).slice(0, 3);
}

function CheckoutSheet({ onClose }: { onClose: () => void }) {
  const { backend, taxBp } = useApp();
  const { cart, clear } = useCart();
  const customers = useAsync(() => backend.listCustomers(), []);
  const wallets = useAsync(() => backend.listWallets(), []);
  const [customerId, setCustomerId] = useState('');
  const [walletId, setWalletId] = useState('');
  const [discount, setDiscount] = useState<number | null>(null);
  const [received, setReceived] = useState<number | null>(null);
  const [due, setDue] = useState('');
  const [newCustomer, setNewCustomer] = useState('');
  const [done, setDone] = useState<SaleResult | null>(null);
  const [phase, setPhase] = useState<'form' | 'processing' | 'success'>('form');
  const [change, setChange] = useState(0);
  const act = useAction();

  const c2 = setOrderDiscount(cart, discount ?? 0);
  const t = totals(c2, taxBp);
  const paid = received === null ? t.total : Math.min(received, t.total);
  const credit = paid < t.total;
  const effWallet = walletId || wallets.data?.[0]?.id || '';

  const pay = () => act.run(async () => {
    const input = toSaleInput(c2, { customerId: customerId || null, walletId: effWallet || null, paid, dueDate: credit && due ? due : null });
    const changeDue = received === null ? 0 : Math.max(0, received - t.total);
    if (!hasPaymentStage()) { // HP / gerak dimatikan: langsung selesai
      const r = await backend.createSale(input);
      setChange(changeDue); setDone(r);
      return;
    }
    // Web beranimasi: transaksi NYATA berjalan di belakang layar "memproses"; sheet terkunci agar tidak bisa ditutup di tengah jalan
    // (menutup saat transaksi berjalan bisa membuat keranjang tidak terhapus padahal penjualan sudah tercatat).
    setPhase('processing');
    try {
      const t0 = Date.now();
      const r = await backend.createSale(input);
      await sleep(Math.max(0, PROCESS_MS - (Date.now() - t0)));
      setChange(changeDue); setSaved(r); setPhase('success');
    } catch (e) { setPhase('form'); throw e; }
  });
  const addCustomer = () => act.run(async () => {
    if (!newCustomer.trim()) return;
    const id = await backend.createCustomer({ name: newCustomer.trim() });
    setCustomerId(id); setNewCustomer(''); customers.reload();
  });

  const [saved, setSaved] = useState<SaleResult | null>(null);
  // layar sukses tampil sebentar lalu otomatis menuju struk (atau ketuk "Lihat struk")
  useEffect(() => {
    if (phase !== 'success' || !saved) return;
    const id = setTimeout(() => { setDone(saved); setPhase('form'); }, SUCCESS_MS);
    return () => clearTimeout(id);
  }, [phase, saved]);

  if (!done && phase !== 'form' && saved === null) {
    return (
      <Sheet visible locked title="Memproses pembayaran" onClose={() => {}}>
        <PaymentStage phase="processing" amountText={formatRupiah(t.total)} />
      </Sheet>
    );
  }
  if (!done && phase === 'success' && saved) {
    return (
      <Sheet visible locked title="Pembayaran berhasil" onClose={() => {}}>
        <PaymentStage phase="success" amountText={formatRupiah(saved.total)} onContinue={() => { setDone(saved); setPhase('form'); }} />
      </Sheet>
    );
  }
  if (done) {
    return (
      <Sheet visible title="Transaksi berhasil ✅" onClose={() => { clear(); onClose(); }}>
        <Card testID="receipt" className="gap-1">
          <Txt className="text-sm text-slate-500">{done.number}</Txt>
          <Box className="flex-row justify-between"><Txt>Total</Txt><Txt testID="receipt-total" className="font-bold">{formatRupiah(done.total)}</Txt></Box>
          <Box className="flex-row justify-between"><Txt>Dibayar</Txt><Txt>{formatRupiah(done.paid)}</Txt></Box>
          {change > 0 ? <Box className="flex-row justify-between"><Txt>Kembalian</Txt><Txt testID="receipt-change" className="font-bold text-emerald-600">{formatRupiah(change)}</Txt></Box> : null}
          {done.status !== 'paid' ? <Txt className="text-amber-700">Sisa {formatRupiah(done.total - done.paid)} dicatat sebagai piutang.</Txt> : null}
        </Card>
        <ReceiptPanel saleId={done.saleId} />
        <Btn label="Transaksi baru" onPress={() => { clear(); onClose(); }} testID="new-sale" />
      </Sheet>
    );
  }

  return (
    <Sheet visible title="Pembayaran" onClose={onClose}>
      <Txt testID="checkout-total" className="text-3xl font-bold text-indigo-700">{formatRupiah(t.total)}</Txt>
      <MoneyField label="Diskon pesanan" value={discount} onChange={setDiscount} testID="order-discount" />
      <Txt className="text-sm text-slate-600">Uang diterima</Txt>
      <Box className="flex-row flex-wrap gap-2">
        <Btn label="Uang pas" variant={received === null ? 'primary' : 'secondary'} onPress={() => setReceived(null)} testID="cash-exact" />
        {roundUps(t.total).map((v) => <Btn key={v} label={formatRupiah(v)} variant={received === v ? 'primary' : 'secondary'} onPress={() => setReceived(v)} />)}
      </Box>
      <MoneyField value={received} onChange={setReceived} placeholder="Nominal lain" testID="received" />
      {received !== null && received > t.total ? <Txt className="text-emerald-600">Kembalian: {formatRupiah(received - t.total)}</Txt> : null}

      <Txt className="text-sm text-slate-600">Pelanggan {credit ? '(wajib untuk cicilan/kredit)' : '(opsional)'}</Txt>
      <Async state={customers}>{(list) => <Chips options={[{ value: '', label: 'Umum' }, ...list.slice(0, 12).map((c) => ({ value: c.id, label: c.name }))]} value={customerId} onChange={setCustomerId} />}</Async>
      <Box className="flex-row items-end gap-2"><Box className="flex-1"><Field value={newCustomer} onChangeText={setNewCustomer} placeholder="Pelanggan baru…" testID="new-customer" /></Box><Btn label="Tambah" variant="secondary" onPress={addCustomer} /></Box>
      {credit ? <Field label="Jatuh tempo (YYYY-MM-DD, opsional)" value={due} onChangeText={setDue} placeholder="2026-12-31" testID="due-date" /> : null}

      <Async state={wallets}>{(list) => (list.length > 1 ? (<><Txt className="text-sm text-slate-600">Masuk ke dompet</Txt><Chips options={list.map((w) => ({ value: w.id, label: w.name }))} value={effWallet} onChange={setWalletId} /></>) : null)}</Async>

      <FormError message={act.error} />
      <Btn label={credit ? `Catat (sisa ${formatRupiah(t.total - paid)} jadi piutang)` : 'Selesaikan pembayaran'} loading={act.busy} onPress={pay} testID="confirm-pay" />
    </Sheet>
  );
}

