/**
 * Adapter PostgreSQL untuk API. STATUS: belum dijalankan (tidak ada Postgres di lingkungan pengembangan).
 * Paket `pg` diinstal oleh apps/api; di sini hanya dipakai tipe struktural.
 *
 * Penting:
 *  - Setiap permintaan WAJIB lewat withBusiness(): membuka transaksi lalu `set_config('app.business_id', …, true)`
 *    supaya Row-Level Security membatasi semua query ke bisnis tersebut.
 *  - Panggil installPgTypeParsers(pg.types) SEKALI saat startup agar bigint -> number, date/timestamptz -> string ISO.
 */
import type { Db, RunResult } from '../db';

export interface PgClientLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  release(): void;
}
export interface PgPoolLike { connect(): Promise<PgClientLike>; query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> }
export interface PgTypesLike { setTypeParser(oid: number, parser: (v: string) => unknown): void }

export function installPgTypeParsers(types: PgTypesLike): void {
  types.setTypeParser(20, (v) => { // int8 / bigint
    const n = Number(v);
    if (!Number.isSafeInteger(n)) throw new Error('bigint di luar rentang aman JavaScript');
    return n;
  });
  types.setTypeParser(1082, (v) => v);                           // date  -> 'YYYY-MM-DD'
  types.setTypeParser(1184, (v) => new Date(v).toISOString());   // timestamptz -> ISO UTC
}

/** Ubah placeholder `?` menjadi $1, $2, … (melewati teks di dalam tanda kutip tunggal). */
export function toPgPlaceholders(sql: string): string {
  let out = '', n = 0, inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i] as string;
    if (ch === "'") inStr = !inStr;
    out += ch === '?' && !inStr ? `$${++n}` : ch;
  }
  return out;
}

export async function withBusiness<T>(pool: PgPoolLike, businessId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let depth = 0;
  const db: Db = {
    dialect: 'postgres',
    async all(sql, params = []) { return (await client.query(toPgPlaceholders(sql), params)).rows; },
    async run(sql, params = []): Promise<RunResult> {
      const r = await client.query(toPgPlaceholders(sql), params);
      return { changes: r.rowCount ?? 0 };
    },
    async transaction<T2>(inner: (tx: Db) => Promise<T2>): Promise<T2> { depth++; try { return await inner(db); } finally { depth--; } },
  };
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.business_id', $1, true)", [businessId]);
    const out = await fn(db);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* abaikan */ }
    throw e;
  } finally {
    void depth;
    client.release();
  }
}

/**
 * Db tanpa konteks bisnis — HANYA untuk tabel autentikasi (app_users, refresh_tokens, business_access) yang tidak memakai RLS.
 * Jangan dipakai untuk data bisnis (RLS akan menyembunyikan semuanya).
 */
export function pgPoolDb(pool: PgPoolLike): Db {
  const db: Db = {
    dialect: 'postgres',
    async all(sql, params = []) { return (await pool.query(toPgPlaceholders(sql), params)).rows; },
    async run(sql, params = []): Promise<RunResult> { return { changes: (await pool.query(toPgPlaceholders(sql), params)).rowCount ?? 0 }; },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      const tx: Db = {
        dialect: 'postgres',
        async all(sql, params = []) { return (await client.query(toPgPlaceholders(sql), params)).rows; },
        async run(sql, params = []): Promise<RunResult> { return { changes: (await client.query(toPgPlaceholders(sql), params)).rowCount ?? 0 }; },
        transaction: (inner) => inner(tx),
      };
      try { await client.query('BEGIN'); const out = await fn(tx); await client.query('COMMIT'); return out; }
      catch (e) { try { await client.query('ROLLBACK'); } catch { /* abaikan */ } throw e; }
      finally { client.release(); }
    },
  };
  return db;
}
