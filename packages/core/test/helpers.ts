import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { insertRow, loadCtx, createBusiness, createProduct, updateRow, stdRow, type Ctx, type Db, type BusinessType } from '../src/index';
import { sqliteNodeDb } from '../src/adapters/sqlite-node';
import { DomainError } from '../src/errors';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const schema = readFileSync(resolve(root, 'database/sqlite/001_core.sql'), 'utf8');

export function newDb(): Db {
  const h = new DatabaseSync(':memory:');
  h.exec('PRAGMA foreign_keys = ON');
  h.exec(schema);
  return sqliteNodeDb(h);
}

export interface Clock { t: number; now: () => Date; advanceMin: (m: number) => void; set: (iso: string) => void }
export function makeClock(iso = '2026-10-27T03:00:00.000Z'): Clock {
  const c: Clock = { t: Date.parse(iso), now: () => new Date(c.t), advanceMin: (m) => { c.t += m * 60_000; }, set: (s) => { c.t = Date.parse(s); } };
  return c;
}

export interface World { db: Db; clock: Clock; ctx: Ctx; businessId: string; ownerId: string; walletId: string }

export async function bootstrap(o: { type?: BusinessType; openingCash?: number; db?: Db; clock?: Clock; name?: string } = {}): Promise<World> {
  const db = o.db ?? newDb();
  const clock = o.clock ?? makeClock();
  const b = await createBusiness(db, { name: o.name ?? 'Toko Uji', businessType: o.type ?? 'elektronik', ownerName: 'Budi', openingCash: o.openingCash ?? 1_000_000 }, { now: clock.now });
  const ctx = await loadCtx(db, b.businessId, b.ownerMemberId, { now: clock.now });
  return { db, clock, ctx, businessId: b.businessId, ownerId: b.ownerMemberId, walletId: b.defaultWalletId };
}

/** Anggota baru (staff/manager) di bisnis yang sama, lalu muat ctx-nya. */
export async function memberCtx(w: World, role: 'staff' | 'manager', flags: { canViewReports?: boolean; canDelete?: boolean } = {}): Promise<Ctx> {
  const row = stdRow(w.ctx, { display_name: `${role}-${w.clock.t}`, role, user_id: null, can_view_reports: flags.canViewReports ?? false, can_delete: flags.canDelete ?? false, is_active: true });
  await insertRow(w.db, 'members', row);
  return loadCtx(w.db, w.businessId, row.id as string, { now: w.clock.now });
}

export async function mk(ctx: Ctx, name: string, cost: number, sell: number, qty: number, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await createProduct(ctx, { name, unit: 'pcs', variants: [{ costPrice: cost, sellPrice: sell, openingQtyMilli: qty * 1000 }], ...extra });
  return r.variantIds[0] as string;
}

export async function addCustomer(ctx: Ctx, name = 'Rina'): Promise<string> {
  const row = stdRow(ctx, { name, phone: null, address: null, note: null });
  await insertRow(ctx.db, 'customers', row);
  return row.id as string;
}
export async function addSupplier(ctx: Ctx, name = 'PT Jaya'): Promise<string> {
  const row = stdRow(ctx, { name, phone: null, address: null, note: null });
  await insertRow(ctx.db, 'suppliers', row);
  return row.id as string;
}

export async function setBusiness(w: World, patch: { tax_bp?: number; settings?: Record<string, unknown> }): Promise<Ctx> {
  await updateRow(w.db, 'businesses', w.businessId, w.businessId, { ...patch, updated_at: w.clock.now().toISOString() });
  return loadCtx(w.db, w.businessId, w.ownerId, { now: w.clock.now });
}

export async function q1(db: Db, sql: string, params: unknown[] = []): Promise<Record<string, unknown>> {
  const r = (await db.all(sql, params))[0];
  if (!r) throw new Error(`query tanpa hasil: ${sql}`);
  return r;
}
export const n = (v: unknown): number => Number(v);

export async function code(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return e instanceof DomainError ? e.code : `BUKAN-DomainError: ${e instanceof Error ? e.message : e}`; }
  return 'TIDAK-ERROR';
}
export const wallet = async (db: Db, id: string) => n((await q1(db, 'SELECT balance FROM wallets WHERE id = ?', [id])).balance);
export const stockOf = async (db: Db, vid: string) => n((await q1(db, 'SELECT stock_qty_milli s FROM product_variants WHERE id = ?', [vid])).s);
export const count = async (db: Db, table: string, where = '1=1', params: unknown[] = []) => n((await q1(db, `SELECT COUNT(*) c FROM "${table}" WHERE ${where}`, params)).c);
