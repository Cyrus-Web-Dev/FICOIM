import { insertRow, getRow, num, updateRow, selectRows } from '../db';
import { DomainError, notFound, validation } from '../errors';
import { nowIso, stdRow, withTx, type Ctx } from '../ctx';
import { requireCan } from '../permissions';
import { optInt, optText, oneOf, requireDate, requireInt, requireText } from '../util';
import { rangeUtc } from '../util';
import { audit } from './audit';
import { attachmentSubquery, claimAttachment, discardAttachment } from './attachments';
import { BUSINESS_TYPES, MEMBER_ROLES } from '@ficoim/shared';

// ---------------- profil bisnis ----------------
export interface BusinessView { id: string; name: string; businessType: string; address: string | null; phone: string | null; taxBp: number; receiptFooter: string | null; allowNegativeStock: boolean; tzOffsetMinutes: number;
  /** Logo di struk (id lampiran) atau null. */ logoAttachmentId: string | null;
  /** Lebar struk teks dalam kolom: 32 = kertas 58 mm, 42 = kertas 80 mm. */ receiptCols: 32 | 42 }

export async function getBusiness(ctx: Ctx): Promise<BusinessView> {
  const b = await getRow(ctx.db, 'businesses', ctx.businessId, ctx.businessId);
  if (!b) throw notFound('Bisnis');
  return { id: b.id as string, name: b.name as string, businessType: b.business_type as string, address: b.address as string | null, phone: b.phone as string | null, taxBp: num(b.tax_bp), receiptFooter: b.receipt_footer as string | null, allowNegativeStock: ctx.allowNegativeStock, tzOffsetMinutes: ctx.tzOffsetMinutes, ...settingsView(b.settings) };
}

function settingsView(raw: unknown): { logoAttachmentId: string | null; receiptCols: 32 | 42 } {
  const s = (raw ?? {}) as Record<string, unknown>;
  return { logoAttachmentId: typeof s.logoAttachmentId === 'string' ? s.logoAttachmentId : null, receiptCols: s.receiptCols === 42 ? 42 : 32 };
}

export async function updateBusiness(
  ctx: Ctx, patch: { name?: string; businessType?: string; address?: string | null; phone?: string | null; taxBp?: number; receiptFooter?: string | null; allowNegativeStock?: boolean; tzOffsetMinutes?: number; logoAttachmentId?: string | null; receiptCols?: number },
): Promise<void> {
  requireCan(ctx, 'settings.write');
  return withTx(ctx, async (c) => {
    const cur = await getRow(c.db, 'businesses', c.businessId, c.businessId);
    if (!cur) throw notFound('Bisnis');
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) set.name = requireText(patch.name, 'Nama bisnis', 120);
    if (patch.businessType !== undefined) set.business_type = oneOf(patch.businessType, BUSINESS_TYPES, 'Jenis usaha');
    if ('address' in patch) set.address = optText(patch.address, 'Alamat');
    if ('phone' in patch) set.phone = optText(patch.phone, 'Telepon', 40);
    if (patch.taxBp !== undefined) set.tax_bp = requireInt(patch.taxBp, 'Pajak (bp)', 0, 10000);
    if ('receiptFooter' in patch) set.receipt_footer = optText(patch.receiptFooter, 'Catatan struk', 200);
    if (patch.allowNegativeStock !== undefined || patch.tzOffsetMinutes !== undefined || 'logoAttachmentId' in patch || patch.receiptCols !== undefined) {
      const s = { ...((cur.settings ?? {}) as Record<string, unknown>) };
      if (patch.receiptCols !== undefined) { if (patch.receiptCols !== 32 && patch.receiptCols !== 42) throw validation('Lebar struk harus 32 (kertas 58 mm) atau 42 (kertas 80 mm).'); s.receiptCols = patch.receiptCols; }
      if ('logoAttachmentId' in patch) {
        const next = patch.logoAttachmentId ?? null, prev = typeof s.logoAttachmentId === 'string' ? s.logoAttachmentId : null;
        if (next !== prev) {
          if (next) await claimAttachment(c, next, 'businesses', c.businessId);
          s.logoAttachmentId = next;
          await discardAttachment(c, prev); // logo lama dibuang agar tidak ikut backup
        }
      }
      if (patch.allowNegativeStock !== undefined) s.allowNegativeStock = !!patch.allowNegativeStock;
      if (patch.tzOffsetMinutes !== undefined) s.tzOffsetMinutes = requireInt(patch.tzOffsetMinutes, 'Zona waktu (menit)', -720, 840);
      set.settings = s;
    }
    if (!Object.keys(set).length) return;
    set.updated_at = nowIso(c);
    await updateRow(c.db, 'businesses', c.businessId, c.businessId, set);
    await audit(c, 'update', 'businesses', c.businessId, { fields: Object.keys(set).filter((k) => k !== 'updated_at') });
  });
}

// ---------------- kategori produk, pelanggan, pemasok ----------------
export async function listProductCategories(ctx: Ctx): Promise<{ id: string; name: string; icon: string | null }[]> {
  const rows = await selectRows(ctx.db, 'product_categories', '"business_id" = ? AND "deleted_at" IS NULL', [ctx.businessId], 'ORDER BY "name"');
  return rows.map((r) => ({ id: r.id as string, name: r.name as string, icon: r.icon as string | null }));
}

export async function createProductCategory(ctx: Ctx, input: { name: string; icon?: string | null }): Promise<string> {
  requireCan(ctx, 'product.write');
  const name = requireText(input.name, 'Nama kategori', 80);
  const dup = await ctx.db.all(`SELECT 1 AS x FROM "product_categories" WHERE "business_id" = ? AND "deleted_at" IS NULL AND "name" = ? LIMIT 1`, [ctx.businessId, name]);
  if (dup[0]) throw new DomainError('CONFLICT', `Kategori "${name}" sudah ada.`);
  const row = stdRow(ctx, { name, icon: optText(input.icon, 'Ikon', 16) });
  await insertRow(ctx.db, 'product_categories', row);
  return row.id as string;
}

export interface PartyInput { name: string; phone?: string | null; address?: string | null; note?: string | null }
export interface PartyView { id: string; name: string; phone: string | null; address: string | null; note: string | null }

async function createParty(ctx: Ctx, table: 'customers' | 'suppliers', input: PartyInput): Promise<string> {
  const row = stdRow(ctx, { name: requireText(input.name, 'Nama', 120), phone: optText(input.phone, 'Telepon', 40), address: optText(input.address, 'Alamat'), note: optText(input.note, 'Catatan') });
  await insertRow(ctx.db, table, row);
  await audit(ctx, 'create', table, row.id as string);
  return row.id as string;
}
async function listParties(ctx: Ctx, table: 'customers' | 'suppliers', search?: string): Promise<PartyView[]> {
  const s = search?.trim();
  const rows = await ctx.db.all(
    `SELECT "id", "name", "phone", "address", "note" FROM "${table}" WHERE "business_id" = ? AND "deleted_at" IS NULL${s ? ` AND LOWER("name") LIKE ? ESCAPE '\\'` : ''} ORDER BY "name" LIMIT 500`,
    [ctx.businessId, ...(s ? [`%${s.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`] : [])]);
  return rows.map((r) => ({ id: String(r.id), name: String(r.name), phone: (r.phone as string | null) ?? null, address: (r.address as string | null) ?? null, note: (r.note as string | null) ?? null }));
}

/** Kasir (staf) boleh menambah pelanggan saat transaksi; pemasok mengikuti hak pembelian. */
export const createCustomer = (ctx: Ctx, i: PartyInput) => { requireCan(ctx, 'sale.create'); return createParty(ctx, 'customers', i); };
export const createSupplier = (ctx: Ctx, i: PartyInput) => { requireCan(ctx, 'purchase.create'); return createParty(ctx, 'suppliers', i); };
export const listCustomers = (ctx: Ctx, search?: string) => listParties(ctx, 'customers', search);
export const listSuppliers = (ctx: Ctx, search?: string) => listParties(ctx, 'suppliers', search);

// ---------------- manajemen pelanggan & pemasok ----------------
export type PartyKind = 'customer' | 'supplier';
export interface PartyStatsView extends PartyView {
  /** Jumlah dokumen tidak batal (penjualan untuk pelanggan, pembelian untuk pemasok). */
  docCount: number; totalAmount: number;
  /** Piutang (pelanggan) / hutang (pemasok) yang belum lunas dari dokumen tidak batal. */
  outstanding: number; lastAt: string | null;
}
const PARTY = {
  customer: { table: 'customers', docs: 'sales', fk: 'customer_id', at: 'sold_at' },
  supplier: { table: 'suppliers', docs: 'purchases', fk: 'supplier_id', at: 'purchased_at' },
} as const;
const partyKind = (k: unknown): PartyKind => { if (k !== 'customer' && k !== 'supplier') throw validation('Jenis pihak harus "customer" atau "supplier".'); return k; };

/** Daftar pelanggan/pemasok beserta ringkasan transaksinya (butuh hak lihat laporan: berisi angka keuangan). */
export async function listPartyStats(ctx: Ctx, kind: PartyKind, search?: string): Promise<PartyStatsView[]> {
  requireCan(ctx, 'report.view');
  const P = PARTY[partyKind(kind)], s = search?.trim();
  const rows = await ctx.db.all(
    `SELECT p."id", p."name", p."phone", p."address", p."note",
       COALESCE(SUM(CASE WHEN d."status" <> 'void' THEN 1 ELSE 0 END), 0) AS doc_count,
       COALESCE(SUM(CASE WHEN d."status" <> 'void' THEN d."total" ELSE 0 END), 0) AS total_amount,
       COALESCE(SUM(CASE WHEN d."status" <> 'void' THEN d."total" - d."paid" ELSE 0 END), 0) AS outstanding,
       MAX(CASE WHEN d."status" <> 'void' THEN d."${P.at}" END) AS last_at
     FROM "${P.table}" p LEFT JOIN "${P.docs}" d ON d."${P.fk}" = p."id" AND d."business_id" = p."business_id" AND d."deleted_at" IS NULL
     WHERE p."business_id" = ? AND p."deleted_at" IS NULL${s ? ` AND LOWER(p."name") LIKE ? ESCAPE '\\'` : ''}
     GROUP BY p."id", p."name", p."phone", p."address", p."note" ORDER BY p."name" LIMIT 500`,
    [ctx.businessId, ...(s ? [`%${s.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`] : [])]);
  return rows.map((r) => ({
    id: String(r.id), name: String(r.name), phone: (r.phone as string | null) ?? null, address: (r.address as string | null) ?? null, note: (r.note as string | null) ?? null,
    docCount: num(r.doc_count), totalAmount: num(r.total_amount), outstanding: num(r.outstanding), lastAt: (r.last_at as string | null) ?? null,
  }));
}

export async function updateParty(ctx: Ctx, kind: PartyKind, id: string, patch: Partial<PartyInput>): Promise<void> {
  requireCan(ctx, 'product.write');
  const table = PARTY[partyKind(kind)].table;
  await withTx(ctx, async (c) => {
    if (!(await getRow(c.db, table, c.businessId, id))) throw notFound(kind === 'customer' ? 'Pelanggan' : 'Pemasok');
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) set.name = requireText(patch.name, 'Nama', 120);
    if (patch.phone !== undefined) set.phone = optText(patch.phone, 'Telepon', 40);
    if (patch.address !== undefined) set.address = optText(patch.address, 'Alamat');
    if (patch.note !== undefined) set.note = optText(patch.note, 'Catatan');
    if (!Object.keys(set).length) return;
    set.updated_at = nowIso(c);
    await updateRow(c.db, table, c.businessId, id, set);
    await audit(c, 'update', table, id);
  });
}

/** Hapus-lunak. Dokumen lama tetap menyimpan tautannya (riwayat tidak berubah). */
export async function deleteParty(ctx: Ctx, kind: PartyKind, id: string): Promise<void> {
  requireCan(ctx, 'product.write');
  const table = PARTY[partyKind(kind)].table;
  await withTx(ctx, async (c) => {
    if (!(await getRow(c.db, table, c.businessId, id))) throw notFound(kind === 'customer' ? 'Pelanggan' : 'Pemasok');
    const t = nowIso(c);
    await updateRow(c.db, table, c.businessId, id, { deleted_at: t, updated_at: t });
    await audit(c, 'delete', table, id);
  });
}

// ---------------- daftar dokumen ----------------
export interface DocRow { id: string; number: string; at: string; party: string | null; total: number; paid: number; status: string; /** Foto nota (hanya pembelian) */ receiptAttachmentId: string | null }

export async function listSales(ctx: Ctx, o: { from?: string; to?: string; status?: string; limit?: number; offset?: number } = {}): Promise<DocRow[]> {
  const where = [`s."business_id" = ?`, `s."deleted_at" IS NULL`]; const p: unknown[] = [ctx.businessId];
  if (o.from && o.to) { const r = rangeUtc(ctx, o.from, o.to); where.push(`s."sold_at" >= ? AND s."sold_at" < ?`); p.push(r.fromIso, r.toIso); }
  if (o.status) { where.push(`s."status" = ?`); p.push(oneOf(o.status, ['paid', 'partial', 'unpaid', 'void'] as const, 'Status')); }
  const rows = await ctx.db.all(`SELECT s."id", s."number", s."sold_at" AS at, c."name" AS party, s."total", s."paid", s."status" FROM "sales" s LEFT JOIN "customers" c ON c."id" = s."customer_id" WHERE ${where.join(' AND ')} ORDER BY s."sold_at" DESC, s."id" DESC LIMIT ? OFFSET ?`,
    [...p, Math.min(Math.max(optInt(o.limit, 'limit', 50, 1), 1), 500), optInt(o.offset, 'offset', 0)]);
  return rows.map((r) => ({ id: String(r.id), number: String(r.number), at: String(r.at), party: (r.party as string | null) ?? null, total: num(r.total), paid: num(r.paid), status: String(r.status), receiptAttachmentId: null }));
}

export async function listPurchases(ctx: Ctx, o: { from?: string; to?: string; limit?: number; offset?: number } = {}): Promise<DocRow[]> {
  const where = [`p."business_id" = ?`, `p."deleted_at" IS NULL`]; const params: unknown[] = [ctx.businessId];
  if (o.from && o.to) { const r = rangeUtc(ctx, o.from, o.to); where.push(`p."purchased_at" >= ? AND p."purchased_at" < ?`); params.push(r.fromIso, r.toIso); }
  const rows = await ctx.db.all(`SELECT p."id", p."number", p."purchased_at" AS at, s."name" AS party, p."total", p."paid", p."status", ${attachmentSubquery('purchases', 'p')} AS receipt_id FROM "purchases" p LEFT JOIN "suppliers" s ON s."id" = p."supplier_id" WHERE ${where.join(' AND ')} ORDER BY p."purchased_at" DESC, p."id" DESC LIMIT ? OFFSET ?`,
    [...params, Math.min(Math.max(optInt(o.limit, 'limit', 50, 1), 1), 500), optInt(o.offset, 'offset', 0)]);
  return rows.map((r) => ({ id: String(r.id), number: String(r.number), at: String(r.at), party: (r.party as string | null) ?? null, total: num(r.total), paid: num(r.paid), status: String(r.status), receiptAttachmentId: (r.receipt_id as string | null) ?? null }));
}

export interface SaleDetail extends DocRow { subtotal: number; discount: number; tax: number; note: string | null; items: { name: string; qtyMilli: number; unitPrice: number; discount: number; lineTotal: number }[] }

export async function getSale(ctx: Ctx, id: string): Promise<SaleDetail> {
  const s = await getRow(ctx.db, 'sales', ctx.businessId, id);
  if (!s) throw notFound('Penjualan');
  const cu = s.customer_id ? await getRow(ctx.db, 'customers', ctx.businessId, String(s.customer_id)) : null;
  const items = await selectRows(ctx.db, 'sale_items', '"business_id" = ? AND "sale_id" = ? AND "deleted_at" IS NULL', [ctx.businessId, id], 'ORDER BY "id"');
  return {
    id, number: s.number as string, at: s.sold_at as string, party: cu ? (cu.name as string) : null, total: num(s.total), paid: num(s.paid), status: s.status as string, receiptAttachmentId: null,
    subtotal: num(s.subtotal), discount: num(s.discount), tax: num(s.tax), note: s.note as string | null,
    items: items.map((i) => ({ name: i.name_snapshot as string, qtyMilli: num(i.qty_milli), unitPrice: num(i.unit_price), discount: num(i.discount), lineTotal: num(i.line_total) })),
  };
}

// ---------------- riwayat transaksi kas ----------------
export interface TxView { id: string; walletId: string; walletName: string; categoryName: string; type: string; amount: number; occurredOn: string; description: string | null; auto: boolean; receiptAttachmentId: string | null }

export async function listTransactions(ctx: Ctx, o: { from?: string; to?: string; walletId?: string; type?: string; limit?: number; offset?: number } = {}): Promise<TxView[]> {
  const where = [`t."business_id" = ?`, `t."deleted_at" IS NULL`]; const p: unknown[] = [ctx.businessId];
  if (o.from) { where.push(`t."occurred_on" >= ?`); p.push(requireDate(o.from, 'Dari')); }
  if (o.to) { where.push(`t."occurred_on" <= ?`); p.push(requireDate(o.to, 'Sampai')); }
  if (o.walletId) { where.push(`t."wallet_id" = ?`); p.push(o.walletId); }
  if (o.type) { where.push(`t."type" = ?`); p.push(oneOf(o.type, ['income', 'expense'] as const, 'Jenis')); }
  const rows = await ctx.db.all(
    `SELECT t."id", t."wallet_id", w."name" AS wn, c."name" AS cn, t."type", t."amount", t."occurred_on", t."description", t."ref_table", t."receipt_attachment_id" FROM "transactions" t
     JOIN "wallets" w ON w."id" = t."wallet_id" JOIN "finance_categories" c ON c."id" = t."category_id" WHERE ${where.join(' AND ')}
     ORDER BY t."occurred_on" DESC, t."created_at" DESC, t."id" DESC LIMIT ? OFFSET ?`,
    [...p, Math.min(Math.max(optInt(o.limit, 'limit', 100, 1), 1), 1000), optInt(o.offset, 'offset', 0)]);
  return rows.map((r) => ({ id: String(r.id), walletId: String(r.wallet_id), walletName: String(r.wn), categoryName: String(r.cn), type: String(r.type), amount: num(r.amount), occurredOn: String(r.occurred_on), description: (r.description as string | null) ?? null, auto: r.ref_table !== null, receiptAttachmentId: (r.receipt_attachment_id as string | null) ?? null }));
}

export async function listFinanceCategories(ctx: Ctx): Promise<{ id: string; name: string; type: string; icon: string | null; isSystem: boolean }[]> {
  const rows = await selectRows(ctx.db, 'finance_categories', '"business_id" = ? AND "deleted_at" IS NULL', [ctx.businessId], 'ORDER BY "type", "name"');
  return rows.map((r) => ({ id: r.id as string, name: r.name as string, type: r.type as string, icon: r.icon as string | null, isSystem: r.is_system === true }));
}

// ---------------- anggota tim ----------------
export interface MemberView { id: string; displayName: string; role: string; isActive: boolean; canViewReports: boolean; canDelete: boolean }

export async function listMembers(ctx: Ctx): Promise<MemberView[]> {
  requireCan(ctx, 'member.manage');
  const rows = await selectRows(ctx.db, 'members', '"business_id" = ? AND "deleted_at" IS NULL', [ctx.businessId], 'ORDER BY "created_at", "id"');
  return rows.map((r) => ({ id: r.id as string, displayName: r.display_name as string, role: r.role as string, isActive: r.is_active === true, canViewReports: r.can_view_reports === true, canDelete: r.can_delete === true }));
}

export async function createMember(ctx: Ctx, input: { displayName: string; role: string; canViewReports?: boolean; canDelete?: boolean; userId?: string | null }): Promise<string> {
  requireCan(ctx, 'member.manage');
  const role = oneOf(input.role, MEMBER_ROLES, 'Peran');
  if (role === 'owner') throw validation('Peran pemilik tidak bisa ditambahkan; hanya ada satu pemilik.');
  const row = stdRow(ctx, { display_name: requireText(input.displayName, 'Nama', 120), role, user_id: input.userId ?? null, can_view_reports: !!input.canViewReports, can_delete: !!input.canDelete, is_active: true });
  await insertRow(ctx.db, 'members', row);
  await audit(ctx, 'create', 'members', row.id as string, { role });
  return row.id as string;
}

export async function updateMember(ctx: Ctx, memberId: string, patch: { role?: string; isActive?: boolean; canViewReports?: boolean; canDelete?: boolean; displayName?: string }): Promise<void> {
  requireCan(ctx, 'member.manage');
  const m = await getRow(ctx.db, 'members', ctx.businessId, memberId);
  if (!m) throw notFound('Anggota');
  if (m.role === 'owner') throw new DomainError('CONFLICT', 'Pemilik tidak dapat diubah atau dinonaktifkan.');
  const set: Record<string, unknown> = {};
  if (patch.role !== undefined) { const r = oneOf(patch.role, MEMBER_ROLES, 'Peran'); if (r === 'owner') throw validation('Peran pemilik tidak bisa diberikan.'); set.role = r; }
  if (patch.isActive !== undefined) set.is_active = !!patch.isActive;
  if (patch.canViewReports !== undefined) set.can_view_reports = !!patch.canViewReports;
  if (patch.canDelete !== undefined) set.can_delete = !!patch.canDelete;
  if (patch.displayName !== undefined) set.display_name = requireText(patch.displayName, 'Nama', 120);
  if (!Object.keys(set).length) return;
  set.updated_at = nowIso(ctx);
  await updateRow(ctx.db, 'members', ctx.businessId, memberId, set);
  await audit(ctx, 'update', 'members', memberId, { fields: Object.keys(set).filter((k) => k !== 'updated_at') });
}
