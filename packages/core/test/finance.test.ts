import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addPeriod, addTransaction, budgetStatus, completeMaintenance, contributeGoal, createAsset, createFinanceCategory, createGoal, createManualDebt, createRecurringBill,
  createSale, createWallet, deleteTransaction, deleteTransfer, dueBills, listAssets, listDebts, listWallets, loanAsset, payDebt, payRecurringBill, recomputeAll,
  returnAsset, scheduleMaintenance, setBudget, transfer, bookValue, listGoals,
} from '../src/index';
import { bootstrap, code, count, memberCtx, mk, n, q1, wallet } from './helpers';

const cat = async (w: Awaited<ReturnType<typeof bootstrap>>, name: string) => String((await q1(w.db, 'SELECT id FROM finance_categories WHERE name = ?', [name])).id);

test('transaksi manual: saldo dompet, validasi kategori (sistem/jenis), hapus hanya yang manual', async () => {
  const w = await bootstrap({ openingCash: 1_000_000 });
  const sewa = await cat(w, 'Sewa'), lain = await cat(w, 'Pemasukan Lain');
  const t1 = await addTransaction(w.ctx, { walletId: w.walletId, categoryId: sewa, type: 'expense', amount: 300_000, description: 'Sewa Okt' });
  await addTransaction(w.ctx, { walletId: w.walletId, categoryId: lain, type: 'income', amount: 50_000 });
  assert.equal(await wallet(w.db, w.walletId), 750_000);
  assert.equal(await code(addTransaction(w.ctx, { walletId: w.walletId, categoryId: await cat(w, 'Penjualan'), type: 'income', amount: 1 })), 'CONFLICT'); // kategori sistem
  assert.equal(await code(addTransaction(w.ctx, { walletId: w.walletId, categoryId: sewa, type: 'income', amount: 1 })), 'VALIDATION'); // jenis tidak cocok
  assert.equal(await code(addTransaction(w.ctx, { walletId: w.walletId, categoryId: sewa, type: 'expense', amount: 0 })), 'VALIDATION');
  assert.equal(await code(addTransaction(w.ctx, { walletId: w.walletId, categoryId: sewa, type: 'expense', amount: 5, occurredOn: '2026-02-30' })), 'VALIDATION');
  assert.equal(await code(addTransaction(w.ctx, { walletId: 'x', categoryId: sewa, type: 'expense', amount: 5 })), 'NOT_FOUND');
  await deleteTransaction(w.ctx, t1);
  assert.equal(await wallet(w.db, w.walletId), 1_050_000);
  // transaksi otomatis dari penjualan tidak boleh dihapus manual
  const v = await mk(w.ctx, 'X', 1, 2, 5);
  await createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 1000 }] });
  const auto = String((await q1(w.db, `SELECT id FROM transactions WHERE ref_table = 'sales'`)).id);
  assert.equal(await code(deleteTransaction(w.ctx, auto)), 'CONFLICT');
  const staff = await memberCtx(w, 'staff');
  assert.equal(await code(deleteTransaction(staff, t1)), 'FORBIDDEN');
});

test('dompet & kategori: nama tidak boleh kembar; transfer memindahkan saldo tanpa dianggap pendapatan/biaya', async () => {
  const w = await bootstrap({ openingCash: 1_000_000 });
  const bank = await createWallet(w.ctx, { name: 'BCA', type: 'bank', openingBalance: 5_000_000 });
  assert.equal(await code(createWallet(w.ctx, { name: 'BCA' })), 'CONFLICT');
  assert.equal(await code(createWallet(w.ctx, { name: 'X', type: 'kripto' })), 'VALIDATION');
  await createFinanceCategory(w.ctx, { name: 'Parkir', type: 'expense' });
  assert.equal(await code(createFinanceCategory(w.ctx, { name: ' parkir ', type: 'expense' })), 'CONFLICT');
  const id = await transfer(w.ctx, { fromWalletId: bank, toWalletId: w.walletId, amount: 2_000_000 });
  assert.deepEqual((await listWallets(w.ctx)).map((x) => [x.name, x.balance]), [['Kas Toko', 3_000_000], ['BCA', 3_000_000]]);
  assert.equal(await code(transfer(w.ctx, { fromWalletId: bank, toWalletId: bank, amount: 1 })), 'VALIDATION');
  await deleteTransfer(w.ctx, id);
  assert.deepEqual((await listWallets(w.ctx)).map((x) => x.balance), [1_000_000, 5_000_000]);
  assert.equal(await code(deleteTransfer(w.ctx, id)), 'NOT_FOUND');
});

test('anggaran: terpakai dihitung per kategori & bulan; set ulang = perbarui, bukan duplikat', async () => {
  const w = await bootstrap();
  const listrik = await cat(w, 'Listrik & Air'), sewa = await cat(w, 'Sewa');
  await addTransaction(w.ctx, { walletId: w.walletId, categoryId: listrik, type: 'expense', amount: 400_000, occurredOn: '2026-10-05' });
  await addTransaction(w.ctx, { walletId: w.walletId, categoryId: listrik, type: 'expense', amount: 300_000, occurredOn: '2026-10-31' });
  await addTransaction(w.ctx, { walletId: w.walletId, categoryId: listrik, type: 'expense', amount: 999_000, occurredOn: '2026-11-01' }); // bulan lain
  await addTransaction(w.ctx, { walletId: w.walletId, categoryId: sewa, type: 'expense', amount: 111, occurredOn: '2026-10-05' });
  const b1 = await setBudget(w.ctx, { categoryId: listrik, amountLimit: 1_000_000, month: 10, year: 2026 });
  assert.equal(await setBudget(w.ctx, { categoryId: listrik, amountLimit: 800_000, month: 10, year: 2026 }), b1);
  assert.equal(await count(w.db, 'budgets'), 1);
  const [s] = await budgetStatus(w.ctx, 10, 2026);
  assert.deepEqual([s!.limit, s!.spent, s!.remaining, s!.percentUsed], [800_000, 700_000, 100_000, 88]);
  assert.equal(await code(setBudget(w.ctx, { categoryId: await cat(w, 'Pemasukan Lain'), amountLimit: 1, month: 10, year: 2026 })), 'VALIDATION');
  assert.equal(await code(setBudget(w.ctx, { categoryId: listrik, amountLimit: 1, month: 13, year: 2026 })), 'VALIDATION');
});

test('tagihan berulang: jatuh tempo, bayar -> transaksi + jatuh tempo maju; addPeriod memotong akhir bulan', async () => {
  assert.equal(addPeriod('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(addPeriod('2028-01-31', 'monthly'), '2028-02-29'); // kabisat
  assert.equal(addPeriod('2026-12-31', 'monthly'), '2027-01-31');
  assert.equal(addPeriod('2028-02-29', 'yearly'), '2029-02-28');
  assert.equal(addPeriod('2026-12-28', 'weekly'), '2027-01-04');
  const w = await bootstrap({ openingCash: 1_000_000 });
  const bill = await createRecurringBill(w.ctx, { walletId: w.walletId, categoryId: await cat(w, 'Listrik & Air'), amount: 250_000, description: 'Listrik toko', nextDueDate: '2026-10-30' });
  await createRecurringBill(w.ctx, { walletId: w.walletId, categoryId: await cat(w, 'Sewa'), amount: 1, nextDueDate: '2026-12-01' });
  assert.deepEqual((await dueBills(w.ctx, 7)).map((b) => [b.description, b.overdue]), [['Listrik toko', false]]); // hari ini 27 Okt
  w.clock.set('2026-11-02T03:00:00.000Z');
  assert.equal((await dueBills(w.ctx, 7))[0]!.overdue, true);
  assert.deepEqual(await payRecurringBill(w.ctx, bill, '2026-11-02'), { nextDueDate: '2026-11-30' });
  assert.equal(await wallet(w.db, w.walletId), 750_000);
  assert.equal((await dueBills(w.ctx, 7)).length, 0);
});

test('target tabungan & hutang/piutang manual', async () => {
  const w = await bootstrap();
  const g = await createGoal(w.ctx, { title: 'Etalase', targetAmount: 12_000_000 });
  assert.equal(await contributeGoal(w.ctx, g, 3_000_000), 3_000_000);
  assert.equal(await contributeGoal(w.ctx, g, 1_000_000), 4_000_000);
  assert.equal(await code(contributeGoal(w.ctx, 'x', 1)), 'NOT_FOUND');
  assert.deepEqual((await listGoals(w.ctx)).map((x) => [x.title, x.targetAmount, x.currentAmount, x.percent]), [['Etalase', 12_000_000, 4_000_000, 33]]);
  const d = await createManualDebt(w.ctx, { kind: 'payable', partyName: 'Pak Haji', amount: 2_000_000, dueDate: '2026-12-01' });
  await payDebt(w.ctx, { debtId: d, amount: 500_000 });
  assert.equal(await wallet(w.db, w.walletId), 500_000); // 1.000.000 - 500.000
  assert.equal((await listDebts(w.ctx))[0]!.remaining, 1_500_000);
});

test('recomputeAll memperbaiki cache yang rusak (saldo dompet, stok, status hutang)', async () => {
  const w = await bootstrap({ openingCash: 1_000_000 });
  const v = await mk(w.ctx, 'X', 10, 20, 5);
  await createSale(w.ctx, { items: [{ variantId: v, qtyMilli: 2000 }] });
  await w.db.run('UPDATE wallets SET balance = 12345');
  await w.db.run('UPDATE product_variants SET stock_qty_milli = 999');
  await recomputeAll(w.ctx);
  assert.equal(await wallet(w.db, w.walletId), 1_000_040);
  assert.equal(n((await q1(w.db, 'SELECT stock_qty_milli s FROM product_variants')).s), 3000);
});

test('aset: penyusutan garis lurus, pinjam/kembali, perawatan dengan biaya otomatis tercatat sebagai pengeluaran', async () => {
  assert.equal(bookValue({ purchasePrice: 120_000_000, salvageValue: 24_000_000, usefulLifeMonths: 96, purchaseDate: '2024-02-10' }, '2026-10-27'), 120_000_000 - 8_000_000 * 1 * 0 - Math.floor((96_000_000 * 32) / 96));
  assert.equal(bookValue({ purchasePrice: 1000, salvageValue: 100, usefulLifeMonths: 10, purchaseDate: '2020-01-01' }, '2030-01-01'), 100); // tidak di bawah nilai sisa
  assert.equal(bookValue({ purchasePrice: 1000, salvageValue: 0, usefulLifeMonths: null, purchaseDate: null }, '2026-01-01'), 1000);
  const w = await bootstrap({ openingCash: 1_000_000 });
  const a = await createAsset(w.ctx, { name: 'Mobil Box', kind: 'vehicle', code: 'AST-1', purchasePrice: 100_000_000, salvageValue: 20_000_000, usefulLifeMonths: 80, purchaseDate: '2026-04-27', plateNumber: 'BP 1 XY' });
  assert.equal(await code(createAsset(w.ctx, { name: 'Lain', code: 'AST-1' })), 'CONFLICT');
  assert.equal(await code(createAsset(w.ctx, { name: 'Lain', purchasePrice: 10, salvageValue: 11 })), 'VALIDATION');
  assert.equal((await listAssets(w.ctx))[0]!.bookValue, 94_000_000); // 6 bulan x 1.000.000
  assert.deepEqual([(await listAssets(w.ctx))[0]!.activeLoan, (await listAssets(w.ctx))[0]!.pendingMaintenance], [null, null]);
  const loan = await loanAsset(w.ctx, { assetId: a, borrowerName: 'Sari', purpose: 'Antar barang' });
  assert.deepEqual([(await listAssets(w.ctx))[0]!.activeLoan!.id, (await listAssets(w.ctx))[0]!.activeLoan!.borrowerName], [loan, 'Sari']);
  assert.equal(await code(loanAsset(w.ctx, { assetId: a, borrowerName: 'Doni' })), 'INVALID_STATE');
  assert.equal((await listAssets(w.ctx))[0]!.status, 'dipinjam');
  await returnAsset(w.ctx, loan, 'perlu_perawatan');
  assert.equal(await code(returnAsset(w.ctx, loan)), 'INVALID_STATE');
  assert.equal((await listAssets(w.ctx))[0]!.status, 'tersedia');
  const m = await scheduleMaintenance(w.ctx, { assetId: a, scheduledOn: '2026-11-20', description: 'Servis 40.000 km' });
  assert.deepEqual((await listAssets(w.ctx))[0]!.pendingMaintenance, { id: m, scheduledOn: '2026-11-20', description: 'Servis 40.000 km' });
  assert.equal((await listAssets(w.ctx))[0]!.activeLoan, null); // sudah dikembalikan
  await completeMaintenance(w.ctx, m, { cost: 450_000 });
  assert.equal(await wallet(w.db, w.walletId), 550_000);
  assert.equal(await code(completeMaintenance(w.ctx, m, {})), 'INVALID_STATE');
  assert.equal((await q1(w.db, `SELECT c.name n FROM transactions t JOIN finance_categories c ON c.id = t.category_id WHERE t.ref_table = 'asset_maintenance'`)).n, 'Perawatan Aset');
});
