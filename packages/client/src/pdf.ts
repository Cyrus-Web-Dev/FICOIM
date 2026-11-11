import type { ExportSheet, ExportColumn } from './xlsx';

/**
 * Penulis PDF minimal tanpa dependensi: tabel laporan dengan font standar PDF (Helvetica, tidak perlu disematkan).
 * Satu sheet = satu bagian (halaman baru), header tabel diulang tiap halaman, nomor halaman di kaki.
 */
const PAGE_W = 595.28, PAGE_H = 841.89, MARGIN = 36, ROW_H = 15, FONT = 8.5;

// Lebar karakter Helvetica (per 1000 em), ASCII 32..126 — dari tabel AFM standar. Diverifikasi terhadap reportlab di test.
const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

const WIN_ANSI: Record<string, number> = { '–': 0x96, '—': 0x97, '·': 0xb7, '•': 0x95, '’': 0x92, '‘': 0x91, '“': 0x93, '”': 0x94, '…': 0x85, '€': 0x80, '×': 0xd7 };
function code(ch: string): number {
  const c = ch.codePointAt(0)!;
  if (c >= 32 && c <= 126) return c;
  if (c >= 160 && c <= 255) return c;
  return WIN_ANSI[ch] ?? 63; // '?'
}
export function textWidth(s: string, size: number, bold = false): number {
  const t = bold ? W_BOLD : W; let w = 0;
  for (const ch of s) { const c = code(ch); w += c >= 32 && c <= 126 ? t[c - 32]! : 556; }
  return (w * size) / 1000;
}
const hex = (s: string): string => { let o = ''; for (const ch of s) o += code(ch).toString(16).padStart(2, '0'); return `<${o}>`; };

function fit(s: string, max: number, size: number, bold: boolean): string {
  if (textWidth(s, size, bold) <= max) return s;
  let t = s;
  while (t.length > 1 && textWidth(t + '...', size, bold) > max) t = t.slice(0, -1);
  return t + '...';
}

/** 1234567 -> "1.234.567"; pecahan hingga 3 desimal dengan koma. */
export function formatId(n: number, maxFrac = 0): string {
  const neg = n < 0; const [i, f = ''] = Math.abs(n).toFixed(maxFrac).split('.');
  const frac = f.replace(/0+$/, '');
  return (neg ? '-' : '') + i!.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (frac ? `,${frac}` : '');
}
const cellText = (v: string | number | null, c: ExportColumn): string => {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return c.kind === 'qty' ? formatId(v, 3) : formatId(Math.round(v));
  return v;
};

interface PageOps { ops: string[] }

export function buildPdf(sheets: ExportSheet[], meta: { title: string; footer: string }): Uint8Array {
  const pages: PageOps[] = [];
  const usableW = PAGE_W - 2 * MARGIN;
  const rg = (hexColor: string) => { const n = parseInt(hexColor.slice(1), 16); return `${((n >> 16) & 255) / 255} ${((n >> 8) & 255) / 255} ${(n & 255) / 255}`; };
  const text = (p: PageOps, s: string, x: number, y: number, size: number, bold: boolean, color = '#0f172a', align: 'l' | 'r' = 'l', width = 0) => {
    const tx = align === 'r' ? x + width - textWidth(s, size, bold) : x;
    p.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rg(color)} rg ${tx.toFixed(2)} ${y.toFixed(2)} Td ${hex(s)} Tj ET`);
  };
  const rect = (p: PageOps, x: number, y: number, w: number, h: number, color: string) => p.ops.push(`${rg(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);

  for (const sh of sheets) {
    const weights = sh.columns.map((c) => Math.max(8, c.width ?? (c.kind === 'money' ? 16 : c.kind && c.kind !== 'text' ? 12 : 28)));
    const total = weights.reduce((a, b) => a + b, 0);
    const cw = weights.map((w) => (w / total) * usableW);
    const xs: number[] = []; cw.reduce((x, w) => { xs.push(x); return x + w; }, MARGIN);
    const bold = new Set(sh.boldRows ?? []);
    let ri = 0, first = true;
    do {
      const p: PageOps = { ops: [] }; pages.push(p);
      let y = PAGE_H - MARGIN;
      text(p, first ? sh.title : `${sh.title} (lanjutan)`, MARGIN, y - 12, 14, true); y -= 18;
      if (sh.subtitle) { text(p, fit(sh.subtitle, usableW, 9, false), MARGIN, y - 9, 9, false, '#64748b'); y -= 14; }
      y -= 6;
      rect(p, MARGIN, y - ROW_H + 3, usableW, ROW_H, '#4f46e5');
      sh.columns.forEach((c, i) => { const right = c.kind && c.kind !== 'text'; text(p, fit(c.header, cw[i]! - 8, FONT, true), xs[i]! + 4, y - ROW_H + 7, FONT, true, '#ffffff', right ? 'r' : 'l', cw[i]! - 8); });
      y -= ROW_H;
      const bottom = MARGIN + 18;
      while (ri < sh.rows.length && y - ROW_H > bottom) {
        const row = sh.rows[ri]!, b = bold.has(ri);
        if (ri % 2 === 1) rect(p, MARGIN, y - ROW_H + 3, usableW, ROW_H, '#f1f5f9');
        sh.columns.forEach((c, i) => {
          const s = fit(cellText(row[i] ?? null, c), cw[i]! - 8, FONT, b), right = c.kind && c.kind !== 'text';
          if (s) text(p, s, xs[i]! + 4, y - ROW_H + 7, FONT, b, '#0f172a', right ? 'r' : 'l', cw[i]! - 8);
        });
        y -= ROW_H; ri++;
      }
      if (sh.rows.length === 0) { text(p, 'Tidak ada data pada periode ini.', MARGIN + 4, y - ROW_H + 7, FONT, false, '#64748b'); }
      first = false;
    } while (ri < sh.rows.length);
  }

  // kaki halaman
  pages.forEach((p, i) => {
    text(p, meta.footer, MARGIN, 20, 7.5, false, '#94a3b8');
    const s = `Halaman ${i + 1} / ${pages.length}`;
    text(p, s, PAGE_W - MARGIN - textWidth(s, 7.5, false), 20, 7.5, false, '#94a3b8');
  });

  // ---- susun objek PDF
  const objs: string[] = [];
  const add = (s: string) => { objs.push(s); return objs.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(''); // Pages diisi setelah id halaman diketahui
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const infoId = add(`<< /Title ${hex(meta.title)} /Producer ${hex('FICOIM')} >>`);
  const pageIds: number[] = [];
  for (const p of pages) {
    const stream = p.ops.join('\n');
    const cid = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${cid} 0 R >>`));
  }
  objs[1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let out = '%PDF-1.4\n'; const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out); // seluruhnya ASCII (string heksadesimal), jadi 1 karakter = 1 byte
}
