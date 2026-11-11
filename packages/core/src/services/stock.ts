import { formatQty } from '@ficoim/shared';
import { insertRow, num } from '../db';
import { DomainError, notFound, validation } from '../errors';
import { nowIso, stdRow, withTx, type Ctx } from '../ctx';
import { requireCan } from '../permissions';
import { optText, oneOf, requireInt } from '../util';
import { audit } from './audit';

export interface StockMove {
  variantId: string;
  type: 'initial' | 'purchase' | 'sale' | 'return_in' | 'return_out' | 'adjustment' | 'opname' | 'damage';
  deltaMilli: number;
  unitCost?: number | null;
  refTable?: string | null;
  refId?: string | null;
  note?: string | null;
}

/**
 * Satu-satunya pintu perubahan stok: menulis buku besar (stock_movements) DAN memperbarui cache
 * secara atomik. Pengurangan dijaga di level SQL (stok + delta >= 0) sehingga dua penjualan bersamaan
 * tidak bisa membuat stok minus, kecuali bisnis mengizinkan stok negatif.
 */
export async function applyStockMovement(ctx: Ctx, m: StockMove): Promise<void> {
  if (!Number.isSafeInteger(m.deltaMilli) || m.deltaMilli === 0) throw validation('Perubahan stok tidak valid.');
  const guard = m.deltaMilli < 0 && !ctx.allowNegativeStock;
  const res = await ctx.db.run(
    `UPDATE "product_variants" SET "stock_qty_milli" = "stock_qty_milli" + ?, "updated_at" = ?
     WHERE "id" = ? AND "business_id" = ? AND "deleted_at" IS NULL${guard ? ' AND "stock_qty_milli" + ? >= 0' : ''}`,
    [m.deltaMilli, nowIso(ctx), m.variantId, ctx.businessId, ...(guard ? [m.deltaMilli] : [])],
  );
  if (res.changes === 0) {
    const rows = await ctx.db.all(
      `SELECT v."stock_qty_milli" AS s, p."name" AS pn, v."name" AS vn FROM "product_variants" v JOIN "products" p ON p."id" = v."product_id"
       WHERE v."id" = ? AND v."business_id" = ? AND v."deleted_at" IS NULL`, [m.variantId, ctx.businessId]);
    const r = rows[0];
    if (!r) throw notFound('Varian produk');
    const label = r.vn === 'Default' ? String(r.pn) : `${r.pn} ${r.vn}`;
    throw new DomainError('INSUFFICIENT_STOCK', `Stok ${label} tidak cukup (tersedia ${formatQty(num(r.s))}).`, { variantId: m.variantId, available: num(r.s) });
  }
  await insertRow(ctx.db, 'stock_movements', stdRow(ctx, {
    variant_id: m.variantId, type: m.type, qty_delta_milli: m.deltaMilli, unit_cost: m.unitCost ?? null,
    ref_table: m.refTable ?? null, ref_id: m.refId ?? null, occurred_at: nowIso(ctx), note: m.note ?? null, created_by: ctx.actor.memberId,
  }));
}

export interface AdjustInput {
  variantId: string;
  /** 'set' = hasil hitung fisik (stok opname); 'delta' = tambah/kurangi. */
  mode: 'set' | 'delta';
  qtyMilli: number;
  reason?: 'opname' | 'adjustment' | 'damage';
  note?: string | null;
}

export async function adjustStock(ctx: Ctx, input: AdjustInput): Promise<{ before: number; after: number }> {
  requireCan(ctx, 'stock.adjust');
  const mode = oneOf(input.mode, ['set', 'delta'] as const, 'Mode');
  const reason = input.reason ?? (mode === 'set' ? 'opname' : 'adjustment');
  oneOf(reason, ['opname', 'adjustment', 'damage'] as const, 'Alasan');
  const q = requireInt(input.qtyMilli, 'Jumlah', mode === 'set' ? 0 : Number.MIN_SAFE_INTEGER);
  return withTx(ctx, async (c) => {
    const rows = await c.db.all(
      `SELECT v."stock_qty_milli" AS s, v."cost_price" AS cost, p."track_stock" AS ts FROM "product_variants" v
       JOIN "products" p ON p."id" = v."product_id" WHERE v."id" = ? AND v."business_id" = ? AND v."deleted_at" IS NULL AND p."deleted_at" IS NULL`,
      [input.variantId, c.businessId]);
    const r = rows[0];
    if (!r) throw notFound('Varian produk');
    const before = num(r.s);
    const delta = mode === 'set' ? q - before : q;
    if (delta === 0) return { before, after: before };
    await applyStockMovement(c, { variantId: input.variantId, type: reason, deltaMilli: delta, unitCost: num(r.cost), note: optText(input.note, 'Catatan') });
    await audit(c, reason, 'product_variants', input.variantId, { before, delta });
    return { before, after: before + delta };
  });
}

export interface StockCardRow { id: string; type: string; deltaMilli: number; unitCost: number | null; occurredAt: string; note: string | null; refTable: string | null; refId: string | null }

/** Kartu stok: riwayat mutasi satu varian, terbaru dulu. */
export async function stockCard(ctx: Ctx, variantId: string, limit = 100): Promise<StockCardRow[]> {
  const rows = await ctx.db.all(
    `SELECT "id", "type", "qty_delta_milli", "unit_cost", "occurred_at", "note", "ref_table", "ref_id" FROM "stock_movements"
     WHERE "business_id" = ? AND "variant_id" = ? AND "deleted_at" IS NULL ORDER BY "occurred_at" DESC, "id" DESC LIMIT ?`,
    [ctx.businessId, variantId, Math.min(Math.max(limit, 1), 1000)]);
  return rows.map((r) => ({
    id: String(r.id), type: String(r.type), deltaMilli: num(r.qty_delta_milli), unitCost: r.unit_cost === null ? null : num(r.unit_cost),
    occurredAt: String(r.occurred_at), note: (r.note as string | null) ?? null, refTable: (r.ref_table as string | null) ?? null, refId: (r.ref_id as string | null) ?? null,
  }));
}
