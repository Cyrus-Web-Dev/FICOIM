import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { nodeRuntime } from '@ficoim/shared/backup/runtime-node';
import { memoryBlobStore } from '@ficoim/core';
import { ApiClient, RemoteBackend, memoryTokenStore, todayLocal, type Backend } from '../src/index';
import { LocalBackend } from '../src/local';
import { newDb } from '../../core/test/helpers';
import { BPW, PW, bootApi, closeAll } from './server';

after(closeAll);

/**
 * Skenario bisnis lengkap yang dijalankan di backend mana pun. Mengembalikan "transkrip" angka (tanpa id/waktu).
 * Bila RemoteBackend (web) dan LocalBackend (mobile) menghasilkan transkrip yang sama persis, perilaku keduanya identik.
 */
async function scenario(b: Backend): Promise<Record<string, unknown>> {
  const t: Record<string, unknown> = {};
  const today = todayLocal();
  const biz = await b.business(); t.biz = [biz.name, biz.businessType, biz.taxBp];
  await b.updateBusiness({ taxBp: 1100 }); t.tax = (await b.business()).taxBp;
  t.catBefore = (await b.listProductCategories()).length;
  const cat = await b.createProductCategory('Kategori Uji'); t.catAfter = (await b.listProductCategories()).length;

  const p = await b.createProduct({ name: 'Ponsel X1', categoryId: cat, unit: 'unit', variants: [
    { name: '128GB', sku: 'X1-128', barcode: '8991', costPrice: 2_000_000, sellPrice: 2_500_000, openingQtyMilli: 5000, minStockMilli: 2000 },
    { name: '256GB', sku: 'X1-256', costPrice: 2_400_000, sellPrice: 3_000_000, openingQtyMilli: 1000 }] });
  const kabel = await b.createProduct({ name: 'Kabel', variants: [{ costPrice: 8000, sellPrice: 25_000, openingQtyMilli: 40_000 }] });
  const jasa = await b.createProduct({ name: 'Jasa Pasang', trackStock: false, variants: [{ sellPrice: 50_000 }] });
  t.list = (await b.listProducts()).map((v) => [v.productName, v.variantName, v.stockQtyMilli, v.sellPrice, v.categoryName]);
  t.byCode = (await b.findByCode('8991'))?.variantName; t.byCodeMissing = await b.findByCode('tidak-ada');
  t.search = [(await b.listProducts({ search: 'x1' })).length, (await b.listProducts({ search: '%' })).length, (await b.listProducts({ lowStockOnly: true })).length];
  const cu = await b.createCustomer({ name: 'Rina', phone: '0812' }), su = await b.createSupplier({ name: 'PT Jaya' });
  t.parties = [(await b.listCustomers()).map((x) => x.name), (await b.listSuppliers('jay')).map((x) => x.name)];

  const s1 = await b.createSale({ items: [{ variantId: p.variantIds[0]!, qtyMilli: 2000 }, { variantId: kabel.variantIds[0]!, qtyMilli: 1500, discount: 5000 }], discount: 10_000 });
  t.sale1 = [s1.subtotal, s1.discount, s1.tax, s1.total, s1.paid, s1.status, s1.number.endsWith('000001')];
  const s2 = await b.createSale({ items: [{ variantId: p.variantIds[1]!, qtyMilli: 1000 }, { variantId: jasa.variantIds[0]!, qtyMilli: 1000 }], customerId: cu, paid: 1_000_000, dueDate: '2030-01-01' });
  t.sale2 = [s2.total, s2.status];
  t.debts = (await b.listDebts({ onlyOpen: true })).map((d) => [d.kind, d.partyName, d.amount, d.remaining, d.status]);
  const debt = (await b.listDebts({ kind: 'receivable' }))[0]!;
  const pay = await b.payDebt(debt.id, { amount: 500_000 }); t.pay = [pay.remaining, pay.status];
  t.sales = (await b.listSales()).map((s) => [s.number.slice(-6), s.total, s.paid, s.status, s.party]);
  t.detail = (await b.getSale(s1.saleId)).items.map((i) => [i.name, i.qtyMilli, i.unitPrice, i.discount, i.lineTotal]);
  t.card = (await b.stockCard(p.variantIds[0]!)).map((m) => [m.type, m.deltaMilli]);
  await b.adjustStock(kabel.variantIds[0]!, { mode: 'set', qtyMilli: 30_000, note: 'opname' });
  t.stockKabel = (await b.listProducts({ search: 'kabel' }))[0]!.stockQtyMilli;
  await b.voidSale(s2.saleId, 'uji batal');
  t.afterVoid = [(await b.listProducts({ search: '256' }))[0]!.stockQtyMilli, (await b.listDebts()).length, (await b.listSales({ status: 'void' })).length];

  const po = await b.createPurchase({ items: [{ variantId: kabel.variantIds[0]!, qtyMilli: 10_000, unitCost: 9000 }], supplierId: su, paid: 50_000, discount: 1000 });
  t.po = [po.total, po.paid, po.status, po.number.endsWith('000001')];
  const pdebt = (await b.listDebts({ kind: 'payable' }))[0]!; t.payable = [pdebt.partyName, pdebt.remaining];
  await b.payDebt(pdebt.id, { amount: pdebt.remaining });
  t.pos = (await b.listPurchases()).map((x) => [x.total, x.paid, x.status]);
  t.kabelCost = (await b.listProducts({ search: 'kabel' }))[0]!.costPrice;

  const wallets = await b.listWallets();
  const bank = await b.createWallet({ name: 'Bank', type: 'bank', openingBalance: 2_000_000 });
  const cats = await b.listFinanceCategories();
  const cid = (n: string) => cats.find((c) => c.name === n)!.id;
  await b.addTransaction({ walletId: wallets[0]!.id, categoryId: cid('Sewa'), type: 'expense', amount: 300_000, occurredOn: today, description: 'Sewa' });
  const lain = await b.addTransaction({ walletId: wallets[0]!.id, categoryId: cid('Pemasukan Lain'), type: 'income', amount: 70_000, occurredOn: today });
  await b.deleteTransaction(lain);
  await b.transfer({ fromWalletId: wallets[0]!.id, toWalletId: bank, amount: 400_000 });
  t.wallets = (await b.listWallets()).map((w) => [w.name, w.balance]);
  t.txs = (await b.listTransactions({ limit: 50 })).map((x) => [x.walletName, x.categoryName, x.type, x.amount, x.auto]).sort();
  await b.setBudget({ categoryId: cid('Sewa'), amountLimit: 500_000, month: Number(today.slice(5, 7)), year: Number(today.slice(0, 4)) });
  t.budget = (await b.budgetStatus(Number(today.slice(5, 7)), Number(today.slice(0, 4)))).map((x) => [x.categoryName, x.limit, x.spent, x.percentUsed]);
  const bill = await b.createBill({ walletId: bank, categoryId: cid('Listrik & Air'), amount: 250_000, nextDueDate: today });
  t.bills = (await b.dueBills(7)).map((x) => [x.amount, x.overdue]);
  const nb = await b.payBill(bill); t.nextDue = nb.nextDueDate > today;
  const goal = await b.createGoal({ title: 'Etalase', targetAmount: 5_000_000 }); t.goal = await b.contributeGoal(goal, 1_000_000); t.goals = (await b.listGoals()).map((g) => [g.title, g.currentAmount, g.percent]);
  const md = await b.createDebt({ kind: 'payable', partyName: 'Pak Haji', amount: 200_000 }); await b.payDebt(md, { amount: 50_000, walletId: bank });

  const asset = await b.createAsset({ name: 'Etalase Kaca', kind: 'furniture', purchasePrice: 3_000_000, code: 'A-1' });
  const loan = await b.loanAsset(asset, { borrowerName: 'Sari' }); t.assetLoan = [(await b.listAssets())[0]!.status, (await b.listAssets())[0]!.activeLoan?.borrowerName];
  await b.returnAsset(loan); t.assetBack = (await b.listAssets())[0]!.status;
  const m = await b.scheduleMaintenance(asset, { scheduledOn: today, description: 'Servis' }); t.pendingMaint = (await b.listAssets())[0]!.pendingMaintenance?.description; await b.completeMaintenance(m, { cost: 100_000, walletId: bank });

  const pl = await b.profitLoss(today, today);
  t.pl = [pl.salesCount, pl.grossSales, pl.tax, pl.netRevenue, pl.cogs, pl.grossProfit, pl.otherIncome, pl.totalExpenses, pl.netProfit, pl.cashIn, pl.cashOut, pl.expensesByCategory.map((e) => [e.category, e.total])];
  t.top = (await b.topProducts(today, today)).map((x) => [x.name, x.qtyMilli, x.revenue, x.profit]);
  t.byDay = (await b.salesByDay(today, today)).map((d) => [d.total, d.count]);
  t.stockValue = await b.stockValue();
  const d = await b.dashboard(); t.dash = [d.salesToday.count, d.salesToday.total, d.lowStockCount, d.profitToday, d.cashBalance, d.receivable, d.payable];

  // grafik laporan
  t.byCategory = (await b.categoryBreakdown(today, today)).map((c) => [c.category, c.revenue, c.profit, c.marginPct]);
  t.trend = (await b.monthlyTrend(3)).map((m) => [m.revenue, m.grossProfit]);

  // pelanggan & pemasok: statistik, ubah, validasi — identik di web dan HP
  const ps = await b.listPartyStats('customer');
  t.parties = ps.map((p) => [p.name, p.docCount, p.totalAmount, p.outstanding]);
  const pid = ps[0]!.id; await b.updateParty('customer', pid, { phone: '0812' });
  t.partyEdit = (await b.listPartyStats('customer')).find((p) => p.id === pid)!.phone;
  await assert.rejects(b.updateParty('customer', pid, { name: ' ' }), /Nama/);
  t.suppliers = (await b.listPartyStats('supplier')).map((p) => [p.name, p.docCount, p.outstanding]);

  // gambar: foto produk + nota pembelian — perilaku harus identik di web (HTTP) dan mobile (lokal)
  const jpeg = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i < 3 ? [0xff, 0xd8, 0xff][i]! : (i * 17 + seed) & 255));
  const foto = jpeg(2000, 3), nota = jpeg(1500, 4);
  const up = await b.uploadImage({ bytes: foto, fileName: 'ponsel.jpg' });
  t.up = [up.mime, up.sizeBytes, up.fileName];
  await b.createProduct({ name: 'Berfoto', photoAttachmentId: up.id, variants: [{ sellPrice: 1000 }] });
  const got = await b.getImage(up.id);
  t.photo = [(await b.listProducts({ search: 'berfoto' }))[0]!.photoAttachmentId === up.id, got.mime, got.bytes.length, got.bytes.every((x, i) => x === foto[i])];
  const up2 = await b.uploadImage({ bytes: nota, fileName: 'nota.jpg' });
  await b.createPurchase({ items: [{ variantId: kabel.variantIds[0]!, qtyMilli: 1000, unitCost: 9000 }], receiptAttachmentId: up2.id });
  t.nota = [(await b.listPurchases())[0]!.receiptAttachmentId === up2.id, (await b.listPurchases()).filter((x) => x.receiptAttachmentId).length];
  await assert.rejects(b.uploadImage({ bytes: new TextEncoder().encode('bukan gambar') }), /bukan gambar/i);
  await assert.rejects(b.getImage('018f0000-0000-7000-8000-000000000000'));

  // backup: ekspor lalu gabung dirinya sendiri = tidak ada perubahan
  const ex = await b.exportBackup(BPW); t.exp = [/^ficoim-[a-z0-9-]+-\d{8}-\d{4}\.ficoim$/.test(ex.fileName), String.fromCharCode(...ex.bytes.subarray(0, 6))];
  const rep = await b.restoreBackup({ password: BPW, mode: 'merge', bytes: ex.bytes });
  t.merge = [rep.inserted, rep.updated, rep.remapped, rep.renumbered, rep.replacementMemberId];
  t.after = (await b.listProducts()).length;
  return t;
}

test('KONTRAK: RemoteBackend (web) dan LocalBackend (mobile) menghasilkan transkrip identik untuk skenario bisnis lengkap', async () => {
  const s = await bootApi();
  const api = new ApiClient({ baseUrl: s.baseUrl, tokens: memoryTokenStore(), client: 'mobile' });
  await api.register({ email: 'budi@toko.id', password: PW, displayName: 'Budi', businessName: 'Toko Uji', businessType: 'elektronik', openingCash: 1_000_000 });
  const remote = new RemoteBackend(api);

  const local = new LocalBackend({ db: newDb(), runtime: nodeRuntime, appVersion: 't', blobStore: memoryBlobStore() });
  assert.equal(await local.hasBusiness(), false);
  await local.createBusiness({ name: 'Toko Uji', businessType: 'elektronik', ownerName: 'Budi', openingCash: 1_000_000 });
  assert.equal(await local.hasBusiness(), true);

  const a = await scenario(remote), b = await scenario(local);
  assert.deepEqual(b, a);
  // jangkar hitungan tangan: transkrip memang berisi angka bermakna, bukan kosong yang kebetulan sama
  // 2 x 2.500.000 + (1,5 x 25.000 - 5.000) = 5.032.500 ; -10.000 = 5.022.500 ; PPN 11% = 552.475 ; total 5.574.975
  assert.deepEqual(a.sale1, [5_032_500, 10_000, 552_475, 5_574_975, 5_574_975, 'paid', true]);
  assert.equal((a.list as unknown[]).length, 4);
  assert.deepEqual(a.merge, [0, 0, 0, 0, null]); // menggabung backup dirinya sendiri tidak mengubah apa pun
});

test('LocalBackend: mode tim tidak tersedia; pemasangan baru dari backup (impor) memulihkan semua data', async () => {
  const src = new LocalBackend({ db: newDb(), runtime: nodeRuntime, appVersion: 't' });
  await src.createBusiness({ name: 'Toko Asal', businessType: 'fashion', ownerName: 'Budi', openingCash: 500_000 });
  const p = await src.createProduct({ name: 'Kaos', variants: [{ sellPrice: 59_000, costPrice: 30_000, openingQtyMilli: 10_000 }] });
  await src.createSale({ items: [{ variantId: p.variantIds[0]!, qtyMilli: 2000 }] });
  await assert.rejects(src.createMember(), /hanya tersedia di versi web/);
  const { bytes } = await src.exportBackup(BPW);

  const fresh = new LocalBackend({ db: newDb(), runtime: nodeRuntime, appVersion: 't' });
  assert.equal(await fresh.hasBusiness(), false);
  await assert.rejects(fresh.importBackup(bytes, 'salah-total-123'));
  assert.equal(await fresh.hasBusiness(), false);
  await fresh.importBackup(bytes, BPW);
  assert.equal((await fresh.business()).name, 'Toko Asal');
  assert.equal((await fresh.listProducts())[0]!.stockQtyMilli, 8000);
  assert.equal((await fresh.listWallets())[0]!.balance, 500_000 + 118_000);
});
