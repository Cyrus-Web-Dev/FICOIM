import type { Ctx } from '../ctx';
import { nowIso } from '../ctx';

/**
 * Cache (stok varian, saldo dompet, status hutang) selalu bisa dihitung ulang dari data sumber:
 * stock_movements, transactions, debt_payments. Dipanggil setelah restore dan untuk perbaikan.
 */
export async function refreshWallet(ctx: Ctx, walletId: string): Promise<void> {
  await ctx.db.run(
    `UPDATE "wallets" SET "balance" = "opening_balance" + COALESCE((
       SELECT SUM(CASE WHEN t."type" = 'income' THEN t."amount" ELSE -t."amount" END)
       FROM "transactions" t WHERE t."wallet_id" = "wallets"."id" AND t."deleted_at" IS NULL), 0), "updated_at" = ?
     WHERE "id" = ? AND "business_id" = ?`,
    [nowIso(ctx), walletId, ctx.businessId],
  );
}

export async function recomputeWallets(ctx: Ctx): Promise<void> {
  await ctx.db.run(
    `UPDATE "wallets" SET "balance" = "opening_balance" + COALESCE((
       SELECT SUM(CASE WHEN t."type" = 'income' THEN t."amount" ELSE -t."amount" END)
       FROM "transactions" t WHERE t."wallet_id" = "wallets"."id" AND t."deleted_at" IS NULL), 0)
     WHERE "business_id" = ?`,
    [ctx.businessId],
  );
}

export async function recomputeStock(ctx: Ctx): Promise<void> {
  await ctx.db.run(
    `UPDATE "product_variants" SET "stock_qty_milli" = COALESCE((
       SELECT SUM(m."qty_delta_milli") FROM "stock_movements" m
       WHERE m."variant_id" = "product_variants"."id" AND m."deleted_at" IS NULL), 0)
     WHERE "business_id" = ?`,
    [ctx.businessId],
  );
}

export async function recomputeDebts(ctx: Ctx): Promise<void> {
  await ctx.db.run(
    `UPDATE "debts" SET "paid_amount" = COALESCE((
       SELECT SUM(p."amount") FROM "debt_payments" p WHERE p."debt_id" = "debts"."id" AND p."deleted_at" IS NULL), 0)
     WHERE "business_id" = ?`,
    [ctx.businessId],
  );
  await ctx.db.run(
    `UPDATE "debts" SET "status" = CASE WHEN "paid_amount" >= "amount" THEN 'settled' WHEN "paid_amount" > 0 THEN 'partial' ELSE 'open' END
     WHERE "business_id" = ?`,
    [ctx.businessId],
  );
}

export async function recomputeAll(ctx: Ctx): Promise<void> {
  await recomputeStock(ctx);
  await recomputeWallets(ctx);
  await recomputeDebts(ctx);
}
