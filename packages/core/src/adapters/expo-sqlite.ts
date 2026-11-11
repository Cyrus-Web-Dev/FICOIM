/**
 * Adapter HP (Expo). STATUS: belum dijalankan di perangkat — diuji lewat logika bersama (sqlite-core)
 * yang sama dengan adapter Node. Bila nama method expo-sqlite berbeda di versi SDK-mu, hanya 3 baris ini yang disesuaikan.
 *
 *   import * as SQLite from 'expo-sqlite';
 *   const handle = await SQLite.openDatabaseAsync('ficoim.db');
 *   await handle.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
 *   const db = expoSqliteDb(handle);
 */
import type { Db } from '../db';
import { makeSqliteDb } from './sqlite-core';

export interface ExpoSqliteHandle {
  getAllAsync(sql: string, params: unknown[]): Promise<Record<string, unknown>[]>;
  runAsync(sql: string, params: unknown[]): Promise<{ changes: number }>;
  execAsync(sql: string): Promise<void>;
}

export function expoSqliteDb(handle: ExpoSqliteHandle): Db {
  return makeSqliteDb({
    queryAll: (sql, params) => handle.getAllAsync(sql, params),
    execRun: async (sql, params) => ({ changes: (await handle.runAsync(sql, params)).changes }),
    execRaw: (sql) => handle.execAsync(sql),
  });
}
