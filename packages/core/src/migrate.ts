import { SCHEMA_VERSION, SQLITE_DDL } from '@ficoim/shared';
import type { Db } from './db';
import { DomainError } from './errors';

/**
 * Menyiapkan database SQLite perangkat (HP): membuat skema bila kosong, menolak database dari versi aplikasi yang lebih baru.
 * Dipanggil SEKALI setelah membuka database (dan setelah `PRAGMA foreign_keys = ON`).
 * Migrasi antar-versi skema ditambahkan di sini bersamaan dengan kenaikan SCHEMA_VERSION.
 */
export async function ensureSqliteSchema(db: Db): Promise<{ created: boolean; version: number }> {
  if (db.dialect !== 'sqlite' || !db.exec) throw new Error('ensureSqliteSchema hanya untuk adapter SQLite.');
  const version = Number((await db.all('PRAGMA user_version'))[0]?.user_version ?? 0);
  if (version === SCHEMA_VERSION) return { created: false, version };
  if (version > SCHEMA_VERSION) throw new DomainError('INVALID_STATE', 'Data di perangkat ini dibuat oleh versi FICOIM yang lebih baru. Perbarui aplikasi.');
  if (version !== 0) throw new DomainError('INVALID_STATE', `Tidak ada jalur migrasi dari skema v${version}.`);
  if ((await db.all(`SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'businesses'`)).length)
    throw new DomainError('INVALID_STATE', 'Database tidak dikenali (tabel ada tetapi versi skema 0).');
  const exec = db.exec.bind(db);
  await db.transaction(async () => { await exec(SQLITE_DDL); }); // DDL + PRAGMA user_version dalam satu transaksi: gagal = tidak ada yang terbentuk
  return { created: true, version: SCHEMA_VERSION };
}
