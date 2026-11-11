import * as SQLite from 'expo-sqlite';
import { ensureSqliteSchema, type Db } from '@ficoim/core';
import { expoSqliteDb } from '@ficoim/core/adapters/expo-sqlite';

/** Membuka database lokal, mengaktifkan foreign key, dan menyiapkan skema (lihat core/migrate.ts). */
export async function openDatabase(): Promise<Db> {
  const handle = await SQLite.openDatabaseAsync('ficoim.db');
  await handle.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const db = expoSqliteDb({
    getAllAsync: (sql, params) => handle.getAllAsync(sql, params as never) as Promise<Record<string, unknown>[]>,
    runAsync: async (sql, params) => ({ changes: (await handle.runAsync(sql, params as never)).changes }),
    execAsync: (sql) => handle.execAsync(sql),
  });
  await ensureSqliteSchema(db);
  return db;
}
