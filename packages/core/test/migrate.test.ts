import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_VERSION, SQLITE_DDL, TABLES } from '@ficoim/shared';
import { ensureSqliteSchema } from '../src/index';
import { sqliteNodeDb } from '../src/adapters/sqlite-node';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fresh = () => { const h = new DatabaseSync(':memory:'); h.exec('PRAGMA foreign_keys = ON'); return { h, db: sqliteNodeDb(h) }; };

test('DDL yang dibungkus di aplikasi mobile sama persis dengan berkas database/sqlite/001_core.sql', () => {
  assert.equal(SQLITE_DDL, readFileSync(resolve(root, 'database/sqlite/001_core.sql'), 'utf8'));
});

test('ensureSqliteSchema: membuat skema lengkap saat pertama, idempoten setelahnya', async () => {
  const { h, db } = fresh();
  assert.deepEqual(await ensureSqliteSchema(db), { created: true, version: SCHEMA_VERSION });
  assert.equal((h.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type = 'table'").get() as { c: number }).c, TABLES.length);
  assert.deepEqual(await ensureSqliteSchema(db), { created: false, version: SCHEMA_VERSION });
  assert.equal((h.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys, 1);
});

test('ensureSqliteSchema: menolak database versi lebih baru, jalur migrasi hilang, dan database setengah jadi', async () => {
  let f = fresh(); f.h.exec('PRAGMA user_version = 999');
  await assert.rejects(ensureSqliteSchema(f.db), /versi FICOIM yang lebih baru/);
  f = fresh(); f.h.exec('PRAGMA user_version = 0'); f.h.exec('CREATE TABLE businesses (id TEXT)');
  await assert.rejects(ensureSqliteSchema(f.db), /tidak dikenali/);
  assert.throws(() => f.h.prepare('SELECT 1 FROM members').get()); // tidak ada tabel lain yang terbentuk
});

test('ensureSqliteSchema: kegagalan di tengah DDL membatalkan semuanya (transaksi)', async () => {
  const { h, db } = fresh();
  h.exec('CREATE TABLE members (x)'); // bentrok dengan DDL -> gagal di tengah
  await assert.rejects(ensureSqliteSchema(db));
  const names = (h.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
  assert.deepEqual(names, ['members']); // tabel sebelum "members" ikut dibatalkan
  assert.equal((h.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 0);
});
