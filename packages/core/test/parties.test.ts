import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomer, createPurchase, createSale, deleteParty, listCustomers, listPartyStats, updateParty, voidSale } from '../src/index';
import { addSupplier, bootstrap, code, memberCtx, mk } from './helpers';

test('statistik pelanggan: jumlah, total, piutang; dokumen batal tidak dihitung; pelanggan tanpa transaksi tetap tampil', async () => {
  const w = await bootstrap();
  const v = await mk(w.ctx, 'Kabel', 8000, 25_000, 100);
  const rina = await createCustomer(w.ctx, { name: 'Rina', phone: '0812' }), budi = await createCustomer(w.ctx, { name: 'Budi' });
  await createCustomer(w.ctx, { name: 'Citra' });
  await createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 2000 }], customerId: rina });                      // 50.000 lunas
  const s2 = await createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 4000 }], customerId: rina, paid: 30_000 }); // 100.000, sisa 70.000
  const s3 = await createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 1000 }], customerId: budi, paid: 0 });   // 25.000 belum bayar
  await voidSale(w.ctx, s3.saleId, 'salah input');
  void s2;
  const st = await listPartyStats(w.ctx, 'customer');
  const by = Object.fromEntries(st.map((p) => [p.name, p]));
  assert.deepEqual([by.Rina!.docCount, by.Rina!.totalAmount, by.Rina!.outstanding], [2, 150_000, 70_000]);
  assert.equal(by.Rina!.phone, '0812'); assert.ok(by.Rina!.lastAt);
  assert.deepEqual([by.Budi!.docCount, by.Budi!.totalAmount, by.Budi!.outstanding, by.Budi!.lastAt], [0, 0, 0, null]); // satu-satunya penjualan Budi batal
  assert.deepEqual([by.Citra!.docCount, by.Citra!.outstanding], [0, 0]);
  assert.deepEqual((await listPartyStats(w.ctx, 'customer', 'rin')).map((p) => p.name), ['Rina']);
  assert.deepEqual((await listPartyStats(w.ctx, 'customer', '%')).map((p) => p.name), []);   // % bukan wildcard
});

test('statistik pemasok: pembelian hutang', async () => {
  const w = await bootstrap();
  const v = await mk(w.ctx, 'Kabel', 8000, 25_000, 0), sup = await addSupplier(w.ctx);
  await createPurchase(w.ctx, { items: [{ variantId: v, qtyMilli: 10_000, unitCost: 8000 }], supplierId: sup, paid: 20_000 });
  const [p] = await listPartyStats(w.ctx, 'supplier');
  assert.deepEqual([p!.docCount, p!.totalAmount, p!.outstanding], [1, 80_000, 60_000]);
  assert.equal(await code(listPartyStats(w.ctx, 'bogus' as never)), 'VALIDATION');
});

test('ubah & hapus: validasi, izin, isolasi antar-bisnis; riwayat dokumen tetap utuh setelah hapus', async () => {
  const A = await bootstrap(), B = await bootstrap({ db: A.db, name: 'Toko Lain' });
  const v = await mk(A.ctx, 'Kabel', 8000, 25_000, 100);
  const id = await createCustomer(A.ctx, { name: 'Rina' });
  const sale = await createSale(A.ctx, { items: [{ variantId: v, qtyMilli: 1000 }], customerId: id });
  await updateParty(A.ctx, 'customer', id, { name: '  Rina Marlina  ', phone: '0899', address: 'Padang', note: null });
  const [p] = await listPartyStats(A.ctx, 'customer');
  assert.deepEqual([p!.name, p!.phone, p!.address], ['Rina Marlina', '0899', 'Padang']);
  assert.equal(await code(updateParty(A.ctx, 'customer', id, { name: '   ' })), 'VALIDATION');
  assert.equal(await code(updateParty(B.ctx, 'customer', id, { name: 'X' })), 'NOT_FOUND');        // bisnis lain
  assert.equal(await code(updateParty(A.ctx, 'supplier', id, { name: 'X' })), 'NOT_FOUND');         // jenis salah
  const staff = await memberCtx(A, 'staff');
  assert.equal(await code(updateParty(staff, 'customer', id, { name: 'X' })), 'FORBIDDEN');
  assert.equal(await code(deleteParty(staff, 'customer', id)), 'FORBIDDEN');
  assert.equal(await code(listPartyStats(staff, 'customer')), 'FORBIDDEN');                          // berisi angka keuangan
  await deleteParty(A.ctx, 'customer', id);
  assert.deepEqual(await listCustomers(A.ctx), []);
  assert.equal(await code(deleteParty(A.ctx, 'customer', id)), 'NOT_FOUND');
  assert.ok(sale.saleId); // penjualan lama tidak terhapus
});
