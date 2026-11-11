import { useMemo, useState } from 'react';
import { fetchAll, formatRupiah, labelOf, type VariantView } from '@ficoim/client';
import { Box, Btn, Icon, QrCode, Txt, hasQrCode } from '../ui';
import { Async, Card, Chips, FormError, IconBubble, Screen, Section } from '../kit';
import { useAction, useAsync } from '../hooks';
import { useApp } from '../platform';

type Size = 'a4' | '50x30' | '40x30';
const SIZES: { value: Size; label: string }[] = [{ value: 'a4', label: 'A4 · 3 kolom' }, { value: '50x30', label: 'Label 50×30 mm' }, { value: '40x30', label: 'Label 40×30 mm' }];
const MAX_LABELS = 300; // batas wajar satu cetakan

/** Kode yang dicetak = barcode, atau SKU bila tidak ada barcode (kasir mencari keduanya lewat findByCode). */
const codeOf = (v: VariantView): string | null => v.barcode?.trim() || v.sku?.trim() || null;

/** Label produk: QR + nama + harga. Dicetak ke kertas A4 stiker atau printer label; hasil scan langsung dikenali kasir. */
export function LabelsScreen() {
  const { backend, platform } = useApp();
  const act = useAction();
  const state = useAsync(() => fetchAll((limit, offset) => backend.listProducts({ limit, offset }), 500, 5000), []);
  const [size, setSize] = useState<Size>('a4');
  const [copies, setCopies] = useState<Record<string, number>>({});

  const items = useMemo(() => (state.data ?? []).filter((v) => v.isActive), [state.data]);
  const chosen = items.filter((v) => (copies[v.id] ?? 0) > 0 && codeOf(v));
  const labels = chosen.flatMap((v) => Array.from({ length: copies[v.id]! }, () => v)).slice(0, MAX_LABELS);
  const noCode = items.filter((v) => !codeOf(v));
  const setN = (id: string, n: number) => setCopies((c) => ({ ...c, [id]: Math.max(0, Math.min(99, n)) }));

  const autoCodes = () => act.run(async () => {
    for (const v of noCode) await backend.updateVariant(v.id, { sku: `FIC-${v.id.replace(/-/g, '').slice(-8).toUpperCase()}` });
    platform.notify(`${noCode.length} kode dibuat`);
    state.reload();
  });

  if (!hasQrCode()) {
    return <Screen title="Label produk"><Txt className="text-slate-500">Pencetakan label tersedia di versi web.</Txt></Screen>;
  }
  return (
    <Screen title="Label produk">
      <Txt className="text-sm text-slate-500">Pilih produk dan jumlah label. QR berisi barcode/SKU produk, jadi bisa dipindai langsung di kasir.</Txt>
      <Chips options={SIZES} value={size} onChange={setSize} testID="label-size" />
      <Async state={state} empty={(d) => d.length === 0}>
        {() => (
          <>
            {noCode.length > 0 ? (
              <Card className="gap-2" testID="label-nocode">
                <Box className="flex-row items-center gap-2"><IconBubble icon="alert" tint="amber" size={28} /><Txt className="flex-1 text-sm text-slate-700">{noCode.length} produk belum punya SKU/barcode, jadi belum bisa dicetak labelnya.</Txt></Box>
                <Btn label={`Buat kode otomatis (${noCode.length})`} variant="secondary" onPress={autoCodes} loading={act.busy} testID="label-autocode" />
              </Card>
            ) : null}
            <Box className="flex-row flex-wrap gap-2">
              <Btn label="Pilih semua (1 label)" variant="ghost" testID="label-all" onPress={() => setCopies(Object.fromEntries(items.filter(codeOf).map((v) => [v.id, 1])))} />
              <Btn label="Kosongkan" variant="ghost" onPress={() => setCopies({})} />
            </Box>
            <Box className="gap-2">
              {items.map((v) => {
                const code = codeOf(v), n = copies[v.id] ?? 0;
                return (
                  <Card key={v.id} testID="label-row" className="flex-row items-center gap-3">
                    <Box onPress={code ? () => setN(v.id, n > 0 ? 0 : 1) : undefined} testID="label-toggle" className={`h-6 w-6 items-center justify-center rounded-md border ${n > 0 ? 'border-indigo-600 bg-indigo-600' : 'border-slate-300'}`}>
                      {n > 0 ? <Icon name="check" size={14} className="text-white" /> : null}
                    </Box>
                    <Box className="flex-1">
                      <Txt className="text-sm font-semibold text-slate-900" numberOfLines={1}>{labelOf(v)}</Txt>
                      <Txt className="text-xs text-slate-500" numberOfLines={1}>{code ?? 'tanpa kode'} · {formatRupiah(v.sellPrice)}</Txt>
                    </Box>
                    {code && n > 0 ? (
                      <Box className="flex-row items-center gap-2">
                        <Box onPress={() => setN(v.id, n - 1)} testID="label-minus" className="h-8 w-8 items-center justify-center rounded-full bg-slate-100"><Icon name="minus" size={16} className="text-slate-700" /></Box>
                        <Txt testID="label-count" className="w-6 text-center font-bold text-slate-900">{n}</Txt>
                        <Box onPress={() => setN(v.id, n + 1)} testID="label-plus" className="h-8 w-8 items-center justify-center rounded-full bg-slate-100"><Icon name="plus" size={16} className="text-slate-700" /></Box>
                      </Box>
                    ) : null}
                  </Card>
                );
              })}
            </Box>
          </>
        )}
      </Async>

      <Section title={`Pratinjau (${labels.length} label)`}>
        {labels.length === 0 ? <Txt className="text-sm text-slate-500">Belum ada label dipilih.</Txt> : (
          <Box className={`label-sheet lbl-${size}`} testID="label-sheet">
            {labels.map((v, i) => (
              <Box key={`${v.id}-${i}`} className="label flex-row items-center gap-2 border border-slate-300 bg-white p-1.5">
                <QrCode value={codeOf(v)!} className="label-qr" />
                <Box className="label-text flex-1 justify-between">
                  <Txt className="label-name text-[11px] font-bold leading-tight text-slate-900" numberOfLines={3}>{labelOf(v)}</Txt>
                  <Box>
                    <Txt className="label-price text-sm font-extrabold text-slate-900">{formatRupiah(v.sellPrice)}</Txt>
                    <Txt className="label-code font-mono text-[9px] text-slate-500" numberOfLines={1}>{codeOf(v)}</Txt>
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Section>
      {labels.length >= MAX_LABELS ? <Txt className="text-xs text-amber-700">Dibatasi {MAX_LABELS} label per cetakan.</Txt> : null}
      <FormError message={act.error} />
      <Btn label="🖨️ Cetak label" onPress={() => platform.printLabels?.(size)} disabled={labels.length === 0 || !platform.printLabels} testID="label-print" />
    </Screen>
  );
}
