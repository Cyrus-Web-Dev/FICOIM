import test from 'node:test';
import assert from 'node:assert/strict';
import { createProduct, createSale, listDebts, payDebt, voidSale, stockCard } from '../src/index';
import { addCustomer, bootstrap, code, count, memberCtx, mk, n, q1, setBusiness, stockOf, wallet } from './helpers';

test('penjualan tunai: total, stok, kas, transaksi, nomor urut, audit — semua konsisten', async () => {
  const w = await bootstrap({ openingCash: 1_000_000 });
  const v = await mk(w.ctx, 'Ponsel X1', 2_100_000, 2_499_000, 3);
  const r = await createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 1000 }] });
  assert.deepEqual([r.subtotal, r.discount, r.tax, r.total, r.paid, r.status], [2_499_000, 0, 0, 2_499_000, 2_499_000, 'paid']);
  assert.equal(r.number, 'PJ-202610-000001');
  assert.equal(await stockOf(w.db, v), 2000);
  assert.equal(await wallet(w.db, w.walletId), 1_000_000 + 2_499_000);
  const tx = await q1(w.db, `SELECT t.amount, t.type, t.occurred_on, c.name cat, t.ref_table, t.ref_id FROM transactions t JOIN finance_categories c ON c.id = t.category_id`);
  assert.deepEqual([n(tx.amount), tx.type, tx.occurred_on, tx.cat, tx.ref_table, tx.ref_id], [2_499_000, 'income', '2026-10-27', 'Penjualan', 'sales', r.saleId]);
  const it = await q1(w.db, 'SELECT name_snapshot, cost_price, line_total FROM sale_items');
  assert.deepEqual([it.name_snapshot, n(it.cost_price), n(it.line_total)], ['Ponsel X1', 2_100_000, 2_499_000]);
  assert.equal(await count(w.db, 'debts'), 0);
  assert.equal((await createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 1000 }] })).number, 'PJ-202610-000002');
  assert.equal(await count(w.db, 'audit_log', `table_name = 'sales'`), 2);
  // ganti bulan -> nomor urut mulai lagi
  w.clock.set('2026-11-02T03:00:00.000Z');
  assert.equal((await createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 1000 }] })).number, 'PJ-202611-000001');
});

test('diskon item + diskon pesanan + PPN 11% dihitung server; qty pecahan (1,5 kg)', async () => {
  const w = await bootstrap();
  const ctx = await setBusiness(w, { tax_bp: 1100 });
  const a = await mk(ctx, 'Gelas', 5000, 10_000, 100);
  const kg = (await createProduct(ctx, { name: 'Kopi Bubuk', unit: 'kg', variants: [{ costPrice: 80_000, sellPrice: 120_000, openingQtyMilli: 10_000 }] })).variantIds[0]!;
  const r = await createSale(ctx, { items: [{ variantId: a, qtyMilli: 10_000, discount: 5000 }, { variantId: kg, qtyMilli: 1500 }], discount: 10_000 });
  // 10x10.000 - 5.000 = 95.000 ; 1,5 x 120.000 = 180.000 ; subtotal 275.000 ; -10.000 = 265.000 ; PPN 11% = 29.150
  assert.deepEqual([r.subtotal, r.discount, r.tax, r.total], [275_000, 10_000, 29_150, 294_150]);
  assert.equal(await stockOf(w.db, kg), 8500);
  assert.equal(await stockOf(w.db, a), 90_000);
});

test('validasi: keranjang kosong, qty/harga tidak valid, diskon berlebih, bayar melebihi total', async () => {
  const w = await bootstrap();
  const v = await mk(w.ctx, 'Item', 1000, 5000, 10);
  const s = (o: object) => createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 1000 }], ...o });
  assert.equal(await code(createSale(w.ctx, { items: [] })), 'VALIDATION');
  assert.equal(await code(createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 0 }] })), 'VALIDATION');
  assert.equal(await code(createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 1.5 }] })), 'VALIDATION');
  assert.equal(await code(createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 1000, unitPrice: -1 }] })), 'VALIDATION');
  assert.equal(await code(createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 1000, discount: 5001 }] })), 'VALIDATION');
  assert.equal(await code(s({ discount: 5001 })), 'VALIDATION');
  assert.equal(await code(s({ paid: 5001 })), 'VALIDATION');
  assert.equal(await code(s({ soldAt: 'kemarin' })), 'VALIDATION');
  assert.equal(await code(s({ soldAt: '2026-12-31T00:00:00.000Z' })), 'VALIDATION'); // terlalu jauh ke depan
  assert.equal(await code(s({ paid: 1000 })), 'VALIDATION'); // kredit tanpa pelanggan
  assert.equal(await code(createSale(w.ctx, { items: [{ variantId: 'x', qtyMilli: 1000 }] })), 'NOT_FOUND');
  assert.equal(await count(w.db, 'sales'), 0);
  assert.equal(await stockOf(w.db, v), 10_000);
});

test('harga manual (nego) dipakai; harga modal tersalin ke baris penjualan', async () => {
  const w = await bootstrap();
  const v = await mk(w.ctx, 'Tas', 70_000, 120_000, 5);
  const r = await createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 2000, unitPrice: 100_000 }] });
  assert.equal(r.total, 200_000);
  assert.equal(n((await q1(w.db, 'SELECT cost_price c FROM sale_items')).c), 70_000);
});

test('stok tidak cukup: ditolak, pesan jelas, dan SELURUH transaksi dibatalkan (termasuk baris yang sudah lolos)', async () => {
  const w = await bootstrap();
  const a = await mk(w.ctx, 'Barang A', 1000, 2000, 10);
  const b = await mk(w.ctx, 'Barang B', 1000, 2000, 1);
  try { await createSale(w.ctx, { items: [{ variantId: a, qtyMilli: 5000 }, { variantId: b, qtyMilli: 2000 }] }); assert.fail(); }
  catch (e) { assert.equal((e as { code: string }).code, 'INSUFFICIENT_STOCK'); assert.match((e as Error).message, /Barang B.*tersedia 1/); }
  assert.equal(await stockOf(w.db, a), 10_000); // baris A (yang sempat berhasil) ikut dibatalkan
  assert.equal(await count(w.db, 'sales'), 0);
  assert.equal(await count(w.db, 'sale_items'), 0);
  assert.equal(await count(w.db, 'stock_movements', `type = 'sale'`), 0);
  assert.equal(await wallet(w.db, w.walletId), 1_000_000);
  // varian yang sama dua baris: total kebutuhan melebihi stok
  assert.equal(await code(createSale(w.ctx, { items: [{ variantId: a, qtyMilli: 6000 }, { variantId: a, qtyMilli: 6000 }] })), 'INSUFFICIENT_STOCK');
  assert.equal(await stockOf(w.db, a), 10_000);
});

test('stok negatif hanya bila bisnis mengizinkan', async () => {
  const w = await bootstrap();
  const v = await mk(w.ctx, 'Item', 1000, 2000, 1);
  assert.equal(await code(createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 3000 }] })), 'INSUFFICIENT_STOCK');
  const ctx = await setBusiness(w, { settings: { allowNegativeStock: true, tzOffsetMinutes: 420 } });
  await createSale(ctx, { items: [{ variantId: v, qtyMilli: 3000 }] });
  assert.equal(await stockOf(w.db, v), -2000);
});

test('BALAPAN: 5 penjualan bersamaan untuk stok 3 -> tepat 3 berhasil, 2 ditolak, stok tidak pernah minus', async () => {
  const w = await bootstrap();
  const v = await mk(w.ctx, 'Langka', 1000, 2000, 3);
  const res = await Promise.all(Array.from({ length: 5 }, () => code(createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 1000 }] }))));
  assert.equal(res.filter((r) => r === 'TIDAK-ERROR').length, 3);
  assert.equal(res.filter((r) => r === 'INSUFFICIENT_STOCK').length, 2);
  assert.equal(await stockOf(w.db, v), 0);
  assert.equal(await count(w.db, 'sales'), 3);
  assert.equal((await q1(w.db, `SELECT COUNT(DISTINCT number) c FROM sales`)).c, 3); // nomor tidak ada yang kembar
});

test('produk non-stok (jasa) tidak membuat mutasi stok; produk nonaktif tidak bisa dijual', async () => {
  const w = await bootstrap();
  const jasa = (await createProduct(w.ctx, { name: 'Jasa Pasang', trackStock: false, variants: [{ sellPrice: 75_000 }] })).variantIds[0]!;
  assert.equal((await createSale(w.ctx, { items: [{ variantId: jasa, qtyMilli: 1000 }] })).total, 75_000);
  assert.equal(await count(w.db, 'stock_movements'), 0);
  const { updateProduct } = await import('../src/index');
  const pid = String((await q1(w.db, 'SELECT product_id p FROM product_variants WHERE id = ?', [jasa])).p);
  await updateProduct(w.ctx, pid, { isActive: false });
  assert.equal(await code(createSale(w.ctx, { items: [{ variantId: jasa, qtyMilli: 1000 }] })), 'VALIDATION');
});

test('cicilan: DP -> piutang; pelunasan bertahap menyinkronkan dompet, hutang, dan dokumen penjualan', async () => {
  const w = await bootstrap({ openingCash: 0 });
  const cust = await addCustomer(w.ctx, 'Rina');
  const v = await mk(w.ctx, 'Laptop', 5_000_000, 6_000_000, 2);
  const r = await createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 1000 }], customerId: cust, paid: 2_000_000, dueDate: '2026-11-15' });
  assert.equal(r.status, 'partial');
  assert.equal(await wallet(w.db, w.walletId), 2_000_000); // hanya uang yang benar-benar diterima
  let debts = await listDebts(w.ctx, { kind: 'receivable' });
  assert.deepEqual([debts[0]!.partyName, debts[0]!.amount, debts[0]!.remaining, debts[0]!.dueDate, debts[0]!.status], ['Rina', 4_000_000, 4_000_000, '2026-11-15', 'open']);

  assert.deepEqual(await payDebt(w.ctx, { debtId: debts[0]!.id, amount: 1_500_000 }), { remaining: 2_500_000, status: 'partial' });
  assert.equal(await wallet(w.db, w.walletId), 3_500_000);
  assert.equal(n((await q1(w.db, 'SELECT paid p FROM sales')).p), 3_500_000);
  assert.equal(await code(payDebt(w.ctx, { debtId: debts[0]!.id, amount: 2_500_001 })), 'VALIDATION');
  assert.deepEqual(await payDebt(w.ctx, { debtId: debts[0]!.id, amount: 2_500_000 }), { remaining: 0, status: 'settled' });
  assert.equal(await wallet(w.db, w.walletId), 6_000_000);
  const s = await q1(w.db, 'SELECT paid, status FROM sales');
  assert.deepEqual([n(s.paid), s.status], [6_000_000, 'paid']);
  assert.equal(await code(payDebt(w.ctx, { debtId: debts[0]!.id, amount: 1 })), 'INVALID_STATE');
  assert.equal((await listDebts(w.ctx, { onlyOpen: true })).length, 0);
  const cat = await q1(w.db, `SELECT c.name FROM transactions t JOIN finance_categories c ON c.id = t.category_id WHERE t.ref_table = 'debt_payments' LIMIT 1`);
  assert.equal(cat.name, 'Pelunasan Piutang');
});

test('belum bayar sama sekali (kredit penuh) -> status unpaid, tanpa transaksi kas', async () => {
  const w = await bootstrap();
  const cust = await addCustomer(w.ctx);
  const v = await mk(w.ctx, 'X', 1000, 5000, 5);
  const r = await createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 2000 }], customerId: cust, paid: 0 });
  assert.equal(r.status, 'unpaid');
  assert.equal(await count(w.db, 'transactions'), 0);
  assert.equal(n((await q1(w.db, 'SELECT amount a FROM debts')).a), 10_000);
});

test('voidSale: stok kembali, kas & piutang & pelunasan dibatalkan, riwayat tetap ada; tidak bisa dua kali', async () => {
  const w = await bootstrap({ openingCash: 500_000 });
  const cust = await addCustomer(w.ctx);
  const v = await mk(w.ctx, 'Monitor', 1_000_000, 1_500_000, 4);
  const r = await createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 2000 }], customerId: cust, paid: 1_000_000 });
  const debt = (await listDebts(w.ctx))[0]!;
  await payDebt(w.ctx, { debtId: debt.id, amount: 500_000 });
  assert.equal(await stockOf(w.db, v), 2000);
  assert.equal(await wallet(w.db, w.walletId), 2_000_000);

  await voidSale(w.ctx, r.saleId, 'Salah input');
  assert.equal(await stockOf(w.db, v), 4000);
  assert.equal(await wallet(w.db, w.walletId), 500_000); // kembali ke saldo awal
  assert.equal((await listDebts(w.ctx)).length, 0);
  assert.equal(await count(w.db, 'transactions', 'deleted_at IS NULL'), 0);
  assert.equal(await count(w.db, 'transactions'), 2); // jejak tetap ada (hapus-lunak)
  const s = await q1(w.db, 'SELECT status, note FROM sales');
  assert.equal(s.status, 'void'); assert.match(String(s.note), /BATAL: Salah input/);
  assert.deepEqual((await stockCard(w.ctx, v)).map((m) => m.type), ['return_in', 'sale', 'initial']);
  assert.equal(await code(voidSale(w.ctx, r.saleId, 'lagi')), 'INVALID_STATE');
  assert.equal(await code(voidSale(w.ctx, 'x', 'apa')), 'NOT_FOUND');
  assert.equal(await code(voidSale(w.ctx, r.saleId, '')), 'VALIDATION');
  const staff = await memberCtx(w, 'staff');
  assert.equal(await code(voidSale(staff, r.saleId, 'coba')), 'FORBIDDEN');
});

test('voidSale untuk produk yang sudah diarsipkan: tidak error, stok arsip tidak disentuh', async () => {
  const w = await bootstrap();
  const v = await mk(w.ctx, 'Lama', 1000, 3000, 5);
  const r = await createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 1000 }] });
  const { deleteProduct } = await import('../src/index');
  await deleteProduct(w.ctx, String((await q1(w.db, 'SELECT product_id p FROM product_variants WHERE id = ?', [v])).p));
  await voidSale(w.ctx, r.saleId, 'batal');
  assert.equal(await stockOf(w.db, v), 4000);
});

test('staf boleh menjual & menagih piutang; waktu penjualan mundur (soldAt) memengaruhi tanggal transaksi lokal', async () => {
  const w = await bootstrap();
  const staff = await memberCtx(w, 'staff');
  const v = await mk(w.ctx, 'Item', 1000, 5000, 10);
  // 2026-10-26 17:30Z = 27 Okt 00:30 WIB ; 2026-10-26 16:30Z = 26 Okt 23:30 WIB
  await createSale(staff, { items: [{ variantId: v, qtyMilli: 1000 }], soldAt: '2026-10-26T17:30:00.000Z' });
  await createSale(staff, { items: [{ variantId: v, qtyMilli: 1000 }], soldAt: '2026-10-26T16:30:00.000Z' });
  const days = (await w.db.all('SELECT occurred_on d FROM transactions ORDER BY occurred_on')).map((r) => r.d);
  assert.deepEqual(days, ['2026-10-26', '2026-10-27']);
  assert.equal(n((await q1(w.db, `SELECT COUNT(*) c FROM sales WHERE created_by = ?`, [staff.actor.memberId])).c), 2);
});
