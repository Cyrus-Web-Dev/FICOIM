import test from 'node:test';
import assert from 'node:assert/strict';
import { createSale, exportTables, getVariantView, listProducts, updateVariant, listWallets, profitLoss, adjustStock, createPurchase } from '../src/index';
import { bootstrap, code, count, mk, newDb, makeClock } from './helpers';

test('dua bisnis dalam satu database tidak saling melihat/mengubah data', async () => {
  const db = newDb(), clock = makeClock();
  const A = await bootstrap({ db, clock, name: 'Toko A', openingCash: 100 });
  const B = await bootstrap({ db, clock, name: 'Toko B', openingCash: 200 });
  const va = await mk(A.ctx, 'Barang A', 10, 20, 5, {});
  const vb = await mk(B.ctx, 'Barang B', 10, 20, 5, {});

  assert.deepEqual((await listProducts(A.ctx)).map((p) => p.productName), ['Barang A']);
  assert.deepEqual((await listProducts(B.ctx)).map((p) => p.productName), ['Barang B']);
  assert.equal(await getVariantView(A.ctx, vb), null);
  assert.equal(await code(updateVariant(A.ctx, vb, { sellPrice: 1 })), 'NOT_FOUND');
  assert.equal(await code(createSale(A.ctx, { items: [{ variantId: vb, qtyMilli: 1000 }] })), 'NOT_FOUND');
  assert.equal(await code(adjustStock(A.ctx, { variantId: vb, mode: 'set', qtyMilli: 0 })), 'NOT_FOUND');
  assert.equal(await code(createPurchase(A.ctx, { items: [{ variantId: vb, qtyMilli: 1000, unitCost: 1 }] })), 'NOT_FOUND');
  assert.equal(await code(createSale(A.ctx, { items: [{ variantId: va, qtyMilli: 1000 }], walletId: B.walletId })), 'NOT_FOUND'); // dompet bisnis lain

  await createSale(B.ctx, { items: [{ variantId: vb, qtyMilli: 2000 }] });
  assert.equal((await profitLoss(A.ctx, '2026-10-01', '2026-10-31')).salesCount, 0);
  assert.equal((await profitLoss(B.ctx, '2026-10-01', '2026-10-31')).salesCount, 1);
  assert.deepEqual((await listWallets(A.ctx)).map((x) => x.balance), [100]);

  const ta = await exportTables(A.ctx);
  assert.equal(ta.businesses!.length, 1);
  for (const [name, rows] of Object.entries(ta)) for (const r of rows) assert.equal(name === 'businesses' ? r.id : r.business_id, A.businessId, `bocor di ${name}`);
  assert.equal(ta.sales!.length, 0);
  // nomor dokumen dihitung per bisnis
  assert.equal((await createSale(A.ctx, { items: [{ variantId: va, qtyMilli: 1000 }] })).number, 'PJ-202610-000001');
  assert.equal(await count(db, 'sales'), 2);
});
