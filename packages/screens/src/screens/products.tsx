import { useState } from 'react';
import { fmtDateTime, formatQty, formatRupiah, type StockCardRow, type VariantView } from '@ficoim/client';
import { Box, Btn, Field, Sheet, Txt, hasQrCode } from '../ui';
import { Async, Card, Chips, FormError, MoneyField, Row, Screen, Section, Toggle } from '../kit';
import { useAction, useAsync, useDebounced } from '../hooks';
import { useApp } from '../platform';
import { useNav } from '../nav';
import { qtyToMilli } from '../util';
import { Photo, PhotoField } from '../photos';

const vTitle = (v: { productName: string; variantName: string }) => (v.variantName === 'Default' ? v.productName : `${v.productName} · ${v.variantName}`);

// ================================================================== daftar
export function ProductsScreen() {
  const { backend } = useApp();
  const nav = useNav();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'low'>('all');
  const dq = useDebounced(q, 250);
  const state = useAsync(() => backend.listProducts({ search: dq, lowStockOnly: filter === 'low', limit: 100 }), [dq, filter]);
  return (
    <Screen title="Produk" right={<Box className="flex-row gap-2">{hasQrCode() ? <Btn label="🏷️ Label" variant="secondary" onPress={() => nav.push('labels')} testID="open-labels" /> : null}<Btn label="+ Baru" onPress={() => nav.push('productForm')} testID="add-product" /></Box>}>
      <Field value={q} onChangeText={setQ} placeholder="Cari nama / SKU / barcode" testID="product-search" autoCapitalize="none" />
      <Chips options={[{ value: 'all', label: 'Semua' }, { value: 'low', label: 'Stok menipis' }]} value={filter} onChange={setFilter} />
      <Async state={state} empty={(d) => d.length === 0}>
        {(list) => (
          <Box className="gap-2">
            {list.map((v) => {
              const low = v.trackStock && v.minStockMilli > 0 && v.stockQtyMilli <= v.minStockMilli;
              return (
                <Row key={v.id} testID="product-row" leading={<Photo id={v.photoAttachmentId} />} title={vTitle(v)} sub={[v.categoryName, v.sku].filter(Boolean).join(' · ') || null}
                  right={formatRupiah(v.sellPrice)} rightSub={v.trackStock ? `${formatQty(v.stockQtyMilli)} ${v.unit}${low ? ' ⚠️' : ''}` : 'Jasa'}
                  onPress={() => nav.push('productDetail', { productId: v.productId, productName: v.productName })} />
              );
            })}
          </Box>
        )}
      </Async>
    </Screen>
  );
}

// ================================================================== form produk baru
interface Draft { name: string; sku: string; barcode: string; cost: number | null; sell: number | null; qty: string; min: string }
const newDraft = (name = ''): Draft => ({ name, sku: '', barcode: '', cost: null, sell: null, qty: '', min: '' });

export function ProductFormScreen() {
  const { backend, platform } = useApp();
  const nav = useNav();
  const cats = useAsync(() => backend.listProductCategories(), []);
  const [name, setName] = useState(''); const [brand, setBrand] = useState(''); const [unit, setUnit] = useState('pcs');
  const [categoryId, setCategoryId] = useState(''); const [track, setTrack] = useState(true); const [expiry, setExpiry] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([newDraft()]);
  const act = useAction();
  const multi = drafts.length > 1;
  const patch = (i: number, p: Partial<Draft>) => setDrafts((ds) => ds.map((d, k) => (k === i ? { ...d, ...p } : d)));

  const save = () => act.run(async () => {
    const variants = drafts.map((d, i) => {
      const qty = d.qty.trim() ? qtyToMilli(d.qty) : 0, min = d.min.trim() ? qtyToMilli(d.min) : 0;
      if (qty === null || min === null) throw new Error(`Jumlah stok pada varian ${i + 1} tidak valid. Contoh: 10 atau 2,5`);
      if (multi && !d.name.trim()) throw new Error(`Nama varian ${i + 1} wajib diisi (mis. "Merah / L").`);
      return { name: multi ? d.name.trim() : 'Default', sku: d.sku || null, barcode: d.barcode || null, costPrice: d.cost ?? 0, sellPrice: d.sell ?? 0, openingQtyMilli: qty, minStockMilli: min };
    });
    await backend.createProduct({ name, categoryId: categoryId || null, brand: brand || null, unit, trackStock: track, trackExpiry: expiry, variants, photoAttachmentId: photoId });
    platform.notify('Produk disimpan');
    nav.back();
  });
  const addCat = () => act.run(async () => { if (!newCat.trim()) return; const id = await backend.createProductCategory(newCat.trim()); setCategoryId(id); setNewCat(''); cats.reload(); });
  const scan = (i: number) => act.run(async () => { const c = await platform.scanBarcode?.(); if (c) patch(i, { barcode: c }); });

  return (
    <Screen title="Produk baru">
      <PhotoField label="Foto produk (opsional)" value={photoId} onChange={setPhotoId} testID="pf-photo" />
      <Field label="Nama produk" value={name} onChangeText={setName} testID="pf-name" autoCapitalize="words" />
      <Box className="flex-row gap-2">
        <Box className="flex-1"><Field label="Satuan" value={unit} onChangeText={setUnit} testID="pf-unit" autoCapitalize="none" /></Box>
        <Box className="flex-1"><Field label="Merek (opsional)" value={brand} onChangeText={setBrand} autoCapitalize="words" /></Box>
      </Box>
      <Txt className="text-sm text-slate-600">Kategori</Txt>
      <Async state={cats}>{(list) => <Chips options={[{ value: '', label: 'Tanpa kategori' }, ...list.map((c) => ({ value: c.id, label: `${c.icon ?? ''} ${c.name}`.trim() }))]} value={categoryId} onChange={setCategoryId} />}</Async>
      <Box className="flex-row items-end gap-2"><Box className="flex-1"><Field value={newCat} onChangeText={setNewCat} placeholder="Kategori baru…" /></Box><Btn label="Tambah" variant="secondary" onPress={addCat} /></Box>
      <Toggle label="Lacak stok (matikan untuk jasa)" value={track} onChange={setTrack} testID="pf-track" />
      <Toggle label="Punya tanggal kedaluwarsa (makanan/minuman)" value={expiry} onChange={setExpiry} />

      {drafts.map((d, i) => (
        <Card key={i} className="gap-2" testID={`variant-${i}`}>
          <Box className="flex-row items-center justify-between"><Txt className="font-bold">{multi ? `Varian ${i + 1}` : 'Harga & stok'}</Txt>{multi ? <Btn label="Hapus" variant="ghost" onPress={() => setDrafts((ds) => ds.filter((_, k) => k !== i))} /> : null}</Box>
          {multi ? <Field label="Nama varian (mis. Merah / L, 128GB)" value={d.name} onChangeText={(t) => patch(i, { name: t })} testID={`vf-name-${i}`} /> : null}
          <Box className="flex-row gap-2">
            <Box className="flex-1"><Field label="SKU" value={d.sku} onChangeText={(t) => patch(i, { sku: t })} autoCapitalize="none" testID={`vf-sku-${i}`} /></Box>
            <Box className="flex-1"><Field label="Barcode" value={d.barcode} onChangeText={(t) => patch(i, { barcode: t })} autoCapitalize="none" testID={`vf-barcode-${i}`} /></Box>
            {platform.scanBarcode ? <Btn label="📷" variant="secondary" onPress={() => scan(i)} /> : null}
          </Box>
          <Box className="flex-row gap-2">
            <Box className="flex-1"><MoneyField label="Harga beli" value={d.cost} onChange={(n) => patch(i, { cost: n })} testID={`vf-cost-${i}`} /></Box>
            <Box className="flex-1"><MoneyField label="Harga jual" value={d.sell} onChange={(n) => patch(i, { sell: n })} testID={`vf-sell-${i}`} /></Box>
          </Box>
          {track ? (
            <Box className="flex-row gap-2">
              <Box className="flex-1"><Field label="Stok awal" value={d.qty} onChangeText={(t) => patch(i, { qty: t })} keyboard="decimal" testID={`vf-qty-${i}`} /></Box>
              <Box className="flex-1"><Field label="Stok minimum (peringatan)" value={d.min} onChangeText={(t) => patch(i, { min: t })} keyboard="decimal" testID={`vf-min-${i}`} /></Box>
            </Box>
          ) : null}
        </Card>
      ))}
      <Btn label="+ Tambah varian (ukuran/warna/kapasitas)" variant="secondary" onPress={() => setDrafts((ds) => [...ds, newDraft()])} testID="add-variant-draft" />
      <FormError message={act.error} />
      <Btn label="Simpan produk" onPress={save} loading={act.busy} disabled={!name.trim()} testID="pf-save" />
    </Screen>
  );
}

// ================================================================== detail produk
type SheetState = { kind: 'edit' | 'stock' | 'history'; v: VariantView } | { kind: 'add' } | null;

export function ProductDetailScreen() {
  const { backend, platform } = useApp();
  const nav = useNav();
  const p = nav.route.params as { productId: string; productName: string };
  const state = useAsync(async () => (await backend.listProducts({ search: p.productName, includeInactive: true, limit: 200 })).filter((v) => v.productId === p.productId), [p.productId]);
  const [sheet, setSheet] = useState<SheetState>(null);
  const act = useAction();
  const close = (reload = false) => { setSheet(null); if (reload) state.reload(); };
  const archive = () => act.run(async () => {
    if (!(await platform.confirm('Arsipkan produk?', `"${p.productName}" tidak akan muncul lagi. Riwayat penjualan tetap tersimpan.`, { destructive: true, confirmLabel: 'Arsipkan' }))) return;
    await backend.deleteProduct(p.productId); platform.notify('Produk diarsipkan'); nav.back();
  });
  return (
    <Screen title={p.productName}>
      <Async state={state}>
        {(vs) => (
 <>
            {vs[0] ? <ProductPhotoCard productId={p.productId} photoId={vs[0].photoAttachmentId} onChanged={state.reload} /> : null}
            {vs.map((v) => (
              <Card key={v.id} testID="variant-card" className="gap-2">
                <Box className="flex-row items-center justify-between">
                  <Txt className="text-base font-bold">{v.variantName === 'Default' ? 'Utama' : v.variantName}</Txt>
                  <Txt testID="variant-stock" className="font-bold text-indigo-700">{v.trackStock ? `${formatQty(v.stockQtyMilli)} ${v.unit}` : 'Jasa'}</Txt>
                </Box>
                <Txt className="text-sm text-slate-600">Beli {formatRupiah(v.costPrice)} · Jual {formatRupiah(v.sellPrice)}{v.minStockMilli > 0 ? ` · Min ${formatQty(v.minStockMilli)}` : ''}</Txt>
                {v.sku || v.barcode ? <Txt className="text-xs text-slate-500">{[v.sku && `SKU ${v.sku}`, v.barcode && `Barcode ${v.barcode}`].filter(Boolean).join(' · ')}</Txt> : null}
                <Box className="flex-row flex-wrap gap-2">
                  <Btn label="Ubah" variant="secondary" onPress={() => setSheet({ kind: 'edit', v })} testID="variant-edit" />
                  {v.trackStock ? <Btn label="Stok" variant="secondary" onPress={() => setSheet({ kind: 'stock', v })} testID="variant-stock-btn" /> : null}
                  {v.trackStock ? <Btn label="Riwayat" variant="ghost" onPress={() => setSheet({ kind: 'history', v })} /> : null}
                </Box>
              </Card>
            ))}
            <Btn label="+ Tambah varian" variant="secondary" onPress={() => setSheet({ kind: 'add' })} />
            <Section title="Lainnya"><Btn label="Arsipkan produk" variant="danger" onPress={archive} loading={act.busy} /></Section>
            <FormError message={act.error} />
          </>
        )}
      </Async>
      {sheet?.kind === 'edit' ? <EditVariantSheet v={sheet.v} onClose={close} /> : null}
      {sheet?.kind === 'stock' ? <StockSheet v={sheet.v} onClose={close} /> : null}
      {sheet?.kind === 'history' ? <HistorySheet v={sheet.v} onClose={() => close()} /> : null}
      {sheet?.kind === 'add' ? <AddVariantSheet productId={p.productId} onClose={close} /> : null}
    </Screen>
  );
}

function EditVariantSheet({ v, onClose }: { v: VariantView; onClose: (reload?: boolean) => void }) {
  const { backend } = useApp();
  const [name, setName] = useState(v.variantName); const [sku, setSku] = useState(v.sku ?? ''); const [barcode, setBarcode] = useState(v.barcode ?? '');
  const [cost, setCost] = useState<number | null>(v.costPrice); const [sell, setSell] = useState<number | null>(v.sellPrice); const [min, setMin] = useState(v.minStockMilli ? formatQty(v.minStockMilli) : '');
  const act = useAction();
  const save = () => act.run(async () => {
    const m = min.trim() ? qtyToMilli(min) : 0;
    if (m === null) throw new Error('Stok minimum tidak valid.');
    await backend.updateVariant(v.id, { name, sku: sku || null, barcode: barcode || null, costPrice: cost ?? 0, sellPrice: sell ?? 0, minStockMilli: m });
    onClose(true);
  });
  return (
    <Sheet visible title="Ubah varian" onClose={() => onClose()}>
      <Field label="Nama varian" value={name} onChangeText={setName} testID="ev-name" />
      <Field label="SKU" value={sku} onChangeText={setSku} autoCapitalize="none" testID="ev-sku" />
      <Field label="Barcode" value={barcode} onChangeText={setBarcode} autoCapitalize="none" />
      <MoneyField label="Harga beli" value={cost} onChange={setCost} testID="ev-cost" />
      <MoneyField label="Harga jual" value={sell} onChange={setSell} testID="ev-sell" />
      <Field label="Stok minimum" value={min} onChangeText={setMin} keyboard="decimal" />
      <FormError message={act.error} />
      <Btn label="Simpan" onPress={save} loading={act.busy} testID="ev-save" />
    </Sheet>
  );
}

function StockSheet({ v, onClose }: { v: VariantView; onClose: (reload?: boolean) => void }) {
  const { backend, platform } = useApp();
  const [mode, setMode] = useState<'set' | 'add' | 'sub'>('set');
  const [reason, setReason] = useState<'adjustment' | 'damage'>('adjustment');
  const [qty, setQty] = useState(''); const [note, setNote] = useState('');
  const act = useAction();
  const save = () => act.run(async () => {
    const m = qtyToMilli(qty);
    if (m === null || (mode !== 'set' && m <= 0)) throw new Error('Jumlah tidak valid. Contoh: 5 atau 2,5');
    const r = await backend.adjustStock(v.id, mode === 'set' ? { mode: 'set', qtyMilli: m, note: note || null } : { mode: 'delta', qtyMilli: mode === 'add' ? m : -m, reason: mode === 'sub' ? reason : 'adjustment', note: note || null });
    platform.notify(`Stok: ${formatQty(r.before)} → ${formatQty(r.after)}`);
    onClose(true);
  });
  return (
    <Sheet visible title={`Stok — ${vTitle(v)}`} onClose={() => onClose()}>
      <Txt className="text-slate-600">Stok sekarang: {formatQty(v.stockQtyMilli)} {v.unit}</Txt>
      <Chips options={[{ value: 'set', label: 'Hitung fisik' }, { value: 'add', label: 'Tambah' }, { value: 'sub', label: 'Kurangi' }]} value={mode} onChange={setMode} testID="stock-mode" />
      <Field label={mode === 'set' ? 'Jumlah hasil hitung fisik' : 'Jumlah'} value={qty} onChangeText={setQty} keyboard="decimal" testID="stock-qty" />
      {mode === 'sub' ? <Chips options={[{ value: 'adjustment', label: 'Penyesuaian' }, { value: 'damage', label: 'Rusak/hilang' }]} value={reason} onChange={setReason} /> : null}
      <Field label="Catatan (opsional)" value={note} onChangeText={setNote} />
      <FormError message={act.error} />
      <Btn label="Simpan" onPress={save} loading={act.busy} testID="stock-save" />
    </Sheet>
  );
}

const MOVE_LABEL: Record<string, string> = { initial: 'Stok awal', purchase: 'Pembelian', sale: 'Penjualan', return_in: 'Batal jual', return_out: 'Batal beli', adjustment: 'Penyesuaian', opname: 'Hitung fisik', damage: 'Rusak/hilang' };

function HistorySheet({ v, onClose }: { v: VariantView; onClose: () => void }) {
  const { backend, tz } = useApp();
  const state = useAsync(() => backend.stockCard(v.id, 50), [v.id]);
  return (
    <Sheet visible title={`Riwayat — ${vTitle(v)}`} onClose={onClose}>
      <Async state={state} empty={(d) => d.length === 0}>
        {(rows: StockCardRow[]) => (
          <Box className="gap-1">
            {rows.map((m) => (
              <Box key={m.id} className="flex-row items-center justify-between border-b border-slate-100 py-1">
                <Box className="flex-1"><Txt className="text-sm font-semibold">{MOVE_LABEL[m.type] ?? m.type}</Txt><Txt className="text-xs text-slate-500">{fmtDateTime(m.occurredAt, tz)}{m.note ? ` · ${m.note}` : ''}</Txt></Box>
                <Txt className={`font-bold ${m.deltaMilli >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{m.deltaMilli > 0 ? '+' : ''}{formatQty(m.deltaMilli)}</Txt>
              </Box>
            ))}
          </Box>
        )}
      </Async>
    </Sheet>
  );
}

function AddVariantSheet({ productId, onClose }: { productId: string; onClose: (reload?: boolean) => void }) {
  const { backend } = useApp();
  const [name, setName] = useState(''); const [sku, setSku] = useState(''); const [cost, setCost] = useState<number | null>(null); const [sell, setSell] = useState<number | null>(null); const [qty, setQty] = useState('');
  const act = useAction();
  const save = () => act.run(async () => {
    const m = qty.trim() ? qtyToMilli(qty) : 0;
    if (m === null) throw new Error('Stok awal tidak valid.');
    await backend.addVariant(productId, { name: name.trim(), sku: sku || null, costPrice: cost ?? 0, sellPrice: sell ?? 0, openingQtyMilli: m });
    onClose(true);
  });
  return (
    <Sheet visible title="Tambah varian" onClose={() => onClose()}>
      <Field label="Nama varian" value={name} onChangeText={setName} testID="av-name" />
      <Field label="SKU" value={sku} onChangeText={setSku} autoCapitalize="none" />
      <MoneyField label="Harga beli" value={cost} onChange={setCost} />
      <MoneyField label="Harga jual" value={sell} onChange={setSell} />
      <Field label="Stok awal" value={qty} onChangeText={setQty} keyboard="decimal" />
      <FormError message={act.error} />
      <Btn label="Simpan" onPress={save} loading={act.busy} disabled={!name.trim()} testID="av-save" />
    </Sheet>
  );
}

function ProductPhotoCard({ productId, photoId, onChanged }: { productId: string; photoId: string | null; onChanged: () => void }) {
  const { backend, platform } = useApp();
  const act = useAction();
  const change = (id: string | null) => act.run(async () => { await backend.updateProduct(productId, { photoAttachmentId: id }); platform.notify(id ? 'Foto disimpan' : 'Foto dihapus'); onChanged(); });
  return (
    <Card className="gap-2" testID="product-photo-card">
      <PhotoField label="Foto produk" value={photoId} onChange={change} testID="pd-photo" />
      <FormError message={act.error} />
    </Card>
  );
}
