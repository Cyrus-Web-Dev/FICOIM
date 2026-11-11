/**
 * Server PRODUKSI: PostgreSQL (dengan Row-Level Security) + Argon2id.
 * STATUS: belum dijalankan terhadap PostgreSQL asli (tidak tersedia di lingkungan pengembangan). Logika yang dipakainya
 * (core, auth, router) sudah diuji di SQLite; yang baru teruji saat kamu menjalankannya: adapter pg, DDL PostgreSQL, RLS, Argon2.
 *
 * Variabel lingkungan (lihat .env.example):
 *   DATABASE_URL   koneksi PostgreSQL dengan role aplikasi (BUKAN superuser, tanpa BYPASSRLS)
 *   TOKEN_SECRET   base64, >= 32 byte        TOTP_KEY   base64, tepat 32 byte
 *   ALLOWED_ORIGINS  daftar origin web dipisah koma (mis. https://app.contoh.id)
 *   SAFETY_DIR     folder backup pengaman      ATTACHMENTS_DIR  folder foto/nota (WAJIB disertakan dalam pencadangan server)      PORT / TRUST_PROXY=1 / INSECURE_COOKIES=1 (hanya untuk uji lokal tanpa HTTPS)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { installPgTypeParsers, pgPoolDb, withBusiness } from '@ficoim/core/adapters/pg';
import { nodeRuntime } from '@ficoim/shared/backup/runtime-node';
import { AuthService, createApi, createHttpServer, dbAuthStore, fileBlobStore } from './index';
import { argon2Hasher } from './argon2-hasher';

function env(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`Variabel lingkungan ${name} wajib diisi.`); process.exit(1); }
  return v;
}
const tokenSecret = Buffer.from(env('TOKEN_SECRET'), 'base64');
const totpKey = Buffer.from(env('TOTP_KEY'), 'base64');
if (tokenSecret.length < 32) { console.error('TOKEN_SECRET harus base64 dari minimal 32 byte.'); process.exit(1); }
if (totpKey.length !== 32) { console.error('TOTP_KEY harus base64 dari tepat 32 byte.'); process.exit(1); }

installPgTypeParsers(pg.types);
const pool = new pg.Pool({ connectionString: env('DATABASE_URL'), max: Number(process.env.PG_POOL_MAX ?? 10) });
const safetyDir = resolve(process.env.SAFETY_DIR ?? 'data/safety');
const attachDir = resolve(process.env.ATTACHMENTS_DIR ?? 'data/attachments');
mkdirSync(safetyDir, { recursive: true });

const tenancy = { run: <T>(businessId: string, fn: Parameters<typeof withBusiness<T>>[2]) => withBusiness(pool, businessId, fn) };
const api = createApi({
  auth: new AuthService({ store: dbAuthStore(pgPoolDb(pool)), tenancy, tokenSecret, totpKey, hasher: await argon2Hasher() }),
  tenancy, runtime: nodeRuntime, blobStore: fileBlobStore(attachDir),
  allowedOrigins: env('ALLOWED_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean),
  appVersion: process.env.APP_VERSION ?? '0.1.0', secureCookies: process.env.INSECURE_COOKIES !== '1',
  safetyBackupSink: async (biz, name, bytes) => { writeFileSync(resolve(safetyDir, `${biz}-${name}`), bytes, { mode: 0o600 }); },
  onError: (e) => console.error('[error]', e instanceof Error ? e.stack : e),
});

const port = Number(process.env.PORT ?? 8787);
createHttpServer(api, { trustProxy: process.env.TRUST_PROXY === '1' }).listen(port, () => console.log(`FICOIM API di port ${port}`));
