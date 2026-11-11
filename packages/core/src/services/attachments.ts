import { toHex, type BackupRuntime } from '@ficoim/shared';
import { getRow, insertRow, updateRow } from '../db';
import { DomainError, notFound, validation } from '../errors';
import { nowIso, stdRow, withTx, type Ctx } from '../ctx';
import { can } from '../permissions';
import { audit } from './audit';
import type { BlobStore } from './backup';

/**
 * Lampiran gambar: foto produk, foto aset, foto nota/struk belanja.
 *  - Jenis berkas ditentukan dari ISI (magic bytes), bukan dari nama/mime kiriman klien: JPEG, PNG, WebP saja.
 *  - Batas ukuran 1,5 MB per gambar. Klien WAJIB mengecilkan foto sebelum unggah (web: canvas, HP: pengubah ukuran) —
 *    format backup v1 mengenkripsi di memori, jadi foto besar membuat backup berat (lihat README).
 *  - Byte disimpan lewat BlobStore (disk server / sistem berkas HP); metadata di tabel `attachments`.
 */
export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMime = (typeof IMAGE_MIMES)[number];
export const MAX_IMAGE_BYTES = 1_500_000;
export const OWNER_TABLES = ['products', 'assets', 'transactions', 'purchases', 'sales', 'businesses'] as const;
export type OwnerTable = (typeof OWNER_TABLES)[number];

const EXT: Record<ImageMime, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const imageExtension = (mime: string): string => EXT[mime as ImageMime] ?? 'bin';

const ascii = (b: Uint8Array, from: number, to: number): string => String.fromCharCode(...b.subarray(from, to));

/** Mengenali gambar dari byte awalnya; null bila bukan JPEG/PNG/WebP. */
export function sniffImageMime(b: Uint8Array): ImageMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 4) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const cleanName = (n: unknown): string => {
  const base = typeof n === 'string' ? (n.split(/[\\/]/).pop() ?? '') : '';
  // karakter kontrol & pemisah jalur dibuang; nama hanya label tampilan (berkas disimpan dengan id)
  const s = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').trim().slice(0, 120);
  return s || 'foto';
};

/** Siapa yang boleh mengunggah: yang berhak mengubah produk/aset/keuangan atau membuat pembelian. Kasir (staf) tidak. */
export function canAttach(ctx: Ctx): boolean {
  return can(ctx.actor, 'product.write') || can(ctx.actor, 'finance.write') || can(ctx.actor, 'asset.write') || can(ctx.actor, 'purchase.create');
}

export interface SavedImage { id: string; mime: ImageMime; sizeBytes: number; fileName: string }

export async function saveImage(
  ctx: Ctx, deps: { blobStore: BlobStore; runtime: Pick<BackupRuntime, 'sha256'> }, input: { fileName?: string; bytes: Uint8Array },
): Promise<SavedImage> {
  if (!canAttach(ctx)) throw new DomainError('FORBIDDEN', 'Peran Anda tidak diizinkan mengunggah gambar.', { action: 'attachment.write' });
  if (!(input.bytes instanceof Uint8Array) || input.bytes.length === 0) throw validation('Berkas gambar kosong.');
  if (input.bytes.length > MAX_IMAGE_BYTES) throw validation(`Gambar terlalu besar (maksimal ${(MAX_IMAGE_BYTES / 1_000_000).toFixed(1)} MB). Perkecil dulu.`);
  const mime = sniffImageMime(input.bytes);
  if (!mime) throw validation('Berkas bukan gambar yang didukung. Pakai JPEG, PNG, atau WebP.');
  const fileName = cleanName(input.fileName);
  const sha256 = toHex(await deps.runtime.sha256(input.bytes));
  const id = ctx.newId();
  const storageKey = await deps.blobStore.write(id, mime, input.bytes);
  await withTx(ctx, async (c) => {
    await insertRow(c.db, 'attachments', stdRow(c, {
      id, owner_table: null, owner_id: null, file_name: fileName, mime, size_bytes: input.bytes.length, sha256, storage_key: storageKey,
    }));
    await audit(c, 'create', 'attachments', id, { mime, size: input.bytes.length });
  });
  return { id, mime, sizeBytes: input.bytes.length, fileName };
}

export async function readImage(ctx: Ctx, blobStore: BlobStore, id: string): Promise<{ bytes: Uint8Array; mime: string; fileName: string }> {
  const row = await getRow(ctx.db, 'attachments', ctx.businessId, id);
  if (!row) throw notFound('Lampiran');
  const bytes = await blobStore.read(row);
  if (!bytes) throw notFound('Berkas lampiran');
  // Jenis selalu dari ISI: backup berkata sandi yang dibuat pihak lain tidak boleh membuat server menyajikan HTML/SVG sebagai "gambar".
  const mime = sniffImageMime(bytes);
  if (!mime) throw notFound('Berkas lampiran');
  return { bytes, mime, fileName: String(row.file_name) };
}

/**
 * Menautkan lampiran ke pemiliknya (dipanggil DI DALAM transaksi pemanggil). Lampiran harus ada di bisnis ini, belum
 * dipakai pemilik lain, dan bertipe gambar. Mengembalikan id yang sama.
 */
export async function claimAttachment(ctx: Ctx, id: string, ownerTable: OwnerTable, ownerId: string): Promise<string> {
  const a = await getRow(ctx.db, 'attachments', ctx.businessId, id);
  if (!a) throw notFound('Lampiran');
  if (!IMAGE_MIMES.includes(String(a.mime) as ImageMime)) throw validation('Lampiran bukan gambar.');
  const sameOwner = a.owner_table === ownerTable && a.owner_id === ownerId;
  if ((a.owner_table || a.owner_id) && !sameOwner) throw new DomainError('CONFLICT', 'Lampiran ini sudah dipakai di data lain.');
  if (!sameOwner) await updateRow(ctx.db, 'attachments', ctx.businessId, id, { owner_table: ownerTable, owner_id: ownerId, updated_at: nowIso(ctx) });
  return id;
}

/** Hapus-lunak lampiran (byte di penyimpanan tidak ikut diekspor lagi karena baris sudah ber-deleted_at). */
export async function discardAttachment(ctx: Ctx, id: string | null | undefined): Promise<void> {
  if (!id) return;
  const t = nowIso(ctx);
  await ctx.db.run(`UPDATE "attachments" SET "deleted_at" = ?, "updated_at" = ? WHERE "id" = ? AND "business_id" = ? AND "deleted_at" IS NULL`, [t, t, id, ctx.businessId]);
}

/** Id lampiran (mis. nota) milik satu dokumen; null bila tidak ada. */
export async function attachmentOf(ctx: Ctx, ownerTable: OwnerTable, ownerId: string): Promise<string | null> {
  const rows = await ctx.db.all(
    `SELECT "id" FROM "attachments" WHERE "business_id" = ? AND "owner_table" = ? AND "owner_id" = ? AND "deleted_at" IS NULL ORDER BY "created_at" DESC, "id" DESC LIMIT 1`,
    [ctx.businessId, ownerTable, ownerId]);
  return rows[0] ? String(rows[0].id) : null;
}

/** SQL fragmen: id lampiran milik dokumen alias `alias` pada tabel `ownerTable` (dipakai di daftar). */
export const attachmentSubquery = (ownerTable: OwnerTable, alias: string): string =>
  `(SELECT a."id" FROM "attachments" a WHERE a."owner_table" = '${ownerTable}' AND a."owner_id" = ${alias}."id" AND a."deleted_at" IS NULL ORDER BY a."created_at" DESC, a."id" DESC LIMIT 1)`;
