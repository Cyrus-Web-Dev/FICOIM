import { dbBool, getRow } from '../db';
import { DomainError, notFound, validation } from '../errors';
import type { Ctx } from '../ctx';

export async function defaultWalletId(ctx: Ctx): Promise<string> {
  const rows = await ctx.db.all(`SELECT "id" FROM "wallets" WHERE "business_id" = ? AND "deleted_at" IS NULL ORDER BY "created_at", "id" LIMIT 1`, [ctx.businessId]);
  if (!rows[0]) throw validation('Belum ada dompet. Buat dompet terlebih dulu.');
  return String(rows[0].id);
}

export async function resolveWallet(ctx: Ctx, walletId?: string | null): Promise<string> {
  if (!walletId) return defaultWalletId(ctx);
  if (!(await getRow(ctx.db, 'wallets', ctx.businessId, walletId))) throw notFound('Dompet');
  return walletId;
}

export async function systemCategoryId(ctx: Ctx, name: string): Promise<string> {
  const rows = await ctx.db.all(
    `SELECT "id" FROM "finance_categories" WHERE "business_id" = ? AND "deleted_at" IS NULL AND "is_system" = ? AND "name" = ? LIMIT 1`,
    [ctx.businessId, dbBool(ctx.db, true), name]);
  if (!rows[0]) throw new DomainError('INVALID_STATE', `Kategori sistem "${name}" tidak ditemukan.`);
  return String(rows[0].id);
}
