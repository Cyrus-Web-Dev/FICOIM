import * as core from '@ficoim/core';
import { suggestBackupFileName, type BackupRuntime, type ScryptParams } from '@ficoim/shared';
import type { Backend, RestoreRequest, UploadedImage } from './backend';

export interface LocalBackendOptions {
  db: core.Db;
  runtime: BackupRuntime;
  appVersion: string;
  blobStore?: core.BlobStore;
  /** Menyimpan backup pengaman otomatis sebelum restore menimpa data (mis. ke folder dokumen aplikasi). */
  safetySink?: (fileName: string, bytes: Uint8Array) => Promise<void>;
  now?: () => Date;
  /** Parameter scrypt untuk backup baru (bawaan logN=15 ≈ 32 MiB). scrypt di JS murni lambat di HP: ukur di perangkat; batas aman logN 14–17. */
  backupKdf?: ScryptParams;
}

/**
 * Backend HP: memanggil mesin bisnis langsung di atas SQLite perangkat — tanpa server, tanpa internet.
 * Satu perangkat = satu bisnis = satu pengguna (pemilik); izin peran tidak relevan di sini.
 */
export class LocalBackend implements Backend {
  readonly mode = 'local' as const;
  private cache: { businessId: string; memberId: string } | null = null;
  constructor(private readonly o: LocalBackendOptions) {}
  private now = () => (this.o.now ?? (() => new Date()))();

  // ---------------- siklus hidup
  async hasBusiness(): Promise<boolean> {
    return (await this.o.db.all(`SELECT "id" FROM "businesses" WHERE "deleted_at" IS NULL LIMIT 1`)).length > 0;
  }
  async createBusiness(input: core.CreateBusinessInput) {
    const r = await core.createBusiness(this.o.db, input, { now: this.o.now });
    this.cache = null;
    return r;
  }
  /** Pemasangan baru di HP: pulihkan backup (dari HP lain atau dari web) sebagai bisnis di perangkat ini. */
  async importBackup(bytes: Uint8Array, password: string) {
    const r = await core.restoreBackup(this.o.db, bytes, { password, runtime: this.o.runtime, mode: 'replace', blobStore: this.o.blobStore, now: this.o.now });
    this.cache = null;
    return r;
  }

  private async ctx(): Promise<core.Ctx> {
    if (!this.cache) {
      const b = (await this.o.db.all(`SELECT "id" FROM "businesses" WHERE "deleted_at" IS NULL ORDER BY "created_at" LIMIT 1`))[0];
      if (!b) throw new core.DomainError('NOT_FOUND', 'Bisnis belum dibuat di perangkat ini.');
      const m = (await this.o.db.all(
        `SELECT "id" FROM "members" WHERE "business_id" = ? AND "role" = 'owner' AND "deleted_at" IS NULL AND "is_active" = ? ORDER BY "created_at", "id" LIMIT 1`,
        [b.id, core.dbBool(this.o.db, true)]))[0];
      if (!m) throw new core.DomainError('NOT_FOUND', 'Pemilik bisnis tidak ditemukan.');
      this.cache = { businessId: String(b.id), memberId: String(m.id) };
    }
    return core.loadCtx(this.o.db, this.cache.businessId, this.cache.memberId, { now: this.o.now });
  }
  private async run<T>(fn: (c: core.Ctx) => Promise<T>): Promise<T> { return fn(await this.ctx()); }

  business() { return this.run((c) => core.getBusiness(c)); }
  updateBusiness(p: Parameters<typeof core.updateBusiness>[1]) { return this.run((c) => core.updateBusiness(c, p)); }

  dashboard() { return this.run((c) => core.dashboard(c)); }
  profitLoss(from: string, to: string) { return this.run((c) => core.profitLoss(c, from, to)); }
  topProducts(from: string, to: string, limit?: number) { return this.run((c) => core.topProducts(c, from, to, limit)); }
  categoryBreakdown(from: string, to: string) { return this.run((c) => core.categoryBreakdown(c, from, to)); }
  monthlyTrend(months?: number) { return this.run((c) => core.monthlyTrend(c, months)); }
  salesByDay(from: string, to: string) { return this.run((c) => core.salesByDay(c, from, to)); }
  stockValue() { return this.run((c) => core.stockValuation(c)); }
  expiring(days?: number) { return this.run((c) => core.expiringSoon(c, days)); }

  listProducts(o?: core.ListProductsOptions) { return this.run((c) => core.listProducts(c, o)); }
  findByCode(code: string) { return this.run((c) => core.findByCode(c, code)); }
  createProduct(i: core.ProductInput) { return this.run((c) => core.createProduct(c, i)); }
  listPartyStats(kind: core.PartyKind, search?: string) { return this.run((c) => core.listPartyStats(c, kind, search)); }
  updateParty(kind: core.PartyKind, id: string, patch: Partial<core.PartyInput>) { return this.run((c) => core.updateParty(c, kind, id, patch)); }
  deleteParty(kind: core.PartyKind, id: string) { return this.run((c) => core.deleteParty(c, kind, id)); }
  updateProduct(id: string, p: Parameters<typeof core.updateProduct>[2]) { return this.run((c) => core.updateProduct(c, id, p)); }
  deleteProduct(id: string) { return this.run((c) => core.deleteProduct(c, id)); }
  addVariant(productId: string, v: core.VariantInput) { return this.run((c) => core.addVariant(c, productId, v)); }
  updateVariant(id: string, p: core.VariantPatch) { return this.run((c) => core.updateVariant(c, id, p)); }
  adjustStock(variantId: string, i: Omit<core.AdjustInput, 'variantId'>) { return this.run((c) => core.adjustStock(c, { ...i, variantId })); }
  stockCard(variantId: string, limit?: number) { return this.run((c) => core.stockCard(c, variantId, limit)); }
  listProductCategories() { return this.run((c) => core.listProductCategories(c)); }
  createProductCategory(name: string) { return this.run((c) => core.createProductCategory(c, { name })); }

  listCustomers(s?: string) { return this.run((c) => core.listCustomers(c, s)); }
  createCustomer(i: core.PartyInput) { return this.run((c) => core.createCustomer(c, i)); }
  listSuppliers(s?: string) { return this.run((c) => core.listSuppliers(c, s)); }
  createSupplier(i: core.PartyInput) { return this.run((c) => core.createSupplier(c, i)); }

  createSale(i: core.SaleInput) { return this.run((c) => core.createSale(c, i)); }
  listSales(o?: { from?: string; to?: string; status?: string; limit?: number; offset?: number }) { return this.run((c) => core.listSales(c, o)); }
  getSale(id: string) { return this.run((c) => core.getSale(c, id)); }
  voidSale(id: string, reason: string) { return this.run((c) => core.voidSale(c, id, reason)); }
  createPurchase(i: core.PurchaseInput) { return this.run((c) => core.createPurchase(c, i)); }
  listPurchases(o?: { from?: string; to?: string; limit?: number; offset?: number }) { return this.run((c) => core.listPurchases(c, o)); }
  voidPurchase(id: string, reason: string) { return this.run((c) => core.voidPurchase(c, id, reason)); }

  listWallets() { return this.run((c) => core.listWallets(c)); }
  createWallet(i: { name: string; type?: string; openingBalance?: number }) { return this.run((c) => core.createWallet(c, i)); }
  listFinanceCategories() { return this.run((c) => core.listFinanceCategories(c)); }
  createFinanceCategory(i: { name: string; type: 'income' | 'expense' }) { return this.run((c) => core.createFinanceCategory(c, i)); }
  listTransactions(o?: { from?: string; to?: string; walletId?: string; type?: string; limit?: number; offset?: number }) { return this.run((c) => core.listTransactions(c, o)); }
  addTransaction(i: core.AddTxInput) { return this.run((c) => core.addTransaction(c, i)); }
  deleteTransaction(id: string) { return this.run((c) => core.deleteTransaction(c, id)); }
  transfer(i: { fromWalletId: string; toWalletId: string; amount: number; occurredOn?: string; note?: string | null }) { return this.run((c) => core.transfer(c, i)); }
  budgetStatus(month: number, year: number) { return this.run((c) => core.budgetStatus(c, month, year)); }
  setBudget(i: { categoryId: string; amountLimit: number; month: number; year: number }) { return this.run((c) => core.setBudget(c, i)); }
  dueBills(days?: number) { return this.run((c) => core.dueBills(c, days)); }
  createBill(i: Parameters<typeof core.createRecurringBill>[1]) { return this.run((c) => core.createRecurringBill(c, i)); }
  payBill(id: string, paidOn?: string) { return this.run((c) => core.payRecurringBill(c, id, paidOn)); }
  listDebts(o?: { kind?: 'receivable' | 'payable'; onlyOpen?: boolean }) { return this.run((c) => core.listDebts(c, o)); }
  createDebt(i: Parameters<typeof core.createManualDebt>[1]) { return this.run((c) => core.createManualDebt(c, i)); }
  payDebt(debtId: string, i: { amount: number; walletId?: string | null; paidOn?: string; note?: string | null }) { return this.run((c) => core.payDebt(c, { ...i, debtId })); }
  listGoals() { return this.run((c) => core.listGoals(c)); }
  createGoal(i: { title: string; targetAmount: number; targetDate?: string | null }) { return this.run((c) => core.createGoal(c, i)); }
  contributeGoal(id: string, amount: number) { return this.run((c) => core.contributeGoal(c, id, amount)); }

  listAssets() { return this.run((c) => core.listAssets(c)); }
  createAsset(i: core.AssetInput) { return this.run((c) => core.createAsset(c, i)); }
  loanAsset(assetId: string, i: { borrowerName: string; borrowerPhone?: string | null; purpose?: string | null }) { return this.run((c) => core.loanAsset(c, { ...i, assetId })); }
  returnAsset(loanId: string, condition?: string) { return this.run((c) => core.returnAsset(c, loanId, condition)); }
  scheduleMaintenance(assetId: string, i: { scheduledOn: string; description?: string | null }) { return this.run((c) => core.scheduleMaintenance(c, { ...i, assetId })); }
  completeMaintenance(id: string, i: { cost?: number; walletId?: string | null }) { return this.run((c) => core.completeMaintenance(c, id, i)); }

  listMembers() { return this.run((c) => core.listMembers(c)); }
  async createMember(): Promise<void> { throw new core.DomainError('INVALID_STATE', 'Manajemen tim hanya tersedia di versi web.'); }
  async updateMember(): Promise<void> { throw new core.DomainError('INVALID_STATE', 'Manajemen tim hanya tersedia di versi web.'); }

  private blobs(): core.BlobStore {
    if (!this.o.blobStore) throw new core.DomainError('INVALID_STATE', 'Penyimpanan gambar belum tersedia di perangkat ini.');
    return this.o.blobStore;
  }
  uploadImage(i: { bytes: Uint8Array; fileName?: string }): Promise<UploadedImage> {
    return this.run((c) => core.saveImage(c, { blobStore: this.blobs(), runtime: this.o.runtime }, i));
  }
  getImage(id: string) { return this.run(async (c) => { const r = await core.readImage(c, this.blobs(), id); return { bytes: r.bytes, mime: r.mime }; }); }

  async exportBackup(password: string) {
    const c = await this.ctx();
    const bytes = await core.exportBackup(c, { password, runtime: this.o.runtime, source: { platform: 'mobile', appVersion: this.o.appVersion }, blobStore: this.o.blobStore, kdf: this.o.backupKdf });
    return { bytes, fileName: suggestBackupFileName((await core.getBusiness(c)).name, this.now()) };
  }

  async restoreBackup(r: RestoreRequest) {
    const c = await this.ctx();
    const report = await core.restoreBackup(this.o.db, r.bytes, {
      password: r.password, runtime: this.o.runtime, mode: r.mode, targetBusinessId: c.businessId, actor: c.actor, blobStore: this.o.blobStore,
      regenerateIds: r.regenerateIds, now: this.o.now,
      makeSafetyBackup: async () => {
        if (!this.o.safetySink) return;
        const safety = await core.exportBackup(c, { password: r.password, runtime: this.o.runtime, source: { platform: 'mobile', appVersion: this.o.appVersion }, blobStore: this.o.blobStore, kdf: this.o.backupKdf });
        await this.o.safetySink(`pengaman-${suggestBackupFileName('pra-restore', this.now())}`, safety);
      },
    });
    this.cache = null; // pemilik/bisnis bisa berubah setelah restore
    return report;
  }
}
