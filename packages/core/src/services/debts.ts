import { getRow, insertRow, num, updateRow } from '../db';
import { DomainError, notFound, validation } from '../errors';
import { nowIso, stdRow, withTx, type Ctx } from '../ctx';
import { requireCan as requirePerm } from '../permissions';
import { SYSTEM_CATEGORY } from '../presets';
import { optText, oneOf, requireDate, requireInt, requireText, today } from '../util';
import { audit } from './audit';
import { postTransaction } from './ledger';
import { resolveWallet, systemCategoryId } from './lookup';

export interface DebtView { id: string; kind: 'receivable' | 'payable'; partyName: string; amount: number; paidAmount: number; remaining: number; dueDate: string | null; status: string; refTable: string | null; refId: string | null; note: string | null }

export async function createManualDebt(
  ctx: Ctx, input: { kind: 'receivable' | 'payable'; partyName: string; amount: number; dueDate?: string | null; customerId?: string | null; supplierId?: string | null; note?: string | null },
): Promise<string> {
  requirePerm(ctx, 'finance.write');
  const kind = oneOf(input.kind, ['receivable', 'payable'] as const, 'Jenis');
  const row = stdRow(ctx, {
    kind, party_name: requireText(input.partyName, 'Nama pihak', 120), customer_id: kind === 'receivable' ? input.customerId ?? null : null,
    supplier_id: kind === 'payable' ? input.supplierId ?? null : null, amount: requireInt(input.amount, 'Jumlah', 1), paid_amount: 0,
    due_date: input.dueDate ? requireDate(input.dueDate, 'Jatuh tempo') : null, status: 'open', ref_table: null, ref_id: null, note: optText(input.note, 'Catatan'),
  });
  return withTx(ctx, async (c) => {
    await insertRow(c.db, 'debts', row);
    await audit(c, 'create', 'debts', row.id as string, { kind, amount: row.amount });
    return row.id as string;
  });
}

/** Bayar / terima pelunasan sebagian atau seluruhnya. Sinkron ke dokumen penjualan/pembelian asal. */
export async function payDebt(ctx: Ctx, input: { debtId: string; amount: number; walletId?: string | null; paidOn?: string; note?: string | null }): Promise<{ remaining: number; status: 'open' | 'partial' | 'settled' }> {
  requirePerm(ctx, 'debt.pay');
  return withTx(ctx, async (c) => {
    const debt = await getRow(c.db, 'debts', c.businessId, input.debtId);
    if (!debt) throw notFound('Hutang/piutang');
    if (debt.status === 'settled') throw new DomainError('INVALID_STATE', 'Sudah lunas.');
    const remaining = num(debt.amount) - num(debt.paid_amount);
    const amount = requireInt(input.amount, 'Nominal', 1);
    if (amount > remaining) throw validation(`Nominal melebihi sisa (${remaining}).`);
    const paidOn = input.paidOn ? requireDate(input.paidOn, 'Tanggal bayar') : today(c);
    const walletId = await resolveWallet(c, input.walletId);

    const pay = stdRow(c, { debt_id: debt.id, wallet_id: walletId, amount, paid_on: paidOn, note: optText(input.note, 'Catatan') });
    await insertRow(c.db, 'debt_payments', pay);
    const receivable = debt.kind === 'receivable';
    await postTransaction(c, {
      walletId, categoryId: await systemCategoryId(c, receivable ? SYSTEM_CATEGORY.RECEIVABLE_PAID : SYSTEM_CATEGORY.PAYABLE_PAID),
      type: receivable ? 'income' : 'expense', amount, occurredOn: paidOn,
      description: `${receivable ? 'Pelunasan piutang' : 'Pembayaran hutang'} ${debt.party_name}`, refTable: 'debt_payments', refId: pay.id as string,
    });

    const paidTotal = num(debt.paid_amount) + amount;
    const status = paidTotal >= num(debt.amount) ? 'settled' : 'partial';
    await updateRow(c.db, 'debts', c.businessId, input.debtId, { paid_amount: paidTotal, status, updated_at: nowIso(c) });

    if (debt.ref_table === 'sales' || debt.ref_table === 'purchases') {
      const doc = await getRow(c.db, debt.ref_table, c.businessId, String(debt.ref_id));
      if (doc) {
        const paid = num(doc.paid) + amount;
        await updateRow(c.db, debt.ref_table, c.businessId, String(doc.id), { paid, status: paid >= num(doc.total) ? 'paid' : 'partial', updated_at: nowIso(c) });
      }
    }
    await audit(c, 'pay', 'debts', input.debtId, { amount, status });
    return { remaining: remaining - amount, status };
  });
}

export async function listDebts(ctx: Ctx, o: { kind?: 'receivable' | 'payable'; onlyOpen?: boolean } = {}): Promise<DebtView[]> {
  const where = [`"business_id" = ?`, `"deleted_at" IS NULL`];
  const params: unknown[] = [ctx.businessId];
  if (o.kind) { where.push(`"kind" = ?`); params.push(o.kind); }
  if (o.onlyOpen) where.push(`"status" <> 'settled'`);
  const rows = await ctx.db.all(`SELECT * FROM "debts" WHERE ${where.join(' AND ')} ORDER BY CASE WHEN "due_date" IS NULL THEN 1 ELSE 0 END, "due_date", "created_at"`, params);
  return rows.map((r) => ({
    id: String(r.id), kind: r.kind as DebtView['kind'], partyName: String(r.party_name), amount: num(r.amount), paidAmount: num(r.paid_amount),
    remaining: num(r.amount) - num(r.paid_amount), dueDate: (r.due_date as string | null) ?? null, status: String(r.status),
    refTable: (r.ref_table as string | null) ?? null, refId: (r.ref_id as string | null) ?? null, note: (r.note as string | null) ?? null,
  }));
}
