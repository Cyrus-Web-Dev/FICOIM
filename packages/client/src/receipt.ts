import type { BusinessView, SaleDetail } from '@ficoim/core';
import { fmtDateTime } from './format';
import { formatQty, formatRupiah } from '@ficoim/shared';

/** Lebar bawaan struk teks (karakter): printer thermal 58 mm. Kertas 80 mm = 42 (pengaturan bisnis `receiptCols`). */
export const RECEIPT_WIDTH = 32;

const STATUS_TEXT: Record<string, string> = { paid: 'LUNAS', partial: 'CICILAN', unpaid: 'BELUM BAYAR', void: 'BATAL' };

function layout(width: number) {
  const LINE = '-'.repeat(width);
  const center = (s: string): string => { const t = s.slice(0, width); return ' '.repeat(Math.floor((width - t.length) / 2)) + t; };
  /** "label ........ nilai" rata kiri/kanan; bila terlalu panjang, nilai pindah ke baris berikutnya (rata kanan). */
  const pair = (left: string, right: string): string => {
    const gap = width - left.length - right.length;
    return gap >= 1 ? left + ' '.repeat(gap) + right : `${left}\n${' '.repeat(Math.max(0, width - right.length))}${right}`;
  };
  const wrap = (text: string, w = width): string[] => {
    const out: string[] = []; let cur = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
      let x = word;
      while (x.length > w) { if (cur) { out.push(cur); cur = ''; } out.push(x.slice(0, w)); x = x.slice(w); }
      if (!cur) cur = x; else if (cur.length + 1 + x.length <= w) cur += ` ${x}`; else { out.push(cur); cur = x; }
    }
    if (cur) out.push(cur);
    return out;
  };
  return { LINE, center, pair, wrap };
}

export interface ReceiptModel {
  businessName: string; address: string | null; phone: string | null;
  number: string; dateText: string; party: string | null;
  status: string; statusLabel: string; stampDate: string;
  items: { name: string; qtyText: string; unitPriceText: string; totalText: string; discountText: string | null }[];
  /** Baris ringkasan sebelum total (Subtotal, Diskon, PPN). */
  rows: { label: string; value: string; tone?: 'neg' }[];
  total: number; totalText: string; paidText: string; dueText: string | null;
  footer: string | null; barcode: string;
  /** Id lampiran logo toko (atau null). */
  logoAttachmentId: string | null;
}

/** Struk sebagai data terstruktur (untuk tampilan kertas animasi). Murni & teruji; angka diformat sama dengan struk teks. */
export function buildReceiptModel(biz: Pick<BusinessView, 'name' | 'address' | 'phone' | 'receiptFooter'> & { logoAttachmentId?: string | null }, sale: SaleDetail, tzOffsetMinutes = 420): ReceiptModel {
  const rows: ReceiptModel['rows'] = [{ label: 'Subtotal', value: formatRupiah(sale.subtotal) }];
  if (sale.discount > 0) rows.push({ label: 'Diskon', value: `-${formatRupiah(sale.discount)}`, tone: 'neg' });
  if (sale.tax > 0) rows.push({ label: 'PPN', value: formatRupiah(sale.tax) });
  return {
    businessName: biz.name, address: biz.address, phone: biz.phone,
    number: sale.number, dateText: fmtDateTime(sale.at, tzOffsetMinutes), party: sale.party,
    status: sale.status, statusLabel: STATUS_TEXT[sale.status] ?? sale.status.toUpperCase(), stampDate: fmtDateTime(sale.at, tzOffsetMinutes).split(' ').slice(0, 3).join(' ').toUpperCase(),
    items: sale.items.map((i) => ({
      name: i.name, qtyText: formatQty(i.qtyMilli), unitPriceText: formatRupiah(i.unitPrice), totalText: formatRupiah(i.lineTotal),
      discountText: i.discount > 0 ? `-${formatRupiah(i.discount)}` : null,
    })),
    rows, total: sale.total, totalText: formatRupiah(sale.total), paidText: formatRupiah(sale.paid),
    dueText: sale.paid < sale.total && sale.status !== 'void' ? formatRupiah(sale.total - sale.paid) : null,
    footer: biz.receiptFooter, barcode: sale.number, logoAttachmentId: biz.logoAttachmentId ?? null,
  };
}


/** Struk penjualan sebagai teks polos. Murni (tanpa efek samping): sama di web & HP, mudah diuji. */
export function buildReceiptText(biz: Pick<BusinessView, 'name' | 'address' | 'phone' | 'receiptFooter'> & { receiptCols?: number }, sale: SaleDetail, tzOffsetMinutes = 420): string {
  const { LINE, center, pair, wrap } = layout(biz.receiptCols === 42 ? 42 : RECEIPT_WIDTH);
  const out: string[] = [];
  out.push(...wrap(biz.name.toUpperCase()).map(center));
  if (biz.address) out.push(...wrap(biz.address).map(center));
  if (biz.phone) out.push(center(`Telp ${biz.phone}`));
  out.push(LINE);
  out.push(pair('No', sale.number));
  out.push(pair('Tanggal', fmtDateTime(sale.at, tzOffsetMinutes)));
  if (sale.party) out.push(pair('Pelanggan', sale.party));
  out.push(LINE);
  for (const i of sale.items) {
    out.push(...wrap(i.name));
    out.push(pair(`  ${formatQty(i.qtyMilli)} x ${formatRupiah(i.unitPrice, { symbol: false })}`, formatRupiah(i.lineTotal + i.discount, { symbol: false })));
    if (i.discount > 0) out.push(pair('  Diskon', `-${formatRupiah(i.discount, { symbol: false })}`));
  }
  out.push(LINE);
  out.push(pair('Subtotal', formatRupiah(sale.subtotal)));
  if (sale.discount > 0) out.push(pair('Diskon', `-${formatRupiah(sale.discount)}`));
  if (sale.tax > 0) out.push(pair('PPN', formatRupiah(sale.tax)));
  out.push(pair('TOTAL', formatRupiah(sale.total)));
  out.push(pair('Dibayar', formatRupiah(sale.paid)));
  if (sale.paid < sale.total && sale.status !== 'void') out.push(pair('Sisa (piutang)', formatRupiah(sale.total - sale.paid)));
  out.push(LINE);
  out.push(center(STATUS_TEXT[sale.status] ?? sale.status.toUpperCase()));
  if (biz.receiptFooter) { out.push(''); out.push(...wrap(biz.receiptFooter).map(center)); }
  return out.join('\n');
}
