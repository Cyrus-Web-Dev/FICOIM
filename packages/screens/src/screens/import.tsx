import { useState } from 'react';
import { IMPORT_HEADERS, buildImportTemplateCsv, buildImportTemplateXlsx, formatQty, formatRupiah, mapRows, readTable, runImport, type ImportResult, type ParsedImport } from '@ficoim/client';
import { Box, Btn, Txt } from '../ui';
import { Card, FormError, IconBubble, Row, Screen, Section } from '../kit';
import { useAction } from '../hooks';
import { useApp } from '../platform';
import { useNav } from '../nav';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Impor produk dari Excel/CSV: template → pilih berkas → pratinjau & validasi per baris → impor (yang gagal dilaporkan, yang lain tetap masuk). */
export function ImportScreen() {
  const { backend, platform } = useApp();
  const nav = useNav();
  const act = useAction();
  const [parsed, setParsed] = useState<{ fileName: string; data: ParsedImport } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const pick = () => act.run(async () => {
    const f = await platform.pickDataFile?.();
    if (!f) return;
    setResult(null);
    setParsed({ fileName: f.fileName, data: mapRows(await readTable(f.bytes, f.fileName)) });
  });
  const go = () => act.run(async () => {
    if (!parsed) return;
    setProgress({ done: 0, total: parsed.data.rows.filter((r) => r.errors.length === 0).length });
    try { setResult(await runImport(backend, parsed.data.rows, (done, total) => setProgress({ done, total }))); setParsed(null); }
    finally { setProgress(null); }
  });

  const bad = parsed?.data.rows.filter((r) => r.errors.length > 0) ?? [];
  const good = parsed?.data.rows.filter((r) => r.errors.length === 0) ?? [];

  return (
    <Screen title="Impor produk">
      {!parsed && !result ? (
        <>
          <Card className="gap-2">
            <Box className="flex-row items-center gap-3"><IconBubble icon="inbox" tint="emerald" size={36} /><Txt className="flex-1 text-sm text-slate-700">Pindahkan daftar produk dari Excel atau CSV. Hanya kolom <Txt className="font-bold">Nama</Txt> yang wajib.</Txt></Box>
            <Txt className="text-xs text-slate-500">Kolom yang dikenali: {IMPORT_HEADERS.join(', ')}. Nama kolom boleh berbeda sedikit (mis. “Harga” = Harga Jual, “Modal” = Harga Beli). Baris dengan Nama sama dan Varian terisi digabung jadi satu produk bervarian.</Txt>
          </Card>
          <Box className="flex-row flex-wrap gap-2">
            <Btn label="📥 Template Excel" variant="secondary" testID="import-template-xlsx" onPress={() => act.run(async () => { await platform.saveFile({ bytes: buildImportTemplateXlsx(), fileName: 'FICOIM-template-impor-produk.xlsx', mime: XLSX_MIME }); })} />
            <Btn label="📄 Template CSV" variant="secondary" testID="import-template-csv" onPress={() => act.run(async () => { await platform.saveFile({ bytes: new TextEncoder().encode(buildImportTemplateCsv()), fileName: 'FICOIM-template-impor-produk.csv', mime: 'text/csv' }); })} />
          </Box>
          <Btn label="📂 Pilih berkas (.xlsx / .csv)" onPress={pick} loading={act.busy} disabled={!platform.pickDataFile} testID="import-pick" />
          <FormError message={act.error} />
        </>
      ) : null}

      {parsed ? (
        <>
          <Card className="gap-1" testID="import-summary">
            <Txt className="text-sm text-slate-500" numberOfLines={1}>{parsed.fileName}</Txt>
            <Txt className="text-base font-bold text-slate-900">{parsed.data.rows.length} baris · <Txt className="text-emerald-600">{good.length} siap</Txt>{bad.length > 0 ? <Txt className="text-rose-600"> · {bad.length} bermasalah</Txt> : null}</Txt>
            {parsed.data.unknownHeaders.length > 0 ? <Txt className="text-xs text-slate-500">Kolom diabaikan: {parsed.data.unknownHeaders.join(', ')}</Txt> : null}
          </Card>
          {bad.length > 0 ? (
            <Section title="Perlu diperbaiki (dilewati saat impor)">
              {bad.slice(0, 15).map((r) => <Row key={r.line} testID="import-bad" title={`Baris ${r.line}${r.name ? ` · ${r.name}` : ''}`} sub={r.errors.join('; ')} />)}
              {bad.length > 15 ? <Txt className="text-xs text-slate-500">…dan {bad.length - 15} baris lain.</Txt> : null}
            </Section>
          ) : null}
          {good.length > 0 ? (
            <Section title="Pratinjau">
              {good.slice(0, 6).map((r) => <Row key={r.line} testID="import-good" title={r.variant ? `${r.name} · ${r.variant}` : r.name} sub={[r.category, r.sku, `stok ${formatQty(r.stockMilli)}`].filter(Boolean).join(' · ')} right={formatRupiah(r.sellPrice)} rightSub={r.costPrice ? `modal ${formatRupiah(r.costPrice)}` : null} />)}
              {good.length > 6 ? <Txt className="text-xs text-slate-500">…dan {good.length - 6} baris siap lainnya.</Txt> : null}
            </Section>
          ) : null}
          <FormError message={act.error} />
          <Btn label={progress ? `Mengimpor ${progress.done}/${progress.total}…` : `Impor ${good.length} baris`} onPress={go} loading={act.busy} disabled={good.length === 0} testID="import-go" />
          <Btn label="Pilih berkas lain" variant="ghost" onPress={() => { setParsed(null); }} testID="import-back" />
        </>
      ) : null}

      {result ? (
        <>
          <Card className="items-center gap-2 p-5" testID="import-result">
            <IconBubble icon="check" tint={result.failed.length ? 'amber' : 'emerald'} size={56} />
            <Txt className="text-lg font-bold text-slate-900">{result.products} produk diimpor</Txt>
            <Txt className="text-center text-sm text-slate-500">{result.variants} varian{result.categoriesCreated ? ` · ${result.categoriesCreated} kategori baru` : ''}{result.failed.length ? ` · ${result.failed.length} gagal` : ''}</Txt>
          </Card>
          {result.failed.length > 0 ? (
            <Section title="Gagal diimpor">
              {result.failed.slice(0, 20).map((f) => <Row key={`${f.line}-${f.name}`} testID="import-failed" title={`Baris ${f.line} · ${f.name}`} sub={f.message} />)}
            </Section>
          ) : null}
          <Btn label="Lihat produk" onPress={() => nav.goTab('products')} testID="import-view" />
          <Btn label="Impor berkas lain" variant="ghost" onPress={() => setResult(null)} />
        </>
      ) : null}
    </Screen>
  );
}
