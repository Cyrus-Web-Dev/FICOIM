import { type Row } from '@ficoim/shared';
import { asBool, dbBool, getRow, insertRow, num, updateRow } from '../db';
import { DomainError, notFound, validation } from '../errors';
import { nowIso, stdRow, withTx, type Ctx } from '../ctx';
import { requireCan } from '../permissions';
import { code, escapeLike, optText, requireInt, requireText, requireDate } from '../util';
import { audit } from './audit';
import { claimAttachment, discardAttachment } from './attachments';
import { applyStockMovement } from './stock';

export interface VariantInput {
  name?: string; sku?: string | null; barcode?: string | null;
  costPrice?: number; sellPrice?: number; openingQtyMilli?: number; minStockMilli?: number;
  expiryDate?: string | null; attributes?: Record<string, unknown> | null;
}
export interface ProductInput {
  name: string; categoryId?: string | null; brand?: string | null; description?: string | null; unit?: string;
  trackStock?: boolean; trackExpiry?: boolean; variants?: VariantInput[];
  /** Id lampiran hasil unggah (saveImage). */
  photoAttachmentId?: string | null;
}

async function assertCategory(ctx: Ctx, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  if (!(await getRow(ctx.db, 'product_categories', ctx.businessId, id))) throw notFound('Kategori produk');
  return id;
}

/** SKU/barcode harus unik di antara varian aktif; pesan error ramah dan menunjuk varian yang bentrok. */
async function assertUniqueCodes(ctx: Ctx, sku: string | null, barcode: string | null, exceptVariantId?: string): Promise<void> {
  for (const [col, val, label] of [['sku', sku, 'SKU'], ['barcode', barcode, 'Barcode']] as const) {
    if (!val) continue;
    const rows = await ctx.db.all(
      `SELECT v."id", p."name" FROM "product_variants" v JOIN "products" p ON p."id" = v."product_id"
       WHERE v."business_id" = ? AND v."deleted_at" IS NULL AND v."${col}" = ?${exceptVariantId ? ' AND v."id" <> ?' : ''} LIMIT 1`,
      [ctx.businessId, val, ...(exceptVariantId ? [exceptVariantId] : [])]);
    if (rows[0]) throw new DomainError('CONFLICT', `${label} "${val}" sudah dipakai oleh produk "${rows[0].name}".`, { field: col });
  }
}

export async function createProduct(ctx: Ctx, input: ProductInput): Promise<{ productId: string; variantIds: string[] }> {
  requireCan(ctx, 'product.write');
  const name = requireText(input.name, 'Nama produk');
  const variants = input.variants && input.variants.length ? input.variants : [{}];
  if (variants.length > 100) throw validation('Maksimal 100 varian per produk.');
  const seen = new Set<string>();
  for (const v of variants) {
    for (const k of [code(v.sku, 'SKU'), code(v.barcode, 'Barcode')]) {
      if (k) { if (seen.has(k)) throw new DomainError('CONFLICT', `Kode "${k}" dipakai dua kali pada varian yang sama.`); seen.add(k); }
    }
  }
  return withTx(ctx, async (c) => {
    const categoryId = await assertCategory(c, input.categoryId);
    const trackStock = input.trackStock ?? true;
    const product = stdRow(c, {
      category_id: categoryId, name, brand: optText(input.brand, 'Merek', 100), description: optText(input.description, 'Deskripsi', 2000),
      unit: requireText(input.unit ?? 'pcs', 'Satuan', 20), track_stock: trackStock, track_expiry: input.trackExpiry ?? false,
      is_active: true, photo_attachment_id: null,
    });
    await insertRow(c.db, 'products', product);
    const ids: string[] = [];
    for (const v of variants) {
      const sku = code(v.sku, 'SKU'), barcode = code(v.barcode, 'Barcode');
      await assertUniqueCodes(c, sku, barcode);
      const cost = requireInt(v.costPrice ?? 0, 'Harga beli'), sell = requireInt(v.sellPrice ?? 0, 'Harga jual');
      const opening = trackStock ? requireInt(v.openingQtyMilli ?? 0, 'Stok awal') : 0;
      const row = stdRow(c, {
        product_id: product.id, name: requireText(v.name ?? 'Default', 'Nama varian', 100), sku, barcode, cost_price: cost, sell_price: sell,
        stock_qty_milli: 0, min_stock_milli: requireInt(v.minStockMilli ?? 0, 'Stok minimum'),
        expiry_date: v.expiryDate ? requireDate(v.expiryDate, 'Tanggal kedaluwarsa') : null, attributes: v.attributes ?? null,
      });
      await insertRow(c.db, 'product_variants', row);
      ids.push(row.id as string);
      if (opening > 0) await applyStockMovement(c, { variantId: row.id as string, type: 'initial', deltaMilli: opening, unitCost: cost, note: 'Stok awal' });
    }
    if (input.photoAttachmentId) {
      await claimAttachment(c, input.photoAttachmentId, 'products', product.id as string);
      await updateRow(c.db, 'products', c.businessId, product.id as string, { photo_attachment_id: input.photoAttachmentId });
    }
    await audit(c, 'create', 'products', product.id as string, { name, variants: ids.length });
    return { productId: product.id as string, variantIds: ids };
  });
}

export interface VariantPatch {
  name?: string; sku?: string | null; barcode?: string | null; costPrice?: number; sellPrice?: number;
  minStockMilli?: number; expiryDate?: string | null; attributes?: Record<string, unknown> | null;
}

export async function updateVariant(ctx: Ctx, variantId: string, patch: VariantPatch): Promise<void> {
  requireCan(ctx, 'product.write');
  return withTx(ctx, async (c) => {
    const cur = await getRow(c.db, 'product_variants', c.businessId, variantId);
    if (!cur) throw notFound('Varian produk');
    const set: Row = {};
    if (patch.name !== undefined) set.name = requireText(patch.name, 'Nama varian', 100);
    if ('sku' in patch || 'barcode' in patch) {
      const sku = 'sku' in patch ? code(patch.sku, 'SKU') : (cur.sku as string | null);
      const barcode = 'barcode' in patch ? code(patch.barcode, 'Barcode') : (cur.barcode as string | null);
      await assertUniqueCodes(c, sku, barcode, variantId);
      if ('sku' in patch) set.sku = sku;
      if ('barcode' in patch) set.barcode = barcode;
    }
    if (patch.costPrice !== undefined) set.cost_price = requireInt(patch.costPrice, 'Harga beli');
    if (patch.sellPrice !== undefined) set.sell_price = requireInt(patch.sellPrice, 'Harga jual');
    if (patch.minStockMilli !== undefined) set.min_stock_milli = requireInt(patch.minStockMilli, 'Stok minimum');
    if ('expiryDate' in patch) set.expiry_date = patch.expiryDate ? requireDate(patch.expiryDate, 'Tanggal kedaluwarsa') : null;
    if ('attributes' in patch) set.attributes = patch.attributes ?? null;
    if (!Object.keys(set).length) return;
    set.updated_at = nowIso(c);
    await updateRow(c.db, 'product_variants', c.businessId, variantId, set);
    await audit(c, 'update', 'product_variants', variantId, { fields: Object.keys(set).filter((k) => k !== 'updated_at') });
  });
}

export async function updateProduct(
  ctx: Ctx, productId: string,
  patch: { name?: string; categoryId?: string | null; brand?: string | null; description?: string | null; unit?: string; isActive?: boolean; trackExpiry?: boolean; photoAttachmentId?: string | null },
): Promise<void> {
  requireCan(ctx, 'product.write');
  return withTx(ctx, async (c) => {
    const cur = await getRow(c.db, 'products', c.businessId, productId);
    if (!cur) throw notFound('Produk');
    const set: Row = {};
    if (patch.name !== undefined) set.name = requireText(patch.name, 'Nama produk');
    if ('categoryId' in patch) set.category_id = await assertCategory(c, patch.categoryId);
    if ('brand' in patch) set.brand = optText(patch.brand, 'Merek', 100);
    if ('description' in patch) set.description = optText(patch.description, 'Deskripsi', 2000);
    if (patch.unit !== undefined) set.unit = requireText(patch.unit, 'Satuan', 20);
    if (patch.isActive !== undefined) set.is_active = !!patch.isActive;
    if (patch.trackExpiry !== undefined) set.track_expiry = !!patch.trackExpiry;
    if ('photoAttachmentId' in patch) {
      const next = patch.photoAttachmentId ?? null, prev = (cur.photo_attachment_id as string | null) ?? null;
      if (next !== prev) {
        if (next) await claimAttachment(c, next, 'products', productId);
        set.photo_attachment_id = next;
        await discardAttachment(c, prev); // foto lama dibuang agar tidak ikut backup
      }
    }
    if (!Object.keys(set).length) return;
    set.updated_at = nowIso(c);
    await updateRow(c.db, 'products', c.businessId, productId, set);
    await audit(c, 'update', 'products', productId, { fields: Object.keys(set).filter((k) => k !== 'updated_at') });
  });
}

/** Tambah varian baru pada produk yang sudah ada. */
export async function addVariant(ctx: Ctx, productId: string, v: VariantInput): Promise<string> {
  requireCan(ctx, 'product.write');
  return withTx(ctx, async (c) => {
    const p = await getRow(c.db, 'products', c.businessId, productId);
    if (!p) throw notFound('Produk');
    const sku = code(v.sku, 'SKU'), barcode = code(v.barcode, 'Barcode');
    await assertUniqueCodes(c, sku, barcode);
    const cost = requireInt(v.costPrice ?? 0, 'Harga beli');
    const row = stdRow(c, {
      product_id: productId, name: requireText(v.name ?? 'Default', 'Nama varian', 100), sku, barcode, cost_price: cost,
      sell_price: requireInt(v.sellPrice ?? 0, 'Harga jual'), stock_qty_milli: 0, min_stock_milli: requireInt(v.minStockMilli ?? 0, 'Stok minimum'),
      expiry_date: v.expiryDate ? requireDate(v.expiryDate, 'Tanggal kedaluwarsa') : null, attributes: v.attributes ?? null,
    });
    await insertRow(c.db, 'product_variants', row);
    const opening = p.track_stock === true ? requireInt(v.openingQtyMilli ?? 0, 'Stok awal') : 0;
    if (opening > 0) await applyStockMovement(c, { variantId: row.id as string, type: 'initial', deltaMilli: opening, unitCost: cost, note: 'Stok awal' });
    await audit(c, 'create', 'product_variants', row.id as string, { productId });
    return row.id as string;
  });
}

/** Arsipkan (hapus-lunak) produk beserta variannya. Riwayat penjualan tetap utuh. */
export async function deleteProduct(ctx: Ctx, productId: string): Promise<void> {
  requireCan(ctx, 'product.delete');
  return withTx(ctx, async (c) => {
    const cur = await getRow(c.db, 'products', c.businessId, productId);
    if (!cur) throw notFound('Produk');
    const t = nowIso(c);
    await discardAttachment(c, (cur.photo_attachment_id as string | null) ?? null);
    await c.db.run(`UPDATE "product_variants" SET "deleted_at" = ?, "updated_at" = ? WHERE "product_id" = ? AND "business_id" = ? AND "deleted_at" IS NULL`, [t, t, productId, c.businessId]);
    await updateRow(c.db, 'products', c.businessId, productId, { deleted_at: t, updated_at: t });
    await audit(c, 'delete', 'products', productId);
  });
}

export interface VariantView {
  id: string; productId: string; productName: string; categoryId: string | null; categoryName: string | null;
  variantName: string; sku: string | null; barcode: string | null; unit: string;
  costPrice: number; sellPrice: number; stockQtyMilli: number; minStockMilli: number;
  trackStock: boolean; expiryDate: string | null; isActive: boolean;
  /** Foto produk (id lampiran) atau null. */
  photoAttachmentId: string | null;
}

export interface ListProductsOptions { search?: string; categoryId?: string; lowStockOnly?: boolean; includeInactive?: boolean; limit?: number; offset?: number }

const VIEW_SELECT = `SELECT v."id", v."product_id", p."name" AS product_name, p."category_id", c."name" AS category_name, v."name" AS variant_name,
  v."sku", v."barcode", p."unit", v."cost_price", v."sell_price", v."stock_qty_milli", v."min_stock_milli", p."track_stock", v."expiry_date", p."is_active", p."photo_attachment_id"
  FROM "product_variants" v JOIN "products" p ON p."id" = v."product_id" LEFT JOIN "product_categories" c ON c."id" = p."category_id"`;

const toView = (r: Record<string, unknown>): VariantView => ({
  id: String(r.id), productId: String(r.product_id), productName: String(r.product_name),
  categoryId: (r.category_id as string | null) ?? null, categoryName: (r.category_name as string | null) ?? null,
  variantName: String(r.variant_name), sku: (r.sku as string | null) ?? null, barcode: (r.barcode as string | null) ?? null, unit: String(r.unit),
  costPrice: num(r.cost_price), sellPrice: num(r.sell_price), stockQtyMilli: num(r.stock_qty_milli), minStockMilli: num(r.min_stock_milli),
  trackStock: asBool(r.track_stock), expiryDate: (r.expiry_date as string | null) ?? null, isActive: asBool(r.is_active),
  photoAttachmentId: (r.photo_attachment_id as string | null) ?? null,
});

export async function listProducts(ctx: Ctx, o: ListProductsOptions = {}): Promise<VariantView[]> {
  const where = [`v."business_id" = ?`, `v."deleted_at" IS NULL`, `p."deleted_at" IS NULL`];
  const params: unknown[] = [ctx.businessId];
  if (!o.includeInactive) { where.push(`p."is_active" = ?`); params.push(dbBool(ctx.db, true)); }
  if (o.categoryId) { where.push(`p."category_id" = ?`); params.push(o.categoryId); }
  if (o.lowStockOnly) {
    where.push(`p."track_stock" = ?`, `v."min_stock_milli" > 0`, `v."stock_qty_milli" <= v."min_stock_milli"`);
    params.push(dbBool(ctx.db, true));
  }
  const s = o.search?.trim();
  if (s) {
    const like = `%${escapeLike(s.toLowerCase())}%`;
    where.push(`(LOWER(p."name") LIKE ? ESCAPE '\\' OR LOWER(v."name") LIKE ? ESCAPE '\\' OR LOWER(COALESCE(v."sku", '')) LIKE ? ESCAPE '\\' OR COALESCE(v."barcode", '') LIKE ? ESCAPE '\\')`);
    params.push(like, like, like, `%${escapeLike(s)}%`);
  }
  const rows = await ctx.db.all(`${VIEW_SELECT} WHERE ${where.join(' AND ')} ORDER BY p."name", v."name" LIMIT ? OFFSET ?`,
    [...params, Math.min(Math.max(o.limit ?? 50, 1), 500), Math.max(o.offset ?? 0, 0)]);
  return rows.map(toView);
}

/** Pemindaian barcode/SKU persis (untuk kasir). */
export async function findByCode(ctx: Ctx, value: string): Promise<VariantView | null> {
  const v = value.trim();
  if (!v) return null;
  const rows = await ctx.db.all(
    `${VIEW_SELECT} WHERE v."business_id" = ? AND v."deleted_at" IS NULL AND p."deleted_at" IS NULL AND (v."barcode" = ? OR v."sku" = ?) LIMIT 1`,
    [ctx.businessId, v, v]);
  return rows[0] ? toView(rows[0]) : null;
}

export async function getVariantView(ctx: Ctx, variantId: string): Promise<VariantView | null> {
  const rows = await ctx.db.all(`${VIEW_SELECT} WHERE v."business_id" = ? AND v."id" = ? AND v."deleted_at" IS NULL AND p."deleted_at" IS NULL`, [ctx.businessId, variantId]);
  return rows[0] ? toView(rows[0]) : null;
}
