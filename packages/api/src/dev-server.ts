/**
 * Server DEV: SQLite berkas tunggal, tanpa PostgreSQL. Data bertahan antar restart (folder ./data).
 * HANYA untuk pengembangan & mencoba API di satu mesin — produksi memakai server.ts (PostgreSQL + RLS + Argon2id).
 *
 *   npm run dev:api            -> http://127.0.0.1:8787/api/health
 */
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sqliteNodeDb } from '@ficoim/core/adapters/sqlite-node';
import { nodeRuntime } from '@ficoim/shared/backup/runtime-node';
import { AuthService, createApi, createHttpServer, dbAuthStore, fileBlobStore } from './index';

const here = dirname(fileURLToPath(import.meta.url));
const sqlDir = resolve(here, '../../../database/sqlite');
const dataDir = resolve(process.env.FICOIM_DATA ?? 'data');
mkdirSync(resolve(dataDir, 'safety'), { recursive: true });

// Rahasia dev dibuat sekali lalu disimpan (mode 0600) agar token & 2FA tetap berlaku setelah restart.
const secretsPath = resolve(dataDir, 'dev-secrets.json');
if (!existsSync(secretsPath)) writeFileSync(secretsPath, JSON.stringify({ tokenSecret: randomBytes(48).toString('base64'), totpKey: randomBytes(32).toString('base64') }), { mode: 0o600 });
const secrets = JSON.parse(readFileSync(secretsPath, 'utf8')) as { tokenSecret: string; totpKey: string };

const handle = new DatabaseSync(resolve(dataDir, 'ficoim-dev.db'));
handle.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
if (!handle.prepare("SELECT 1 FROM sqlite_master WHERE name = 'businesses'").get()) {
  handle.exec(readFileSync(resolve(sqlDir, '001_core.sql'), 'utf8'));
  handle.exec(readFileSync(resolve(sqlDir, '002_server_auth.sql'), 'utf8'));
  console.log('Database baru dibuat.');
}
const db = sqliteNodeDb(handle);

const api = createApi({
  auth: new AuthService({ store: dbAuthStore(db), tenancy: { run: (_b, fn) => fn(db) }, tokenSecret: Buffer.from(secrets.tokenSecret, 'base64'), totpKey: Buffer.from(secrets.totpKey, 'base64') }),
  tenancy: { run: (_b, fn) => fn(db) },
  runtime: nodeRuntime,
  blobStore: fileBlobStore(resolve(dataDir, 'attachments')),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:8081').split(',').map((s) => s.trim()).filter(Boolean),
  appVersion: '0.1.0-dev', secureCookies: false,
  safetyBackupSink: async (biz, name, bytes) => { writeFileSync(resolve(dataDir, 'safety', `${biz}-${name}`), bytes, { mode: 0o600 }); },
  onError: (e) => console.error('[error]', e instanceof Error ? e.stack : e),
});

const port = Number(process.env.PORT ?? 8787);
createHttpServer(api).listen(port, '127.0.0.1', () => console.log(`FICOIM dev API: http://127.0.0.1:${port}/api/health  (data: ${dataDir})`));
