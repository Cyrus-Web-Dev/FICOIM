import { ASSET_CONDITIONS, ASSET_KINDS } from '@ficoim/shared';
import { getRow, insertRow, num, updateRow } from '../db';
import { DomainError, notFound, validation } from '../errors';
import { nowIso, stdRow, withTx, type Ctx } from '../ctx';
import { requireCan } from '../permissions';
import { oneOf, optText, requireDate, requireInt, requireText, today } from '../util';
import { audit } from './audit';
import { claimAttachment } from './attachments';
import { postTransaction } from './ledger';
import { resolveWallet } from './lookup';

export interface AssetInput {
  name: string; kind?: string; code?: string | null; purchaseDate?: string | null; purchasePrice?: number; usefulLifeMonths?: number | null;
  salvageValue?: number; condition?: string; location?: string | null; plateNumber?: string | null; note?: string | null;
  /** Foto aset (id lampiran hasil unggah). */
  photoAttachmentId?: string | null;
}

export async function createAsset(ctx: Ctx, input: AssetInput): Promise<string> {
  requireCan(ctx, 'asset.write');
  const price = requireInt(input.purchasePrice ?? 0, 'Harga perolehan'), salvage = requireInt(input.salvageValue ?? 0, 'Nilai sisa');
  if (salvage > price) throw validation('Nilai sisa tidak boleh melebihi harga perolehan.');
  const code = optText(input.code, 'Kode', 40);
  return withTx(ctx, async (c) => {
    if (code) {
      const dup = await c.db.all(`SELECT 1 AS x FROM "assets" WHERE "business_id" = ? AND "deleted_at" IS NULL AND "code" = ? LIMIT 1`, [c.businessId, code]);
      if (dup[0]) throw new DomainError('CONFLICT', `Kode aset "${code}" sudah dipakai.`);
    }
    const row = stdRow(c, {
      code, name: requireText(input.name, 'Nama aset'), kind: oneOf(input.kind ?? 'equipment', ASSET_KINDS, 'Jenis aset'),
      purchase_date: input.purchaseDate ? requireDate(input.purchaseDate, 'Tanggal perolehan') : null, purchase_price: price,
      useful_life_months: input.usefulLifeMonths == null ? null : requireInt(input.usefulLifeMonths, 'Umur manfaat (bulan)', 1),
      salvage_value: salvage, condition: oneOf(input.condition ?? 'baik', ASSET_CONDITIONS, 'Kondisi'), status: 'tersedia',
      location: optText(input.location, 'Lokasi', 120), plate_number: optText(input.plateNumber, 'Plat nomor', 20), note: optText(input.note, 'Catatan'), photo_attachment_id: null,
    });
    await insertRow(c.db, 'assets', row);
    if (input.photoAttachmentId) {
      await claimAttachment(c, input.photoAttachmentId, 'assets', row.id as string);
      await updateRow(c.db, 'assets', c.businessId, row.id as string, { photo_attachment_id: input.photoAttachmentId });
    }
    await audit(c, 'create', 'assets', row.id as string, { name: row.name });
    return row.id as string;
  });
}

/** Penyusutan garis lurus: nilai buku turun per bulan penuh sejak tanggal perolehan, tidak kurang dari nilai sisa. */
export function bookValue(a: { purchasePrice: number; salvageValue: number; usefulLifeMonths: number | null; purchaseDate: string | null }, asOf: string): number {
  if (!a.usefulLifeMonths || !a.purchaseDate) return a.purchasePrice;
  const [y1, m1, d1] = a.purchaseDate.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = asOf.split('-').map(Number) as [number, number, number];
  let months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  months = Math.max(0, Math.min(months, a.usefulLifeMonths));
  const depreciable = a.purchasePrice - a.salvageValue;
  const dep = Math.floor((depreciable * months) / a.usefulLifeMonths);
  return Math.max(a.salvageValue, a.purchasePrice - dep);
}

export interface AssetView {
  id: string; code: string | null; name: string; kind: string; status: string; condition: string; purchasePrice: number; bookValue: number; location: string | null;
  photoAttachmentId: string | null;
  /** Peminjaman yang sedang berjalan (untuk tombol "Kembalikan"). */
  activeLoan: { id: string; borrowerName: string; loanedAt: string } | null;
  /** Jadwal perawatan terdekat yang belum selesai (untuk tombol "Selesaikan"). */
  pendingMaintenance: { id: string; scheduledOn: string; description: string | null } | null;
}

export async function listAssets(ctx: Ctx): Promise<AssetView[]> {
  const rows = await ctx.db.all(`SELECT * FROM "assets" WHERE "business_id" = ? AND "deleted_at" IS NULL ORDER BY "name"`, [ctx.businessId]);
  const loans = new Map<string, { id: string; borrowerName: string; loanedAt: string }>();
  for (const l of await ctx.db.all(`SELECT "id", "asset_id", "borrower_name", "loaned_at" FROM "asset_loans" WHERE "business_id" = ? AND "deleted_at" IS NULL AND "status" = 'dipinjam' ORDER BY "loaned_at"`, [ctx.businessId]))
    loans.set(String(l.asset_id), { id: String(l.id), borrowerName: String(l.borrower_name), loanedAt: String(l.loaned_at) });
  const maint = new Map<string, { id: string; scheduledOn: string; description: string | null }>();
  for (const m of await ctx.db.all(`SELECT "id", "asset_id", "scheduled_on", "description" FROM "asset_maintenance" WHERE "business_id" = ? AND "deleted_at" IS NULL AND "status" = 'terjadwal' ORDER BY "scheduled_on" DESC`, [ctx.businessId]))
    maint.set(String(m.asset_id), { id: String(m.id), scheduledOn: String(m.scheduled_on), description: (m.description as string | null) ?? null }); // DESC + set terakhir menang = yang paling awal
  const t = today(ctx);
  return rows.map((r) => ({
    activeLoan: loans.get(String(r.id)) ?? null, pendingMaintenance: maint.get(String(r.id)) ?? null,
    id: String(r.id), code: (r.code as string | null) ?? null, name: String(r.name), kind: String(r.kind), status: String(r.status), condition: String(r.condition),
    purchasePrice: num(r.purchase_price), location: (r.location as string | null) ?? null, photoAttachmentId: (r.photo_attachment_id as string | null) ?? null,
    bookValue: bookValue({ purchasePrice: num(r.purchase_price), salvageValue: num(r.salvage_value), usefulLifeMonths: r.useful_life_months == null ? null : num(r.useful_life_months), purchaseDate: (r.purchase_date as string | null) ?? null }, t),
  }));
}

export async function loanAsset(ctx: Ctx, input: { assetId: string; borrowerName: string; borrowerPhone?: string | null; purpose?: string | null; dueAt?: string | null }): Promise<string> {
  requireCan(ctx, 'asset.write');
  return withTx(ctx, async (c) => {
    const a = await getRow(c.db, 'assets', c.businessId, input.assetId);
    if (!a) throw notFound('Aset');
    if (a.status !== 'tersedia') throw new DomainError('INVALID_STATE', `Aset "${a.name}" tidak tersedia (status: ${a.status}).`);
    const row = stdRow(c, {
      asset_id: input.assetId, borrower_name: requireText(input.borrowerName, 'Nama peminjam', 120), borrower_phone: optText(input.borrowerPhone, 'Telepon', 40),
      purpose: optText(input.purpose, 'Keperluan'), loaned_at: nowIso(c), due_at: input.dueAt ?? null, returned_at: null, status: 'dipinjam', note: null,
    });
    await insertRow(c.db, 'asset_loans', row);
    await updateRow(c.db, 'assets', c.businessId, input.assetId, { status: 'dipinjam', updated_at: nowIso(c) });
    await audit(c, 'loan', 'assets', input.assetId, { borrower: row.borrower_name });
    return row.id as string;
  });
}

export async function returnAsset(ctx: Ctx, loanId: string, condition?: string): Promise<void> {
  requireCan(ctx, 'asset.write');
  return withTx(ctx, async (c) => {
    const l = await getRow(c.db, 'asset_loans', c.businessId, loanId);
    if (!l) throw notFound('Peminjaman');
    if (l.status === 'kembali') throw new DomainError('INVALID_STATE', 'Aset sudah dikembalikan.');
    const cond = condition ? oneOf(condition, ASSET_CONDITIONS, 'Kondisi') : null;
    await updateRow(c.db, 'asset_loans', c.businessId, loanId, { status: 'kembali', returned_at: nowIso(c), updated_at: nowIso(c) });
    await updateRow(c.db, 'assets', c.businessId, String(l.asset_id), { status: cond === 'rusak' ? 'rusak' : 'tersedia', ...(cond ? { condition: cond } : {}), updated_at: nowIso(c) });
    await audit(c, 'return', 'assets', String(l.asset_id));
  });
}

export async function scheduleMaintenance(ctx: Ctx, input: { assetId: string; scheduledOn: string; description?: string | null }): Promise<string> {
  requireCan(ctx, 'asset.write');
  return withTx(ctx, async (c) => {
    if (!(await getRow(c.db, 'assets', c.businessId, input.assetId))) throw notFound('Aset');
    const row = stdRow(c, { asset_id: input.assetId, scheduled_on: requireDate(input.scheduledOn, 'Tanggal jadwal'), done_on: null, cost: 0, description: optText(input.description, 'Keterangan'), status: 'terjadwal' });
    await insertRow(c.db, 'asset_maintenance', row);
    return row.id as string;
  });
}

/** Selesaikan perawatan; bila biaya > 0, otomatis dicatat sebagai pengeluaran "Perawatan Aset". */
export async function completeMaintenance(ctx: Ctx, maintenanceId: string, input: { cost?: number; walletId?: string | null; doneOn?: string }): Promise<void> {
  requireCan(ctx, 'asset.write');
  return withTx(ctx, async (c) => {
    const m = await getRow(c.db, 'asset_maintenance', c.businessId, maintenanceId);
    if (!m) throw notFound('Jadwal perawatan');
    if (m.status !== 'terjadwal') throw new DomainError('INVALID_STATE', 'Jadwal ini sudah selesai atau dibatalkan.');
    const cost = requireInt(input.cost ?? 0, 'Biaya'), doneOn = input.doneOn ? requireDate(input.doneOn, 'Tanggal selesai') : today(c);
    if (cost > 0) {
      const cat = (await c.db.all(`SELECT "id" FROM "finance_categories" WHERE "business_id" = ? AND "deleted_at" IS NULL AND "name" = 'Perawatan Aset' AND "type" = 'expense' LIMIT 1`, [c.businessId]))[0];
      if (!cat) throw new DomainError('INVALID_STATE', 'Kategori "Perawatan Aset" tidak ditemukan.');
      await postTransaction(c, { walletId: await resolveWallet(c, input.walletId), categoryId: String(cat.id), type: 'expense', amount: cost, occurredOn: doneOn, description: `Perawatan: ${m.description ?? 'aset'}`, refTable: 'asset_maintenance', refId: maintenanceId });
    }
    await updateRow(c.db, 'asset_maintenance', c.businessId, maintenanceId, { status: 'selesai', done_on: doneOn, cost, updated_at: nowIso(c) });
    await audit(c, 'complete', 'asset_maintenance', maintenanceId, { cost });
  });
}
