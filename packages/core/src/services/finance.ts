import { getRow, insertRow, num, selectRows, updateRow, dbBool, asBool } from '../db';
import { DomainError, notFound, validation } from '../errors';
import { nowIso, stdRow, withTx, type Ctx } from '../ctx';
import { requireCan } from '../permissions';
import { SYSTEM_CATEGORY } from '../presets';
import { addDays, addPeriod, oneOf, optText, requireDate, requireInt, requireText, today } from '../util';
import { audit } from './audit';
import { claimAttachment } from './attachments';
import { postTransaction } from './ledger';
import { systemCategoryId } from './lookup';
import { refreshWallet } from './recompute';
import { WALLET_TYPES, FREQUENCIES } from '@ficoim/shared';

// ---------------- dompet ----------------
export interface WalletView { id: string; name: string; type: string; openingBalance: number; balance: number }

export async function createWallet(ctx: Ctx, input: { name: string; type?: string; openingBalance?: number }): Promise<string> {
  requireCan(ctx, 'finance.write');
  const row = stdRow(ctx, {
    name: requireText(input.name, 'Nama dompet', 80), type: oneOf(input.type ?? 'cash', WALLET_TYPES, 'Jenis dompet'),
    opening_balance: requireInt(input.openingBalance ?? 0, 'Saldo awal', Number.MIN_SAFE_INTEGER), balance: 0,
  });
  return withTx(ctx, async (c) => {
    const dup = await c.db.all(`SELECT 1 AS x FROM "wallets" WHERE "business_id" = ? AND "deleted_at" IS NULL AND "name" = ? LIMIT 1`, [c.businessId, row.name]);
    if (dup[0]) throw new DomainError('CONFLICT', `Dompet "${row.name}" sudah ada.`);
    await insertRow(c.db, 'wallets', row);
    await refreshWallet(c, row.id as string);
    await audit(c, 'create', 'wallets', row.id as string);
    return row.id as string;
  });
}

export async function listWallets(ctx: Ctx): Promise<WalletView[]> {
  const rows = await selectRows(ctx.db, 'wallets', `"business_id" = ? AND "deleted_at" IS NULL`, [ctx.businessId], 'ORDER BY "created_at", "id"');
  return rows.map((r) => ({ id: r.id as string, name: r.name as string, type: r.type as string, openingBalance: r.opening_balance as number, balance: r.balance as number }));
}

// ---------------- kategori ----------------
export async function createFinanceCategory(ctx: Ctx, input: { name: string; type: 'income' | 'expense'; icon?: string | null }): Promise<string> {
  requireCan(ctx, 'finance.write');
  const name = requireText(input.name, 'Nama kategori', 60);
  const type = oneOf(input.type, ['income', 'expense'] as const, 'Jenis');
  const dup = await ctx.db.all(`SELECT 1 AS x FROM "finance_categories" WHERE "business_id" = ? AND "deleted_at" IS NULL AND "type" = ? AND LOWER("name") = ? LIMIT 1`, [ctx.businessId, type, name.toLowerCase()]);
  if (dup[0]) throw new DomainError('CONFLICT', `Kategori "${name}" sudah ada.`);
  const row = stdRow(ctx, { name, type, icon: optText(input.icon, 'Ikon', 16), is_system: false });
  await insertRow(ctx.db, 'finance_categories', row);
  return row.id as string;
}

async function userCategory(ctx: Ctx, categoryId: string, type?: 'income' | 'expense') {
  const cat = await getRow(ctx.db, 'finance_categories', ctx.businessId, categoryId);
  if (!cat) throw notFound('Kategori');
  if (cat.is_system === true) throw new DomainError('CONFLICT', `Kategori "${cat.name}" dipakai otomatis oleh sistem dan tidak bisa dipilih manual.`);
  if (type && cat.type !== type) throw validation(`Kategori "${cat.name}" bukan kategori ${type === 'income' ? 'pemasukan' : 'pengeluaran'}.`);
  return cat;
}

// ---------------- transaksi manual ----------------
export interface AddTxInput { walletId: string; categoryId: string; type: 'income' | 'expense'; amount: number; occurredOn?: string; description?: string | null; receiptAttachmentId?: string | null }

export async function addTransaction(ctx: Ctx, input: AddTxInput): Promise<string> {
  requireCan(ctx, 'finance.write');
  const type = oneOf(input.type, ['income', 'expense'] as const, 'Jenis');
  const amount = requireInt(input.amount, 'Nominal', 1);
  return withTx(ctx, async (c) => {
    if (!(await getRow(c.db, 'wallets', c.businessId, input.walletId))) throw notFound('Dompet');
    await userCategory(c, input.categoryId, type);
    const receiptId = input.receiptAttachmentId ?? null;
    const id = await postTransaction(c, {
      walletId: input.walletId, categoryId: input.categoryId, type, amount, occurredOn: input.occurredOn ? requireDate(input.occurredOn, 'Tanggal') : today(c),
      description: optText(input.description, 'Keterangan'), receiptAttachmentId: receiptId,
    });
    if (receiptId) await claimAttachment(c, receiptId, 'transactions', id); // wajib ada, bergambar, dan belum dipakai data lain
    await audit(c, 'create', 'transactions', id, { type, amount });
    return id;
  });
}

/** Hanya transaksi manual yang boleh dihapus langsung; transaksi hasil penjualan/pembelian/hutang dibatalkan lewat dokumennya. */
export async function deleteTransaction(ctx: Ctx, transactionId: string): Promise<void> {
  requireCan(ctx, 'finance.delete');
  return withTx(ctx, async (c) => {
    const t = await getRow(c.db, 'transactions', c.businessId, transactionId);
    if (!t) throw notFound('Transaksi');
    if (t.ref_table) throw new DomainError('CONFLICT', 'Transaksi ini dibuat otomatis oleh sistem. Batalkan dokumen asalnya (penjualan/pembelian/pelunasan).');
    await updateRow(c.db, 'transactions', c.businessId, transactionId, { deleted_at: nowIso(c), updated_at: nowIso(c) });
    await refreshWallet(c, String(t.wallet_id));
    await audit(c, 'delete', 'transactions', transactionId, { amount: t.amount });
  });
}

export async function transfer(ctx: Ctx, input: { fromWalletId: string; toWalletId: string; amount: number; occurredOn?: string; note?: string | null }): Promise<string> {
  requireCan(ctx, 'finance.write');
  const amount = requireInt(input.amount, 'Nominal', 1);
  if (input.fromWalletId === input.toWalletId) throw validation('Dompet asal dan tujuan harus berbeda.');
  return withTx(ctx, async (c) => {
    for (const w of [input.fromWalletId, input.toWalletId]) if (!(await getRow(c.db, 'wallets', c.businessId, w))) throw notFound('Dompet');
    const refId = c.newId(), on = input.occurredOn ? requireDate(input.occurredOn, 'Tanggal') : today(c), note = optText(input.note, 'Catatan');
    await postTransaction(c, { walletId: input.fromWalletId, categoryId: await systemCategoryId(c, SYSTEM_CATEGORY.TRANSFER_OUT), type: 'expense', amount, occurredOn: on, description: note ?? 'Transfer antar dompet', refTable: 'transfers', refId });
    await postTransaction(c, { walletId: input.toWalletId, categoryId: await systemCategoryId(c, SYSTEM_CATEGORY.TRANSFER_IN), type: 'income', amount, occurredOn: on, description: note ?? 'Transfer antar dompet', refTable: 'transfers', refId });
    await audit(c, 'transfer', 'transactions', refId, { amount });
    return refId;
  });
}

export async function deleteTransfer(ctx: Ctx, transferId: string): Promise<void> {
  requireCan(ctx, 'finance.delete');
  return withTx(ctx, async (c) => {
    const rows = await c.db.all(`SELECT "id", "wallet_id" FROM "transactions" WHERE "business_id" = ? AND "ref_table" = 'transfers' AND "ref_id" = ? AND "deleted_at" IS NULL`, [c.businessId, transferId]);
    if (!rows.length) throw notFound('Transfer');
    const t = nowIso(c);
    for (const r of rows) { await updateRow(c.db, 'transactions', c.businessId, String(r.id), { deleted_at: t, updated_at: t }); await refreshWallet(c, String(r.wallet_id)); }
    await audit(c, 'delete', 'transactions', transferId, { transfer: true });
  });
}

// ---------------- anggaran ----------------
export async function setBudget(ctx: Ctx, input: { categoryId: string; amountLimit: number; month: number; year: number }): Promise<string> {
  requireCan(ctx, 'finance.write');
  const month = requireInt(input.month, 'Bulan', 1, 12), year = requireInt(input.year, 'Tahun', 2000, 2200), limit = requireInt(input.amountLimit, 'Batas anggaran', 1);
  return withTx(ctx, async (c) => {
    await userCategory(c, input.categoryId, 'expense');
    const ex = await c.db.all(`SELECT "id" FROM "budgets" WHERE "business_id" = ? AND "category_id" = ? AND "month" = ? AND "year" = ? AND "deleted_at" IS NULL`, [c.businessId, input.categoryId, month, year]);
    if (ex[0]) { await updateRow(c.db, 'budgets', c.businessId, String(ex[0].id), { amount_limit: limit, updated_at: nowIso(c) }); return String(ex[0].id); }
    const row = stdRow(c, { category_id: input.categoryId, amount_limit: limit, month, year });
    await insertRow(c.db, 'budgets', row);
    return row.id as string;
  });
}

export interface BudgetStatus { budgetId: string; categoryId: string; categoryName: string; limit: number; spent: number; remaining: number; percentUsed: number }

export async function budgetStatus(ctx: Ctx, month: number, year: number): Promise<BudgetStatus[]> {
  requireInt(month, 'Bulan', 1, 12); requireInt(year, 'Tahun', 2000, 2200);
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const rows = await ctx.db.all(
    `SELECT b."id", b."category_id", c."name", b."amount_limit",
       COALESCE((SELECT SUM(t."amount") FROM "transactions" t WHERE t."business_id" = b."business_id" AND t."category_id" = b."category_id"
                 AND t."type" = 'expense' AND t."deleted_at" IS NULL AND t."occurred_on" >= ? AND t."occurred_on" <= ?), 0) AS spent
     FROM "budgets" b JOIN "finance_categories" c ON c."id" = b."category_id"
     WHERE b."business_id" = ? AND b."month" = ? AND b."year" = ? AND b."deleted_at" IS NULL ORDER BY c."name"`,
    [from, to, ctx.businessId, month, year]);
  return rows.map((r) => {
    const limit = num(r.amount_limit), spent = num(r.spent);
    return { budgetId: String(r.id), categoryId: String(r.category_id), categoryName: String(r.name), limit, spent, remaining: limit - spent, percentUsed: Math.round((spent * 100) / limit) };
  });
}

// ---------------- tagihan berulang ----------------
export async function createRecurringBill(ctx: Ctx, input: { walletId: string; categoryId: string; type?: 'income' | 'expense'; amount: number; description?: string | null; frequency?: string; nextDueDate: string }): Promise<string> {
  requireCan(ctx, 'finance.write');
  const type = oneOf(input.type ?? 'expense', ['income', 'expense'] as const, 'Jenis');
  return withTx(ctx, async (c) => {
    if (!(await getRow(c.db, 'wallets', c.businessId, input.walletId))) throw notFound('Dompet');
    await userCategory(c, input.categoryId, type);
    const row = stdRow(c, {
      wallet_id: input.walletId, category_id: input.categoryId, type, amount: requireInt(input.amount, 'Nominal', 1), description: optText(input.description, 'Keterangan'),
      frequency: oneOf(input.frequency ?? 'monthly', FREQUENCIES, 'Frekuensi'), next_due_date: requireDate(input.nextDueDate, 'Jatuh tempo berikut'), is_active: true,
    });
    await insertRow(c.db, 'recurring_bills', row);
    return row.id as string;
  });
}

export interface BillView { id: string; description: string | null; amount: number; type: string; frequency: string; nextDueDate: string; overdue: boolean; categoryName: string }

export async function dueBills(ctx: Ctx, withinDays = 7): Promise<BillView[]> {
  const limit = addDays(today(ctx), withinDays);
  const rows = await ctx.db.all(
    `SELECT b.*, c."name" AS cat FROM "recurring_bills" b JOIN "finance_categories" c ON c."id" = b."category_id"
     WHERE b."business_id" = ? AND b."deleted_at" IS NULL AND b."is_active" = ? AND b."next_due_date" <= ? ORDER BY b."next_due_date"`,
    [ctx.businessId, dbBool(ctx.db, true), limit]);
  const t = today(ctx);
  return rows.map((r) => ({
    id: String(r.id), description: (r.description as string | null) ?? null, amount: num(r.amount), type: String(r.type), frequency: String(r.frequency),
    nextDueDate: String(r.next_due_date), overdue: String(r.next_due_date) < t, categoryName: String(r.cat),
  }));
}

/** Bayar satu tagihan: membuat transaksi lalu memajukan jatuh tempo satu periode. */
export async function payRecurringBill(ctx: Ctx, billId: string, paidOn?: string): Promise<{ nextDueDate: string }> {
  requireCan(ctx, 'finance.write');
  return withTx(ctx, async (c) => {
    const b = await getRow(c.db, 'recurring_bills', c.businessId, billId);
    if (!b || !asBool(b.is_active)) throw notFound('Tagihan');
    await postTransaction(c, {
      walletId: String(b.wallet_id), categoryId: String(b.category_id), type: b.type as 'income' | 'expense', amount: num(b.amount),
      occurredOn: paidOn ? requireDate(paidOn, 'Tanggal') : today(c), description: (b.description as string | null) ?? 'Tagihan rutin',
    });
    const next = addPeriod(String(b.next_due_date), b.frequency as 'weekly' | 'monthly' | 'yearly');
    await updateRow(c.db, 'recurring_bills', c.businessId, billId, { next_due_date: next, updated_at: nowIso(c) });
    await audit(c, 'pay', 'recurring_bills', billId, { next });
    return { nextDueDate: next };
  });
}

// ---------------- target tabungan ----------------
export async function createGoal(ctx: Ctx, input: { title: string; targetAmount: number; targetDate?: string | null }): Promise<string> {
  requireCan(ctx, 'finance.write');
  const row = stdRow(ctx, { title: requireText(input.title, 'Judul', 100), target_amount: requireInt(input.targetAmount, 'Target', 1), current_amount: 0, target_date: input.targetDate ? requireDate(input.targetDate, 'Tanggal target') : null });
  await insertRow(ctx.db, 'saving_goals', row);
  return row.id as string;
}

export async function contributeGoal(ctx: Ctx, goalId: string, amount: number): Promise<number> {
  requireCan(ctx, 'finance.write');
  const a = requireInt(amount, 'Nominal', 1);
  return withTx(ctx, async (c) => {
    const g = await getRow(c.db, 'saving_goals', c.businessId, goalId);
    if (!g) throw notFound('Target tabungan');
    const cur = num(g.current_amount) + a;
    await updateRow(c.db, 'saving_goals', c.businessId, goalId, { current_amount: cur, updated_at: nowIso(c) });
    return cur;
  });
}

export interface GoalView { id: string; title: string; targetAmount: number; currentAmount: number; targetDate: string | null; percent: number }

export async function listGoals(ctx: Ctx): Promise<GoalView[]> {
  const rows = await selectRows(ctx.db, 'saving_goals', '"business_id" = ? AND "deleted_at" IS NULL', [ctx.businessId], 'ORDER BY "created_at", "id"');
  return rows.map((r) => ({
    id: r.id as string, title: r.title as string, targetAmount: num(r.target_amount), currentAmount: num(r.current_amount), targetDate: r.target_date as string | null,
    percent: Math.min(100, Math.floor((num(r.current_amount) * 100) / Math.max(1, num(r.target_amount)))),
  }));
}
