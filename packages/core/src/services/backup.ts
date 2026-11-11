import {
  TABLES, createBackup, openBackup, uuidv7, type BackupBlob, type BackupRuntime, type Row, type ScryptParams, type TableData, type TableDef,
} from '@ficoim/shared';
import { dbBool, insertRow, selectRows, updateRow, type Db } from '../db';
import { DomainError } from '../errors';
import { nowIso, stdRow, type Actor, type Ctx } from '../ctx';
import { can, requireCan } from '../permissions';
import { audit } from './audit';
import { recomputeAll } from './recompute';

/** Penyimpanan berkas lampiran per platform (sistem file HP, disk/objek server). */
export interface BlobStore {
  read(attachment: Row): Promise<Uint8Array | null>;
  /** Simpan byte lampiran; mengembalikan storage_key yang dicatat di tabel attachments. */
  write(id: string, mime: string, data: Uint8Array): Promise<string>;
}

export function memoryBlobStore(): BlobStore & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async read(a) { return files.get(String(a.storage_key)) ?? null; },
    async write(id, _mime, data) { const k = `mem://${id}`; files.set(k, data); return k; },
  };
}

// ------------------------------------------------------------------ ekspor
export async function exportTables(ctx: Ctx): Promise<TableData> {
  const out: TableData = {};
  for (const t of TABLES)
    out[t.name] = t.scope === 'root'
      ? await selectRows(ctx.db, t.name, '"id" = ?', [ctx.businessId])
      : await selectRows(ctx.db, t.name, '"business_id" = ?', [ctx.businessId], 'ORDER BY "id"');
  return out;
}

export interface ExportOptions {
  password: string; runtime: BackupRuntime; source: { platform: 'web' | 'mobile' | 'server'; appVersion: string };
  blobStore?: BlobStore; kdf?: ScryptParams; onProgress?: (p: number) => void;
}

export async function exportBackup(ctx: Ctx, o: ExportOptions): Promise<Uint8Array> {
  requireCan(ctx, 'backup.export');
  const tables = await exportTables(ctx);
  const blobs: BackupBlob[] = [];
  if (o.blobStore)
    for (const a of tables.attachments ?? []) {
      if (a.deleted_at !== null || !a.storage_key) continue;
      const data = await o.blobStore.read(a);
      if (data) blobs.push({ id: a.id as string, mime: String(a.mime), data });
    }
  return createBackup({ tables, blobs, password: o.password, source: o.source, now: ctx.now(), kdf: o.kdf, onProgress: o.onProgress }, o.runtime);
}

// ------------------------------------------------------------------ restore
export interface RestoreOptions {
  password: string;
  runtime: BackupRuntime;
  /** replace = ganti seluruh data bisnis tujuan; merge = gabungkan (baris terbaru menang). */
  mode: 'replace' | 'merge';
  /**
   * Bisnis tujuan. null/undefined = pakai bisnis yang ada di backup (impor baru bila belum ada di perangkat ini).
   * Bila diisi dan berbeda dari bisnis di backup, seluruh data dipindahkan (business_id ditulis ulang) ke bisnis tujuan.
   */
  targetBusinessId?: string | null;
  /** WAJIB bila bisnis tujuan sudah ada: hanya peran yang berhak (pemilik) yang boleh menimpa/menggabung. */
  actor?: Actor;
  blobStore?: BlobStore;
  /** Dipanggil sebelum data apa pun diubah (buat backup pengaman kondisi saat ini). Jika melempar error, restore dibatalkan. */
  makeSafetyBackup?: () => Promise<void>;
  /**
   * Tulis ulang SEMUA id baris (dan referensinya) dengan UUID baru: memulihkan sebagai SALINAN. Wajib bila backup berasal dari
   * bisnis lain di sistem yang sama (id yang sama tidak boleh ada dua kali). Konsekuensi: salinan tidak lagi bisa
   * digabung dengan sumbernya berdasarkan id. Bawaan false agar penggabungan HP <-> web tetap cocok.
   */
  regenerateIds?: boolean;
  now?: () => Date;
  newId?: () => string;
  onProgress?: (p: number) => void;
}

export interface RestoreReport {
  mode: 'replace' | 'merge'; businessId: string; importedAsNew: boolean;
  inserted: number; updated: number; skipped: number; remapped: number; renumbered: number; blobsWritten: number;
  /**
   * Terisi bila baris anggota milik pelaku (actor) hilang akibat restore (mis. timpa dengan backup dari perangkat lain).
   * Pemanggil WAJIB menautkan ulang akun pelaku ke anggota ini (peran: pemilik), kalau tidak akun tersebut kehilangan akses.
   */
  replacementMemberId: string | null;
}

/** Tabel yang konflik-uniknya berarti "dokumen berbeda dengan nomor sama" (diberi nomor baru), bukan "entitas yang sama". */
const RENUMBER = new Set(['sales', 'purchases']);

function canonical(t: TableDef, row: Row): void {
  for (const c of t.columns) {
    const v = row[c.name];
    if (c.type === 'timestamp' && typeof v === 'string') row[c.name] = new Date(v).toISOString();
  }
}

export async function restoreBackup(db: Db, bytes: Uint8Array, o: RestoreOptions): Promise<RestoreReport> {
  const opened = await openBackup(bytes, o.password, o.runtime, { onProgress: o.onProgress });
  const tables = opened.tables;
  const backupBizId = (tables.businesses?.[0] as Row).id as string;
  const dest = o.targetBusinessId ?? backupBizId;
  const destExists = (await db.all('SELECT "id" FROM "businesses" WHERE "id" = ?', [dest])).length > 0;

  if (destExists) {
    if (!o.actor || !can(o.actor, 'backup.restore'))
      throw new DomainError('FORBIDDEN', 'Hanya pemilik bisnis yang boleh memulihkan backup ke bisnis yang sudah ada.');
  } else if (o.mode === 'replace' && o.targetBusinessId) {
    throw new DomainError('NOT_FOUND', 'Bisnis tujuan tidak ditemukan.');
  }
  if (!destExists && o.targetBusinessId && o.mode === 'merge') throw new DomainError('NOT_FOUND', 'Bisnis tujuan tidak ditemukan.');
  if (o.mode === 'replace' && !o.targetBusinessId && destExists)
    throw new DomainError('CONFLICT', 'Bisnis ini sudah ada di perangkat. Tentukan bisnis tujuan, atau pilih mode Gabung.');

  // Pindahkan ke bisnis tujuan bila berbeda.
  if (dest !== backupBizId)
    for (const t of TABLES)
      for (const r of tables[t.name] ?? []) { if (t.scope === 'root') r.id = dest; else r.business_id = dest; }

  // Salinan baru: id semua baris diganti, referensi (FK & ref_id/owner_id/record_id) mengikuti.
  const fresh = new Map<string, string>();
  if (o.regenerateIds) {
    const gen = o.newId ?? (() => uuidv7());
    for (const t of TABLES) if (t.scope === 'business') for (const r of tables[t.name] ?? []) fresh.set(r.id as string, gen());
    for (const t of TABLES) {
      if (t.scope === 'root') continue;
      const refNames = [...t.columns.filter((c) => c.ref && c.name !== 'business_id').map((c) => c.name), ...['ref_id', 'owner_id', 'record_id'].filter((n) => t.columns.some((c) => c.name === n))];
      for (const r of tables[t.name] ?? []) {
        r.id = fresh.get(r.id as string) as string;
        for (const n of refNames) { const v = r[n]; if (typeof v === 'string' && fresh.has(v)) r[n] = fresh.get(v) as string; }
      }
    }
  }
  for (const t of TABLES) for (const r of tables[t.name] ?? []) canonical(t, r);

  if (destExists && o.makeSafetyBackup) await o.makeSafetyBackup();

  // Lampiran ditulis dulu (di luar transaksi DB); berkas yatim akibat gagal-transaksi tidak merusak data.
  const keys = new Map<string, string>();
  if (o.blobStore)
    for (const b of opened.blobs) { const id = fresh.get(b.id) ?? b.id; keys.set(id, await o.blobStore.write(id, b.mime, b.data)); }

  const now = o.now ?? (() => new Date());
  const report: RestoreReport = { mode: o.mode, businessId: dest, importedAsNew: !destExists, inserted: 0, updated: 0, skipped: 0, remapped: 0, renumbered: 0, blobsWritten: keys.size, replacementMemberId: null };

  try {
  await db.transaction(async (tx) => {
    const ctx: Ctx = {
      db: tx, businessId: dest, now, newId: o.newId ?? (() => uuidv7()), tzOffsetMinutes: 420, allowNegativeStock: true, taxBp: 0,
      actor: o.actor ?? { memberId: null, role: 'owner', canViewReports: true, canDelete: true },
    };

    if (destExists && o.mode === 'replace') {
      if (tx.dialect === 'postgres') await tx.run(`SELECT set_config('app.restore_mode', 'on', true)`);
      for (const t of [...TABLES].reverse()) if (t.scope === 'business') await tx.run(`DELETE FROM "${t.name}" WHERE "business_id" = ?`, [dest]);
      await tx.run(`DELETE FROM "businesses" WHERE "id" = ?`, [dest]);
    }

    const plainInsert = !destExists || o.mode === 'replace';
    const idMap = new Map<string, string>();
    const insertedProducts = new Set<string>();
    for (const t of TABLES) {
      const refCols = [...t.columns.filter((c) => c.ref).map((c) => c.name), ...['ref_id', 'owner_id', 'record_id'].filter((n) => t.columns.some((c) => c.name === n))];
      for (const row of tables[t.name] ?? []) {
        if (t.name === 'attachments') row.storage_key = keys.get(row.id as string) ?? null;
        if (plainInsert) { await insertRow(tx, t.name, row); report.inserted++; continue; }

        for (const n of refCols) { const v = row[n]; if (typeof v === 'string' && idMap.has(v)) row[n] = idMap.get(v) as string; }
        const idWhere = t.scope === 'root' ? '"id" = ?' : '"id" = ? AND "business_id" = ?';
        const idParams = t.scope === 'root' ? [row.id] : [row.id, dest];
        const same = (await selectRows(tx, t.name, idWhere, idParams))[0];
        if (same) {
          // Profil bisnis tujuan (nama, pajak, pengaturan) tidak ditimpa bila backup berasal dari bisnis lain.
          if (t.name === 'businesses' && dest !== backupBizId) { report.skipped++; continue; }
          await lww(tx, t, dest, same, row, keys, report);
          continue;
        }

        let handled = false;
        if (row.deleted_at === null)
          for (const u of t.uniques) {
            const vals = u.cols.map((c) => row[c]);
            if (vals.some((v) => v === null)) continue;
            const hit = (await tx.all(`SELECT "id" FROM "${t.name}" WHERE ${u.cols.map((c) => `"${c}" = ?`).join(' AND ')} AND "deleted_at" IS NULL LIMIT 1`, vals))[0];
            if (!hit) continue;
            if (RENUMBER.has(t.name) && u.cols.includes('number')) {
              const base = String(row.number);
              for (let n = 1; ; n++) {
                const cand = `${base}-M${n}`;
                if (!(await tx.all(`SELECT 1 AS x FROM "${t.name}" WHERE "business_id" = ? AND "number" = ? LIMIT 1`, [dest, cand]))[0]) { row.number = cand; break; }
              }
              report.renumbered++;
            } else {
              const existing = (await selectRows(tx, t.name, idWhere, t.scope === 'root' ? [hit.id] : [hit.id, dest]))[0] as Row;
              idMap.set(row.id as string, String(hit.id));
              report.remapped++;
              await lww(tx, t, dest, existing, row, keys, report, true);
              handled = true;
            }
            break;
          }
        if (handled) continue;
        await insertRow(tx, t.name, row);
        if (t.name === 'products') insertedProducts.add(row.id as string);
        report.inserted++;
      }
    }

    // Produk yang baru masuk tetapi seluruh variannya digabung ke produk lain (SKU sama) -> arsipkan agar tidak jadi produk yatim.
    for (const pid of insertedProducts) {
      const has = await tx.all(`SELECT 1 AS x FROM "product_variants" WHERE "business_id" = ? AND "product_id" = ? AND "deleted_at" IS NULL LIMIT 1`, [dest, pid]);
      if (!has[0]) await updateRow(tx, 'products', dest, pid, { deleted_at: nowIso(ctx), updated_at: nowIso(ctx) });
    }

    await recomputeAll(ctx);
    // Anggota pelaku bisa hilang setelah restore (diganti anggota dari backup). Tautkan ke pemilik hasil restore agar tidak terkunci.
    if (ctx.actor.memberId) {
      const still = await tx.all('SELECT 1 AS x FROM "members" WHERE "id" = ? AND "business_id" = ? AND "deleted_at" IS NULL', [ctx.actor.memberId, dest]);
      if (!still[0]) {
        const owner = (await tx.all(
          `SELECT "id" FROM "members" WHERE "business_id" = ? AND "role" = 'owner' AND "deleted_at" IS NULL AND "is_active" = ? ORDER BY "created_at", "id" LIMIT 1`,
          [dest, dbBool(tx, true)]))[0];
        let repl = owner ? String(owner.id) : null;
        if (!repl) {
          const row = stdRow(ctx, { display_name: 'Pemilik', role: 'owner', user_id: null, can_view_reports: true, can_delete: true, is_active: true });
          await insertRow(tx, 'members', row);
          repl = row.id as string;
        }
        report.replacementMemberId = repl;
        ctx.actor = { ...ctx.actor, memberId: repl, role: 'owner', canViewReports: true, canDelete: true };
      }
    }
    await audit(ctx, 'restore', 'businesses', dest, { ...report, backupCreatedAt: opened.manifest.createdAt, source: opened.manifest.source });
  });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/UNIQUE constraint failed: \w+\.id\b|duplicate key value violates unique constraint "\w+_pkey"/.test(msg))
      throw new DomainError('CONFLICT', 'Sebagian data dalam backup ini memiliki ID yang sudah dipakai bisnis lain di sistem ini. Pulihkan sebagai salinan baru (regenerateIds).', { code: 'ID_COLLISION' });
    throw e;
  }
  return report;
}

/** Last-write-wins: baris masuk menggantikan yang ada hanya bila updated_at-nya lebih baru. */
async function lww(db: Db, t: TableDef, dest: string, existing: Row, incoming: Row, keys: Map<string, string>, report: RestoreReport, fromRemap = false): Promise<void> {
  if (String(incoming.updated_at) <= String(existing.updated_at)) { if (!fromRemap) report.skipped++; return; }
  const patch: Row = {};
  for (const c of t.columns) {
    if (c.name === 'id' || c.name === 'business_id' || c.name === 'created_at') continue;
    patch[c.name] = incoming[c.name];
  }
  if (t.name === 'attachments' && existing.storage_key && !keys.has(String(existing.id))) patch.storage_key = existing.storage_key;
  await updateRow(db, t.name, dest, existing.id as string, patch);
  report.updated++;
}
