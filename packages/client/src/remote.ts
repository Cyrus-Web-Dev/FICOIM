import type * as C from '@ficoim/core';
import type { Backend, RestoreRequest, UploadedImage } from './backend';
import { toBase64 } from './base64';
import type { StoredSession, TokenStore } from './session';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) { super(message); this.name = 'ApiError'; }
}

export interface ApiClientOptions {
  /** Mis. "/api" (web, satu origin) atau "https://api.contoh.id/api" (mobile). */
  baseUrl: string;
  tokens: TokenStore;
  client: 'web' | 'mobile';
  fetchImpl?: typeof fetch;
  /** Dipanggil saat sesi tidak bisa dipulihkan lagi (UI kembali ke layar masuk). */
  onSessionExpired?: () => void;
}

type Query = Record<string, string | number | boolean | undefined | null>;
interface SessionBody { accessToken: string; refreshToken?: string; businessId: string; role: StoredSession['role']; user: StoredSession['user'] }
interface ReqOpts { query?: Query; body?: unknown; bytes?: boolean; auth?: boolean; /** Badan biner (unggah gambar); menggantikan `body` JSON. */ rawBody?: Uint8Array }

export class ApiClient {
  private refreshing: Promise<boolean> | null = null;
  private readonly f: typeof fetch;
  constructor(private readonly o: ApiClientOptions) { this.f = o.fetchImpl ?? ((...a) => fetch(...a)); }

  get clientKind(): 'web' | 'mobile' { return this.o.client; }

  private url(path: string, q?: Query): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(q ?? {})) if (v !== undefined && v !== null && v !== '') parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    return this.o.baseUrl.replace(/\/$/, '') + path + (parts.length ? `?${parts.join('&')}` : '');
  }

  private async send(method: string, path: string, o: ReqOpts, token: string | null): Promise<Response> {
    const headers: Record<string, string> = {};
    if (o.rawBody !== undefined) headers['content-type'] = 'application/octet-stream';
    else if (o.body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    try {
      return await this.f(this.url(path, o.query), {
        method, headers, body: o.rawBody !== undefined ? (o.rawBody as BodyInit) : o.body === undefined ? undefined : JSON.stringify(o.body), credentials: this.o.client === 'web' ? 'include' : 'omit',
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'Tidak dapat terhubung ke server. Periksa koneksi internet.');
    }
  }

  private async fail(res: Response): Promise<never> {
    let code = 'HTTP_' + res.status, message = `Permintaan gagal (${res.status}).`, details: unknown;
    try { const j = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } }; if (j.error) { code = j.error.code ?? code; message = j.error.message ?? message; details = j.error.details; } } catch { /* badan bukan JSON */ }
    throw new ApiError(res.status, code, message, details);
  }

  async request<T>(method: string, path: string, o: ReqOpts = {}): Promise<T> {
    const useAuth = o.auth !== false;
    const used = useAuth ? (await this.o.tokens.get())?.accessToken ?? null : null;
    let res = await this.send(method, path, o, used);
    if (res.status === 401 && useAuth && (await this.refreshIfStale(used))) res = await this.send(method, path, o, (await this.o.tokens.get())?.accessToken ?? null);
    if (!res.ok) return this.fail(res);
    if (o.bytes) return { bytes: new Uint8Array(await res.arrayBuffer()), fileName: /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'backup.ficoim', contentType: res.headers.get('content-type') ?? 'application/octet-stream' } as T;
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  /** Bila token di penyimpanan sudah berbeda dari yang dipakai permintaan ini, permintaan lain sudah me-refresh: cukup ulangi. */
  private async refreshIfStale(usedToken: string | null): Promise<boolean> {
    const cur = (await this.o.tokens.get())?.accessToken ?? null;
    if (cur !== null && cur !== usedToken) return true;
    return this.refreshOnce();
  }

  /** Beberapa permintaan yang gagal 401 bersamaan hanya memicu SATU refresh (refresh token berotasi: dua refresh = deteksi pencurian). */
  private refreshOnce(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    const cur = await this.o.tokens.get();
    const body = this.o.client === 'web' ? { client: 'web' } : cur?.refreshToken ? { refreshToken: cur.refreshToken } : null;
    if (body) {
      try {
        const res = await this.send('POST', '/auth/refresh', { body }, null);
        if (res.ok) { await this.store((await res.json()) as SessionBody); return true; }
      } catch { /* jaringan putus: jangan hapus sesi; biarkan pemanggil gagal dengan NETWORK */ return false; }
    }
    await this.o.tokens.set(null);
    this.o.onSessionExpired?.();
    return false;
  }

  private async store(b: SessionBody): Promise<StoredSession> {
    const prev = await this.o.tokens.get();
    const s: StoredSession = { accessToken: b.accessToken, businessId: b.businessId, role: b.role, user: b.user, refreshToken: this.o.client === 'mobile' ? b.refreshToken ?? prev?.refreshToken : undefined };
    await this.o.tokens.set(s);
    return s;
  }

  // ---------------- sesi
  async login(i: { email: string; password: string; totp?: string }): Promise<StoredSession> {
    return this.store(await this.request<SessionBody>('POST', '/auth/login', { auth: false, body: { ...i, client: this.o.client } }));
  }
  async register(i: { email: string; password: string; displayName: string; businessName: string; businessType: string; openingCash?: number }): Promise<StoredSession> {
    return this.store(await this.request<SessionBody>('POST', '/auth/register', { auth: false, body: { ...i, client: this.o.client } }));
  }
  /** Memulihkan sesi saat aplikasi dibuka: mobile dari penyimpanan aman; web lewat cookie refresh (token akses tidak disimpan di disk). */
  async restoreSession(): Promise<StoredSession | null> {
    const cur = await this.o.tokens.get();
    if (cur) return cur;
    if (this.o.client === 'web' && (await this.refreshOnce())) return this.o.tokens.get();
    return null;
  }
  async logout(): Promise<void> {
    const cur = await this.o.tokens.get();
    try { await this.request('POST', '/auth/logout', { auth: false, body: cur?.refreshToken ? { refreshToken: cur.refreshToken } : {} }); } catch { /* tetap keluar secara lokal */ }
    await this.o.tokens.set(null);
  }
  me() { return this.request<{ id: string; email: string; displayName: string; totpEnabled: boolean; businesses: { businessId: string; role: string }[] }>('GET', '/me'); }
  changePassword(oldPassword: string, newPassword: string) { return this.request('POST', '/auth/password', { body: { oldPassword, newPassword } }); }
  totpStart() { return this.request<{ base32: string; otpauthUri: string }>('POST', '/auth/totp/start'); }
  totpConfirm(code: string) { return this.request('POST', '/auth/totp/confirm', { body: { code } }); }
  totpDisable(password: string, code: string) { return this.request('POST', '/auth/totp/disable', { body: { password, code } }); }

  /** Dipakai RemoteBackend.restoreBackup: respons restore dapat membawa sesi baru yang WAJIB dipakai. */
  async adoptSession(b: SessionBody): Promise<void> { await this.store(b); }
}

type Id = { id: string };

export class RemoteBackend implements Backend {
  readonly mode = 'remote' as const;
  constructor(readonly api: ApiClient) {}
  private get = <T>(p: string, query?: Query) => this.api.request<T>('GET', p, { query });
  private post = <T>(p: string, body?: unknown) => this.api.request<T>('POST', p, { body: body ?? {} });
  private patch = <T>(p: string, body: unknown) => this.api.request<T>('PATCH', p, { body });
  private del = <T>(p: string) => this.api.request<T>('DELETE', p);
  private id = async (p: string, body: unknown): Promise<string> => (await this.post<Id>(p, body)).id;

  business() { return this.get<C.BusinessView>('/business'); }
  async updateBusiness(patch: Parameters<typeof C.updateBusiness>[1]) { await this.patch('/business', patch); }

  dashboard() { return this.get<C.Dashboard>('/reports/dashboard'); }
  profitLoss(from: string, to: string) { return this.get<C.ProfitLoss>('/reports/profit-loss', { from, to }); }
  topProducts(from: string, to: string, limit?: number) { return this.get<C.TopProduct[]>('/reports/top-products', { from, to, limit }); }
  categoryBreakdown(from: string, to: string) { return this.get<C.CategoryBreakdown[]>('/reports/by-category', { from, to }); }
  monthlyTrend(months?: number) { return this.get<C.MonthTrend[]>('/reports/monthly-trend', { months }); }
  salesByDay(from: string, to: string) { return this.get<{ date: string; total: number; count: number }[]>('/reports/sales-by-day', { from, to }); }
  stockValue() { return this.get<{ items: number; value: number }>('/reports/stock-value'); }
  expiring(days?: number) { return this.get<C.ExpiringItem[]>('/reports/expiring', { days }); }

  listProducts(o: C.ListProductsOptions = {}) {
    return this.get<C.VariantView[]>('/products', { search: o.search, categoryId: o.categoryId, lowStock: o.lowStockOnly ? 1 : undefined, includeInactive: o.includeInactive ? 1 : undefined, limit: o.limit, offset: o.offset });
  }
  async findByCode(code: string) {
    try { return await this.get<C.VariantView>(`/products/by-code/${encodeURIComponent(code)}`); }
    catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
  }
  createProduct(i: C.ProductInput) { return this.post<{ productId: string; variantIds: string[] }>('/products', i); }
  listPartyStats(kind: C.PartyKind, search?: string) { return this.api.request<C.PartyStatsView[]>('GET', `/parties/${kind}/stats`, { query: { search } }); }
  async updateParty(kind: C.PartyKind, id: string, patch: Partial<C.PartyInput>) { await this.patch(`/parties/${kind}/${id}`, patch); }
  async deleteParty(kind: C.PartyKind, id: string) { await this.del(`/parties/${kind}/${id}`); }
  async updateProduct(id: string, patch: object) { await this.patch(`/products/${id}`, patch); }
  async deleteProduct(id: string) { await this.del(`/products/${id}`); }
  addVariant(productId: string, v: C.VariantInput) { return this.id(`/products/${productId}/variants`, v); }
  async updateVariant(id: string, patch: C.VariantPatch) { await this.patch(`/variants/${id}`, patch); }
  adjustStock(variantId: string, i: Omit<C.AdjustInput, 'variantId'>) { return this.post<{ before: number; after: number }>(`/variants/${variantId}/adjust`, i); }
  stockCard(variantId: string, limit?: number) { return this.get<C.StockCardRow[]>(`/variants/${variantId}/card`, { limit }); }
  listProductCategories() { return this.get<{ id: string; name: string; icon: string | null }[]>('/product-categories'); }
  createProductCategory(name: string) { return this.id('/product-categories', { name }); }

  listCustomers(search?: string) { return this.get<C.PartyView[]>('/customers', { search }); }
  createCustomer(i: C.PartyInput) { return this.id('/customers', i); }
  listSuppliers(search?: string) { return this.get<C.PartyView[]>('/suppliers', { search }); }
  createSupplier(i: C.PartyInput) { return this.id('/suppliers', i); }

  createSale(i: C.SaleInput) { return this.post<C.SaleResult>('/sales', i); }
  listSales(o: { from?: string; to?: string; status?: string; limit?: number; offset?: number } = {}) { return this.get<C.DocRow[]>('/sales', o); }
  getSale(id: string) { return this.get<C.SaleDetail>(`/sales/${id}`); }
  async voidSale(id: string, reason: string) { await this.post(`/sales/${id}/void`, { reason }); }
  createPurchase(i: C.PurchaseInput) { return this.post<C.PurchaseResult>('/purchases', i); }
  listPurchases(o: { from?: string; to?: string; limit?: number; offset?: number } = {}) { return this.get<C.DocRow[]>('/purchases', o); }
  async voidPurchase(id: string, reason: string) { await this.post(`/purchases/${id}/void`, { reason }); }

  listWallets() { return this.get<C.WalletView[]>('/wallets'); }
  createWallet(i: { name: string; type?: string; openingBalance?: number }) { return this.id('/wallets', i); }
  listFinanceCategories() { return this.get<{ id: string; name: string; type: string; icon: string | null; isSystem: boolean }[]>('/finance/categories'); }
  createFinanceCategory(i: { name: string; type: 'income' | 'expense' }) { return this.id('/finance/categories', i); }
  listTransactions(o: { from?: string; to?: string; walletId?: string; type?: string; limit?: number; offset?: number } = {}) { return this.get<C.TxView[]>('/transactions', o); }
  addTransaction(i: C.AddTxInput) { return this.id('/transactions', i); }
  async deleteTransaction(id: string) { await this.del(`/transactions/${id}`); }
  transfer(i: { fromWalletId: string; toWalletId: string; amount: number; occurredOn?: string; note?: string | null }) { return this.id('/transfers', i); }
  budgetStatus(month: number, year: number) { return this.get<C.BudgetStatus[]>('/budgets', { month, year }); }
  async setBudget(i: { categoryId: string; amountLimit: number; month: number; year: number }) { return (await this.api.request<Id>('PUT', '/budgets', { body: i })).id; }
  dueBills(days?: number) { return this.get<C.BillView[]>('/bills/due', { days }); }
  createBill(i: object) { return this.id('/bills', i); }
  payBill(id: string, paidOn?: string) { return this.post<{ nextDueDate: string }>(`/bills/${id}/pay`, paidOn ? { paidOn } : {}); }
  listDebts(o: { kind?: 'receivable' | 'payable'; onlyOpen?: boolean } = {}) { return this.get<C.DebtView[]>('/debts', { kind: o.kind, open: o.onlyOpen ? 1 : undefined }); }
  createDebt(i: object) { return this.id('/debts', i); }
  payDebt(debtId: string, i: { amount: number; walletId?: string | null; paidOn?: string; note?: string | null }) { return this.post<{ remaining: number; status: 'open' | 'partial' | 'settled' }>(`/debts/${debtId}/pay`, i); }
  listGoals() { return this.get<C.GoalView[]>('/goals'); }
  createGoal(i: { title: string; targetAmount: number; targetDate?: string | null }) { return this.id('/goals', i); }
  async contributeGoal(id: string, amount: number) { return (await this.post<{ current: number }>(`/goals/${id}/contribute`, { amount })).current; }

  listAssets() { return this.get<C.AssetView[]>('/assets'); }
  createAsset(i: C.AssetInput) { return this.id('/assets', i); }
  loanAsset(assetId: string, i: { borrowerName: string; borrowerPhone?: string | null; purpose?: string | null }) { return this.id(`/assets/${assetId}/loans`, i); }
  async returnAsset(loanId: string, condition?: string) { await this.post(`/loans/${loanId}/return`, condition ? { condition } : {}); }
  scheduleMaintenance(assetId: string, i: { scheduledOn: string; description?: string | null }) { return this.id(`/assets/${assetId}/maintenance`, i); }
  async completeMaintenance(id: string, i: { cost?: number; walletId?: string | null }) { await this.post(`/maintenance/${id}/complete`, i); }

  listMembers() { return this.get<C.MemberView[]>('/members'); }
  async createMember(i: { email: string; password: string; displayName: string; role: string; canViewReports?: boolean; canDelete?: boolean }) { await this.post('/members', i); }
  async updateMember(id: string, patch: object) { await this.patch(`/members/${id}`, patch); }

  uploadImage(i: { bytes: Uint8Array; fileName?: string }) { return this.api.request<UploadedImage>('POST', '/attachments', { query: { name: i.fileName }, rawBody: i.bytes }); }
  async getImage(id: string) {
    const r = await this.api.request<{ bytes: Uint8Array; contentType: string }>('GET', `/attachments/${encodeURIComponent(id)}`, { bytes: true });
    return { bytes: r.bytes, mime: r.contentType.split(';')[0]!.trim() };
  }

  exportBackup(password: string) { return this.api.request<{ bytes: Uint8Array; fileName: string }>('POST', '/backup/export', { body: { password }, bytes: true }); }
  async restoreBackup(r: RestoreRequest) {
    const res = await this.post<C.RestoreReport & { session?: SessionBody }>('/backup/restore', { password: r.password, mode: r.mode, regenerateIds: r.regenerateIds === true, dataBase64: toBase64(r.bytes), client: this.api.clientKind });
    if (res.session) await this.api.adoptSession(res.session); // anggota pengguna diganti oleh restore -> token lama tidak berlaku
    const { session: _s, ...report } = res;
    return report;
  }
}
