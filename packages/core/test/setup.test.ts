import test from 'node:test';
import assert from 'node:assert/strict';
import { createBusiness, createProduct, createSale, createPurchase, adjustStock, addTransaction, voidSale, profitLoss, exportBackup, can, loadCtx, PRESETS, DEFAULT_FINANCE_CATEGORIES } from '../src/index';
import { sqliteNodeDb } from '../src/adapters/sqlite-node';
import { bootstrap, code, count, memberCtx, mk, newDb, q1 } from './helpers';
import { DatabaseSync } from 'node:sqlite';
import { nodeRuntime } from '@ficoim/shared/backup/runtime-node';

test('createBusiness: bisnis, pemilik, dompet kas, kategori sesuai jenis usaha, jejak audit', async () => {
  const w = await bootstrap({ type: 'fashion', openingCash: 2_500_000 });
  assert.equal(await count(w.db, 'businesses'), 1);
  assert.equal(await count(w.db, 'members', `role = 'owner'`), 1);
  assert.equal(await count(w.db, 'finance_categories'), DEFAULT_FINANCE_CATEGORIES.length);
  assert.equal(await count(w.db, 'product_categories'), PRESETS.fashion.productCategories.length);
  const wal = await q1(w.db, 'SELECT name, opening_balance, balance FROM wallets');
  assert.deepEqual([wal.name, Number(wal.opening_balance), Number(wal.balance)], ['Kas Toko', 2_500_000, 2_500_000]);
  assert.equal(await count(w.db, 'audit_log', `action = 'create' AND table_name = 'businesses'`), 1);
  assert.equal(w.ctx.tzOffsetMinutes, 420);
});

test('createBusiness: input tidak valid ditolak dan tidak meninggalkan data setengah jadi', async () => {
  const db = newDb();
  assert.equal(await code(createBusiness(db, { name: '  ', businessType: 'fashion', ownerName: 'A' })), 'VALIDATION');
  assert.equal(await code(createBusiness(db, { name: 'X', businessType: 'kripto' as never, ownerName: 'A' })), 'VALIDATION');
  assert.equal(await code(createBusiness(db, { name: 'X', businessType: 'fashion', ownerName: 'A', openingCash: -5 })), 'VALIDATION');
  assert.equal(await count(db, 'businesses'), 0);
});

test('izin per peran: owner, manager, staff', async () => {
  const w = await bootstrap();
  const staff = await memberCtx(w, 'staff');
  const staffR = await memberCtx(w, 'staff', { canViewReports: true, canDelete: true });
  const mgr = await memberCtx(w, 'manager');
  assert.ok(can(w.ctx.actor, 'backup.restore') && can(w.ctx.actor, 'member.manage'));
  assert.ok(can(mgr.actor, 'purchase.create') && can(mgr.actor, 'sale.void') && !can(mgr.actor, 'backup.restore') && !can(mgr.actor, 'member.manage'));
  assert.ok(can(staff.actor, 'sale.create') && can(staff.actor, 'debt.pay'));
  assert.ok(!can(staff.actor, 'product.write') && !can(staff.actor, 'sale.void') && !can(staff.actor, 'report.view') && !can(staff.actor, 'product.delete'));
  assert.ok(can(staffR.actor, 'report.view') && can(staffR.actor, 'product.delete') && !can(staffR.actor, 'stock.adjust'));

  assert.equal(await code(createProduct(staff, { name: 'X' })), 'FORBIDDEN');
  assert.equal(await code(adjustStock(staff, { variantId: 'x', mode: 'set', qtyMilli: 0 })), 'FORBIDDEN');
  assert.equal(await code(createPurchase(staff, { items: [] })), 'FORBIDDEN');
  assert.equal(await code(profitLoss(staff, '2026-10-01', '2026-10-31')), 'FORBIDDEN');
  assert.equal(await code(addTransaction(staff, { walletId: w.walletId, categoryId: 'x', type: 'expense', amount: 1 })), 'FORBIDDEN');
  assert.equal(await code(voidSale(staff, 'x', 'salah')), 'FORBIDDEN');
  assert.equal(await code(exportBackup(staff, { password: 'Rahasia-12345', runtime: nodeRuntime, source: { platform: 'web', appVersion: '1' } })), 'FORBIDDEN');
  // kasir boleh jualan
  const v = await mk(w.ctx, 'Pulpen', 1000, 2000, 10);
  assert.equal((await createSale(staff, { items: [{ variantId: v, qtyMilli: 1000 }] })).status, 'paid');
});

test('loadCtx: anggota nonaktif / dari bisnis lain ditolak', async () => {
  const w = await bootstrap();
  const staff = await memberCtx(w, 'staff');
  await w.db.run('UPDATE members SET is_active = 0 WHERE id = ?', [staff.actor.memberId]);
  assert.equal(await code(loadCtx(w.db, w.businessId, staff.actor.memberId)), 'FORBIDDEN');
  const other = await bootstrap({ db: w.db, name: 'Toko Lain', clock: w.clock });
  assert.equal(await code(loadCtx(w.db, other.businessId, w.ownerId)), 'FORBIDDEN'); // pemilik bisnis A bukan anggota bisnis B
  assert.equal(await code(loadCtx(w.db, '00000000-0000-7000-8000-000000000000', null)), 'NOT_FOUND');
});

test('transaksi bersarang: gagal di dalam membatalkan seluruhnya; transaksi paralel diserialkan', async () => {
  const h = new DatabaseSync(':memory:'); h.exec('CREATE TABLE t (v INTEGER)');
  const db = sqliteNodeDb(h);
  await assert.rejects(db.transaction(async (tx) => {
    await tx.run('INSERT INTO t VALUES (1)');
    await tx.transaction(async (inner) => { await inner.run('INSERT INTO t VALUES (2)'); throw new Error('gagal'); });
  }));
  assert.equal(Number((await db.all('SELECT COUNT(*) c FROM t'))[0]!.c), 0);
  await Promise.all([1, 2, 3, 4, 5].map((i) => db.transaction(async (tx) => { await tx.run('INSERT INTO t VALUES (?)', [i]); await new Promise((r) => setTimeout(r, 5)); })));
  assert.equal(Number((await db.all('SELECT COUNT(*) c FROM t'))[0]!.c), 5);
});
