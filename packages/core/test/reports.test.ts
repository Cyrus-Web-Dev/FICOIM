import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTransaction, createProduct, createPurchase, createSale, createWallet, dashboard, expiringSoon, listWallets, profitLoss, salesByDay, stockValuation, topProducts, transfer, voidSale,
} from '../src/index';
import { bootstrap, memberCtx, mk, q1 } from './helpers';

const cat = async (w: Awaited<ReturnType<typeof bootstrap>>, name: string) => String((await q1(w.db, 'SELECT id FROM finance_categories WHERE name = ?', [name])).id);

test('laba-rugi cocok dengan hitungan tangan; pembelian stok, transfer, dan transaksi batal TIDAK ikut mengacaukan', async () => {
  const w = await bootstrap({ openingCash: 5_000_000 });
  const A = await mk(w.ctx, 'A', 60_000, 100_000, 10);
  const B = await mk(w.ctx, 'B', 20_000, 35_000, 20);
  await createSale(w.ctx, { items: [{ variantId: A, qtyMilli: 2000 }, { variantId: B, qtyMilli: 3000 }] });              // 305.000 | HPP 180.000
  await createSale(w.ctx, { items: [{ variantId: A, qtyMilli: 1000, discount: 5000 }] });                                 //  95.000 | HPP  60.000
  const gone = await createSale(w.ctx, { items: [{ variantId: B, qtyMilli: 10_000 }] });                                  // dibatalkan
  await voidSale(w.ctx, gone.saleId, 'salah');
  await addTransaction(w.ctx, { walletId: w.walletId, categoryId: await cat(w, 'Listrik & Air'), type: 'expense', amount: 50_000 });
  await addTransaction(w.ctx, { walletId: w.walletId, categoryId: await cat(w, 'Sewa'), type: 'expense', amount: 100_000 });
  await addTransaction(w.ctx, { walletId: w.walletId, categoryId: await cat(w, 'Pemasukan Lain'), type: 'income', amount: 7_000 });
  await createPurchase(w.ctx, { items: [{ variantId: B, qtyMilli: 1000, unitCost: 20_000 }] });                           // kas keluar 20.000, bukan biaya
  const bank = await createWallet(w.ctx, { name: 'Bank' });
  await transfer(w.ctx, { fromWalletId: w.walletId, toWalletId: bank, amount: 1_000_000 });

  const r = await profitLoss(w.ctx, '2026-10-01', '2026-10-31');
  assert.equal(r.salesCount, 2);
  assert.deepEqual([r.grossSales, r.tax, r.netRevenue, r.cogs, r.grossProfit], [400_000, 0, 400_000, 240_000, 160_000]);
  assert.deepEqual(r.expensesByCategory, [{ category: 'Sewa', total: 100_000 }, { category: 'Listrik & Air', total: 50_000 }]);
  assert.deepEqual([r.totalExpenses, r.otherIncome, r.netProfit], [150_000, 7_000, 160_000 + 7_000 - 150_000]);
  assert.deepEqual([r.cashIn, r.cashOut], [400_000 + 7_000, 150_000 + 20_000]); // transfer & penjualan batal tidak dihitung
  // di luar rentang -> nol
  const empty = await profitLoss(w.ctx, '2026-09-01', '2026-09-30');
  assert.deepEqual([empty.salesCount, empty.netRevenue, empty.cogs, empty.netProfit], [0, 0, 0, 0]);
  assert.deepEqual((await listWallets(w.ctx)).map((x) => x.balance), [5_000_000 + 400_000 + 7_000 - 150_000 - 20_000 - 1_000_000, 1_000_000]);
});

test('PPN tidak dihitung sebagai pendapatan; batas hari mengikuti zona waktu bisnis (WIB)', async () => {
  const w = await bootstrap();
  await (await import('./helpers')).setBusiness(w, { tax_bp: 1100 });
  const ctx = (await import('../src/index')).loadCtx; const c = await ctx(w.db, w.businessId, w.ownerId, { now: w.clock.now });
  const v = await mk(c, 'X', 40_000, 100_000, 10);
  await createSale(c, { items: [{ variantId: v, qtyMilli: 1000 }], soldAt: '2026-10-26T17:30:00.000Z' }); // 27 Okt 00:30 WIB
  await createSale(c, { items: [{ variantId: v, qtyMilli: 1000 }], soldAt: '2026-10-26T16:30:00.000Z' }); // 26 Okt 23:30 WIB
  const d27 = await profitLoss(c, '2026-10-27', '2026-10-27');
  assert.deepEqual([d27.salesCount, d27.grossSales, d27.tax, d27.netRevenue, d27.cogs, d27.grossProfit], [1, 111_000, 11_000, 100_000, 40_000, 60_000]);
  assert.equal((await profitLoss(c, '2026-10-26', '2026-10-26')).salesCount, 1);
  assert.equal((await profitLoss(c, '2026-10-26', '2026-10-27')).salesCount, 2);
  await assert.rejects(profitLoss(c, '2026-10-28', '2026-10-27'));
});

test('produk terlaris, penjualan harian (hari kosong tetap ada), nilai persediaan', async () => {
  const w = await bootstrap();
  const A = await mk(w.ctx, 'Produk A', 10, 30, 100);
  const B = await mk(w.ctx, 'Produk B', 50, 90, 100);
  await createSale(w.ctx, { items: [{ variantId: A, qtyMilli: 10_000 }, { variantId: B, qtyMilli: 2000 }], soldAt: '2026-10-25T05:00:00.000Z' });
  await createSale(w.ctx, { items: [{ variantId: A, qtyMilli: 5000 }], soldAt: '2026-10-27T01:00:00.000Z' });
  const top = await topProducts(w.ctx, '2026-10-01', '2026-10-31', 5);
  assert.deepEqual(top.map((t) => [t.name, t.qtyMilli, t.revenue, t.cogs, t.profit]), [['Produk A', 15_000, 450, 150, 300], ['Produk B', 2000, 180, 100, 80]]);
  assert.deepEqual(await salesByDay(w.ctx, '2026-10-25', '2026-10-27'), [
    { date: '2026-10-25', total: 480, count: 1 }, { date: '2026-10-26', total: 0, count: 0 }, { date: '2026-10-27', total: 150, count: 1 },
  ]);
  assert.deepEqual(await stockValuation(w.ctx), { items: 2, value: 85 * 10 + 98 * 50 });
});

test('kedaluwarsa & dashboard: stok menipis, tagihan, hak lihat laporan', async () => {
  const w = await bootstrap({ type: 'makanan_minuman', openingCash: 100_000 });
  await createProduct(w.ctx, { name: 'Susu', trackExpiry: true, variants: [{ expiryDate: '2026-10-20', openingQtyMilli: 5000, costPrice: 10, sellPrice: 20 }] });   // sudah lewat
  await createProduct(w.ctx, { name: 'Roti', trackExpiry: true, variants: [{ expiryDate: '2026-11-05', openingQtyMilli: 5000, costPrice: 10, sellPrice: 20 }] });   // 9 hari lagi
  await createProduct(w.ctx, { name: 'Madu', trackExpiry: true, variants: [{ expiryDate: '2027-06-01', openingQtyMilli: 5000, costPrice: 10, sellPrice: 20 }] });   // jauh
  await createProduct(w.ctx, { name: 'Habis', trackExpiry: true, variants: [{ expiryDate: '2026-10-10', openingQtyMilli: 0 }] });                                   // stok 0 -> diabaikan
  const exp = await expiringSoon(w.ctx, 14);
  assert.deepEqual(exp.map((e) => [e.name, e.expired]), [['Susu', true], ['Roti', false]]);
  const low = (await createProduct(w.ctx, { name: 'Gula', variants: [{ openingQtyMilli: 2000, minStockMilli: 5000, costPrice: 10, sellPrice: 20 }] })).variantIds[0]!;
  await createSale(w.ctx, { items: [{ variantId: low, qtyMilli: 1000 }] });
  const d = await dashboard(w.ctx);
  assert.deepEqual([d.salesToday.count, d.salesToday.total, d.lowStockCount, d.expiringCount, d.profitToday, d.cashBalance, d.receivable, d.payable], [1, 20, 1, 2, 10, 100_020, 0, 0]);
  const staff = await memberCtx(w, 'staff');
  const ds = await dashboard(staff);
  assert.deepEqual([ds.salesToday.total, ds.profitToday, ds.cashBalance, ds.receivable, ds.payable], [20, null, null, null, null]);
});
