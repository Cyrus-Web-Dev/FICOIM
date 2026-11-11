import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryBreakdown, createProduct, createProductCategory, createSale, monthlyTrend } from '../src/index';
import { bootstrap, code, memberCtx } from './helpers';

test('margin per kategori: pendapatan, HPP, laba, margin %; produk tanpa kategori digabung; penjualan di luar periode tidak dihitung; kasir ditolak', async () => {
  const w = await bootstrap();
  const snack = await createProductCategory(w.ctx, { name: 'Camilan' });
  const a = (await createProduct(w.ctx, { name: 'Keripik', categoryId: snack, variants: [{ costPrice: 6000, sellPrice: 10_000, openingQtyMilli: 100_000 }] })).variantIds[0]!;
  const b = (await createProduct(w.ctx, { name: 'Permen', categoryId: snack, variants: [{ costPrice: 1000, sellPrice: 2000, openingQtyMilli: 100_000 }] })).variantIds[0]!;
  const c = (await createProduct(w.ctx, { name: 'Jasa Servis', trackStock: false, variants: [{ costPrice: 0, sellPrice: 50_000 }] })).variantIds[0]!;
  const day = w.clock.now().toISOString();
  await createSale(w.ctx, { items: [{ variantId: a, qtyMilli: 10_000 }, { variantId: b, qtyMilli: 5000 }, { variantId: c, qtyMilli: 1000 }], soldAt: day });
  await createSale(w.ctx, { items: [{ variantId: a, qtyMilli: 1000 }], soldAt: '2020-01-01T03:00:00.000Z' }); // di luar periode
  const from = day.slice(0, 10), to = day.slice(0, 10);
  const rows = await categoryBreakdown(w.ctx, from, to);
  const by = Object.fromEntries(rows.map((r) => [r.category, r]));
  assert.deepEqual([by.Camilan!.revenue, by.Camilan!.cogs, by.Camilan!.profit, by.Camilan!.marginPct], [110_000, 65_000, 45_000, 40.9]); // (100k+10k, 60k+5k)
  assert.equal(by.Camilan!.qtyMilli, 15_000);
  assert.deepEqual([by['Tanpa kategori']!.revenue, by['Tanpa kategori']!.marginPct], [50_000, 100]);
  assert.deepEqual(rows.map((r) => r.category), ['Camilan', 'Tanpa kategori']); // urut pendapatan terbesar (110.000 > 50.000)
  assert.deepEqual(await categoryBreakdown(w.ctx, '2019-01-01', '2019-01-31'), []);
  const staff = await memberCtx(w, 'staff');
  assert.equal(await code(categoryBreakdown(staff, from, to)), 'FORBIDDEN');
});

test('tren bulanan: N bulan terakhir berurutan lama→baru, melintasi pergantian tahun, bulan kosong bernilai 0', async () => {
  const w = await bootstrap();
  const v = (await createProduct(w.ctx, { name: 'Kabel', variants: [{ costPrice: 8000, sellPrice: 25_000, openingQtyMilli: 1_000_000 }] })).variantIds[0]!;
  const now = w.clock.now(); const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  const iso = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}-10T03:00:00.000Z`;
  const prev = m === 1 ? [y - 1, 12] : [y, m - 1];
  await createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 2000 }], soldAt: iso(prev[0]!, prev[1]!) });  // 50.000, laba kotor 34.000
  await createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 1000 }], soldAt: now.toISOString() });            // 25.000, laba kotor 17.000
  const t = await monthlyTrend(w.ctx, 6);
  assert.equal(t.length, 6);
  const keys = t.map((x) => x.month);
  assert.deepEqual(keys, [...keys].sort());                                  // urut menaik
  assert.equal(new Set(keys).size, 6);
  assert.equal(t[5]!.month, `${y}-${String(m).padStart(2, '0')}`);
  assert.deepEqual([t[4]!.revenue, t[4]!.grossProfit], [50_000, 34_000]);
  assert.deepEqual([t[5]!.revenue, t[5]!.grossProfit], [25_000, 17_000]);
  assert.deepEqual([t[0]!.revenue, t[0]!.grossProfit], [0, 0]);
  assert.equal((await monthlyTrend(w.ctx, 999)).length, 24);                 // dibatasi
  assert.equal((await monthlyTrend(w.ctx, 0)).length, 6);                    // tidak valid -> bawaan
  assert.equal(await code(monthlyTrend(await memberCtx(w, 'staff'), 6)), 'FORBIDDEN');
});
