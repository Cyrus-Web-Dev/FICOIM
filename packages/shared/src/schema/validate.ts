import { isUuid } from '../ids';
import type { ColDef, TableDef } from './defs';
import type { Row } from './rows';
import { TABLES, TABLE_BY_NAME } from './tables';

export type TableData = Record<string, Row[]>;

export interface ValidationIssue {
  table: string;
  rowId?: string;
  column?: string;
  message: string;
}

const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function validDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function checkValue(c: ColDef, v: unknown): string | null {
  switch (c.type) {
    case 'uuid': return isUuid(v) ? null : 'bukan UUID huruf-kecil yang valid';
    case 'text': return typeof v === 'string' ? null : 'harus teks';
    case 'bool': return typeof v === 'boolean' ? null : 'harus true/false';
    case 'json': return v !== null && typeof v === 'object' ? null : 'harus objek/array JSON';
    case 'timestamp': return typeof v === 'string' && TS_RE.test(v) && !Number.isNaN(Date.parse(v)) ? null : 'harus ISO-8601 UTC (…Z)';
    case 'date': return typeof v === 'string' && validDate(v) ? null : 'harus tanggal YYYY-MM-DD yang valid';
    case 'int':
    case 'bigint': {
      if (typeof v !== 'number' || !Number.isSafeInteger(v)) return 'harus bilangan bulat';
      if (c.min !== undefined && v < c.min) return `minimal ${c.min}`;
      if (c.max !== undefined && v > c.max) return `maksimal ${c.max}`;
      return null;
    }
  }
}

/**
 * Validasi isi backup (data TIDAK dipercaya): bentuk kolom, tipe, enum, rentang,
 * duplikat id, konsistensi business_id, dan integritas referensi antar-tabel.
 * Berhenti mengumpulkan setelah `maxIssues` temuan.
 */
export function validateTables(data: TableData, maxIssues = 50): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (i: ValidationIssue) => { if (issues.length < maxIssues) issues.push(i); };

  for (const name of Object.keys(data)) {
    if (!TABLE_BY_NAME[name]) add({ table: name, message: 'tabel tidak dikenal' });
  }

  const ids = new Map<string, Set<string>>();
  for (const t of TABLES) {
    const rows = data[t.name] ?? [];
    if (!Array.isArray(rows)) { add({ table: t.name, message: 'isi tabel harus berupa array' }); continue; }
    const set = new Set<string>();
    ids.set(t.name, set);
    for (const row of rows) {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) { add({ table: t.name, message: 'baris harus objek' }); continue; }
      const rid = typeof row.id === 'string' ? row.id : undefined;
      validateRowShape(t, row, rid, add);
      if (rid) {
        if (set.has(rid)) add({ table: t.name, rowId: rid, column: 'id', message: 'id duplikat' });
        set.add(rid);
      }
    }
  }

  const biz = data.businesses ?? [];
  if (biz.length !== 1) add({ table: 'businesses', message: `harus tepat 1 baris bisnis, ditemukan ${biz.length}` });
  const bizId = biz[0]?.id;

  for (const t of TABLES) {
    for (const row of data[t.name] ?? []) {
      if (!row || typeof row !== 'object') continue;
      const rid = typeof row.id === 'string' ? row.id : undefined;
      if (t.scope === 'business' && bizId !== undefined && row.business_id !== bizId)
        add({ table: t.name, rowId: rid, column: 'business_id', message: 'business_id tidak sama dengan bisnis di backup' });
      for (const c of t.columns) {
        const v = row[c.name];
        if (!c.ref || v === null || v === undefined || c.name === 'business_id') continue;
        if (!ids.get(c.ref.table)?.has(v as string))
          add({ table: t.name, rowId: rid, column: c.name, message: `merujuk ${c.ref.table}.id yang tidak ada di backup` });
      }
    }
  }
  return issues;
}

function validateRowShape(t: TableDef, row: Row, rid: string | undefined, add: (i: ValidationIssue) => void): void {
  const known = new Set(t.columns.map((c) => c.name));
  for (const k of Object.keys(row)) if (!known.has(k)) add({ table: t.name, rowId: rid, column: k, message: 'kolom tidak dikenal' });
  for (const c of t.columns) {
    if (!(c.name in row)) { add({ table: t.name, rowId: rid, column: c.name, message: 'kolom wajib ada' }); continue; }
    const v = row[c.name];
    if (v === null) {
      if (!c.nullable) add({ table: t.name, rowId: rid, column: c.name, message: 'tidak boleh null' });
      continue;
    }
    const err = checkValue(c, v);
    if (err) { add({ table: t.name, rowId: rid, column: c.name, message: err }); continue; }
    if (c.enum && !c.enum.includes(v as string)) add({ table: t.name, rowId: rid, column: c.name, message: `nilai harus salah satu dari: ${c.enum.join(', ')}` });
  }
}

export function emptyTables(): TableData {
  return Object.fromEntries(TABLES.map((t) => [t.name, [] as Row[]]));
}
