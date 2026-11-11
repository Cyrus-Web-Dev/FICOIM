/**
 * DSL definisi tabel — SATU sumber kebenaran untuk:
 *  - DDL PostgreSQL (web/server) dan SQLite (mobile)  -> scripts/gen-sql.ts
 *  - validasi isi file backup                          -> validate.ts
 *  - konversi baris SQLite <-> JSON                    -> rows.ts
 */
export type ColType = 'uuid' | 'text' | 'int' | 'bigint' | 'bool' | 'timestamp' | 'date' | 'json';
export type OnDelete = 'cascade' | 'restrict' | 'set null';

export interface ColDef {
  name: string;
  type: ColType;
  nullable: boolean;
  default?: string | number | boolean;
  enum?: readonly string[];
  ref?: { table: string; onDelete: OnDelete };
  min?: number;
  max?: number;
}

export interface TableDef {
  name: string;
  /** 'root' = tabel businesses (id-nya adalah id bisnis); 'business' = punya kolom business_id */
  scope: 'root' | 'business';
  columns: ColDef[];
  /** Unik hanya untuk baris yang belum dihapus (soft delete). */
  uniques: { name: string; cols: string[] }[];
  indexes: { name: string; cols: string[] }[];
}

export interface ColOpts {
  null?: boolean;
  def?: string | number | boolean;
  enum?: readonly string[];
  ref?: string | [string, OnDelete];
  min?: number;
  max?: number;
}

export function col(name: string, type: ColType, o: ColOpts = {}): ColDef {
  const c: ColDef = { name, type, nullable: o.null === true };
  if (o.def !== undefined) c.default = o.def;
  if (o.enum) c.enum = o.enum;
  if (o.ref) {
    const [table, onDelete] = typeof o.ref === 'string' ? [o.ref, 'restrict' as OnDelete] : o.ref;
    c.ref = { table, onDelete };
  }
  if (o.min !== undefined) c.min = o.min;
  if (o.max !== undefined) c.max = o.max;
  return c;
}

export interface TableExtra {
  uniques?: Record<string, string[]>;
  indexes?: Record<string, string[]>;
}

/** Kolom standar: id, business_id (kecuali root), created_at, updated_at, deleted_at (soft delete). */
export function table(name: string, cols: ColDef[], extra: TableExtra = {}, root = false): TableDef {
  const std: ColDef[] = [col('id', 'uuid')];
  if (!root) std.push(col('business_id', 'uuid', { ref: ['businesses', 'cascade'] }));
  const tail: ColDef[] = [
    col('created_at', 'timestamp'),
    col('updated_at', 'timestamp'),
    col('deleted_at', 'timestamp', { null: true }),
  ];
  const uniques = Object.entries(extra.uniques ?? {}).map(([n, c]) => ({ name: n, cols: c }));
  const indexes = Object.entries(extra.indexes ?? {}).map(([n, c]) => ({ name: n, cols: c }));
  if (!root) indexes.unshift({ name: `ix_${name}_sync`, cols: ['business_id', 'updated_at'] });
  return { name, scope: root ? 'root' : 'business', columns: [...std, ...cols, ...tail], uniques, indexes };
}
