import type { TableDef } from './defs';

export type Row = Record<string, unknown>;

/** Baris format snapshot (bool = boolean, json = objek) -> nilai siap-INSERT untuk SQLite. */
export function encodeRowForSqlite(t: TableDef, row: Row): unknown[] {
  return t.columns.map((c) => {
    const v = row[c.name];
    if (v === null || v === undefined) return null;
    if (c.type === 'bool') return v ? 1 : 0;
    if (c.type === 'json') return JSON.stringify(v);
    return v;
  });
}

/** Baris hasil SELECT SQLite -> format snapshot. */
export function decodeRowFromSqlite(t: TableDef, raw: Record<string, unknown>): Row {
  const out: Row = {};
  for (const c of t.columns) {
    const v = raw[c.name];
    if (v === null || v === undefined) out[c.name] = null;
    else if (c.type === 'bool') out[c.name] = Number(v) === 1;
    else if (c.type === 'json') out[c.name] = JSON.parse(String(v));
    else if (c.type === 'bigint' || c.type === 'int') out[c.name] = Number(v);
    else out[c.name] = v;
  }
  return out;
}
