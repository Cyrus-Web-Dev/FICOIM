import type { Actor, Ctx } from './ctx';
import { DomainError } from './errors';

export type Action =
  | 'product.write' | 'product.delete' | 'stock.adjust'
  | 'sale.create' | 'sale.void' | 'purchase.create' | 'purchase.void'
  | 'finance.write' | 'finance.delete' | 'debt.pay'
  | 'asset.write' | 'report.view' | 'settings.write'
  | 'backup.export' | 'backup.restore' | 'member.manage';

const MANAGER_DENIED: ReadonlySet<Action> = new Set(['backup.restore', 'member.manage']);
const STAFF_ALLOWED: ReadonlySet<Action> = new Set(['sale.create', 'debt.pay']);

export function can(actor: Actor, action: Action): boolean {
  if (actor.role === 'owner') return true;
  if (actor.role === 'manager') return !MANAGER_DENIED.has(action);
  // staff
  if (STAFF_ALLOWED.has(action)) return true;
  if (action === 'report.view') return actor.canViewReports;
  if (action === 'product.delete' || action === 'finance.delete') return actor.canDelete;
  return false;
}

export function requireCan(ctx: Ctx, action: Action): void {
  if (!can(ctx.actor, action)) throw new DomainError('FORBIDDEN', 'Peran Anda tidak diizinkan melakukan aksi ini.', { action });
}
