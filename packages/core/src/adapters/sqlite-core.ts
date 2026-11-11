import type { Db, RunResult } from '../db';

/** Primitif minimal yang disediakan tiap driver SQLite (node:sqlite, expo-sqlite). */
export interface SqlitePrimitives {
  queryAll(sql: string, params: unknown[]): Promise<Record<string, unknown>[]>;
  execRun(sql: string, params: unknown[]): Promise<RunResult>;
  execRaw(sql: string): Promise<void>;
}

/**
 * Membangun Db dari primitif SQLite: transaksi diserialkan (satu koneksi = satu transaksi aktif)
 * dan boleh bersarang (bergabung ke transaksi induk; kegagalan di mana pun membatalkan seluruhnya).
 */
export function makeSqliteDb(p: SqlitePrimitives): Db {
  let depth = 0;
  let chain: Promise<unknown> = Promise.resolve();
  const self: Db = {
    dialect: 'sqlite',
    all: (sql, params = []) => p.queryAll(sql, params),
    run: (sql, params = []) => p.execRun(sql, params),
    exec: (sql) => p.execRaw(sql),
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      if (depth > 0) return fn(self);
      const job = async (): Promise<T> => {
        await p.execRaw('BEGIN IMMEDIATE');
        depth = 1;
        try {
          const out = await fn(self);
          await p.execRaw('COMMIT');
          return out;
        } catch (e) {
          try { await p.execRaw('ROLLBACK'); } catch { /* koneksi sudah menutup transaksi */ }
          throw e;
        } finally {
          depth = 0;
        }
      };
      const result = chain.then(job, job);
      chain = result.catch(() => undefined);
      return result;
    },
  };
  return self;
}
