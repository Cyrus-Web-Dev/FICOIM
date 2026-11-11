import { useState } from 'react';
import { buildReceiptModel, buildReceiptText, type ReceiptModel } from '@ficoim/client';
import { Box, Btn, ReceiptPaper, Txt, hasReceiptImage, hasReceiptPaper, renderReceiptImage } from '../ui';
import { Card, ErrorBox, Loading } from '../kit';
import { useAction, useAsync } from '../hooks';
import { useImage } from '../photos';
import { useApp } from '../platform';

/**
 * Struk penjualan. Web: kertas animasi (printer → kertas keluar → stempel → bisa disobek). HP: struk teks monospasi.
 * Tombol: Bagikan, Cetak (web), Salin (web), Sobek/Cetak ulang (web, animasi). Teks & angka dibuat oleh fungsi murni yang teruji (client/receipt.ts).
 */
export function ReceiptPanel({ saleId }: { saleId: string; startOpen?: boolean }) {
  const { backend, tz } = useApp();
  const state = useAsync(async () => {
    const [biz, sale] = await Promise.all([backend.business(), backend.getSale(saleId)]);
    return { text: buildReceiptText(biz, sale, tz), model: buildReceiptModel(biz, sale, tz) };
  }, [saleId]);
  if (state.error) return <ErrorBox message={state.error} onRetry={state.reload} />;
  if (!state.data) return <Loading />;
  return <ReceiptBody text={state.data.text} model={state.data.model} />;
}

function ReceiptBody({ text, model }: { text: string; model: ReceiptModel }) {
  const { platform } = useApp();
  const [open, setOpen] = useState(false);
  const [torn, setTorn] = useState(false);
  const [playKey, setPlayKey] = useState(0);
  const act = useAction();
  const paper = hasReceiptPaper();
  const logoRaw = useImage(model.logoAttachmentId);
  const logo = logoRaw && logoRaw !== 'error' ? logoRaw : null;
  return (
    <Card className="gap-3" testID="receipt-panel">
      {paper ? (
        <Box className="items-center" testID="receipt-paper">
          <ReceiptPaper model={model} torn={torn} playKey={playKey} logo={logo} />
          {torn ? <Txt className="pt-2 text-sm text-slate-500">Struk disobek. Ketuk “Cetak ulang” untuk mencetak lagi.</Txt> : null}
        </Box>
      ) : null}
      <Box className="flex-row flex-wrap justify-center gap-2">
        <Btn label="📤 Bagikan" variant="secondary" testID="receipt-share" loading={act.busy} onPress={() => act.run(async () => { await platform.shareText(`Struk ${model.number}`, text); })} />
        {platform.printReceipt ? <Btn label="🖨️ Cetak" variant="secondary" testID="receipt-print" onPress={() => platform.printReceipt?.(`Struk ${model.number}`, text)} /> : null}
        {hasReceiptImage() ? <Btn label="🖼️ Gambar" variant="secondary" testID="receipt-image" loading={act.busy} onPress={() => act.run(async () => { const bytes = await renderReceiptImage(model, logo); await platform.saveFile({ bytes, fileName: `struk-${model.number}.png`, mime: 'image/png' }); })} /> : null}
        {platform.copyText ? <Btn label="📋 Salin" variant="secondary" testID="receipt-copy" onPress={() => act.run(async () => { await platform.copyText?.(text); })} /> : null}
        {paper ? (
          <Btn label={torn ? '🔁 Cetak ulang' : '✂️ Sobek struk'} variant="ghost" testID="receipt-tear" onPress={() => { if (torn) { setTorn(false); setPlayKey((k) => k + 1); } else setTorn(true); }} />
        ) : (
          <Btn label={open ? 'Sembunyikan' : 'Lihat struk'} variant="ghost" testID="receipt-toggle" onPress={() => setOpen((o) => !o)} />
        )}
      </Box>
      {act.error ? <Txt className="text-center text-sm text-rose-600">{act.error}</Txt> : null}
      {!paper && open ? (
        <Box className="rounded-lg bg-slate-50 p-3">
          <Txt testID="receipt-text" className="font-mono receipt-text text-xs text-slate-800">{text}</Txt>
        </Box>
      ) : null}
    </Card>
  );
}
