import { dbBool, num } from '../db';
import { can, requireCan } from '../permissions';
import type { Ctx } from '../ctx';
import { addDays, localDate, rangeUtc, today } from '../util';


/** Pecahan per baris dibulatkan sama seperti saat penjualan (qty_milli * harga / 1000, setengah naik). */
const LINE_COST_SQL = `((si."qty_milli" * si."cost_price" + 500) / 1000)`;

export interface ProfitLoss {
  from: string; to: string; salesCount: number;
  grossSales: number; tax: number; netRevenue: number; cogs: number; grossProfit: number;
  otherIncome: number; expensesByCategory: { category: string; total: number }[]; totalExpenses: number; netProfit: number;
  cashIn: number; cashOut: number;
}

/**
 * Laba-rugi (akrual untuk penjualan): pendapatan bersih = total penjualan - PPN; HPP dari harga modal saat terjual;
 * biaya operasional = pengeluaran berkategori NON-sistem (pembelian stok, pelunasan hutang, transfer tidak dihitung biaya).
 * cashIn/cashOut = arus kas nyata (tanpa transfer antar dompet).
 */
export async function profitLoss(ctx: Ctx, from: string, to: string): Promise<ProfitLoss> {
  requireCan(ctx, 'report.view');
  const { fromIso, toIso } = rangeUtc(ctx, from, to);
  const b = ctx.businessId;
  const s = (await ctx.db.all(
    `SELECT COUNT(*) AS n, COALESCE(SUM("total"), 0) AS total, COALESCE(SUM("tax"), 0) AS tax FROM "sales"
     WHERE "business_id" = ? AND "deleted_at" IS NULL AND "status" <> 'void' AND "sold_at" >= ? AND "sold_at" < ?`, [b, fromIso, toIso]))[0]!;
  const cogs = num((await ctx.db.all(
    `SELECT COALESCE(SUM(${LINE_COST_SQL}), 0) AS c FROM "sale_items" si JOIN "sales" s ON s."id" = si."sale_id"
     WHERE s."business_id" = ? AND s."deleted_at" IS NULL AND si."deleted_at" IS NULL AND s."status" <> 'void' AND s."sold_at" >= ? AND s."sold_at" < ?`, [b, fromIso, toIso]))[0]!.c);
  const exp = await ctx.db.all(
    `SELECT c."name" AS name, SUM(t."amount") AS total FROM "transactions" t JOIN "finance_categories" c ON c."id" = t."category_id"
     WHERE t."business_id" = ? AND t."deleted_at" IS NULL AND t."type" = 'expense' AND c."is_system" = ? AND t."occurred_on" >= ? AND t."occurred_on" <= ?
     GROUP BY c."name" ORDER BY total DESC, c."name"`, [b, dbBool(ctx.db, false), from, to]);
  const other = num((await ctx.db.all(
    `SELECT COALESCE(SUM(t."amount"), 0) AS v FROM "transactions" t JOIN "finance_categories" c ON c."id" = t."category_id"
     WHERE t."business_id" = ? AND t."deleted_at" IS NULL AND t."type" = 'income' AND c."is_system" = ? AND t."occurred_on" >= ? AND t."occurred_on" <= ?`, [b, dbBool(ctx.db, false), from, to]))[0]!.v);
  const cash = (await ctx.db.all(
    `SELECT COALESCE(SUM(CASE WHEN "type" = 'income' THEN "amount" ELSE 0 END), 0) AS cin, COALESCE(SUM(CASE WHEN "type" = 'expense' THEN "amount" ELSE 0 END), 0) AS cout
     FROM "transactions" WHERE "business_id" = ? AND "deleted_at" IS NULL AND ("ref_table" IS NULL OR "ref_table" <> 'transfers') AND "occurred_on" >= ? AND "occurred_on" <= ?`, [b, from, to]))[0]!;

  const gross = num(s.total), tax = num(s.tax), netRevenue = gross - tax;
  const expensesByCategory = exp.map((r) => ({ category: String(r.name), total: num(r.total) }));
  const totalExpenses = expensesByCategory.reduce((a, x) => a + x.total, 0);
  const grossProfit = netRevenue - cogs;
  return {
    from, to, salesCount: num(s.n), grossSales: gross, tax, netRevenue, cogs, grossProfit, otherIncome: other,
    expensesByCategory, totalExpenses, netProfit: grossProfit + other - totalExpenses, cashIn: num(cash.cin), cashOut: num(cash.cout),
  };
}

export interface TopProduct { variantId: string; name: string; qtyMilli: number; revenue: number; cogs: number; profit: number }

export async function topProducts(ctx: Ctx, from: string, to: string, limit = 10): Promise<TopProduct[]> {
  requireCan(ctx, 'report.view');
  const { fromIso, toIso } = rangeUtc(ctx, from, to);
  const rows = await ctx.db.all(
    `SELECT si."variant_id" AS vid, MAX(si."name_snapshot") AS name, SUM(si."qty_milli") AS qty, SUM(si."line_total") AS revenue, SUM(${LINE_COST_SQL}) AS cogs
     FROM "sale_items" si JOIN "sales" s ON s."id" = si."sale_id"
     WHERE s."business_id" = ? AND s."deleted_at" IS NULL AND si."deleted_at" IS NULL AND s."status" <> 'void' AND s."sold_at" >= ? AND s."sold_at" < ?
     GROUP BY si."variant_id" ORDER BY revenue DESC, name LIMIT ?`, [ctx.businessId, fromIso, toIso, Math.min(Math.max(limit, 1), 100)]);
  return rows.map((r) => ({ variantId: String(r.vid), name: String(r.name), qtyMilli: num(r.qty), revenue: num(r.revenue), cogs: num(r.cogs), profit: num(r.revenue) - num(r.cogs) }));
}

export interface CategoryBreakdown { category: string; qtyMilli: number; revenue: number; cogs: number; profit: number; /** Margin kotor dalam persen (0 bila pendapatan 0). */ marginPct: number }

/** Pendapatan, HPP, dan laba kotor per kategori produk (produk tanpa kategori digabung sebagai "Tanpa kategori"). */
export async function categoryBreakdown(ctx: Ctx, from: string, to: string): Promise<CategoryBreakdown[]> {
  requireCan(ctx, 'report.view');
  const { fromIso, toIso } = rangeUtc(ctx, from, to);
  const rows = await ctx.db.all(
    `SELECT COALESCE(c."name", 'Tanpa kategori') AS category, SUM(si."qty_milli") AS qty, SUM(si."line_total") AS revenue, SUM(${LINE_COST_SQL}) AS cogs
     FROM "sale_items" si JOIN "sales" s ON s."id" = si."sale_id"
     LEFT JOIN "product_variants" v ON v."id" = si."variant_id" LEFT JOIN "products" p ON p."id" = v."product_id" LEFT JOIN "product_categories" c ON c."id" = p."category_id"
     WHERE s."business_id" = ? AND s."deleted_at" IS NULL AND si."deleted_at" IS NULL AND s."status" <> 'void' AND s."sold_at" >= ? AND s."sold_at" < ?
     GROUP BY COALESCE(c."name", 'Tanpa kategori') ORDER BY revenue DESC, category`, [ctx.businessId, fromIso, toIso]);
  return rows.map((r) => {
    const revenue = num(r.revenue), cogs = num(r.cogs);
    return { category: String(r.category), qtyMilli: num(r.qty), revenue, cogs, profit: revenue - cogs, marginPct: revenue > 0 ? Math.round(((revenue - cogs) / revenue) * 1000) / 10 : 0 };
  });
}

export interface MonthTrend { month: string; revenue: number; grossProfit: number; netProfit: number }

/** Tren per bulan untuk `months` bulan terakhir (bulan berjalan = sampai hari ini), terlama dulu. */
export async function monthlyTrend(ctx: Ctx, months = 6): Promise<MonthTrend[]> {
  requireCan(ctx, 'report.view');
  const n = Math.min(Math.max(Math.trunc(months) || 6, 1), 24);
  const t = today(ctx);
  let y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  const out: MonthTrend[] = [];
  for (let i = 0; i < n; i++) {
    const first = `${y}-${String(m).padStart(2, '0')}-01`;
    const last = i === 0 ? t : `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    const pl = await profitLoss(ctx, first, last);
    out.unshift({ month: first.slice(0, 7), revenue: pl.netRevenue, grossProfit: pl.grossProfit, netProfit: pl.netProfit });
    if (--m === 0) { m = 12; y--; }
  }
  return out;
}

/** Penjualan harian (tanggal lokal bisnis); hari tanpa penjualan tetap muncul dengan nilai 0 supaya grafik utuh. */
export async function salesByDay(ctx: Ctx, from: string, to: string): Promise<{ date: string; total: number; count: number }[]> {
  requireCan(ctx, 'report.view');
  const { fromIso, toIso } = rangeUtc(ctx, from, to);
  const rows = await ctx.db.all(
    `SELECT "sold_at", "total" FROM "sales" WHERE "business_id" = ? AND "deleted_at" IS NULL AND "status" <> 'void' AND "sold_at" >= ? AND "sold_at" < ?`, [ctx.businessId, fromIso, toIso]);
  const buckets = new Map<string, { total: number; count: number }>();
  for (let d = from; d <= to; d = addDays(d, 1)) buckets.set(d, { total: 0, count: 0 });
  for (const r of rows) {
    const b = buckets.get(localDate(new Date(String(r.sold_at)), ctx.tzOffsetMinutes));
    if (b) { b.total += num(r.total); b.count++; }
  }
  return [...buckets.entries()].map(([date, v]) => ({ date, ...v }));
}

export async function stockValuation(ctx: Ctx): Promise<{ items: number; value: number }> {
  requireCan(ctx, 'report.view');
  const r = (await ctx.db.all(
    `SELECT COUNT(*) AS n, COALESCE(SUM((v."stock_qty_milli" * v."cost_price" + 500) / 1000), 0) AS value FROM "product_variants" v JOIN "products" p ON p."id" = v."product_id"
     WHERE v."business_id" = ? AND v."deleted_at" IS NULL AND p."deleted_at" IS NULL AND p."track_stock" = ? AND v."stock_qty_milli" > 0`, [ctx.businessId, dbBool(ctx.db, true)]))[0]!;
  return { items: num(r.n), value: num(r.value) };
}

export interface ExpiringItem { variantId: string; name: string; expiryDate: string; stockQtyMilli: number; expired: boolean }

export async function expiringSoon(ctx: Ctx, withinDays = 30): Promise<ExpiringItem[]> {
  const limit = addDays(today(ctx), withinDays), t = today(ctx);
  const rows = await ctx.db.all(
    `SELECT v."id", p."name" AS pn, v."name" AS vn, v."expiry_date", v."stock_qty_milli" FROM "product_variants" v JOIN "products" p ON p."id" = v."product_id"
     WHERE v."business_id" = ? AND v."deleted_at" IS NULL AND p."deleted_at" IS NULL AND p."track_expiry" = ? AND v."expiry_date" IS NOT NULL
       AND v."expiry_date" <= ? AND v."stock_qty_milli" > 0 ORDER BY v."expiry_date"`, [ctx.businessId, dbBool(ctx.db, true), limit]);
  return rows.map((r) => ({
    variantId: String(r.id), name: r.vn === 'Default' ? String(r.pn) : `${r.pn} ${r.vn}`, expiryDate: String(r.expiry_date),
    stockQtyMilli: num(r.stock_qty_milli), expired: String(r.expiry_date) < t,
  }));
}

export interface Dashboard {
  today: string; salesToday: { count: number; total: number };
  lowStockCount: number; expiringCount: number; dueBillsCount: number;
  /** null bila peran tidak berhak melihat laporan. */
  profitToday: number | null; cashBalance: number | null; receivable: number | null; payable: number | null;
}

export async function dashboard(ctx: Ctx): Promise<Dashboard> {
  const t = today(ctx);
  const { fromIso, toIso } = rangeUtc(ctx, t, t);
  const b = ctx.businessId;
  const s = (await ctx.db.all(`SELECT COUNT(*) AS n, COALESCE(SUM("total"), 0) AS total FROM "sales" WHERE "business_id" = ? AND "deleted_at" IS NULL AND "status" <> 'void' AND "sold_at" >= ? AND "sold_at" < ?`, [b, fromIso, toIso]))[0]!;
  const low = num((await ctx.db.all(
    `SELECT COUNT(*) AS n FROM "product_variants" v JOIN "products" p ON p."id" = v."product_id" WHERE v."business_id" = ? AND v."deleted_at" IS NULL AND p."deleted_at" IS NULL AND p."is_active" = ? AND p."track_stock" = ? AND v."min_stock_milli" > 0 AND v."stock_qty_milli" <= v."min_stock_milli"`,
    [b, dbBool(ctx.db, true), dbBool(ctx.db, true)]))[0]!.n);
  const exp = (await expiringSoon(ctx, 14)).length;
  const bills = num((await ctx.db.all(`SELECT COUNT(*) AS n FROM "recurring_bills" WHERE "business_id" = ? AND "deleted_at" IS NULL AND "is_active" = ? AND "next_due_date" <= ?`, [b, dbBool(ctx.db, true), addDays(t, 7)]))[0]!.n);

  let profitToday: number | null = null, cash: number | null = null, rec: number | null = null, pay: number | null = null;
  if (can(ctx.actor, 'report.view')) {
    const pl = await profitLoss(ctx, t, t);
    profitToday = pl.grossProfit;
    cash = num((await ctx.db.all(`SELECT COALESCE(SUM("balance"), 0) AS v FROM "wallets" WHERE "business_id" = ? AND "deleted_at" IS NULL`, [b]))[0]!.v);
    const d = await ctx.db.all(`SELECT "kind", COALESCE(SUM("amount" - "paid_amount"), 0) AS v FROM "debts" WHERE "business_id" = ? AND "deleted_at" IS NULL AND "status" <> 'settled' GROUP BY "kind"`, [b]);
    rec = num(d.find((x) => x.kind === 'receivable')?.v); pay = num(d.find((x) => x.kind === 'payable')?.v);
  }
  return { today: t, salesToday: { count: num(s.n), total: num(s.total) }, lowStockCount: low, expiringCount: exp, dueBillsCount: bills, profitToday, cashBalance: cash, receivable: rec, payable: pay };
}
