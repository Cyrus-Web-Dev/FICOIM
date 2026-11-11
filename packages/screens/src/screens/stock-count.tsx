import { useState } from 'react';
import { applyCount, buildCountSheetXlsx, describeDiff, fetchAll, formatQty, mapCountRows, planCount, readTable, type CountPlan, type CountResult } from '@ficoim/client';
import { Box, Btn, Field, Txt } from '../ui';
import { Card, FormError, IconBubble, Row, Screen, Section } from '../kit';
import { useAction } from '../hooks';
import { useApp } from '../platform';
import { useNav } from '../nav';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Stok opname massal: unduh daftar stok → hitung di lapangan → isi "Stok Fisik" → unggah → cek selisih → terapkan. */
export function StockCountScreen() {
  const { backend, platform } = useApp();
  const nav = useNav();
  const act = useAction();
  const [plan, setPlan] = useState<{ fileName: string; data: CountPlan } | null>(null);
  const [note, setNote] = useState('Stok opname massal');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<CountResult | null>(null);

  const variants = () => fetchAll((limit, offset) => backend.listProducts({ limit, offset }), 500, 20_000);
  const download = () => act.run(async () => {
    const v = await variants();
    await platform.saveFile({ bytes: buildCountSheetXlsx(v), fileName: 'FICOIM-daftar-hitung-stok.xlsx', mime: XLSX_MIME });
  });
  const pick = () => act.run(async () => {
    const f = await platform.pickDataFile?.();
    if (!f) return;
    setResult(null);
    const rows = mapCountRows(await readTable(f.bytes, f.fileName));
    setPlan({ fileName: f.fileName, data: planCount(rows, await variants()) });
  });
  const changed = plan?.data.items.filter((i) => i.errors.length === 0 && i.diff !== 0) ?? [];
  const bad = plan?.data.items.filter((i) => i.errors.length > 0) ?? [];
  const apply = () => act.run(async () => {
    if (!plan) return;
    setProgress({ done: 0, total: changed.length });
    try { setResult(await applyCount(backend, plan.data.items, note, (done, total) => setProgress({ done, total }))); setPlan(null); }
    finally { setProgress(null); }
  });

  return (
    <Screen title="Stok opname massal">
      {!plan && !result ? (
        <>
          <Card className="gap-2">
            <Box className="flex-row items-center gap-3"><IconBubble icon="box" tint="sky" size={36} /><Txt className="flex-1 text-sm text-slate-700">Hitung stok fisik di rak, isi di Excel, lalu unggah. Selisih ditampilkan dulu sebelum stok diubah.</Txt></Box>
            <Txt className="text-xs text-slate-500">1) Unduh daftar stok. 2) Isi kolom “Stok Fisik” (kosong = tidak dihitung). 3) Pilih berkas di sini. Stok sistem akan <Txt className="font-bold">diganti</Txt> dengan hasil hitungan dan tercatat di kartu stok sebagai opname.</Txt>
          </Card>
          <Btn label="📥 Unduh daftar hitung (Excel)" variant="secondary" testID="count-download" onPress={download} loading={act.busy} />
          <Btn label="📂 Pilih berkas hasil hitung (.xlsx / .csv)" onPress={pick} loading={act.busy} disabled={!platform.pickDataFile} testID="count-pick" />
          <FormError message={act.error} />
        </>
      ) : null}

      {plan ? (
        <>
          <Card className="gap-1" testID="count-summary">
            <Txt className="text-sm text-slate-500" numberOfLines={1}>{plan.fileName}</Txt>
            <Txt className="text-base font-bold text-slate-900"><Txt className="text-indigo-600">{changed.length} berubah</Txt> · {plan.data.unchanged} sama{plan.data.skippedBlank ? ` · ${plan.data.skippedBlank} tidak dihitung` : ''}{bad.length ? <Txt className="text-rose-600"> · {bad.length} bermasalah</Txt> : null}</Txt>
          </Card>
          {bad.length > 0 ? (
            <Section title="Perlu diperbaiki (dilewati)">
              {bad.slice(0, 15).map((i) => <Row key={i.line} testID="count-bad" title={`Baris ${i.line}${i.name ? ` · ${i.name}` : ''}`} sub={i.errors.join('; ')} />)}
              {bad.length > 15 ? <Txt className="text-xs text-slate-500">…dan {bad.length - 15} lainnya.</Txt> : null}
            </Section>
          ) : null}
          {changed.length > 0 ? (
            <Section title="Selisih stok">
              {changed.slice(0, 40).map((i) => (
                <Row key={i.line} testID="count-diff" title={i.name} sub={`${formatQty(i.system)} → ${formatQty(i.counted)} ${i.unit}`} right={describeDiff(i.diff, i.unit)} rightSub={i.diff < 0 ? 'berkurang' : 'bertambah'} />
              ))}
              {changed.length > 40 ? <Txt className="text-xs text-slate-500">…dan {changed.length - 40} lainnya (semua tetap diterapkan).</Txt> : null}
            </Section>
          ) : <Txt className="text-sm text-slate-500">Tidak ada selisih: semua hitungan sama dengan stok sistem.</Txt>}
          <Field label="Catatan di kartu stok" value={note} onChangeText={setNote} testID="count-note" />
          <FormError message={act.error} />
          <Btn label={progress ? `Menerapkan ${progress.done}/${progress.total}…` : `Terapkan ${changed.length} perubahan stok`} onPress={apply} loading={act.busy} disabled={changed.length === 0} testID="count-apply" />
          <Btn label="Pilih berkas lain" variant="ghost" onPress={() => setPlan(null)} />
        </>
      ) : null}

      {result ? (
        <>
          <Card className="items-center gap-2 p-5" testID="count-result">
            <IconBubble icon="check" tint={result.failed.length ? 'amber' : 'emerald'} size={56} />
            <Txt className="text-lg font-bold text-slate-900">{result.updated} stok diperbarui</Txt>
            {result.failed.length ? <Txt className="text-sm text-amber-700">{result.failed.length} gagal</Txt> : null}
          </Card>
          {result.failed.length > 0 ? <Section title="Gagal diterapkan">{result.failed.map((f) => <Row key={f.line} title={`Baris ${f.line} · ${f.name}`} sub={f.message} />)}</Section> : null}
          <Btn label="Lihat produk" onPress={() => nav.goTab('products')} />
          <Btn label="Opname lagi" variant="ghost" onPress={() => setResult(null)} />
        </>
      ) : null}
    </Screen>
  );
}
