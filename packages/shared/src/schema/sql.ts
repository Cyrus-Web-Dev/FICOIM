import type { ColDef, TableDef } from './defs';

export type Dialect = 'postgres' | 'sqlite';

const PG_TYPE: Record<ColDef['type'], string> = {
  uuid: 'uuid', text: 'text', int: 'integer', bigint: 'bigint', bool: 'boolean',
  timestamp: 'timestamptz', date: 'date', json: 'jsonb',
};
const SQLITE_TYPE: Record<ColDef['type'], string> = {
  uuid: 'TEXT', text: 'TEXT', int: 'INTEGER', bigint: 'INTEGER', bool: 'INTEGER',
  timestamp: 'TEXT', date: 'TEXT', json: 'TEXT',
};

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

function literal(c: ColDef, d: Dialect): string {
  const v = c.default as string | number | boolean;
  if (typeof v === 'boolean') return d === 'postgres' ? String(v) : v ? '1' : '0';
  if (typeof v === 'number') return String(v);
  return q(v);
}

function columnSql(c: ColDef, d: Dialect, isPk: boolean): string {
  const parts = [`  "${c.name}"`, d === 'postgres' ? PG_TYPE[c.type] : SQLITE_TYPE[c.type]];
  if (isPk) parts.push('PRIMARY KEY');
  else if (!c.nullable) parts.push('NOT NULL');
  if (c.default !== undefined) parts.push(`DEFAULT ${literal(c, d)}`);
  if (c.ref) parts.push(`REFERENCES "${c.ref.table}"("id") ON DELETE ${c.ref.onDelete.toUpperCase()}`);
  return parts.join(' ');
}

function checks(t: TableDef, d: Dialect): string[] {
  const out: string[] = [];
  for (const c of t.columns) {
    if (c.enum) out.push(`  CONSTRAINT "ck_${t.name}_${c.name}" CHECK ("${c.name}" IN (${c.enum.map(q).join(', ')}))`);
    if (c.min !== undefined) out.push(`  CONSTRAINT "ck_${t.name}_${c.name}_min" CHECK ("${c.name}" >= ${c.min})`);
    if (c.max !== undefined) out.push(`  CONSTRAINT "ck_${t.name}_${c.name}_max" CHECK ("${c.name}" <= ${c.max})`);
    if (c.type === 'bool' && d === 'sqlite') out.push(`  CONSTRAINT "ck_${t.name}_${c.name}_bool" CHECK ("${c.name}" IN (0, 1))`);
  }
  return out;
}

export function createTableSql(t: TableDef, d: Dialect): string {
  const lines = [...t.columns.map((c) => columnSql(c, d, c.name === 'id')), ...checks(t, d)];
  let sql = `CREATE TABLE "${t.name}" (\n${lines.join(',\n')}\n);\n`;
  for (const u of t.uniques)
    sql += `CREATE UNIQUE INDEX "${u.name}" ON "${t.name}" (${u.cols.map((c) => `"${c}"`).join(', ')}) WHERE "deleted_at" IS NULL;\n`;
  for (const i of t.indexes) sql += `CREATE INDEX "${i.name}" ON "${t.name}" (${i.cols.map((c) => `"${c}"`).join(', ')});\n`;
  return sql;
}

function rlsSql(t: TableDef): string {
  const key = t.scope === 'root' ? 'id' : 'business_id';
  const expr = `"${key}" = NULLIF(current_setting('app.business_id', true), '')::uuid`;
  return (
    `ALTER TABLE "${t.name}" ENABLE ROW LEVEL SECURITY;\n` +
    `ALTER TABLE "${t.name}" FORCE ROW LEVEL SECURITY;\n` +
    `CREATE POLICY "tenant_isolation" ON "${t.name}" USING (${expr}) WITH CHECK (${expr});\n`
  );
}

export function generateSql(tables: readonly TableDef[], d: Dialect, schemaVersion: number): string {
  const head =
    `-- GENERATED FILE — JANGAN DIEDIT TANGAN.\n` +
    `-- Sumber: packages/shared/src/schema/tables.ts   |   Regenerasi: npm run gen:sql\n` +
    `-- Dialek: ${d}   |   Versi skema data: ${schemaVersion}\n\n`;
  const pre =
    d === 'postgres'
      ? `-- Uang = BIGINT Rupiah; qty = BIGINT milli (1000 = 1 satuan); waktu = timestamptz (UTC).\n` +
        `-- Isolasi antar-bisnis (multi-tenant) dipaksa oleh Row-Level Security: tiap transaksi wajib\n` +
        `--   SET LOCAL app.business_id = '<uuid bisnis>';  Role aplikasi TIDAK boleh superuser / BYPASSRLS.\n\n`
      : `-- Jalankan PRAGMA foreign_keys = ON pada SETIAP koneksi (SQLite tidak mengaktifkannya otomatis).\n` +
        `-- Uang = INTEGER Rupiah; qty = INTEGER milli; waktu = TEXT ISO-8601 UTC (…Z); bool = 0/1; json = TEXT.\n\n`;
  const body = tables.map((t) => createTableSql(t, d)).join('\n');
  const rls = d === 'postgres' ? '\n-- ===== Row-Level Security =====\n' + tables.map(rlsSql).join('\n') : '';
  const ver = d === 'sqlite' ? `\nPRAGMA user_version = ${schemaVersion};\n` : '';
  return head + pre + body + rls + ver;
}
