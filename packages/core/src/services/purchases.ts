import { lineTotal } from '@ficoim/shared';
import { getRow, insertRow, num, selectRows, updateRow } from '../db';
import { DomainError, notFound, validation } from '../errors';
import { nowIso, stdRow, withTx, type Ctx } from '../ctx';
import { requireCan } from '../permissions';
import { SYSTEM_CATEGORY } from '../presets';
import { localDate, nextNumber, optText, requireDate, requireInt, requireText } from '../util';
import { audit } from './audit';
import { claimAttachment } from './attachments';
import { postTransaction } from './ledger';
import { resolveWallet, systemCategoryId } from './lookup';
import { getVariantView } from './products';
import { applyStockMovement } from './stock';
import { labelOf, resolveTimestamp, reverseFinanceOf } from './sales';

export interface PurchaseItemInput { variantId: string; qtyMilli: number; unitCost: number }
export interface PurchaseInput {
  items: PurchaseItemInput[]; supplierId?: string | null; walletId?: string | null;
  discount?: number; paid?: number; dueDate?: string | null; note?: string | null; purchasedAt?: string;
  /** Foto nota/struk belanja (id lampiran hasil unggah). */
  receiptAttachmentId?: string | null;
}
export interface PurchaseResult { purchaseId: string; number: string; subtotal: number; discount: number; total: number; paid: number; status: 'paid' | 'partial' | 'unpaid' }

/** Harga pokok rata-rata tertimbang. Memakai BigInt agar tidak meluap pada angka besar. */
export function weightedAverageCost(oldQtyMilli: number, oldCost: number, addQtyMilli: number, addCost: number): number {
  if (oldQtyMilli <= 0) return addCost;
  const totalQty = BigInt(oldQtyMilli) + BigInt(addQtyMilli);
  const sum = BigInt(oldQtyMilli) * BigInt(oldCost) + BigInt(addQtyMilli) * BigInt(addCost);
  return Number((sum + totalQty / 2n) / totalQty);
}

export async function createPurchase(ctx: Ctx, input: PurchaseInput): Promise<PurchaseResult> {
  requireCan(ctx, 'purchase.create');
  if (!Array.isArray(input.items) || input.items.length === 0) throw validation('Daftar barang masih kosong.');
  if (input.items.length > 200) throw validation('Maksimal 200 baris per pembelian.');

  return withTx(ctx, async (c) => {
    const at = resolveTimestamp(c, input.purchasedAt, 'Waktu pembelian');
    let subtotal = 0;
    const lines: { variantId: string; label: string; track: boolean; qty: number; cost: number; total: number }[] = [];
    for (const it of input.items) {
      const v = await getVariantView(c, it.variantId);
      if (!v) throw notFound('Produk');
      const qty = requireInt(it.qtyMilli, 'Jumlah', 1), cost = requireInt(it.unitCost, 'Harga beli');
      const total = lineTotal(qty, cost);
      lines.push({ variantId: v.id, label: labelOf(v), track: v.trackStock, qty, cost, total });
      subtotal += total;
    }
    const discount = requireInt(input.discount ?? 0, 'Diskon');
    if (discount > subtotal) throw validation('Diskon melebihi subtotal.');
    const total = subtotal - discount;
    const paid = input.paid === undefined ? total : requireInt(input.paid, 'Pembayaran');
    if (paid > total) throw validation('Pembayaran melebihi total pembelian.');

    let supplierName: string | null = null;
    if (input.supplierId) {
      const s = await getRow(c.db, 'suppliers', c.businessId, input.supplierId);
      if (!s) throw notFound('Pemasok');
      supplierName = String(s.name);
    }
    if (paid < total && !input.supplierId) throw validation('Pembelian hutang/cicilan wajib memilih pemasok.');
    const walletId = paid > 0 ? await resolveWallet(c, input.walletId) : null;
    const dueDate = input.dueDate ? requireDate(input.dueDate, 'Jatuh tempo') : null;
    const status: PurchaseResult['status'] = paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid';

    const number = await nextNumber(c, 'purchases', 'PB');
    const po = stdRow(c, {
      number, supplier_id: input.supplierId ?? null, wallet_id: walletId, purchased_at: at, subtotal, discount, total, paid, status,
      note: optText(input.note, 'Catatan'), created_by: c.actor.memberId,
    });
    await insertRow(c.db, 'purchases', po);
    const purchaseId = po.id as string;
    if (input.receiptAttachmentId) await claimAttachment(c, input.receiptAttachmentId, 'purchases', purchaseId);

    for (const l of lines) {
      await insertRow(c.db, 'purchase_items', stdRow(c, { purchase_id: purchaseId, variant_id: l.variantId, name_snapshot: l.label, qty_milli: l.qty, unit_cost: l.cost, line_total: l.total }));
      if (l.track) {
        const cur = await getVariantView(c, l.variantId); // stok terbaru (baris sebelumnya mungkin varian yang sama)
        const newCost = weightedAverageCost(cur ? cur.stockQtyMilli : 0, cur ? cur.costPrice : 0, l.qty, l.cost);
        await applyStockMovement(c, { variantId: l.variantId, type: 'purchase', deltaMilli: l.qty, unitCost: l.cost, refTable: 'purchases', refId: purchaseId });
        await updateRow(c.db, 'product_variants', c.businessId, l.variantId, { cost_price: newCost, updated_at: nowIso(c) });
      }
    }

    if (paid > 0)
      await postTransaction(c, {
        walletId: walletId as string, categoryId: await systemCategoryId(c, SYSTEM_CATEGORY.PURCHASE), type: 'expense', amount: paid,
        occurredOn: localDate(new Date(at), c.tzOffsetMinutes), description: `Pembelian ${number}`, refTable: 'purchases', refId: purchaseId,
      });
    if (paid < total)
      await insertRow(c.db, 'debts', stdRow(c, {
        kind: 'payable', party_name: supplierName, customer_id: null, supplier_id: input.supplierId, amount: total - paid, paid_amount: 0,
        due_date: dueDate, status: 'open', ref_table: 'purchases', ref_id: purchaseId, note: `Hutang ${number}`,
      }));
    await audit(c, 'create', 'purchases', purchaseId, { number, total, paid });
    return { purchaseId, number, subtotal, discount, total, paid, status };
  });
}

/** Membatalkan pembelian: stok dikembalikan (gagal bila sebagian sudah terjual). Harga pokok tidak dihitung mundur. */
export async function voidPurchase(ctx: Ctx, purchaseId: string, reason: string): Promise<void> {
  requireCan(ctx, 'purchase.void');
  const why = requireText(reason, 'Alasan pembatalan', 200);
  return withTx(ctx, async (c) => {
    const po = await getRow(c.db, 'purchases', c.businessId, purchaseId);
    if (!po) throw notFound('Pembelian');
    if (po.status === 'void') throw new DomainError('INVALID_STATE', 'Pembelian ini sudah dibatalkan.');
    const items = await selectRows(c.db, 'purchase_items', `"business_id" = ? AND "purchase_id" = ? AND "deleted_at" IS NULL`, [c.businessId, purchaseId]);
    for (const it of items) {
      const r = (await c.db.all(
        `SELECT v."deleted_at" AS vd, p."track_stock" AS ts FROM "product_variants" v JOIN "products" p ON p."id" = v."product_id" WHERE v."id" = ? AND v."business_id" = ?`,
        [it.variant_id, c.businessId]))[0];
      if (r && (r.ts === true || r.ts === 1) && r.vd === null)
        await applyStockMovement(c, { variantId: String(it.variant_id), type: 'return_out', deltaMilli: -num(it.qty_milli), unitCost: num(it.unit_cost), refTable: 'purchases', refId: purchaseId, note: `Batal ${po.number}` });
    }
    await reverseFinanceOf(c, 'purchases', purchaseId);
    await updateRow(c.db, 'purchases', c.businessId, purchaseId, { status: 'void', note: [po.note, `BATAL: ${why}`].filter(Boolean).join(' | '), updated_at: nowIso(c) });
    await audit(c, 'void', 'purchases', purchaseId, { number: po.number, reason: why });
  });
}
