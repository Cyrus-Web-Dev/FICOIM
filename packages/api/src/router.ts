import * as core from '@ficoim/core';
import { loadCtx, type BlobStore, type Ctx } from '@ficoim/core';
import { suggestBackupFileName, type BackupRuntime } from '@ficoim/shared';
import type { AuthService, Principal, Tenancy } from './auth';
import { ApiError, toHttpError } from './errors';
import { RateLimiter } from './rate-limit';

export interface ApiRequest { method: string; path: string; query: Record<string, string>; headers: Record<string, string | undefined>; body: unknown; ip: string }
export interface ApiResponse { status: number; headers: Record<string, string>; json?: unknown; bytes?: Uint8Array }

export interface ApiDeps {
  auth: AuthService; tenancy: Tenancy; runtime: BackupRuntime;
  /** Menyimpan backup pengaman otomatis sebelum restore-timpa (berkas/objek storage). WAJIB agar restore tidak merusak tanpa jalan kembali. */
  safetyBackupSink: (businessId: string, fileName: string, bytes: Uint8Array) => Promise<void>;
  allowedOrigins: string[]; appVersion: string; secureCookies: boolean;
  /** Penyimpanan foto/nota. Tanpa ini rute /attachments menjawab 501 dan backup tidak membawa gambar. */
  blobStore?: BlobStore;
  now?: () => Date; rateLimiter?: RateLimiter; onError?: (e: unknown, req: ApiRequest) => void;
  limits?: { authPerMin?: number; defaultPerMin?: number; backupPerMin?: number };
}

interface Args { req: ApiRequest; params: Record<string, string>; q: Record<string, string>; body: unknown; principal: Principal | null; ctx: Ctx | null }
type Handler = (a: Args) => Promise<unknown>;
interface Route { method: string; segs: string[]; auth: boolean; tenant: boolean; group: 'auth' | 'backup' | 'default'; maxBody: number; raw: boolean; handler: Handler }

class Reply { constructor(readonly status: number, readonly body: unknown, readonly headers: Record<string, string> = {}, readonly bytes?: Uint8Array) {} }
const created = (b: unknown) => new Reply(201, b);

const MB = 1024 * 1024;
const obj = (b: unknown): Record<string, unknown> => {
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'VALIDATION', 'Badan permintaan harus berupa objek JSON.');
  return b as Record<string, unknown>;
};
const qint = (q: Record<string, string>, k: string): number | undefined => {
  const v = q[k];
  if (v === undefined || v === '') return undefined;
  if (!/^-?\d+$/.test(v)) throw new ApiError(400, 'VALIDATION', `Parameter ${k} harus bilangan bulat.`);
  return Number(v);
};
const need = (q: Record<string, string>, k: string): string => {
  const v = q[k];
  if (!v) throw new ApiError(400, 'VALIDATION', `Parameter ${k} wajib.`);
  return v;
};
const qbool = (q: Record<string, string>, k: string) => q[k] === '1' || q[k] === 'true';

const REFRESH_COOKIE = 'ficoim_rt';
/** Awalan /api dibuang agar rute (dan batas ukuran badan per rute) dicocokkan dengan cara yang sama di semua jalur. */
const stripApi = (path: string): string => path.replace(/^\/api(?=\/)/, '');

function cookieOf(h: Record<string, string | undefined>, name: string): string | undefined {
  for (const part of (h.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

export function createApi(deps: ApiDeps) {
  // Daftar rute dibuat PER instance: handler menutup `deps`, jadi tidak boleh dibagi antar-instance.
  const routes: Route[] = [];
  function r(method: string, pattern: string, handler: Handler, o: { auth?: boolean; tenant?: boolean; group?: Route['group']; maxBody?: number; raw?: boolean } = {}): void {
    const auth = o.auth ?? true;
    routes.push({ method, segs: pattern.split('/').filter(Boolean), auth, tenant: auth && (o.tenant ?? true), group: o.group ?? 'default', maxBody: o.maxBody ?? 1 * MB, raw: o.raw ?? false, handler });
  }
  const limiter = deps.rateLimiter ?? new RateLimiter();
  const now = deps.now ?? (() => new Date());
  const lim = { authPerMin: 10, defaultPerMin: 600, backupPerMin: 6, ...deps.limits };
  const isOriginOk = (o: string | undefined) => !!o && deps.allowedOrigins.includes(o);

  type Session = Awaited<ReturnType<AuthService['login']>>;
  /** Klien web: refresh token hanya di cookie HttpOnly (tidak ada di badan); klien mobile: di badan. */
  const sessionParts = (web: boolean, t: Session): { body: Record<string, unknown>; headers: Record<string, string> } => {
    const { refreshToken, ...rest } = t;
    if (!web) return { body: { ...rest, refreshToken }, headers: {} };
    const cookie = `${REFRESH_COOKIE}=${refreshToken}; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=${30 * 86400}${deps.secureCookies ? '; Secure' : ''}`;
    return { body: rest, headers: { 'set-cookie': cookie } };
  };
  const tokenReply = (a: Args, t: Session, status = 200): Reply => {
    const p = sessionParts(obj(a.body).client === 'web', t);
    return new Reply(status, p.body, p.headers);
  };

  // ---------------------------------------------------------------- auth
  r('GET', '/health', async () => ({ ok: true, version: deps.appVersion }), { auth: false });
  r('POST', '/auth/register', async (a) => {
    const b = obj(a.body);
    return tokenReply(a, await deps.auth.register({ email: b.email, password: b.password, displayName: b.displayName, businessName: b.businessName, businessType: b.businessType, openingCash: b.openingCash }), 201);
  }, { auth: false, group: 'auth' });
  r('POST', '/auth/login', async (a) => {
    const b = obj(a.body);
    return tokenReply(a, await deps.auth.login({ email: b.email, password: b.password, totp: b.totp, businessId: b.businessId }));
  }, { auth: false, group: 'auth' });
  r('POST', '/auth/refresh', async (a) => {
    const b = a.body === undefined || a.body === null ? {} : obj(a.body);
    const fromCookie = typeof b.refreshToken !== 'string';
    const raw = fromCookie ? cookieOf(a.req.headers, REFRESH_COOKIE) : (b.refreshToken as string);
    // Refresh via cookie hanya dari origin yang kita kenal (lapisan CSRF tambahan di atas SameSite=Strict).
    if (fromCookie && a.req.headers.origin && !isOriginOk(a.req.headers.origin)) throw new ApiError(403, 'BAD_ORIGIN', 'Origin tidak diizinkan.');
    const t = await deps.auth.refresh(raw);
    return tokenReply({ ...a, body: fromCookie ? { client: 'web' } : b }, t);
  }, { auth: false, group: 'auth' });
  r('POST', '/auth/logout', async (a) => {
    const b = a.body === undefined || a.body === null ? {} : obj(a.body);
    await deps.auth.logout(typeof b.refreshToken === 'string' ? b.refreshToken : cookieOf(a.req.headers, REFRESH_COOKIE));
    return new Reply(200, { ok: true }, { 'set-cookie': `${REFRESH_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=0${deps.secureCookies ? '; Secure' : ''}` });
  }, { auth: false, group: 'auth' });
  r('GET', '/me', async (a) => deps.auth.me(a.principal!.userId), { tenant: false });
  r('POST', '/auth/password', async (a) => { const b = obj(a.body); await deps.auth.changePassword(a.principal!.userId, b.oldPassword, b.newPassword); return { ok: true }; }, { tenant: false, group: 'auth' });
  r('POST', '/auth/totp/start', async (a) => deps.auth.totpStart(a.principal!.userId), { tenant: false, group: 'auth' });
  r('POST', '/auth/totp/confirm', async (a) => { await deps.auth.totpConfirm(a.principal!.userId, obj(a.body).code); return { ok: true }; }, { tenant: false, group: 'auth' });
  r('POST', '/auth/totp/disable', async (a) => { const b = obj(a.body); await deps.auth.totpDisable(a.principal!.userId, b.password, b.code); return { ok: true }; }, { tenant: false, group: 'auth' });

  // ---------------------------------------------------------------- bisnis & tim
  r('GET', '/business', async (a) => core.getBusiness(a.ctx!));
  r('PATCH', '/business', async (a) => { await core.updateBusiness(a.ctx!, obj(a.body)); return core.getBusiness(a.ctx!); });
  r('GET', '/members', async (a) => core.listMembers(a.ctx!));
  r('POST', '/members', async (a) => { const b = obj(a.body); return created(await deps.auth.provisionStaff(a.ctx!, { email: b.email, password: b.password, displayName: String(b.displayName ?? ''), role: String(b.role ?? ''), canViewReports: b.canViewReports === true, canDelete: b.canDelete === true })); });
  r('PATCH', '/members/:id', async (a) => { await core.updateMember(a.ctx!, a.params.id!, obj(a.body)); return { ok: true }; });

  // ---------------------------------------------------------------- produk & stok
  r('GET', '/product-categories', async (a) => core.listProductCategories(a.ctx!));
  r('POST', '/product-categories', async (a) => created({ id: await core.createProductCategory(a.ctx!, obj(a.body) as never) }));
  r('GET', '/products', async (a) => core.listProducts(a.ctx!, { search: a.q.search, categoryId: a.q.categoryId, lowStockOnly: qbool(a.q, 'lowStock'), includeInactive: qbool(a.q, 'includeInactive'), limit: qint(a.q, 'limit'), offset: qint(a.q, 'offset') }));
  r('GET', '/products/by-code/:code', async (a) => { const v = await core.findByCode(a.ctx!, a.params.code!); if (!v) throw new ApiError(404, 'NOT_FOUND', 'Kode tidak ditemukan.'); return v; });
  r('POST', '/products', async (a) => created(await core.createProduct(a.ctx!, obj(a.body) as never)));
  r('PATCH', '/products/:id', async (a) => { await core.updateProduct(a.ctx!, a.params.id!, obj(a.body)); return { ok: true }; });
  r('DELETE', '/products/:id', async (a) => { await core.deleteProduct(a.ctx!, a.params.id!); return { ok: true }; });
  r('POST', '/products/:id/variants', async (a) => created({ id: await core.addVariant(a.ctx!, a.params.id!, obj(a.body)) }));
  r('PATCH', '/variants/:id', async (a) => { await core.updateVariant(a.ctx!, a.params.id!, obj(a.body)); return { ok: true }; });
  r('POST', '/variants/:id/adjust', async (a) => core.adjustStock(a.ctx!, { ...(obj(a.body) as never as core.AdjustInput), variantId: a.params.id! }));
  r('GET', '/variants/:id/card', async (a) => core.stockCard(a.ctx!, a.params.id!, qint(a.q, 'limit')));

  // ---------------------------------------------------------------- pelanggan & pemasok
  r('GET', '/customers', async (a) => core.listCustomers(a.ctx!, a.q.search));
  r('POST', '/customers', async (a) => created({ id: await core.createCustomer(a.ctx!, obj(a.body) as never) }));
  r('GET', '/parties/:kind/stats', async (a) => core.listPartyStats(a.ctx!, a.params.kind as core.PartyKind, a.q.search));
  r('PATCH', '/parties/:kind/:id', async (a) => { await core.updateParty(a.ctx!, a.params.kind as core.PartyKind, a.params.id!, obj(a.body) as never); return { ok: true }; });
  r('DELETE', '/parties/:kind/:id', async (a) => { await core.deleteParty(a.ctx!, a.params.kind as core.PartyKind, a.params.id!); return { ok: true }; });
  r('GET', '/suppliers', async (a) => core.listSuppliers(a.ctx!, a.q.search));
  r('POST', '/suppliers', async (a) => created({ id: await core.createSupplier(a.ctx!, obj(a.body) as never) }));

  // ---------------------------------------------------------------- lampiran (foto produk, nota, struk)
  const blobs = (): BlobStore => { if (!deps.blobStore) throw new ApiError(501, 'NOT_IMPLEMENTED', 'Penyimpanan gambar belum dikonfigurasi di server.'); return deps.blobStore; };
  r('POST', '/attachments', async (a) => {
    if (!(a.body instanceof Uint8Array) || a.body.length === 0) throw new ApiError(400, 'VALIDATION', 'Badan permintaan harus berisi byte gambar.');
    return created(await core.saveImage(a.ctx!, { blobStore: blobs(), runtime: deps.runtime }, { fileName: a.q.name, bytes: a.body }));
  }, { maxBody: 2 * MB, raw: true });
  r('GET', '/attachments/:id', async (a) => {
    const img = await core.readImage(a.ctx!, blobs(), a.params.id!);
    // Gambar tak pernah berubah untuk id yang sama -> boleh di-cache peramban pribadi. nosniff + CSP dari baseHeaders tetap berlaku.
    return new Reply(200, null, { 'content-type': img.mime, 'content-disposition': 'inline', 'cache-control': 'private, max-age=86400' }, img.bytes);
  });

  // ---------------------------------------------------------------- penjualan & pembelian
  r('GET', '/sales', async (a) => core.listSales(a.ctx!, { from: a.q.from, to: a.q.to, status: a.q.status, limit: qint(a.q, 'limit'), offset: qint(a.q, 'offset') }));
  r('GET', '/sales/:id', async (a) => core.getSale(a.ctx!, a.params.id!));
  r('POST', '/sales', async (a) => created(await core.createSale(a.ctx!, obj(a.body) as never)));
  r('POST', '/sales/:id/void', async (a) => { await core.voidSale(a.ctx!, a.params.id!, String(obj(a.body).reason ?? '')); return { ok: true }; });
  r('GET', '/purchases', async (a) => core.listPurchases(a.ctx!, { from: a.q.from, to: a.q.to, limit: qint(a.q, 'limit'), offset: qint(a.q, 'offset') }));
  r('POST', '/purchases', async (a) => created(await core.createPurchase(a.ctx!, obj(a.body) as never)));
  r('POST', '/purchases/:id/void', async (a) => { await core.voidPurchase(a.ctx!, a.params.id!, String(obj(a.body).reason ?? '')); return { ok: true }; });

  // ---------------------------------------------------------------- keuangan
  r('GET', '/wallets', async (a) => core.listWallets(a.ctx!));
  r('POST', '/wallets', async (a) => created({ id: await core.createWallet(a.ctx!, obj(a.body) as never) }));
  r('GET', '/finance/categories', async (a) => core.listFinanceCategories(a.ctx!));
  r('POST', '/finance/categories', async (a) => created({ id: await core.createFinanceCategory(a.ctx!, obj(a.body) as never) }));
  r('GET', '/transactions', async (a) => core.listTransactions(a.ctx!, { from: a.q.from, to: a.q.to, walletId: a.q.walletId, type: a.q.type, limit: qint(a.q, 'limit'), offset: qint(a.q, 'offset') }));
  r('POST', '/transactions', async (a) => created({ id: await core.addTransaction(a.ctx!, obj(a.body) as never) }));
  r('DELETE', '/transactions/:id', async (a) => { await core.deleteTransaction(a.ctx!, a.params.id!); return { ok: true }; });
  r('POST', '/transfers', async (a) => created({ id: await core.transfer(a.ctx!, obj(a.body) as never) }));
  r('DELETE', '/transfers/:id', async (a) => { await core.deleteTransfer(a.ctx!, a.params.id!); return { ok: true }; });
  r('GET', '/budgets', async (a) => core.budgetStatus(a.ctx!, qint(a.q, 'month') ?? 0, qint(a.q, 'year') ?? 0));
  r('PUT', '/budgets', async (a) => ({ id: await core.setBudget(a.ctx!, obj(a.body) as never) }));
  r('GET', '/bills/due', async (a) => core.dueBills(a.ctx!, qint(a.q, 'days') ?? 7));
  r('POST', '/bills', async (a) => created({ id: await core.createRecurringBill(a.ctx!, obj(a.body) as never) }));
  r('POST', '/bills/:id/pay', async (a) => core.payRecurringBill(a.ctx!, a.params.id!, typeof obj(a.body ?? {}).paidOn === 'string' ? (obj(a.body).paidOn as string) : undefined));
  r('GET', '/debts', async (a) => core.listDebts(a.ctx!, { kind: a.q.kind as never, onlyOpen: qbool(a.q, 'open') }));
  r('POST', '/debts', async (a) => created({ id: await core.createManualDebt(a.ctx!, obj(a.body) as never) }));
  r('POST', '/debts/:id/pay', async (a) => core.payDebt(a.ctx!, { ...(obj(a.body) as never as { amount: number }), debtId: a.params.id! }));
  r('GET', '/goals', async (a) => core.listGoals(a.ctx!));
  r('POST', '/goals', async (a) => created({ id: await core.createGoal(a.ctx!, obj(a.body) as never) }));
  r('POST', '/goals/:id/contribute', async (a) => ({ current: await core.contributeGoal(a.ctx!, a.params.id!, obj(a.body).amount as number) }));

  // ---------------------------------------------------------------- aset
  r('GET', '/assets', async (a) => core.listAssets(a.ctx!));
  r('POST', '/assets', async (a) => created({ id: await core.createAsset(a.ctx!, obj(a.body) as never) }));
  r('POST', '/assets/:id/loans', async (a) => created({ id: await core.loanAsset(a.ctx!, { ...(obj(a.body) as never as { borrowerName: string }), assetId: a.params.id! }) }));
  r('POST', '/loans/:id/return', async (a) => { await core.returnAsset(a.ctx!, a.params.id!, typeof obj(a.body ?? {}).condition === 'string' ? (obj(a.body).condition as string) : undefined); return { ok: true }; });
  r('POST', '/assets/:id/maintenance', async (a) => created({ id: await core.scheduleMaintenance(a.ctx!, { ...(obj(a.body) as never as { scheduledOn: string }), assetId: a.params.id! }) }));
  r('POST', '/maintenance/:id/complete', async (a) => { await core.completeMaintenance(a.ctx!, a.params.id!, obj(a.body ?? {}) as never); return { ok: true }; });

  // ---------------------------------------------------------------- laporan
  r('GET', '/reports/dashboard', async (a) => core.dashboard(a.ctx!));
  r('GET', '/reports/profit-loss', async (a) => core.profitLoss(a.ctx!, need(a.q, 'from'), need(a.q, 'to')));
  r('GET', '/reports/by-category', async (a) => core.categoryBreakdown(a.ctx!, need(a.q, 'from'), need(a.q, 'to')));
  r('GET', '/reports/monthly-trend', async (a) => core.monthlyTrend(a.ctx!, qint(a.q, 'months')));
  r('GET', '/reports/top-products', async (a) => core.topProducts(a.ctx!, need(a.q, 'from'), need(a.q, 'to'), qint(a.q, 'limit')));
  r('GET', '/reports/sales-by-day', async (a) => core.salesByDay(a.ctx!, need(a.q, 'from'), need(a.q, 'to')));
  r('GET', '/reports/stock-value', async (a) => core.stockValuation(a.ctx!));
  r('GET', '/reports/expiring', async (a) => core.expiringSoon(a.ctx!, qint(a.q, 'days') ?? 30));

  // ---------------------------------------------------------------- backup
  const src = { platform: 'server' as const, appVersion: deps.appVersion };
  r('POST', '/backup/export', async (a) => {
    const bytes = await core.exportBackup(a.ctx!, { password: String(obj(a.body).password ?? ''), runtime: deps.runtime, source: src, blobStore: deps.blobStore });
    const name = suggestBackupFileName((await core.getBusiness(a.ctx!)).name, now());
    return new Reply(200, null, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${name}"` }, bytes);
  }, { group: 'backup' });

  r('POST', '/backup/restore', async (a) => {
    const b = obj(a.body);
    if (typeof b.dataBase64 !== 'string') throw new ApiError(400, 'VALIDATION', 'dataBase64 wajib.');
    if (b.mode !== 'replace' && b.mode !== 'merge') throw new ApiError(400, 'VALIDATION', 'mode harus "replace" atau "merge".');
    const bytes = new Uint8Array(Buffer.from(b.dataBase64, 'base64'));
    const ctx = a.ctx!;
    const password = String(b.password ?? '');
    // Selalu ke bisnis milik pengguna yang sedang masuk; backup dari bisnis/perangkat lain dipindahkan (business_id ditulis ulang).
    const report = await core.restoreBackup(ctx.db, bytes, {
      password, runtime: deps.runtime, mode: b.mode, targetBusinessId: ctx.businessId, actor: ctx.actor, now: ctx.now, regenerateIds: b.regenerateIds === true, blobStore: deps.blobStore,
      makeSafetyBackup: async () => {
        const safety = await core.exportBackup(ctx, { password, runtime: deps.runtime, source: src, blobStore: deps.blobStore });
        await deps.safetyBackupSink(ctx.businessId, `pengaman-${suggestBackupFileName('pra-restore', now())}`, safety);
      },
    });
    // Restore mengganti anggota milik pengguna ini -> tautkan akunnya ke pemilik hasil restore & terbitkan sesi baru,
    // kalau tidak ia terkunci dari akunnya sendiri. Klien WAJIB memakai `session` pada respons ini.
    if (report.replacementMemberId) {
      await core.updateRow(ctx.db, 'members', ctx.businessId, report.replacementMemberId, { user_id: a.principal!.userId, updated_at: now().toISOString() });
      const session = sessionParts(b.client === 'web', await deps.auth.relinkAndIssue(a.principal!.userId, ctx.businessId, report.replacementMemberId));
      return new Reply(200, { ...report, session: session.body }, session.headers);
    }
    return report;
  }, { group: 'backup', maxBody: 200 * MB });

  // ================================================================ dispatcher
  function match(method: string, path: string): { route: Route; params: Record<string, string> } | 'METHOD' | null {
    const segs = path.split('/').filter(Boolean);
    let pathHit = false;
    for (const rt of routes) {
      if (rt.segs.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        const want = rt.segs[i]!, got = segs[i]!;
        if (want.startsWith(':')) { try { params[want.slice(1)] = decodeURIComponent(got); } catch { ok = false; break; } }
        else if (want !== got) { ok = false; break; }
      }
      if (!ok) continue;
      pathHit = true;
      if (rt.method === method) return { route: rt, params };
    }
    return pathHit ? 'METHOD' : null;
  }

  const baseHeaders = (origin: string | undefined): Record<string, string> => {
    const h: Record<string, string> = {
      'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'", 'cross-origin-resource-policy': 'same-site',
    };
    if (deps.secureCookies) h['strict-transport-security'] = 'max-age=63072000; includeSubDomains';
    if (isOriginOk(origin)) { h['access-control-allow-origin'] = origin as string; h['access-control-allow-credentials'] = 'true'; h.vary = 'Origin'; }
    return h;
  };

  const fail = (status: number, code: string, message: string, headers: Record<string, string>, details?: unknown): ApiResponse =>
    ({ status, headers, json: { error: { code, message, ...(details !== undefined ? { details } : {}) } } });

  return {
    /** Ukuran maksimum badan permintaan untuk rute ini (dipakai adapter HTTP sebelum membaca badan). */
    maxBodyFor(method: string, path: string): number {
      const m = match(method.toUpperCase(), stripApi(path));
      return m && m !== 'METHOD' ? m.route.maxBody : 1 * MB;
    },
    /** Rute yang menerima byte mentah (bukan JSON): adapter HTTP meneruskan badan sebagai Uint8Array. */
    isRawBody(method: string, path: string): boolean {
      const m = match(method.toUpperCase(), stripApi(path));
      return !!m && m !== 'METHOD' && m.route.raw;
    },

    async handle(req: ApiRequest): Promise<ApiResponse> {
      const method = req.method.toUpperCase();
      const path = stripApi(req.path);
      const origin = req.headers.origin;
      const headers = baseHeaders(origin);

      if (method === 'OPTIONS') {
        if (!isOriginOk(origin)) return fail(403, 'BAD_ORIGIN', 'Origin tidak diizinkan.', headers);
        return { status: 204, headers: { ...headers, 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'authorization,content-type', 'access-control-max-age': '600' } };
      }

      const m = match(method, path);
      if (m === null) return fail(404, 'NOT_FOUND', 'Rute tidak ditemukan.', headers);
      if (m === 'METHOD') return fail(405, 'METHOD_NOT_ALLOWED', 'Metode tidak diizinkan.', headers);
      const { route, params } = m;

      const limit = route.group === 'auth' ? lim.authPerMin : route.group === 'backup' ? lim.backupPerMin : lim.defaultPerMin;
      const rl = limiter.take(`${route.group}:${req.ip}`, limit, 60_000);
      if (!rl.ok) return fail(429, 'RATE_LIMITED', 'Terlalu banyak permintaan. Coba lagi sebentar.', { ...headers, 'retry-after': String(rl.retryAfterSec) });

      try {
        let principal: Principal | null = null;
        if (route.auth) {
          const h = req.headers.authorization ?? '';
          if (!h.startsWith('Bearer ') || h.length > 2000) throw new ApiError(401, 'UNAUTHENTICATED', 'Perlu masuk.');
          principal = await deps.auth.verifyAccess(h.slice(7));
        }
        const args: Args = { req, params, q: req.query, body: req.body, principal, ctx: null };
        const out: unknown = route.tenant && principal
          ? await deps.tenancy.run(principal.businessId, async (db) => {
              const ctx = await loadCtx(db, principal!.businessId, principal!.memberId, { now });
              return route.handler({ ...args, ctx });
            })
          : await route.handler(args);

        if (out instanceof Reply) return { status: out.status, headers: { ...headers, ...out.headers }, ...(out.bytes ? { bytes: out.bytes } : { json: out.body }) };
        return { status: 200, headers, json: out };
      } catch (e) {
        const he = toHttpError(e);
        if (he) return fail(he.status, he.code, he.message, headers, he.details);
        deps.onError?.(e, req);
        return fail(500, 'INTERNAL', 'Terjadi kesalahan pada server.', headers); // detail tidak pernah dikirim ke klien
      }
    },
  };
}

export type Api = ReturnType<typeof createApi>;
