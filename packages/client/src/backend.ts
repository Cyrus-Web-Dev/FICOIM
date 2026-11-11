import type * as C from '@ficoim/core';

/**
 * Satu-satunya antarmuka yang dipakai layar (UI). Dua implementasi dengan perilaku IDENTIK (dibuktikan tes kontrak):
 *  - RemoteBackend (web)    : memanggil API server.
 *  - LocalBackend  (mobile) : memanggil mesin bisnis `@ficoim/core` langsung di atas SQLite perangkat (offline-first).
 */
/** Hasil unggah gambar: `id` dipakai sebagai photoAttachmentId (produk/aset) atau receiptAttachmentId (nota/bukti). */
export interface UploadedImage { id: string; mime: string; sizeBytes: number; fileName: string }

export interface RestoreRequest { password: string; mode: 'replace' | 'merge'; bytes: Uint8Array; regenerateIds?: boolean }

export interface Backend {
  readonly mode: 'remote' | 'local';

  business(): Promise<C.BusinessView>;
  updateBusiness(patch: Parameters<typeof C.updateBusiness>[1]): Promise<void>;

  // laporan
  dashboard(): Promise<C.Dashboard>;
  profitLoss(from: string, to: string): Promise<C.ProfitLoss>;
  topProducts(from: string, to: string, limit?: number): Promise<C.TopProduct[]>;
  categoryBreakdown(from: string, to: string): Promise<C.CategoryBreakdown[]>;
  monthlyTrend(months?: number): Promise<C.MonthTrend[]>;
  salesByDay(from: string, to: string): Promise<{ date: string; total: number; count: number }[]>;
  stockValue(): Promise<{ items: number; value: number }>;
  expiring(days?: number): Promise<C.ExpiringItem[]>;

  // produk & stok
  listProducts(o?: C.ListProductsOptions): Promise<C.VariantView[]>;
  findByCode(code: string): Promise<C.VariantView | null>;
  createProduct(input: C.ProductInput): Promise<{ productId: string; variantIds: string[] }>;
  updateProduct(id: string, patch: Parameters<typeof C.updateProduct>[2]): Promise<void>;
  deleteProduct(id: string): Promise<void>;
  addVariant(productId: string, v: C.VariantInput): Promise<string>;
  updateVariant(id: string, patch: C.VariantPatch): Promise<void>;
  adjustStock(variantId: string, input: Omit<C.AdjustInput, 'variantId'>): Promise<{ before: number; after: number }>;
  stockCard(variantId: string, limit?: number): Promise<C.StockCardRow[]>;
  listProductCategories(): Promise<{ id: string; name: string; icon: string | null }[]>;
  createProductCategory(name: string): Promise<string>;

  // pihak
  listCustomers(search?: string): Promise<C.PartyView[]>;
  createCustomer(i: C.PartyInput): Promise<string>;
  listSuppliers(search?: string): Promise<C.PartyView[]>;
  createSupplier(i: C.PartyInput): Promise<string>;
  listPartyStats(kind: C.PartyKind, search?: string): Promise<C.PartyStatsView[]>;
  updateParty(kind: C.PartyKind, id: string, patch: Partial<C.PartyInput>): Promise<void>;
  deleteParty(kind: C.PartyKind, id: string): Promise<void>;

  // penjualan & pembelian
  createSale(i: C.SaleInput): Promise<C.SaleResult>;
  listSales(o?: { from?: string; to?: string; status?: string; limit?: number; offset?: number }): Promise<C.DocRow[]>;
  getSale(id: string): Promise<C.SaleDetail>;
  voidSale(id: string, reason: string): Promise<void>;
  createPurchase(i: C.PurchaseInput): Promise<C.PurchaseResult>;
  listPurchases(o?: { from?: string; to?: string; limit?: number; offset?: number }): Promise<C.DocRow[]>;
  voidPurchase(id: string, reason: string): Promise<void>;

  // keuangan
  listWallets(): Promise<C.WalletView[]>;
  createWallet(i: { name: string; type?: string; openingBalance?: number }): Promise<string>;
  listFinanceCategories(): Promise<{ id: string; name: string; type: string; icon: string | null; isSystem: boolean }[]>;
  createFinanceCategory(i: { name: string; type: 'income' | 'expense' }): Promise<string>;
  listTransactions(o?: { from?: string; to?: string; walletId?: string; type?: string; limit?: number; offset?: number }): Promise<C.TxView[]>;
  addTransaction(i: C.AddTxInput): Promise<string>;
  deleteTransaction(id: string): Promise<void>;
  transfer(i: { fromWalletId: string; toWalletId: string; amount: number; occurredOn?: string; note?: string | null }): Promise<string>;
  budgetStatus(month: number, year: number): Promise<C.BudgetStatus[]>;
  setBudget(i: { categoryId: string; amountLimit: number; month: number; year: number }): Promise<string>;
  dueBills(days?: number): Promise<C.BillView[]>;
  createBill(i: Parameters<typeof C.createRecurringBill>[1]): Promise<string>;
  payBill(id: string, paidOn?: string): Promise<{ nextDueDate: string }>;
  listDebts(o?: { kind?: 'receivable' | 'payable'; onlyOpen?: boolean }): Promise<C.DebtView[]>;
  createDebt(i: Parameters<typeof C.createManualDebt>[1]): Promise<string>;
  payDebt(debtId: string, i: { amount: number; walletId?: string | null; paidOn?: string; note?: string | null }): Promise<{ remaining: number; status: 'open' | 'partial' | 'settled' }>;
  listGoals(): Promise<C.GoalView[]>;
  createGoal(i: { title: string; targetAmount: number; targetDate?: string | null }): Promise<string>;
  contributeGoal(id: string, amount: number): Promise<number>;

  // aset
  listAssets(): Promise<C.AssetView[]>;
  createAsset(i: C.AssetInput): Promise<string>;
  loanAsset(assetId: string, i: { borrowerName: string; borrowerPhone?: string | null; purpose?: string | null }): Promise<string>;
  returnAsset(loanId: string, condition?: string): Promise<void>;
  scheduleMaintenance(assetId: string, i: { scheduledOn: string; description?: string | null }): Promise<string>;
  completeMaintenance(id: string, i: { cost?: number; walletId?: string | null }): Promise<void>;

  // tim (hanya mode remote)
  listMembers(): Promise<C.MemberView[]>;
  createMember(i: { email: string; password: string; displayName: string; role: string; canViewReports?: boolean; canDelete?: boolean }): Promise<void>;
  updateMember(id: string, patch: { role?: string; isActive?: boolean; canViewReports?: boolean; canDelete?: boolean }): Promise<void>;

  // gambar (foto produk, nota, struk). Klien WAJIB mengecilkan foto lebih dulu (maks 1,5 MB; disarankan ≤ 300 KB).
  uploadImage(i: { bytes: Uint8Array; fileName?: string }): Promise<UploadedImage>;
  getImage(id: string): Promise<{ bytes: Uint8Array; mime: string }>;

  // backup
  exportBackup(password: string): Promise<{ bytes: Uint8Array; fileName: string }>;
  restoreBackup(r: RestoreRequest): Promise<C.RestoreReport>;
}
