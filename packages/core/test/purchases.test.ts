import test from 'node:test';
import assert from 'node:assert/strict';
import { createPurchase, createSale, listDebts, payDebt, voidPurchase, weightedAverageCost } from '../src/index';
import { addSupplier, bootstrap, code, count, mk, n, q1, stockOf, wallet } from './helpers';

test('weightedAverageCost: rata-rata tertimbang, pembulatan, stok nol/minus, angka besar', () => {
  assert.equal(weightedAverageCost(4000, 80, 6000, 100), 92);
  assert.equal(weightedAverageCost(0, 80, 6000, 100), 100);
  assert.equal(weightedAverageCost(-2000, 80, 6000, 100), 100);
  assert.equal(weightedAverageCost(1000, 100, 2000, 101), 101); // 100,67 -> 101
  assert.equal(weightedAverageCost(1000, 100, 1000, 101), 101); // 100,5 -> naik
  assert.equal(weightedAverageCost(9e9, 9e9, 1000, 9e9), 9e9); // tanpa meluap 2^53
});

test('pembelian tunai: stok naik, harga pokok rata-rata, kas turun, kategori Pembelian Stok (bukan biaya operasional)', async () => {
  const w = await bootstrap({ openingCash: 2_000_000 });
  const sup = await addSupplier(w.ctx);
  const v = await mk(w.ctx, 'Beras 5kg', 80, 120, 4); // modal 80, stok 4
  const r = await createPurchase(w.ctx, { items: [{ variantId: v, qtyMilli: 6000, unitCost: 100 }], supplierId: sup });
  assert.deepEqual([r.subtotal, r.total, r.paid, r.status, r.number], [600, 600, 600, 'paid', 'PB-202610-000001']);
  assert.equal(await stockOf(w.db, v), 10_000);
  assert.equal(n((await q1(w.db, 'SELECT cost_price c FROM product_variants WHERE id = ?', [v])).c), 92); // (4x80 + 6x100) / 10
  assert.equal(await wallet(w.db, w.walletId), 2_000_000 - 600);
  const t = await q1(w.db, `SELECT c.name cat, t.type FROM transactions t JOIN finance_categories c ON c.id = t.category_id WHERE t.ref_table = 'purchases'`);
  assert.deepEqual([t.cat, t.type], ['Pembelian Stok', 'expense']);
});

test('pembelian hutang: DP + hutang ke pemasok, lalu dilunasi bertahap', async () => {
  const w = await bootstrap({ openingCash: 10_000_000 });
  const sup = await addSupplier(w.ctx, 'CV Makmur');
  const v = await mk(w.ctx, 'Kulkas', 0, 3_000_000, 0);
  const r = await createPurchase(w.ctx, { items: [{ variantId: v, qtyMilli: 5000, unitCost: 2_000_000 }], supplierId: sup, paid: 4_000_000, discount: 500_000, dueDate: '2026-11-30' });
  assert.deepEqual([r.subtotal, r.total, r.paid, r.status], [10_000_000, 9_500_000, 4_000_000, 'partial']);
  assert.equal(await wallet(w.db, w.walletId), 6_000_000);
  const d = (await listDebts(w.ctx, { kind: 'payable' }))[0]!;
  assert.deepEqual([d.partyName, d.remaining, d.dueDate], ['CV Makmur', 5_500_000, '2026-11-30']);
  await payDebt(w.ctx, { debtId: d.id, amount: 5_500_000 });
  assert.equal(await wallet(w.db, w.walletId), 500_000);
  const p = await q1(w.db, 'SELECT paid, status FROM purchases');
  assert.deepEqual([n(p.paid), p.status], [9_500_000, 'paid']);
  assert.equal((await q1(w.db, `SELECT c.name n FROM transactions t JOIN finance_categories c ON c.id = t.category_id WHERE t.ref_table = 'debt_payments'`)).n, 'Pembayaran Hutang');
});

test('validasi pembelian', async () => {
  const w = await bootstrap();
  const v = await mk(w.ctx, 'X', 1, 2, 1);
  assert.equal(await code(createPurchase(w.ctx, { items: [] })), 'VALIDATION');
  assert.equal(await code(createPurchase(w.ctx, { items: [{ variantId: v, qtyMilli: 1000, unitCost: -1 }] })), 'VALIDATION');
  assert.equal(await code(createPurchase(w.ctx, { items: [{ variantId: v, qtyMilli: 1000, unitCost: 10 }], paid: 5 })), 'VALIDATION'); // hutang tanpa pemasok
  assert.equal(await code(createPurchase(w.ctx, { items: [{ variantId: v, qtyMilli: 1000, unitCost: 10 }], paid: 11 })), 'VALIDATION');
  assert.equal(await code(createPurchase(w.ctx, { items: [{ variantId: v, qtyMilli: 1000, unitCost: 10 }], discount: 11 })), 'VALIDATION');
  assert.equal(await code(createPurchase(w.ctx, { items: [{ variantId: 'x', qtyMilli: 1000, unitCost: 10 }] })), 'NOT_FOUND');
  assert.equal(await count(w.db, 'purchases'), 0);
});

test('voidPurchase: stok & kas dikembalikan; gagal total bila sebagian sudah terjual', async () => {
  const w = await bootstrap({ openingCash: 1_000_000 });
  const v = await mk(w.ctx, 'Item', 100, 200, 0);
  const p1 = await createPurchase(w.ctx, { items: [{ variantId: v, qtyMilli: 10_000, unitCost: 100 }] });
  await voidPurchase(w.ctx, p1.purchaseId, 'salah catat');
  assert.equal(await stockOf(w.db, v), 0);
  assert.equal(await wallet(w.db, w.walletId), 1_000_000);
  assert.equal(await code(voidPurchase(w.ctx, p1.purchaseId, 'lagi')), 'INVALID_STATE');

  const p2 = await createPurchase(w.ctx, { items: [{ variantId: v, qtyMilli: 5000, unitCost: 100 }] });
  await createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 3000 }] });
  assert.equal(await code(voidPurchase(w.ctx, p2.purchaseId, 'batal')), 'INSUFFICIENT_STOCK'); // hanya 2 tersisa dari 5
  assert.equal(await stockOf(w.db, v), 2000);
  assert.equal((await q1(w.db, 'SELECT status s FROM purchases WHERE id = ?', [p2.purchaseId])).s, 'paid'); // tidak setengah batal
  assert.equal(await count(w.db, 'transactions', `ref_table = 'purchases' AND deleted_at IS NULL`), 1);
});
