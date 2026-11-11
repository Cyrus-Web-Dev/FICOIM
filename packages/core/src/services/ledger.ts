import { insertRow } from '../db';
import { stdRow, type Ctx } from '../ctx';
import { refreshWallet } from './recompute';

export interface PostTx {
  walletId: string; categoryId: string; type: 'income' | 'expense'; amount: number; occurredOn: string;
  description?: string | null; refTable?: string | null; refId?: string | null; receiptAttachmentId?: string | null;
}

/** Catat satu transaksi kas dan segarkan saldo dompetnya. Validasi tingkat-tinggi dilakukan pemanggil. */
export async function postTransaction(ctx: Ctx, t: PostTx): Promise<string> {
  const row = stdRow(ctx, {
    wallet_id: t.walletId, category_id: t.categoryId, type: t.type, amount: t.amount, occurred_on: t.occurredOn,
    description: t.description ?? null, ref_table: t.refTable ?? null, ref_id: t.refId ?? null,
    receipt_attachment_id: t.receiptAttachmentId ?? null, created_by: ctx.actor.memberId,
  });
  await insertRow(ctx.db, 'transactions', row);
  await refreshWallet(ctx, t.walletId);
  return row.id as string;
}
