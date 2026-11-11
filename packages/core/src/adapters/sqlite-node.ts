import type { DatabaseSync } from 'node:sqlite';
import type { Db } from '../db';
import { makeSqliteDb } from './sqlite-core';

/** Untuk pengujian & pengembangan lokal di Node (node:sqlite, Node >= 22.5). */
export function sqliteNodeDb(handle: DatabaseSync): Db {
  return makeSqliteDb({
    queryAll: async (sql, params) => handle.prepare(sql).all(...(params as never[])) as Record<string, unknown>[],
    execRun: async (sql, params) => ({ changes: Number(handle.prepare(sql).run(...(params as never[])).changes) }),
    execRaw: async (sql) => { handle.exec(sql); },
  });
}
