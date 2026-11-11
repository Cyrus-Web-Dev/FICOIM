import { insertRow } from '../db';
import { stdRow, nowIso, type Ctx } from '../ctx';

export async function audit(ctx: Ctx, action: string, table: string, recordId: string | null, detail?: unknown): Promise<void> {
  await insertRow(ctx.db, 'audit_log', stdRow(ctx, {
    member_id: ctx.actor.memberId, action, table_name: table, record_id: recordId,
    detail: detail === undefined ? null : detail, occurred_at: nowIso(ctx),
  }));
}
