import { SCHEMA_VERSION } from '../schema/tables';
import type { TableData } from '../schema/validate';
import { BackupError } from './errors';

/**
 * Migrasi isi backup antar versi skema: migrations[n] mengubah data skema n -> n+1.
 * Saat SCHEMA_VERSION dinaikkan, TAMBAHKAN fungsi di sini; backup lama harus tetap bisa dipulihkan.
 * Contoh nanti:  migrations[1] = (t) => { for (const r of t.products ?? []) r.new_col = null; return t; };
 */
export const migrations: Record<number, (tables: TableData) => TableData> = {};

export function migrateTables(tables: TableData, fromVersion: number, toVersion = SCHEMA_VERSION): TableData {
  if (!Number.isInteger(fromVersion) || fromVersion < 1)
    throw new BackupError('INVALID_CONTENT', 'schemaVersion pada backup tidak valid.');
  if (fromVersion > toVersion)
    throw new BackupError('SCHEMA_TOO_NEW', 'Backup ini dibuat oleh versi FICOIM yang lebih baru. Perbarui aplikasi lalu coba lagi.');
  let cur = tables;
  for (let v = fromVersion; v < toVersion; v++) {
    const step = migrations[v];
    if (!step) throw new BackupError('UNSUPPORTED_FORMAT', `Tidak ada jalur migrasi dari skema v${v}.`);
    cur = step(cur);
  }
  return cur;
}
