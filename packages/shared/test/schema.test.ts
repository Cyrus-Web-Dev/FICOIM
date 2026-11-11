import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TABLES, TABLE_ORDER, SCHEMA_VERSION } from '../src/schema/tables';
import { generateSql } from '../src/schema/sql';
import { decodeRowFromSqlite, encodeRowForSqlite, type Row } from '../src/schema/rows';
import { validateTables } from '../src/schema/validate';
import { buildSample } from '../src/testing/sample';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sqliteSql = readFileSync(resolve(root, 'database/sqlite/001_core.sql'), 'utf8');
const pgSql = readFileSync(resolve(root, 'database/postgres/001_core.sql'), 'utf8');

const openDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(sqliteSql);
  return db;
};
const clone = <T>(x: T): T => structuredClone(x);

test('file SQL di repo sama dengan hasil generator (tidak basi)', () => {
  assert.equal(readFileSync(resolve(root, 'database/postgres/001_core.sql'), 'utf8'), generateSql(TABLES, 'postgres', SCHEMA_VERSION));
  assert.equal(sqliteSql, generateSql(TABLES, 'sqlite', SCHEMA_VERSION));
});

test('PostgreSQL & SQLite: tabel dan kolom identik; RLS aktif di semua tabel', () => {
  for (const t of TABLES) {
    const grab = (sql: string) => {
      const m = new RegExp(`CREATE TABLE "${t.name}" \\(\\n([\\s\\S]*?)\\n\\);`).exec(sql);
      assert.ok(m, `tabel ${t.name} tidak ada`);
      return [...(m![1] as string).matchAll(/^ {2}"(\w+)" /gm)].map((x) => x[1]);
    };
    assert.deepEqual(grab(pgSql), grab(sqliteSql), `kolom ${t.name} berbeda`);
    assert.ok(pgSql.includes(`ALTER TABLE "${t.name}" FORCE ROW LEVEL SECURITY;`), `RLS ${t.name}`);
  }
  assert.equal(TABLES.length, 25);
});

test('SQLite: skema valid, versi tercatat, foreign key aktif', () => {
  const db = openDb();
  assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, SCHEMA_VERSION);
  const n = (db.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table'").get() as { c: number }).c;
  assert.equal(n, TABLES.length);
});

test('data contoh lolos validator & urutan TABLE_ORDER aman untuk FK', () => {
  const { tables } = buildSample();
  assert.deepEqual(validateTables(tables), []);
  const db = openDb();
  for (const name of TABLE_ORDER) {
    const t = TABLES.find((x) => x.name === name)!;
    const sql = `INSERT INTO "${name}" (${t.columns.map((c) => `"${c.name}"`).join(',')}) VALUES (${t.columns.map(() => '?').join(',')})`;
    const st = db.prepare(sql);
    for (const row of tables[name] ?? []) st.run(...(encodeRowForSqlite(t, row) as never[]));
  }
});

test('round-trip SQLite: baris keluar persis sama dengan yang masuk (bool, json, bigint)', () => {
  const { tables } = buildSample();
  const db = openDb();
  for (const t of TABLES) {
    const st = db.prepare(`INSERT INTO "${t.name}" (${t.columns.map((c) => `"${c.name}"`).join(',')}) VALUES (${t.columns.map(() => '?').join(',')})`);
    for (const row of tables[t.name] ?? []) st.run(...(encodeRowForSqlite(t, row) as never[]));
  }
  for (const t of TABLES) {
    const back = (db.prepare(`SELECT * FROM "${t.name}" ORDER BY id`).all() as Record<string, unknown>[]).map((r) => decodeRowFromSqlite(t, r));
    const orig = [...(tables[t.name] ?? [])].sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : 1));
    assert.deepEqual(back, orig, `tabel ${t.name}`);
  }
});

test('SQLite menolak data yang melanggar aturan (constraint)', () => {
  const { tables } = buildSample();
  const db = openDb();
  const ins = (name: string, row: Row) => {
    const t = TABLES.find((x) => x.name === name)!;
    db.prepare(`INSERT INTO "${name}" (${t.columns.map((c) => `"${c.name}"`).join(',')}) VALUES (${t.columns.map(() => '?').join(',')})`).run(...(encodeRowForSqlite(t, row) as never[]));
  };
  for (const name of ['businesses', 'members', 'attachments', 'product_categories', 'products', 'product_variants']) for (const r of tables[name]!) ins(name, r);

  const v = tables.product_variants![0]!;
  assert.throws(() => ins('product_variants', { ...v, id: 'x'.padEnd(36, '0'), sell_price: -1 }), /constraint/i, 'harga negatif');
  assert.throws(() => ins('product_variants', { ...v, id: '00000000-0000-7000-8000-000000000001' }), /UNIQUE/i, 'SKU kembar saat aktif');
  assert.throws(() => ins('product_variants', { ...v, id: '00000000-0000-7000-8000-000000000002', sku: 'baru', barcode: 'baru', product_id: '00000000-0000-7000-8000-0000000000ff' }), /FOREIGN KEY/i);
  // SKU yang sama boleh dipakai lagi jika baris lama sudah di-soft-delete
  db.prepare('UPDATE product_variants SET deleted_at = ? WHERE id = ?').run('2026-10-02T00:00:00.000Z', v.id as string);
  assert.doesNotThrow(() => ins('product_variants', { ...v, id: '00000000-0000-7000-8000-000000000003' }));
});

test('validator: menangkap berbagai kerusakan data', () => {
  const base = buildSample().tables;
  const bad = (mut: (t: typeof base) => void, expectMsg: RegExp) => {
    const t = clone(base);
    mut(t);
    const issues = validateTables(t);
    assert.ok(issues.some((i) => expectMsg.test(`${i.table}.${i.column ?? ''}: ${i.message}`)), `harusnya terdeteksi ${expectMsg}; dapat: ${JSON.stringify(issues.slice(0, 3))}`);
  };
  bad((t) => { t.sales![0]!.status = 'lunas?'; }, /sales\.status: nilai harus/);
  bad((t) => { delete t.sales![0]!.total; }, /sales\.total: kolom wajib/);
  bad((t) => { t.sales![0]!.total = 10.5; }, /sales\.total: harus bilangan bulat/);
  bad((t) => { t.transactions![0]!.amount = 0; }, /transactions\.amount: minimal 1/);
  bad((t) => { t.transactions![0]!.occurred_on = '2026-02-31'; }, /occurred_on: harus tanggal/);
  bad((t) => { t.transactions![0]!.wallet_id = '00000000-0000-7000-8000-000000000999'; }, /wallet_id: merujuk wallets/);
  bad((t) => { t.sales![0]!.business_id = '00000000-0000-7000-8000-000000000999'; }, /business_id: business_id tidak sama/);
  bad((t) => { t.suppliers!.push({ ...t.suppliers![0]! }); }, /id: id duplikat/);
  bad((t) => { t.suppliers![0]!.hacker = 1; }, /hacker: kolom tidak dikenal/);
  bad((t) => { (t as Record<string, unknown>).users = []; }, /users.*: tabel tidak dikenal/);
  bad((t) => { t.businesses!.push({ ...t.businesses![0]!, id: '00000000-0000-7000-8000-000000000998' }); }, /tepat 1 baris bisnis/);
  bad((t) => { t.budgets![0]!.month = 13; }, /budgets\.month: maksimal 12/);
  bad((t) => { t.members![0]!.can_delete = 'ya'; }, /can_delete: harus true\/false/);
  bad((t) => { t.audit_log![0]!.occurred_at = '2026-10-01 08:00:00'; }, /occurred_at: harus ISO-8601/);
});
