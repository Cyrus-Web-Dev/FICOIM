/**
 * Penulis berkas Excel (.xlsx) minimal tanpa dependensi: paket ZIP "stored" + XML SpreadsheetML.
 * Teks ditulis sebagai inlineStr (tidak pernah dianggap rumus, jadi aman dari "formula injection"); angka sebagai angka asli sehingga
 * bisa dijumlah/diurutkan di Excel. Dibuka oleh Excel, LibreOffice, Google Sheets, dan Numbers.
 */
export type CellKind = 'text' | 'money' | 'int' | 'qty';
export type Cell = string | number | null;
export interface ExportColumn { header: string; kind?: CellKind; width?: number }
export interface ExportSheet {
  name: string; title: string; subtitle?: string; columns: ExportColumn[]; rows: Cell[][];
  /** Indeks baris (0-based, di dalam `rows`) yang dicetak tebal (mis. total). */
  boldRows?: number[];
}

// ------------------------------------------------------------------ ZIP (stored, tanpa kompresi)
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01 (tanggal tetap: keluaran deterministik)
  const parts: Uint8Array[] = []; const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number) => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const local = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(DATE), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...name]);
    parts.push(local, f.data);
    central.push(Uint8Array.from([0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(DATE), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]));
    offset += local.length + size;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = Uint8Array.from([0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

// ------------------------------------------------------------------ XML
const esc = (s: string): string => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function colLetter(i: number): string { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; }

/** Nama sheet Excel: ≤ 31 karakter, tanpa []:*?/\ , unik. */
export function sheetName(raw: string, used: Set<string>): string {
  const base = (raw.replace(/[\[\]:*?\/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Sheet').slice(0, 31);
  let name = base, i = 2;
  while (used.has(name.toLowerCase())) { const suf = ` (${i++})`; name = base.slice(0, 31 - suf.length) + suf; }
  used.add(name.toLowerCase());
  return name;
}

// indeks gaya (cellXfs) — lihat STYLES
const S = { header: 1, money: 2, int: 3, qty: 4, title: 5, sub: 6, bold: 7, boldMoney: 8, boldInt: 9, boldQty: 10 } as const;
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.###"/></numFmts>
<fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF64748B"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF4F46E5"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="3" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/><xf numFmtId="1" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/><xf numFmtId="164" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function cellXml(ref: string, v: Cell, kind: CellKind, bold: boolean): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) {
    const s = kind === 'money' ? (bold ? S.boldMoney : S.money) : kind === 'qty' ? (bold ? S.boldQty : S.qty) : kind === 'int' ? (bold ? S.boldInt : S.int) : (bold ? S.boldMoney : 0);
    return `<c r="${ref}"${s ? ` s="${s}"` : ''}><v>${v}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"${bold ? ` s="${S.bold}"` : ''}><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

function sheetXml(sh: ExportSheet): string {
  const rows: string[] = [];
  rows.push(`<row r="1" ht="22" customHeight="1"><c r="A1" t="inlineStr" s="${S.title}"><is><t xml:space="preserve">${esc(sh.title)}</t></is></c></row>`);
  if (sh.subtitle) rows.push(`<row r="2"><c r="A2" t="inlineStr" s="${S.sub}"><is><t xml:space="preserve">${esc(sh.subtitle)}</t></is></c></row>`);
  const hr = 4;
  rows.push(`<row r="${hr}" ht="20" customHeight="1">${sh.columns.map((c, i) => `<c r="${colLetter(i)}${hr}" t="inlineStr" s="${S.header}"><is><t xml:space="preserve">${esc(c.header)}</t></is></c>`).join('')}</row>`);
  const bold = new Set(sh.boldRows ?? []);
  sh.rows.forEach((r, ri) => {
    const rn = hr + 1 + ri;
    rows.push(`<row r="${rn}">${sh.columns.map((c, ci) => cellXml(`${colLetter(ci)}${rn}`, r[ci] ?? null, c.kind ?? 'text', bold.has(ri))).join('')}</row>`);
  });
  const cols = sh.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? (c.kind === 'money' ? 16 : c.kind === 'text' || !c.kind ? 28 : 12)}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${hr}" topLeftCell="A${hr + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData></worksheet>`;
}

/** Membuat berkas .xlsx (bytes) dari beberapa sheet. */
export function buildXlsx(sheets: ExportSheet[]): Uint8Array {
  if (sheets.length === 0) throw new Error('Minimal satu sheet.');
  const enc = new TextEncoder(); const used = new Set<string>();
  const names = sheets.map((s) => sheetName(s.name, used));
  const n = sheets.length;
  const files: { name: string; data: Uint8Array }[] = [
    { name: '[Content_Types].xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`) },
    { name: '_rels/.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: 'xl/workbook.xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((nm, i) => `<sheet name="${esc(nm)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: 'xl/styles.xml', data: enc.encode(STYLES) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s)) })),
  ];
  return zipStore(files);
}
