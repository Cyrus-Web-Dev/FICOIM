import { uuidv7, type Row } from '@ficoim/shared';
import type { Db } from './db';
import { getRow } from './db';
import { DomainError, notFound } from './errors';

export type Role = 'owner' | 'manager' | 'staff';

export interface Actor {
  memberId: string | null;
  role: Role;
  canViewReports: boolean;
  canDelete: boolean;
}

/** Konteks satu operasi: siapa, bisnis mana, jam berapa. Dibuat per permintaan (API) atau per sesi (HP). */
export interface Ctx {
  db: Db;
  businessId: string;
  actor: Actor;
  now: () => Date;
  newId: () => string;
  /** Selisih zona waktu bisnis terhadap UTC dalam menit (WIB = 420, WITA = 480, WIT = 540). */
  tzOffsetMinutes: number;
  allowNegativeStock: boolean;
  taxBp: number;
}

export interface CtxOptions {
  now?: () => Date;
  newId?: () => string;
}

export async function loadCtx(db: Db, businessId: string, memberId: string | null, opts: CtxOptions = {}): Promise<Ctx> {
  const biz = await getRow(db, 'businesses', businessId, businessId);
  if (!biz || biz.deleted_at) throw notFound('Bisnis');
  let actor: Actor = { memberId: null, role: 'owner', canViewReports: true, canDelete: true };
  if (memberId) {
    const m = await getRow(db, 'members', businessId, memberId);
    if (!m || m.is_active !== true) throw new DomainError('FORBIDDEN', 'Anggota tidak aktif atau bukan bagian dari bisnis ini.');
    actor = { memberId, role: m.role as Role, canViewReports: m.can_view_reports === true, canDelete: m.can_delete === true };
  }
  const s = (biz.settings ?? {}) as Record<string, unknown>;
  const now = opts.now ?? (() => new Date());
  return {
    db, businessId, actor, now,
    newId: opts.newId ?? (() => uuidv7(now().getTime())),
    tzOffsetMinutes: typeof s.tzOffsetMinutes === 'number' ? s.tzOffsetMinutes : 420,
    allowNegativeStock: s.allowNegativeStock === true,
    taxBp: Number(biz.tax_bp ?? 0),
  };
}

export const nowIso = (ctx: Ctx): string => ctx.now().toISOString();

/** Baris baru dengan kolom standar terisi. */
export function stdRow(ctx: Ctx, extra: Row): Row {
  const t = nowIso(ctx);
  return { id: ctx.newId(), business_id: ctx.businessId, created_at: t, updated_at: t, deleted_at: null, ...extra };
}

/** Jalankan fn dalam satu transaksi (bergabung bila sudah di dalam transaksi). */
export function withTx<T>(ctx: Ctx, fn: (c: Ctx) => Promise<T>): Promise<T> {
  return ctx.db.transaction((db) => fn({ ...ctx, db }));
}
