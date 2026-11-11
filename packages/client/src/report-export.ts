import type { Backend } from './backend';
import { buildXlsx, type ExportSheet } from './xlsx';
import { buildPdf } from './pdf';

export interface ReportExportOptions { from: string; to: string; tzOffsetMinutes: number; businessName: string }

const STATUS: Record<string, string> = { paid: 'Lunas', partial: 'Cicilan', unpaid: 'Belum bayar', void: 'Batal' };
const KIND: Record<string, string> = { income: 'Pemasukan', expense: 'Pengeluaran', transfer_in: 'Transfer masuk', transfer_out: 'Transfer keluar' };

/** "2026-11-07T14:05:00.000Z" -> "2026-11-07 21:05" menurut zona waktu bisnis. Format ISO agar bisa diurutkan di Excel. */
export function localDateTime(iso: string, tzOffsetMinutes: number): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + tzOffsetMinutes * 60_000).toISOString().slice(0, 16).replace('T', ' ') : iso;
}

/** Mengambil semua halaman sebuah daftar (server membatasi 500/1000 baris per panggilan). Berhenti di `maxRows` agar memori aman. */
export async function fetchAll<T>(page: (limit: number, offset: number) => Promise<T[]>, pageSize: number, maxRows = 20_000): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const rows = await page(pageSize, offset);
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out.slice(0, maxRows);
}

const slug = (s: string): string => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'bisnis';

/** Semua sheet laporan untuk periode [from, to]. Butuh izin lihat laporan (pemilik/manajer yang diberi hak). */
export async function buildReportSheets(backend: Backend, o: ReportExportOptions): Promise<ExportSheet[]> {
  const { from, to, tzOffsetMinutes: tz } = o;
  const sub = `${o.businessName} · periode ${from} s.d. ${to}`;
  const [pl, top, days, sales, purchases, txs, debts, products] = await Promise.all([
    backend.profitLoss(from, to), backend.topProducts(from, to, 100), backend.salesByDay(from, to),
    fetchAll((limit, offset) => backend.listSales({ from, to, limit, offset }), 500),
    fetchAll((limit, offset) => backend.listPurchases({ from, to, limit, offset }), 500),
    fetchAll((limit, offset) => backend.listTransactions({ from, to, limit, offset }), 1000),
    backend.listDebts({ onlyOpen: true }),
    fetchAll((limit, offset) => backend.listProducts({ limit, offset }), 500),
  ]);

  const summary: [string, number | null, boolean][] = [
    [`Penjualan (${pl.salesCount} transaksi)`, pl.grossSales, false], ['PPN (bukan pendapatan)', -pl.tax, false], ['Pendapatan bersih', pl.netRevenue, true],
    ['Harga pokok penjualan (HPP)', -pl.cogs, false], ['Laba kotor', pl.grossProfit, true], ['Pemasukan lain', pl.otherIncome, false],
    ...pl.expensesByCategory.map((e): [string, number | null, boolean] => [`Biaya: ${e.category}`, -e.total, false]),
    ['LABA BERSIH', pl.netProfit, true], ['', null, false], ['Arus kas masuk', pl.cashIn, false], ['Arus kas keluar', -pl.cashOut, false],
  ];

  const stockRows = products.filter((p) => p.isActive);
  return [
    { name: 'Laba Rugi', title: 'Laporan Laba Rugi', subtitle: sub, columns: [{ header: 'Keterangan', width: 38 }, { header: 'Jumlah (Rp)', kind: 'money' }],
      rows: summary.map(([l, v]) => [l, v]), boldRows: summary.flatMap(([, , b], i) => (b ? [i] : [])) },
    { name: 'Penjualan', title: 'Riwayat Penjualan', subtitle: sub, columns: [{ header: 'No. dokumen', width: 22 }, { header: 'Tanggal', width: 24 }, { header: 'Pelanggan' }, { header: 'Total (Rp)', kind: 'money' }, { header: 'Dibayar (Rp)', kind: 'money' }, { header: 'Sisa (Rp)', kind: 'money' }, { header: 'Status', width: 14 }],
      rows: [...sales.map((s) => [s.number, localDateTime(s.at, tz), s.party ?? 'Umum', s.total, s.paid, s.status === 'void' ? 0 : s.total - s.paid, STATUS[s.status] ?? s.status]),
        ['TOTAL (tanpa yang batal)', null, null, sales.filter((s) => s.status !== 'void').reduce((a, s) => a + s.total, 0), sales.filter((s) => s.status !== 'void').reduce((a, s) => a + s.paid, 0), null, null]],
      boldRows: [sales.length] },
    { name: 'Penjualan Harian', title: 'Penjualan per Hari', subtitle: sub, columns: [{ header: 'Tanggal', width: 14 }, { header: 'Transaksi', kind: 'int' }, { header: 'Total (Rp)', kind: 'money' }], rows: days.map((d) => [d.date, d.count, d.total]) },
    { name: 'Produk Terlaris', title: 'Produk Terlaris', subtitle: sub, columns: [{ header: 'Produk', width: 36 }, { header: 'Terjual', kind: 'qty' }, { header: 'Pendapatan (Rp)', kind: 'money' }, { header: 'HPP (Rp)', kind: 'money' }, { header: 'Laba (Rp)', kind: 'money' }],
      rows: top.map((t) => [t.name, t.qtyMilli / 1000, t.revenue, t.cogs, t.profit]) },
    { name: 'Pembelian', title: 'Pembelian Stok', subtitle: sub, columns: [{ header: 'No. dokumen', width: 22 }, { header: 'Tanggal', width: 24 }, { header: 'Pemasok' }, { header: 'Total (Rp)', kind: 'money' }, { header: 'Dibayar (Rp)', kind: 'money' }, { header: 'Status', width: 14 }, { header: 'Ada foto nota', width: 14 }],
      rows: purchases.map((p) => [p.number, localDateTime(p.at, tz), p.party ?? '-', p.total, p.paid, STATUS[p.status] ?? p.status, p.receiptAttachmentId ? 'Ya' : 'Tidak']) },
    { name: 'Kas', title: 'Transaksi Kas', subtitle: sub, columns: [{ header: 'Tanggal', width: 14 }, { header: 'Jenis', width: 16 }, { header: 'Kategori' }, { header: 'Dompet' }, { header: 'Jumlah (Rp)', kind: 'money' }, { header: 'Keterangan', width: 36 }, { header: 'Otomatis', width: 10 }],
      rows: txs.map((t) => [t.occurredOn, KIND[t.type] ?? t.type, t.categoryName, t.walletName, t.amount, t.description ?? '', t.auto ? 'Ya' : '']) },
    { name: 'Hutang Piutang', title: 'Hutang & Piutang Belum Lunas', subtitle: `${o.businessName} · per ${to}`, columns: [{ header: 'Jenis', width: 12 }, { header: 'Pihak' }, { header: 'Jumlah (Rp)', kind: 'money' }, { header: 'Terbayar (Rp)', kind: 'money' }, { header: 'Sisa (Rp)', kind: 'money' }, { header: 'Jatuh tempo', width: 14 }, { header: 'Catatan', width: 30 }],
      rows: debts.map((d) => [d.kind === 'receivable' ? 'Piutang' : 'Hutang', d.partyName, d.amount, d.paidAmount, d.remaining, d.dueDate ?? '', d.note ?? '']) },
    { name: 'Persediaan', title: 'Persediaan Barang (saat ini)', subtitle: `${o.businessName} · per ${to}`, columns: [{ header: 'Produk', width: 36 }, { header: 'SKU', width: 16 }, { header: 'Kategori' }, { header: 'Stok', kind: 'qty' }, { header: 'Satuan', width: 10 }, { header: 'Harga beli (Rp)', kind: 'money' }, { header: 'Harga jual (Rp)', kind: 'money' }, { header: 'Nilai stok (Rp)', kind: 'money' }],
      rows: [...stockRows.map((p) => [p.variantName === 'Default' ? p.productName : `${p.productName} ${p.variantName}`, p.sku ?? '', p.categoryName ?? '', p.trackStock ? p.stockQtyMilli / 1000 : null, p.unit, p.costPrice, p.sellPrice, p.trackStock ? Math.round((p.stockQtyMilli * p.costPrice) / 1000) : 0]),
        ['TOTAL NILAI PERSEDIAAN', null, null, null, null, null, null, stockRows.reduce((a, p) => a + (p.trackStock ? Math.round((p.stockQtyMilli * p.costPrice) / 1000) : 0), 0)]],
      boldRows: [stockRows.length] },
  ];
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function buildReportWorkbook(backend: Backend, o: ReportExportOptions): Promise<{ bytes: Uint8Array; fileName: string; mime: string; sheets: number }> {
  const sheets = await buildReportSheets(backend, o);
  return { bytes: buildXlsx(sheets), fileName: `FICOIM-laporan-${slug(o.businessName)}-${o.from}_${o.to}.xlsx`, mime: XLSX_MIME, sheets: sheets.length };
}

export const PDF_MIME = 'application/pdf';

/** Laporan yang sama dengan Excel, dalam bentuk PDF (siap dicetak/dikirim). */
export async function buildReportPdf(backend: Backend, o: ReportExportOptions): Promise<{ bytes: Uint8Array; fileName: string; mime: string; sheets: number }> {
  const sheets = await buildReportSheets(backend, o);
  const bytes = buildPdf(sheets, { title: `Laporan ${o.businessName} ${o.from} s.d. ${o.to}`, footer: `FICOIM · ${o.businessName} · ${o.from} s.d. ${o.to}` });
  return { bytes, fileName: `FICOIM-laporan-${slug(o.businessName)}-${o.from}_${o.to}.pdf`, mime: PDF_MIME, sheets: sheets.length };
}
