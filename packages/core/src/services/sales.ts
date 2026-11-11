import { lineTotal, percentBp } from '@ficoim/shared';
import { getRow, insertRow, selectRows, num, updateRow } from '../db';
import { DomainError, notFound, validation } from '../errors';
import { nowIso, stdRow, withTx, type Ctx } from '../ctx';
import { requireCan } from '../permissions';
import { SYSTEM_CATEGORY } from '../presets';
import { localDate, nextNumber, optText, requireDate, requireInt, requireText } from '../util';
import { audit } from './audit';
import { postTransaction } from './ledger';
import { resolveWallet, systemCategoryId } from './lookup';
import { getVariantView } from './products';
import { refreshWallet } from './recompute';
import { applyStockMovement } from './stock';

export interface SaleItemInput { variantId: string; qtyMilli: number; unitPrice?: number; discount?: number }
export interface SaleInput {
  items: SaleItemInput[]; customerId?: string | null; walletId?: string | null;
  discount?: number; paid?: number; dueDate?: string | null; note?: string | null; soldAt?: string;
}
export interface SaleResult { saleId: string; number: string; subtotal: number; discount: number; tax: number; total: number; paid: number; status: 'paid' | 'partial' | 'unpaid' }

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export function labelOf(v: { productName: string; variantName: string }): string {
  return v.variantName === 'Default' ? v.productName : `${v.productName} ${v.variantName}`;
}

export function resolveTimestamp(ctx: Ctx, v: string | undefined, field: string): string {
  if (v === undefined) return nowIso(ctx);
  if (!ISO_RE.test(v) || Number.isNaN(Date.parse(v))) throw validation(`${field} harus berformat ISO-8601 UTC (…Z).`);
  if (Date.parse(v) > ctx.now().getTime() + 24 * 3600_000) throw validation(`${field} tidak boleh lebih dari 1 hari ke depan.`);
  return new Date(v).toISOString();
}

/**
 * Penjualan: SEMUA angka dihitung ulang di sini dari harga & qty (nilai total dari klien tidak dipercaya).
 * Dalam satu transaksi DB: sales + sale_items + mutasi stok + transaksi kas + piutang (bila belum lunas).
 */
export async function createSale(ctx: Ctx, input: SaleInput): Promise<SaleResult> {
  requireCan(ctx, 'sale.create');
  if (!Array.isArray(input.items) || input.items.length === 0) throw validation('Keranjang masih kosong.');
  if (input.items.length > 200) throw validation('Maksimal 200 baris per penjualan.');

  return withTx(ctx, async (c) => {
    const soldAt = resolveTimestamp(c, input.soldAt, 'Waktu penjualan');
    let subtotal = 0;
    const lines: { v: NonNullable<Awaited<ReturnType<typeof getVariantView>>>; qty: number; unitPrice: number; disc: number; total: number }[] = [];
    for (const it of input.items) {
      const v = await getVariantView(c, it.variantId);
      if (!v) throw notFound('Produk');
      if (!v.isActive) throw validation(`Produk "${labelOf(v)}" sedang dinonaktifkan.`);
      const qty = requireInt(it.qtyMilli, 'Jumlah', 1);
      const unitPrice = it.unitPrice === undefined ? v.sellPrice : requireInt(it.unitPrice, 'Harga');
      const gross = lineTotal(qty, unitPrice);
      const disc = it.discount === undefined ? 0 : requireInt(it.discount, 'Diskon item');
      if (disc > gross) throw validation(`Diskon "${labelOf(v)}" melebihi harganya.`);
      lines.push({ v, qty, unitPrice, disc, total: gross - disc });
      subtotal += gross - disc;
    }
    const discount = requireInt(input.discount ?? 0, 'Diskon');
    if (discount > subtotal) throw validation('Diskon melebihi subtotal.');
    const taxable = subtotal - discount;
    const tax = percentBp(taxable, c.taxBp);
    const total = taxable + tax;
    const paid = input.paid === undefined ? total : requireInt(input.paid, 'Pembayaran');
    if (paid > total) throw validation('Pembayaran melebihi total. Masukkan nominal pas; kembalian tidak dicatat.');

    let customerName: string | null = null;
    if (input.customerId) {
      const cu = await getRow(c.db, 'customers', c.businessId, input.customerId);
      if (!cu) throw notFound('Pelanggan');
      customerName = String(cu.name);
    }
    if (paid < total && !input.customerId) throw validation('Penjualan kredit/cicilan wajib memilih pelanggan.');
    const walletId = paid > 0 ? await resolveWallet(c, input.walletId) : null;
    const dueDate = input.dueDate ? requireDate(input.dueDate, 'Jatuh tempo') : null;
    const status: SaleResult['status'] = paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid';

    const number = await nextNumber(c, 'sales', 'PJ');
    const sale = stdRow(c, {
      number, customer_id: input.customerId ?? null, wallet_id: walletId, sold_at: soldAt, subtotal, discount, tax, total, paid, status,
      note: optText(input.note, 'Catatan'), created_by: c.actor.memberId,
    });
    await insertRow(c.db, 'sales', sale);
    const saleId = sale.id as string;

    for (const l of lines) {
      await insertRow(c.db, 'sale_items', stdRow(c, {
        sale_id: saleId, variant_id: l.v.id, name_snapshot: labelOf(l.v), qty_milli: l.qty, unit_price: l.unitPrice,
        cost_price: l.v.costPrice, discount: l.disc, line_total: l.total,
      }));
      if (l.v.trackStock)
        await applyStockMovement(c, { variantId: l.v.id, type: 'sale', deltaMilli: -l.qty, unitCost: l.v.costPrice, refTable: 'sales', refId: saleId });
    }

    if (paid > 0)
      await postTransaction(c, {
        walletId: walletId as string, categoryId: await systemCategoryId(c, SYSTEM_CATEGORY.SALES), type: 'income', amount: paid,
        occurredOn: localDate(new Date(soldAt), c.tzOffsetMinutes), description: `Penjualan ${number}`, refTable: 'sales', refId: saleId,
      });
    if (paid < total)
      await insertRow(c.db, 'debts', stdRow(c, {
        kind: 'receivable', party_name: customerName, customer_id: input.customerId, supplier_id: null, amount: total - paid, paid_amount: 0,
        due_date: dueDate, status: 'open', ref_table: 'sales', ref_id: saleId, note: `Piutang ${number}`,
      }));
    await audit(c, 'create', 'sales', saleId, { number, total, paid });
    return { saleId, number, subtotal, discount, tax, total, paid, status };
  });
}

/** Soft-delete semua transaksi kas & hutang yang bersumber dari dokumen (penjualan/pembelian) dan segarkan saldo dompet. */
export async function reverseFinanceOf(ctx: Ctx, refTable: 'sales' | 'purchases', refId: string): Promise<void> {
  const t = nowIso(ctx);
  const txs = await ctx.db.all(
    `SELECT "id", "wallet_id" FROM "transactions" WHERE "business_id" = ? AND "deleted_at" IS NULL AND (
       ("ref_table" = ? AND "ref_id" = ?) OR
       ("ref_table" = 'debt_payments' AND "ref_id" IN (
          SELECT p."id" FROM "debt_payments" p JOIN "debts" d ON d."id" = p."debt_id" WHERE d."business_id" = ? AND d."ref_table" = ? AND d."ref_id" = ?)))`,
    [ctx.businessId, refTable, refId, ctx.businessId, refTable, refId]);
  const wallets = new Set<string>();
  for (const r of txs) {
    await updateRow(ctx.db, 'transactions', ctx.businessId, String(r.id), { deleted_at: t, updated_at: t });
    wallets.add(String(r.wallet_id));
  }
  const debts = await ctx.db.all(`SELECT "id" FROM "debts" WHERE "business_id" = ? AND "ref_table" = ? AND "ref_id" = ? AND "deleted_at" IS NULL`, [ctx.businessId, refTable, refId]);
  for (const d of debts) {
    await ctx.db.run(`UPDATE "debt_payments" SET "deleted_at" = ?, "updated_at" = ? WHERE "debt_id" = ? AND "business_id" = ? AND "deleted_at" IS NULL`, [t, t, String(d.id), ctx.businessId]);
    await updateRow(ctx.db, 'debts', ctx.businessId, String(d.id), { deleted_at: t, updated_at: t });
  }
  for (const w of wallets) await refreshWallet(ctx, w);
}

export async function voidSale(ctx: Ctx, saleId: string, reason: string): Promise<void> {
  requireCan(ctx, 'sale.void');
  const why = requireText(reason, 'Alasan pembatalan', 200);
  return withTx(ctx, async (c) => {
    const sale = await getRow(c.db, 'sales', c.businessId, saleId);
    if (!sale) throw notFound('Penjualan');
    if (sale.status === 'void') throw new DomainError('INVALID_STATE', 'Penjualan ini sudah dibatalkan.');

    const items = await selectRows(c.db, 'sale_items', `"business_id" = ? AND "sale_id" = ? AND "deleted_at" IS NULL`, [c.businessId, saleId]);
    for (const it of items) {
      const r = (await c.db.all(
        `SELECT v."deleted_at" AS vd, p."track_stock" AS ts FROM "product_variants" v JOIN "products" p ON p."id" = v."product_id" WHERE v."id" = ? AND v."business_id" = ?`,
        [it.variant_id, c.businessId]))[0];
      const tracked = r && (r.ts === true || r.ts === 1) && r.vd === null;
      if (tracked)
        await applyStockMovement(c, { variantId: String(it.variant_id), type: 'return_in', deltaMilli: num(it.qty_milli), unitCost: num(it.cost_price), refTable: 'sales', refId: saleId, note: `Batal ${sale.number}` });
    }
    await reverseFinanceOf(c, 'sales', saleId);
    const note = [sale.note, `BATAL: ${why}`].filter(Boolean).join(' | ');
    await updateRow(c.db, 'sales', c.businessId, saleId, { status: 'void', note, updated_at: nowIso(c) });
    await audit(c, 'void', 'sales', saleId, { number: sale.number, reason: why });
  });
}
