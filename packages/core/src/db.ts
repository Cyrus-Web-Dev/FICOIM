import { TABLE_BY_NAME, decodeRowFromSqlite, type ColDef, type Dialect, type Row, type TableDef } from '@ficoim/shared';

export type { Dialect };
export interface RunResult { changes: number }

/**
 * Antarmuka database minimum yang dipakai seluruh mesin bisnis.
 *  - SQL memakai placeholder `?` dan identifier ber-kutip ganda (valid di SQLite & PostgreSQL).
 *  - transaction() boleh dipanggil bersarang: panggilan dalam transaksi aktif ikut bergabung.
 * Adapter: sqlite-node (uji/dev), expo-sqlite (HP), pg (server).
 */
export interface Db {
  readonly dialect: Dialect;
  all(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  run(sql: string, params?: unknown[]): Promise<RunResult>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  /** Menjalankan skrip multi-pernyataan (DDL). Hanya adapter SQLite. */
  exec?(sql: string): Promise<void>;
}

export const qi = (name: string): string => `"${name}"`;

export function tbl(name: string): TableDef {
  const t = TABLE_BY_NAME[name];
  if (!t) throw new Error(`tabel tidak dikenal: ${name}`);
  return t;
}

/** Nilai boolean untuk parameter SQL (SQLite = 0/1, PostgreSQL = true/false). */
export const dbBool = (db: Db, v: boolean): number | boolean => (db.dialect === 'sqlite' ? (v ? 1 : 0) : v);
export const asBool = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 't' || v === 'true';
export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

export function encodeValue(c: ColDef, v: unknown, d: Dialect): unknown {
  if (v === null || v === undefined) return null;
  if (c.type === 'bool') return d === 'sqlite' ? (v ? 1 : 0) : Boolean(v);
  if (c.type === 'json') return JSON.stringify(v);
  return v;
}

export function decodeRow(db: Db, t: TableDef, raw: Record<string, unknown>): Row {
  if (db.dialect === 'sqlite') return decodeRowFromSqlite(t, raw);
  const out: Row = {};
  for (const c of t.columns) {
    const v = raw[c.name];
    out[c.name] = v === null || v === undefined ? null : c.type === 'bigint' || c.type === 'int' ? Number(v) : v;
  }
  return out;
}

export async function insertRow(db: Db, table: string, row: Row): Promise<void> {
  const t = tbl(table);
  await db.run(
    `INSERT INTO ${qi(table)} (${t.columns.map((c) => qi(c.name)).join(', ')}) VALUES (${t.columns.map(() => '?').join(', ')})`,
    t.columns.map((c) => encodeValue(c, row[c.name], db.dialect)),
  );
}

/** UPDATE satu baris menurut id (selalu dibatasi business_id). Mengembalikan jumlah baris terubah. */
export async function updateRow(db: Db, table: string, businessId: string, id: string, patch: Row): Promise<number> {
  const t = tbl(table);
  const keys = Object.keys(patch);
  if (keys.length === 0) return 0;
  const cols = keys.map((k) => {
    const c = t.columns.find((x) => x.name === k);
    if (!c) throw new Error(`kolom tidak dikenal: ${table}.${k}`);
    return c;
  });
  const root = t.scope === 'root';
  const res = await db.run(
    `UPDATE ${qi(table)} SET ${keys.map((k) => `${qi(k)} = ?`).join(', ')} WHERE "id" = ?${root ? '' : ' AND "business_id" = ?'}`,
    [...cols.map((c) => encodeValue(c, patch[c.name], db.dialect)), id, ...(root ? [] : [businessId])],
  );
  return res.changes;
}

export async function selectRows(db: Db, table: string, where: string, params: unknown[], tail = ''): Promise<Row[]> {
  const t = tbl(table);
  const raw = await db.all(`SELECT * FROM ${qi(table)} WHERE ${where} ${tail}`, params);
  return raw.map((r) => decodeRow(db, t, r));
}

/** Ambil 1 baris menurut id dalam bisnis ini. Baris yang sudah dihapus-lunak tidak dikembalikan. */
export async function getRow(db: Db, table: string, businessId: string, id: string): Promise<Row | null> {
  const t = tbl(table);
  const where = t.scope === 'root' ? '"id" = ?' : '"id" = ? AND "business_id" = ? AND "deleted_at" IS NULL';
  const rows = await selectRows(db, table, where, t.scope === 'root' ? [id] : [id, businessId]);
  return rows[0] ?? null;
}
