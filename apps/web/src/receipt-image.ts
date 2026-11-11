import { code39Modules, type ReceiptModel } from '@ficoim/client';

const MONO = '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", "Courier New", monospace';
const SCALE = 2, W = 360, PAD = 22, OUT = 18; // lebar logis kertas; OUT = margin luar

type Ctx = CanvasRenderingContext2D;

function wrap(ctx: Ctx, text: string, max: number): string[] {
  const lines: string[] = []; let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word;
    while (ctx.measureText(w).width > max) { // kata terlalu panjang: potong per karakter
      let k = w.length - 1; while (k > 1 && ctx.measureText(w.slice(0, k)).width > max) k--;
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(w.slice(0, k)); w = w.slice(k);
    }
    const t = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(t).width > max) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Menggambar struk (kertas putih, tepi bergerigi, stempel, barcode) menjadi PNG. Dua kali: ukur tinggi lalu gambar. */
export async function renderReceiptPng(m: ReceiptModel, logo?: { bytes: Uint8Array; mime: string } | null): Promise<Uint8Array> {
  if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
  const bmp = logo ? await createImageBitmap(new Blob([logo.bytes.slice().buffer as ArrayBuffer], { type: logo.mime })).catch(() => null) : null;
  const measure = document.createElement('canvas').getContext('2d')!;
  const run = (ctx: Ctx, draw: boolean): number => {
    const inner = W - PAD * 2; let y = OUT + PAD;
    const font = (px: number, bold = false) => { ctx.font = `${bold ? '700' : '400'} ${px}px ${MONO}`; };
    const text = (s: string, x: number, yy: number, color: string, align: CanvasTextAlign = 'left') => { if (draw) { ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillText(s, x, yy); } };
    const dash = () => { y += 8; if (draw) { ctx.save(); ctx.strokeStyle = '#cbd5e1'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(OUT + PAD, y); ctx.lineTo(OUT + W - PAD, y); ctx.stroke(); ctx.restore(); } y += 12; };
    const row = (l: string, r: string, color = '#0f172a', bold = false, px = 12) => { font(px, bold); text(l, OUT + PAD, y + px, color); text(r, OUT + W - PAD, y + px, color, 'right'); y += px + 7; };

    // kepala
    font(14, true); const nameLines = wrap(ctx, m.businessName.toUpperCase(), inner - 46);
    nameLines.forEach((ln) => { text(ln, OUT + PAD, y + 14, '#3730a3'); y += 18; });
    font(10.5); [`Struk penjualan`, ...(m.address ? wrap(ctx, m.address, inner - 46) : []), ...(m.phone ? [`Telp ${m.phone}`] : [])].forEach((ln) => { text(ln, OUT + PAD, y + 10, '#64748b'); y += 14; });
    if (draw) { // logo
      const lx = OUT + W - PAD - 36, ly = OUT + PAD;
      if (bmp) { // logo toko: muat di kotak 36x36 tanpa distorsi
        const k = Math.min(32 / bmp.width, 32 / bmp.height), dw = bmp.width * k, dh = bmp.height * k;
        ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(lx, ly, 36, 36, 10); ctx.stroke();
        ctx.drawImage(bmp, lx + (36 - dw) / 2, ly + (36 - dh) / 2, dw, dh);
      } else {
        const g = ctx.createLinearGradient(lx, ly, lx + 36, ly + 36); g.addColorStop(0, '#4f46e5'); g.addColorStop(1, '#7c3aed');
        ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(lx, ly, 36, 36, 10); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = `800 20px ${MONO}`; ctx.textAlign = 'center'; ctx.fillText('F', lx + 18, ly + 26);
      }
    }
    y += 8;
    // baris meta
    if (draw) { ctx.fillStyle = '#f1f5f9'; ctx.beginPath(); ctx.roundRect(OUT + PAD, y, inner, 26, 6); ctx.fill(); }
    font(10.5); text(m.number, OUT + PAD + 8, y + 17, '#0f172a'); text(m.party ? `Pelanggan: ${m.party}` : 'Pelanggan umum', OUT + W - PAD - 8, y + 17, '#0f172a', 'right'); y += 26 + 14;
    font(28, true); const bigY = y + 28; text(m.totalText, OUT + PAD, bigY, '#0f172a'); y += 38;
    font(10.5); text(m.dateText, OUT + PAD, y + 10, '#64748b'); y += 14;
    const stampY = bigY - 4;
    dash();
    // barang
    for (const it of m.items) {
      font(12, true); const lines = wrap(ctx, it.name, inner - ctx.measureText(it.totalText).width - 12);
      lines.forEach((ln, i) => { text(ln, OUT + PAD, y + 12, '#0f172a'); if (i === 0) { font(12, true); text(it.totalText, OUT + W - PAD, y + 12, '#0f172a', 'right'); font(12, true); } y += 16; });
      font(10.5); text(`${it.qtyText} × ${it.unitPriceText}${it.discountText ? ` · diskon ${it.discountText}` : ''}`, OUT + PAD, y + 10, '#64748b'); y += 18;
    }
    dash();
    m.rows.forEach((r) => row(r.label, r.value, r.tone === 'neg' ? '#dc2626' : '#475569'));
    if (draw) { ctx.fillStyle = '#0f172a'; ctx.fillRect(OUT + PAD, y + 2, inner, 2); } y += 12;
    row('TOTAL', m.totalText, '#0f172a', true, 15);
    row('Dibayar', m.paidText, '#475569');
    if (m.dueText) row('Sisa (piutang)', m.dueText, '#b45309', true);
    y += 8; font(10); wrap(ctx, (m.footer ?? 'Terima kasih sudah berbelanja!').toUpperCase(), inner).forEach((ln) => { text(ln, OUT + W / 2, y + 10, '#475569', 'center'); y += 14; });
    // barcode
    y += 10; const mods = code39Modules(m.barcode), total = mods.reduce((a, b) => a + b, 0), unit = inner / total;
    if (draw) { let x = OUT + PAD; ctx.fillStyle = '#0f172a'; mods.forEach((w, i) => { if (i % 2 === 0) ctx.fillRect(x, y, w * unit, 44); x += w * unit; }); }
    y += 44 + 14; font(10); text(m.barcode, OUT + W / 2, y, '#64748b', 'center'); y += 22;
    if (draw) { // stempel
      const col = m.status === 'paid' ? '#16a34a' : m.status === 'void' ? '#64748b' : '#d97706';
      ctx.save(); ctx.translate(OUT + W - PAD - 62, stampY - 4); ctx.rotate((-12 * Math.PI) / 180); ctx.globalAlpha = 0.9;
      ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.setLineDash([7, 4]); ctx.beginPath(); ctx.roundRect(-58, -22, 116, 44, 8); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.font = `800 17px ${MONO}`; ctx.fillText(m.statusLabel, 0, 2); ctx.font = `700 8px ${MONO}`; ctx.fillText(m.stampDate, 0, 15); ctx.restore();
    }
    return y;
  };

  measure.font = `400 12px ${MONO}`;
  const paperBottom = run(measure, false);
  const H = paperBottom + OUT;
  const canvas = document.createElement('canvas'); canvas.width = (W + OUT * 2) * SCALE; canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d')!; ctx.scale(SCALE, SCALE);
  ctx.fillStyle = '#e2e8f0'; ctx.fillRect(0, 0, W + OUT * 2, H);
  // kertas: bayangan + tepi bawah bergerigi
  ctx.save(); ctx.shadowColor = 'rgba(15,23,42,.25)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 6; ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.moveTo(OUT, OUT); ctx.lineTo(OUT + W, OUT); ctx.lineTo(OUT + W, paperBottom - 8);
  const teeth = Math.round(W / 10); for (let i = 0; i < teeth; i++) { const x = OUT + W - ((i + 0.5) * W) / teeth; ctx.lineTo(x, paperBottom); ctx.lineTo(OUT + W - ((i + 1) * W) / teeth, paperBottom - 8); }
  ctx.lineTo(OUT, OUT); ctx.closePath(); ctx.fill(); ctx.restore();
  run(ctx, true);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('Gagal membuat gambar struk.');
  return new Uint8Array(await blob.arrayBuffer());
}
