/**
 * Menghasilkan database/postgres/001_core.sql dan database/sqlite/001_core.sql dari tables.ts.
 *   tsx packages/shared/scripts/gen-sql.ts          -> tulis file
 *   tsx packages/shared/scripts/gen-sql.ts --check  -> gagal (exit 1) bila file di repo sudah basi
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_VERSION, TABLES } from '../src/schema/tables';
import { generateSql } from '../src/schema/sql';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const targets = [
  { path: resolve(root, 'database/postgres/001_core.sql'), d: 'postgres' as const },
  { path: resolve(root, 'database/sqlite/001_core.sql'), d: 'sqlite' as const },
];
const tsPath = resolve(root, 'packages/shared/src/schema/sqlite-ddl.generated.ts');
const tsBody = (sql: string) =>
  `// GENERATED FILE — JANGAN DIEDIT TANGAN. Sumber: tables.ts | Regenerasi: npm run gen:sql\n` +
  `// DDL SQLite sebagai string agar ikut terbundel di aplikasi mobile (Metro tidak mengimpor berkas .sql).\n` +
  `export const SQLITE_DDL: string = ${JSON.stringify(sql)};\n`;
const check = process.argv.includes('--check');
let stale = false;
for (const t of targets) {
  const sql = generateSql(TABLES, t.d, SCHEMA_VERSION);
  if (check) {
    if (!existsSync(t.path) || readFileSync(t.path, 'utf8') !== sql) { console.error(`BASI: ${t.path}`); stale = true; }
  } else {
    mkdirSync(dirname(t.path), { recursive: true });
    writeFileSync(t.path, sql);
    console.log(`ditulis: ${t.path}`);
  }
}
{
  const sql = generateSql(TABLES, 'sqlite', SCHEMA_VERSION);
  if (check) { if (!existsSync(tsPath) || readFileSync(tsPath, 'utf8') !== tsBody(sql)) { console.error(`BASI: ${tsPath}`); stale = true; } }
  else { writeFileSync(tsPath, tsBody(sql)); console.log(`ditulis: ${tsPath}`); }
}
if (stale) { console.error('Jalankan: npm run gen:sql'); process.exit(1); }
