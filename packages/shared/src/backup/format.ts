import { isUuid } from '../ids';
import { MIN_BACKUP_PASSWORD_LENGTH, normalizePassword } from '../password';
import type { Row } from '../schema/rows';
import { SCHEMA_VERSION } from '../schema/tables';
import { validateTables, type TableData } from '../schema/validate';
import { toHex, utf8Decode, utf8Encode } from '../utf8';
import { BackupError } from './errors';
import { migrateTables } from './migrations';
import type { BackupRuntime, ScryptParams } from './runtime';

/*
 * FORMAT FILE .ficoim  (v1) — lihat bagian "Format backup" di README.md
 *
 *  offset  panjang  isi
 *  0       6        magic "FICOIM"
 *  6       1        versi format (=1)
 *  7       1        id KDF (1 = scrypt)
 *  8       1        logN   9: r   10: p
 *  11      1        cadangan (harus 0)
 *  12      16       salt acak
 *  28      12       nonce AES-GCM acak
 *  40      …        AES-256-GCM(ciphertext || tag 16 byte)  — AAD = 40 byte header di atas
 *
 *  plaintext = u32BE(panjang meta) || gzip(JSON manifest) || blob_1 || blob_2 || …
 */

export const BACKUP_FILE_EXTENSION = '.ficoim';
export const BACKUP_FORMAT_VERSION = 1;
export const HEADER_LENGTH = 40;
const MAGIC = Uint8Array.from([0x46, 0x49, 0x43, 0x4f, 0x49, 0x4d]); // "FICOIM"
const KDF_SCRYPT = 1;
const SALT_LEN = 16;
const NONCE_LEN = 12;
const TAG_LEN = 16;

export const DEFAULT_KDF: ScryptParams = { logN: 15, r: 8, p: 1 }; // ±32 MiB memori
export const LIMITS = {
  maxFileBytes: 512 * 1024 * 1024,
  maxMetaJsonBytes: 256 * 1024 * 1024,
  maxBlobs: 20_000,
  kdfLogN: [14, 17] as const,
  kdfMaxMemoryBytes: 256 * 1024 * 1024,
} as const;

export interface BackupBlob { id: string; mime: string; data: Uint8Array }
export interface BackupSource { platform: 'web' | 'mobile' | 'server'; appVersion: string }
export interface BlobMeta { id: string; mime: string; size: number; sha256: string }

export interface BackupManifest {
  format: 'ficoim-backup';
  formatVersion: number;
  schemaVersion: number;
  createdAt: string;
  source: BackupSource;
  business: { id: string; name: string };
  counts: Record<string, number>;
  blobs: BlobMeta[];
  tables: TableData;
}

export interface CreateBackupInput {
  tables: TableData;
  blobs?: BackupBlob[];
  password: string;
  source: BackupSource;
  now?: Date;
  kdf?: ScryptParams;
  onProgress?: (p: number) => void;
}

export interface OpenedBackup { manifest: BackupManifest; tables: TableData; blobs: BackupBlob[] }

export interface BackupHeader {
  formatVersion: number;
  kdf: ScryptParams;
  salt: Uint8Array;
  nonce: Uint8Array;
  headerBytes: Uint8Array;
}

// ---------- util ----------
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function assertKdf(k: ScryptParams): void {
  const [lo, hi] = LIMITS.kdfLogN;
  const ok =
    Number.isInteger(k.logN) && k.logN >= lo && k.logN <= hi &&
    Number.isInteger(k.r) && k.r >= 1 && k.r <= 16 &&
    Number.isInteger(k.p) && k.p >= 1 && k.p <= 4 &&
    128 * 2 ** k.logN * k.r <= LIMITS.kdfMaxMemoryBytes;
  if (!ok) throw new BackupError('INVALID_KDF_PARAMS', 'Parameter derivasi kunci pada file di luar batas aman.');
}

// ---------- header ----------
export function inspectBackupHeader(bytes: Uint8Array): BackupHeader {
  if (bytes.length < HEADER_LENGTH + TAG_LEN) throw new BackupError('NOT_A_BACKUP', 'Berkas ini bukan backup FICOIM.');
  for (let i = 0; i < MAGIC.length; i++)
    if (bytes[i] !== MAGIC[i]) throw new BackupError('NOT_A_BACKUP', 'Berkas ini bukan backup FICOIM.');
  const version = bytes[6] as number;
  if (version !== BACKUP_FORMAT_VERSION)
    throw new BackupError('UNSUPPORTED_FORMAT', 'Versi format backup tidak didukung. Perbarui aplikasi FICOIM.');
  if (bytes[7] !== KDF_SCRYPT || bytes[11] !== 0)
    throw new BackupError('UNSUPPORTED_FORMAT', 'Backup memakai opsi yang belum didukung aplikasi ini.');
  const kdf = { logN: bytes[8] as number, r: bytes[9] as number, p: bytes[10] as number };
  assertKdf(kdf);
  return {
    formatVersion: version,
    kdf,
    salt: bytes.slice(12, 12 + SALT_LEN),
    nonce: bytes.slice(28, 28 + NONCE_LEN),
    headerBytes: bytes.slice(0, HEADER_LENGTH),
  };
}

// ---------- ekspor: buang data yang spesifik perangkat/akun ----------
function sanitizeForExport(tables: TableData): TableData {
  const out: TableData = {};
  for (const [name, rows] of Object.entries(tables))
    out[name] = Array.isArray(rows) ? rows.map((r): Row => ({ ...r })) : rows;
  for (const r of out.members ?? []) if (r && typeof r === 'object') r.user_id = null; // tautan akun login tidak ikut
  for (const r of out.attachments ?? []) if (r && typeof r === 'object') r.storage_key = null; // lokasi file lokal tidak ikut
  return out;
}

// ---------- buat backup ----------
export async function createBackup(input: CreateBackupInput, rt: BackupRuntime): Promise<Uint8Array> {
  const password = normalizePassword(input.password);
  if (password.length < MIN_BACKUP_PASSWORD_LENGTH)
    throw new BackupError('WEAK_PASSWORD', `Kata sandi backup minimal ${MIN_BACKUP_PASSWORD_LENGTH} karakter.`);
  const kdf = input.kdf ?? DEFAULT_KDF;
  assertKdf(kdf);

  const tables = sanitizeForExport(input.tables);
  const issues = validateTables(tables);
  if (issues.length) throw new BackupError('INVALID_CONTENT', 'Data tidak valid untuk di-backup.', issues);

  const blobsIn = input.blobs ?? [];
  if (blobsIn.length > LIMITS.maxBlobs) throw new BackupError('LIMIT_EXCEEDED', 'Terlalu banyak berkas lampiran.');
  const seen = new Set<string>();
  const blobMeta: BlobMeta[] = [];
  for (const b of blobsIn) {
    if (!isUuid(b.id) || seen.has(b.id)) throw new BackupError('INVALID_CONTENT', 'ID lampiran tidak valid atau duplikat.');
    seen.add(b.id);
    blobMeta.push({ id: b.id, mime: b.mime, size: b.data.length, sha256: toHex(await rt.sha256(b.data)) });
  }

  const biz = (tables.businesses as Row[])[0] as Row;
  const manifest: BackupManifest = {
    format: 'ficoim-backup',
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    createdAt: (input.now ?? new Date()).toISOString(),
    source: input.source,
    business: { id: biz.id as string, name: biz.name as string },
    counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
    blobs: blobMeta,
    tables,
  };

  const metaGz = await rt.gzip(utf8Encode(JSON.stringify(manifest)));
  if (metaGz.length > LIMITS.maxMetaJsonBytes) throw new BackupError('LIMIT_EXCEEDED', 'Data terlalu besar untuk satu backup.');
  const lenBytes = new Uint8Array(4);
  new DataView(lenBytes.buffer).setUint32(0, metaGz.length, false);
  const plain = concat(lenBytes, metaGz, ...blobsIn.map((b) => b.data));
  if (plain.length + HEADER_LENGTH + TAG_LEN > LIMITS.maxFileBytes)
    throw new BackupError('LIMIT_EXCEEDED', 'Ukuran backup melebihi batas 512 MB. Kurangi foto lampiran.');

  const salt = rt.randomBytes(SALT_LEN);
  const nonce = rt.randomBytes(NONCE_LEN);
  const header = new Uint8Array(HEADER_LENGTH);
  header.set(MAGIC, 0);
  header[6] = BACKUP_FORMAT_VERSION;
  header[7] = KDF_SCRYPT;
  header[8] = kdf.logN; header[9] = kdf.r; header[10] = kdf.p; header[11] = 0;
  header.set(salt, 12);
  header.set(nonce, 28);

  const key = await rt.scrypt(utf8Encode(password), salt, kdf, input.onProgress);
  try {
    const ct = await rt.aesGcmEncrypt(key, nonce, header, plain);
    return concat(header, ct);
  } finally {
    key.fill(0);
  }
}

// ---------- buka backup ----------
export async function openBackup(
  bytes: Uint8Array,
  password: string,
  rt: BackupRuntime,
  opts: { onProgress?: (p: number) => void } = {},
): Promise<OpenedBackup> {
  if (bytes.length > LIMITS.maxFileBytes) throw new BackupError('LIMIT_EXCEEDED', 'Berkas terlalu besar.');
  const h = inspectBackupHeader(bytes);

  const key = await rt.scrypt(utf8Encode(normalizePassword(password)), h.salt, h.kdf, opts.onProgress);
  let plain: Uint8Array;
  try {
    plain = await rt.aesGcmDecrypt(key, h.nonce, h.headerBytes, bytes.subarray(HEADER_LENGTH));
  } catch {
    throw new BackupError('WRONG_PASSWORD_OR_CORRUPT', 'Kata sandi salah, atau berkas backup rusak/telah diubah.');
  } finally {
    key.fill(0);
  }

  if (plain.length < 4) throw new BackupError('INVALID_CONTENT', 'Isi backup tidak lengkap.');
  const metaLen = new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getUint32(0, false);
  if (4 + metaLen > plain.length) throw new BackupError('INVALID_CONTENT', 'Isi backup tidak lengkap.');

  let manifest: BackupManifest;
  try {
    const json = await rt.gunzip(plain.subarray(4, 4 + metaLen), LIMITS.maxMetaJsonBytes);
    manifest = JSON.parse(utf8Decode(json)) as BackupManifest;
  } catch {
    throw new BackupError('INVALID_CONTENT', 'Isi backup tidak dapat dibaca.');
  }

  if (
    !manifest || manifest.format !== 'ficoim-backup' || manifest.formatVersion !== h.formatVersion ||
    typeof manifest.schemaVersion !== 'number' || !manifest.tables || typeof manifest.tables !== 'object' ||
    !Array.isArray(manifest.blobs)
  ) throw new BackupError('INVALID_CONTENT', 'Struktur manifest backup tidak valid.');

  const tables = migrateTables(manifest.tables, manifest.schemaVersion);

  // blob
  if (manifest.blobs.length > LIMITS.maxBlobs) throw new BackupError('LIMIT_EXCEEDED', 'Terlalu banyak berkas lampiran.');
  let offset = 4 + metaLen;
  const blobs: BackupBlob[] = [];
  const seen = new Set<string>();
  for (const m of manifest.blobs) {
    if (!m || !isUuid(m.id) || seen.has(m.id) || !Number.isSafeInteger(m.size) || m.size < 0 || typeof m.sha256 !== 'string')
      throw new BackupError('INVALID_CONTENT', 'Daftar lampiran pada backup tidak valid.');
    seen.add(m.id);
    if (offset + m.size > plain.length) throw new BackupError('INVALID_CONTENT', 'Data lampiran terpotong.');
    const data = plain.subarray(offset, offset + m.size);
    offset += m.size;
    if (toHex(await rt.sha256(data)) !== m.sha256)
      throw new BackupError('INVALID_CONTENT', 'Checksum lampiran tidak cocok; backup rusak.');
    blobs.push({ id: m.id, mime: String(m.mime), data });
  }
  if (offset !== plain.length) throw new BackupError('INVALID_CONTENT', 'Terdapat data berlebih pada backup.');

  const issues = validateTables(tables);
  if (issues.length) throw new BackupError('INVALID_CONTENT', 'Isi backup melanggar aturan data.', issues);

  return { manifest, tables, blobs };
}

// ---------- bantuan UI ----------
export function suggestBackupFileName(businessName: string, now: Date = new Date()): string {
  const slug = businessName.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/\s+/g, '-').slice(0, 30) || 'bisnis';
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `ficoim-${slug}-${stamp}${BACKUP_FILE_EXTENSION}`;
}

export interface BackupSummary {
  businessName: string; createdAt: string; platform: string; appVersion: string;
  products: number; sales: number; purchases: number; transactions: number; assets: number; attachments: number;
  attachmentBytes: number;
}

/** Ringkasan untuk layar "Pratinjau sebelum restore". */
export function summarizeBackup(b: OpenedBackup): BackupSummary {
  const c = b.manifest.counts;
  return {
    businessName: b.manifest.business.name, createdAt: b.manifest.createdAt,
    platform: b.manifest.source.platform, appVersion: b.manifest.source.appVersion,
    products: c.products ?? 0, sales: c.sales ?? 0, purchases: c.purchases ?? 0,
    transactions: c.transactions ?? 0, assets: c.assets ?? 0, attachments: b.blobs.length,
    attachmentBytes: b.blobs.reduce((n, x) => n + x.data.length, 0),
  };
}
