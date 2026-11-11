import { useState } from 'react';
import { fmtDate, formatRupiah, todayLocal, type AssetView } from '@ficoim/client';
import { Box, Btn, Field, Sheet, Txt } from '../ui';
import { Async, Card, Chips, FormError, MoneyField, Screen } from '../kit';
import { useAction, useAsync } from '../hooks';
import { useApp } from '../platform';
import { Photo, PhotoField } from '../photos';

const KINDS = [{ value: 'vehicle', label: 'Kendaraan' }, { value: 'building', label: 'Bangunan' }, { value: 'furniture', label: 'Perabot' }, { value: 'equipment', label: 'Peralatan' }, { value: 'other', label: 'Lainnya' }];
const STATUS: Record<string, string> = { tersedia: 'Tersedia', dipinjam: 'Dipinjam', maintenance: 'Perawatan', rusak: 'Rusak' };

type Sheetk = { kind: 'add' } | { kind: 'loan' | 'maint'; a: AssetView } | { kind: 'done'; a: AssetView } | null;

export function AssetsScreen() {
  const { backend, tz, platform } = useApp();
  const state = useAsync(() => backend.listAssets(), []);
  const [sheet, setSheet] = useState<Sheetk>(null);
  const act = useAction();
  const close = (r?: boolean) => { setSheet(null); if (r) state.reload(); };
  const giveBack = (a: AssetView) => act.run(async () => { if (a.activeLoan) { await backend.returnAsset(a.activeLoan.id); platform.notify('Aset dikembalikan'); state.reload(); } });
  return (
    <Screen title="Aset" right={<Btn label="+ Aset" onPress={() => setSheet({ kind: 'add' })} testID="add-asset" />}>
      <FormError message={act.error} />
      <Async state={state} empty={(d) => d.length === 0}>
        {(list) => (
          <Box className="gap-2">
            {list.map((a) => (
              <Card key={a.id} testID="asset-row" className="gap-2">
                <Box className="flex-row items-center gap-3">{a.photoAttachmentId ? <Photo id={a.photoAttachmentId} className="h-14 w-14 rounded-lg" icon="tag" /> : null}<Txt className="flex-1 text-base font-bold">{a.name}</Txt><Txt className={a.status === 'tersedia' ? 'text-emerald-600' : 'text-amber-600'}>{STATUS[a.status] ?? a.status}</Txt></Box>
                <Txt className="text-sm text-slate-600">{a.code ? `${a.code} · ` : ''}Nilai buku {formatRupiah(a.bookValue)} (beli {formatRupiah(a.purchasePrice)})</Txt>
                {a.activeLoan ? <Txt className="text-sm text-amber-700">Dipinjam {a.activeLoan.borrowerName} sejak {fmtDate(a.activeLoan.loanedAt, tz)}</Txt> : null}
                {a.pendingMaintenance ? <Txt className="text-sm text-slate-600">🛠️ Perawatan {fmtDate(a.pendingMaintenance.scheduledOn)}{a.pendingMaintenance.description ? ` — ${a.pendingMaintenance.description}` : ''}</Txt> : null}
                <Box className="flex-row flex-wrap gap-2">
                  {a.activeLoan ? <Btn label="Kembalikan" onPress={() => giveBack(a)} testID="asset-return" /> : <Btn label="Pinjamkan" variant="secondary" disabled={a.status !== 'tersedia'} onPress={() => setSheet({ kind: 'loan', a })} testID="asset-loan" />}
                  {a.pendingMaintenance ? <Btn label="Selesaikan perawatan" variant="secondary" onPress={() => setSheet({ kind: 'done', a })} /> : <Btn label="Jadwalkan perawatan" variant="ghost" onPress={() => setSheet({ kind: 'maint', a })} />}
                </Box>
              </Card>
            ))}
          </Box>
        )}
      </Async>
      {sheet?.kind === 'add' ? <AssetSheet onClose={close} /> : null}
      {sheet?.kind === 'loan' ? <LoanSheet a={sheet.a} onClose={close} /> : null}
      {sheet?.kind === 'maint' ? <MaintSheet a={sheet.a} onClose={close} /> : null}
      {sheet?.kind === 'done' && sheet.a.pendingMaintenance ? <DoneSheet a={sheet.a} onClose={close} /> : null}
    </Screen>
  );
}

function AssetSheet({ onClose }: { onClose: (r?: boolean) => void }) {
  const { backend, tz } = useApp();
  const [name, setName] = useState(''); const [kind, setKind] = useState('equipment'); const [code, setCode] = useState(''); const [price, setPrice] = useState<number | null>(null);
  const [life, setLife] = useState(''); const [date, setDate] = useState(todayLocal(tz)); const [loc, setLoc] = useState('');
  const [photoId, setPhotoId] = useState<string | null>(null);
  const act = useAction();
  const save = () => act.run(async () => {
    const months = life.trim() ? Number(life) : null;
    if (months !== null && (!Number.isInteger(months) || months < 1)) throw new Error('Umur manfaat harus bilangan bulat bulan.');
    await backend.createAsset({ name: name.trim(), kind, code: code || null, purchasePrice: price ?? 0, usefulLifeMonths: months, purchaseDate: date || null, location: loc || null, photoAttachmentId: photoId });
    onClose(true);
  });
  return (
    <Sheet visible title="Aset baru" onClose={() => onClose()}>
      <PhotoField label="Foto aset (opsional)" value={photoId} onChange={setPhotoId} testID="as-photo" />
      <Field label="Nama aset" value={name} onChangeText={setName} testID="as-name" autoCapitalize="words" />
      <Chips options={KINDS} value={kind} onChange={setKind} />
      <Field label="Kode (opsional)" value={code} onChangeText={setCode} autoCapitalize="none" />
      <MoneyField label="Harga perolehan" value={price} onChange={setPrice} testID="as-price" />
      <Field label="Umur manfaat (bulan, untuk penyusutan)" value={life} onChangeText={setLife} keyboard="numeric" />
      <Field label="Tanggal perolehan (YYYY-MM-DD)" value={date} onChangeText={setDate} />
      <Field label="Lokasi (opsional)" value={loc} onChangeText={setLoc} />
      <FormError message={act.error} />
      <Btn label="Simpan" loading={act.busy} disabled={!name.trim()} testID="as-save" onPress={save} />
    </Sheet>
  );
}

function LoanSheet({ a, onClose }: { a: AssetView; onClose: (r?: boolean) => void }) {
  const { backend } = useApp();
  const [who, setWho] = useState(''); const [phone, setPhone] = useState(''); const [why, setWhy] = useState('');
  const act = useAction();
  return (
    <Sheet visible title={`Pinjamkan ${a.name}`} onClose={() => onClose()}>
      <Field label="Nama peminjam" value={who} onChangeText={setWho} testID="ln-who" autoCapitalize="words" />
      <Field label="Telepon (opsional)" value={phone} onChangeText={setPhone} keyboard="phone" />
      <Field label="Keperluan (opsional)" value={why} onChangeText={setWhy} />
      <FormError message={act.error} />
      <Btn label="Pinjamkan" loading={act.busy} disabled={!who.trim()} testID="ln-save" onPress={() => act.run(async () => { await backend.loanAsset(a.id, { borrowerName: who.trim(), borrowerPhone: phone || null, purpose: why || null }); onClose(true); })} />
    </Sheet>
  );
}

function MaintSheet({ a, onClose }: { a: AssetView; onClose: (r?: boolean) => void }) {
  const { backend, tz } = useApp();
  const [date, setDate] = useState(todayLocal(tz)); const [desc, setDesc] = useState('');
  const act = useAction();
  return (
    <Sheet visible title={`Jadwalkan perawatan — ${a.name}`} onClose={() => onClose()}>
      <Field label="Tanggal (YYYY-MM-DD)" value={date} onChangeText={setDate} testID="mt-date" />
      <Field label="Keterangan (mis. Servis 40.000 km)" value={desc} onChangeText={setDesc} testID="mt-desc" />
      <FormError message={act.error} />
      <Btn label="Simpan" loading={act.busy} testID="mt-save" onPress={() => act.run(async () => { await backend.scheduleMaintenance(a.id, { scheduledOn: date, description: desc || null }); onClose(true); })} />
    </Sheet>
  );
}

function DoneSheet({ a, onClose }: { a: AssetView; onClose: (r?: boolean) => void }) {
  const { backend } = useApp();
  const [cost, setCost] = useState<number | null>(null);
  const act = useAction();
  const m = a.pendingMaintenance as NonNullable<AssetView['pendingMaintenance']>;
  return (
    <Sheet visible title={`Selesaikan perawatan — ${a.name}`} onClose={() => onClose()}>
      <Txt className="text-slate-600">{m.description ?? 'Perawatan'} · {fmtDate(m.scheduledOn)}</Txt>
      <MoneyField label="Biaya (otomatis tercatat sebagai pengeluaran)" value={cost} onChange={setCost} testID="dn-cost" />
      <FormError message={act.error} />
      <Btn label="Selesai" loading={act.busy} testID="dn-save" onPress={() => act.run(async () => { await backend.completeMaintenance(m.id, { cost: cost ?? 0 }); onClose(true); })} />
    </Sheet>
  );
}
