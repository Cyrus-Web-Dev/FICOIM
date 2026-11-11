import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { nodeRuntime } from '@ficoim/shared/backup/runtime-node';
import { AuthService, createApi, createHttpServer, memoryAuthStore, scryptHasher, RateLimiter, totp, base32Decode } from '../src/index';
import { newDb } from '../../core/test/helpers';

const PW = 'Toko-Maju-2026!', BPW = 'Backup-Rahasia-77!';
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

async function boot(o: { limits?: { authPerMin?: number }; failSafety?: boolean } = {}) {
  const db = newDb();
  const safety: { biz: string; name: string; bytes: Uint8Array }[] = [];
  const auth = new AuthService({ store: memoryAuthStore(), hasher: scryptHasher({ logN: 12, r: 8, p: 1 }), tenancy: { run: (_b, fn) => fn(db) }, tokenSecret: Buffer.alloc(32, 9), totpKey: Buffer.alloc(32, 5) });
  const errors: unknown[] = [];
  const api = createApi({
    auth, tenancy: { run: (_b, fn) => fn(db) }, runtime: nodeRuntime, allowedOrigins: ['https://app.ficoim.id'], appVersion: '0.1.0', secureCookies: true,
    limits: { authPerMin: 1000, defaultPerMin: 100000, backupPerMin: 1000, ...o.limits }, rateLimiter: new RateLimiter(),
    safetyBackupSink: async (biz, name, bytes) => { if (o.failSafety) throw new Error('RAHASIA-INTERNAL: disk /var/secret penuh'); safety.push({ biz, name, bytes }); },
    onError: (e) => errors.push(e),
  });
  const srv = createHttpServer(api);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  servers.push(srv);
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return { db, base, safety, errors, call: caller(base) };
}

function caller(base: string) {
  return async (method: string, path: string, o: { token?: string; body?: unknown; headers?: Record<string, string>; raw?: string } = {}) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { ...(o.body !== undefined || o.raw !== undefined ? { 'content-type': 'application/json' } : {}), ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...o.headers },
      body: o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body)),
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    const ctype = res.headers.get('content-type') ?? '';
    return { status: res.status, headers: res.headers, bytes: buf, json: ctype.includes('json') ? JSON.parse(Buffer.from(buf).toString('utf8')) : null };
  };
}

async function signup(call: ReturnType<typeof caller>, email = 'budi@toko.id', extra: Record<string, unknown> = {}) {
  const r = await call('POST', '/auth/register', { body: { email, password: PW, displayName: 'Budi', businessName: 'Toko Maju', businessType: 'elektronik', openingCash: 1_000_000, ...extra } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json as { accessToken: string; refreshToken: string; businessId: string; role: string };
}

test('ALUR LENGKAP: daftar -> produk -> pelanggan -> jual kredit -> tagih -> laporan -> dashboard', async () => {
  const { call } = await boot();
  const { accessToken: T } = await signup(call);
  const p = await call('POST', '/products', { token: T, body: { name: 'Ponsel X1', variants: [{ sku: 'X1', barcode: '8991', costPrice: 2_100_000, sellPrice: 2_499_000, openingQtyMilli: 5000 }] } });
  assert.equal(p.status, 201);
  const vid = p.json.variantIds[0];
  assert.equal((await call('GET', '/products/by-code/8991', { token: T })).json.productName, 'Ponsel X1');
  assert.equal((await call('GET', '/products/by-code/0000', { token: T })).status, 404);
  const cu = await call('POST', '/customers', { token: T, body: { name: 'Rina', phone: '0812' } });
  const sale = await call('POST', '/sales', { token: T, body: { items: [{ variantId: vid, qtyMilli: 2000 }], customerId: cu.json.id, paid: 1_000_000, dueDate: '2026-11-30' } });
  assert.equal(sale.status, 201);
  assert.deepEqual([sale.json.total, sale.json.status], [4_998_000, 'partial']);
  assert.equal((await call('GET', `/sales/${sale.json.saleId}`, { token: T })).json.items[0].name, 'Ponsel X1');
  const debts = await call('GET', '/debts?open=1', { token: T });
  assert.equal(debts.json[0].remaining, 3_998_000);
  const pay = await call('POST', `/debts/${debts.json[0].id}/pay`, { token: T, body: { amount: 998_000 } });
  assert.deepEqual(pay.json, { remaining: 3_000_000, status: 'partial' });
  assert.equal((await call('GET', '/products?search=ponsel', { token: T })).json[0].stockQtyMilli, 3000);
  const day = new Date().toISOString().slice(0, 10);
  const pl = await call('GET', `/reports/profit-loss?from=${day}&to=${day}`, { token: T });
  assert.equal(pl.status, 200);
  assert.equal((await call('GET', '/reports/dashboard', { token: T })).json.lowStockCount, 0);
  assert.equal((await call('GET', '/wallets', { token: T })).json[0].balance, 1_000_000 + 1_000_000 + 998_000);
  assert.equal((await call('GET', `/reports/profit-loss?from=2026-10-02&to=2026-10-01`, { token: T })).status, 400);
  assert.equal((await call('GET', `/reports/profit-loss`, { token: T })).status, 400);
});

test('BACKUP LINTAS-PERANGKAT: data dari akun A diekspor, dipulihkan ke akun B (bisnis berbeda) dan tampil lengkap', async () => {
  const { call, safety } = await boot();
  const A = await signup(call, 'a@toko.id', { businessName: 'Toko A' });
  const B = await signup(call, 'b@toko.id', { businessName: 'Toko B' });
  const pa = await call('POST', '/products', { token: A.accessToken, body: { name: 'Barang Milik A', variants: [{ sku: 'A1', costPrice: 100, sellPrice: 200, openingQtyMilli: 10_000 }] } });
  await call('POST', '/sales', { token: A.accessToken, body: { items: [{ variantId: pa.json.variantIds[0], qtyMilli: 3000 }] } });
  await call('POST', '/products', { token: B.accessToken, body: { name: 'Barang Lama B' } });

  const exp = await call('POST', '/backup/export', { token: A.accessToken, body: { password: BPW } });
  assert.equal(exp.status, 200);
  assert.match(exp.headers.get('content-disposition') ?? '', /^attachment; filename="ficoim-toko-a-\d{8}-\d{4}\.ficoim"$/);
  assert.equal(exp.headers.get('content-type'), 'application/octet-stream');
  assert.equal(Buffer.from(exp.bytes.subarray(0, 6)).toString(), 'FICOIM');
  const b64 = Buffer.from(exp.bytes).toString('base64');

  assert.equal((await call('POST', '/backup/restore', { token: B.accessToken, body: { password: 'salah-total-123', mode: 'replace', dataBase64: b64 } })).status, 422);
  assert.equal((await call('GET', '/products?search=lama', { token: B.accessToken })).json.length, 1); // belum berubah
  // Di satu database yang sama, ID baris A masih dipakai A -> pemulihan apa adanya ditolak jelas (409), B tidak berubah.
  const clash = await call('POST', '/backup/restore', { token: B.accessToken, body: { password: BPW, mode: 'replace', dataBase64: b64 } });
  assert.equal(clash.status, 409); assert.equal(clash.json.error.details.code, 'ID_COLLISION');
  assert.equal((await call('GET', '/products?search=lama', { token: B.accessToken })).json.length, 1);
  const rs = await call('POST', '/backup/restore', { token: B.accessToken, body: { password: BPW, mode: 'replace', regenerateIds: true, dataBase64: b64 } });
  assert.equal(rs.status, 200, JSON.stringify(rs.json));
  assert.equal(rs.json.businessId, B.businessId);
  assert.ok(safety.length >= 1 && safety.every((x) => x.biz === B.businessId)); // backup pengaman tersimpan sebelum menimpa
  // token lama menunjuk anggota yang sudah diganti -> tidak berlaku; sesi baru dari respons restore HARUS dipakai
  assert.equal((await call('GET', '/products', { token: B.accessToken })).status, 401);
  assert.ok(rs.json.session.accessToken && rs.json.session.refreshToken);
  B.accessToken = rs.json.session.accessToken;
  assert.equal((await call('GET', '/me', { token: B.accessToken })).status, 200);
  assert.equal((await call('GET', '/business', { token: B.accessToken })).json.id, B.businessId);

  const prods = await call('GET', '/products', { token: B.accessToken });
  assert.deepEqual(prods.json.map((x: { productName: string }) => x.productName), ['Barang Milik A']);
  assert.equal(prods.json[0].stockQtyMilli, 7000);
  assert.equal((await call('GET', '/sales', { token: B.accessToken })).json.length, 1);
  assert.equal((await call('GET', '/business', { token: B.accessToken })).json.id, B.businessId);   // tetap bisnis B
  // pengaman bisa dibuka dengan kata sandi yang sama dan berisi data lama B
  const re = await call('POST', '/backup/restore', { token: B.accessToken, body: { password: BPW, mode: 'replace', dataBase64: Buffer.from(safety[safety.length - 1]!.bytes).toString('base64') } });
  assert.equal(re.status, 200, JSON.stringify(re.json));
  B.accessToken = re.json.session.accessToken; // anggota diganti lagi -> sesi baru lagi
  assert.deepEqual((await call('GET', '/products', { token: B.accessToken })).json.map((x: { productName: string }) => x.productName), ['Barang Lama B']);
  // akun A tidak terpengaruh sama sekali
  assert.deepEqual((await call('GET', '/products', { token: A.accessToken })).json.map((x: { productName: string }) => x.productName), ['Barang Milik A']);
});

test('restore: hanya pemilik; validasi input; kegagalan internal tidak membocorkan detail & tidak mengubah data', async () => {
  const ok = await boot();
  const O = await signup(ok.call);
  const owner = { token: O.accessToken };
  const st = await ok.call('POST', '/members', { ...owner, body: { email: 'sari@toko.id', password: 'Kasir-Sari-2026', displayName: 'Sari', role: 'staff' } });
  assert.equal(st.status, 201);
  const S = (await ok.call('POST', '/auth/login', { body: { email: 'sari@toko.id', password: 'Kasir-Sari-2026' } })).json;
  const mgr = await ok.call('POST', '/members', { ...owner, body: { email: 'manu@toko.id', password: 'Manajer-Manu-26', displayName: 'Manu', role: 'manager' } });
  assert.equal(mgr.status, 201);
  const M = (await ok.call('POST', '/auth/login', { body: { email: 'manu@toko.id', password: 'Manajer-Manu-26' } })).json;

  const exp = await ok.call('POST', '/backup/export', { ...owner, body: { password: BPW } });
  const b64 = Buffer.from(exp.bytes).toString('base64');
  for (const who of [S, M]) {
    assert.equal((await ok.call('POST', '/backup/restore', { token: who.accessToken, body: { password: BPW, mode: 'replace', dataBase64: b64 } })).status, 403);
    assert.equal((await ok.call('POST', '/backup/export', { token: who.accessToken, body: { password: BPW } })).status, who === M ? 200 : 403);
  }
  assert.equal((await ok.call('POST', '/backup/restore', { ...owner, body: { password: BPW, mode: 'hapus', dataBase64: b64 } })).status, 400);
  assert.equal((await ok.call('POST', '/backup/restore', { ...owner, body: { password: BPW, mode: 'merge' } })).status, 400);
  assert.equal((await ok.call('POST', '/backup/restore', { ...owner, body: { password: BPW, mode: 'merge', dataBase64: Buffer.from('bukan backup sama sekali, cukup panjang untuk lolos').toString('base64') } })).status, 400);
  assert.equal((await ok.call('POST', '/backup/export', { ...owner, body: { password: 'pendek' } })).status, 400);

  const bad = await boot({ failSafety: true });
  const X = await signup(bad.call);
  await bad.call('POST', '/products', { token: X.accessToken, body: { name: 'Jangan Hilang' } });
  const eb = await bad.call('POST', '/backup/export', { token: X.accessToken, body: { password: BPW } });
  const r = await bad.call('POST', '/backup/restore', { token: X.accessToken, body: { password: BPW, mode: 'replace', dataBase64: Buffer.from(eb.bytes).toString('base64') } });
  assert.equal(r.status, 500);
  assert.equal(r.json.error.code, 'INTERNAL');
  assert.ok(!JSON.stringify(r.json).includes('RAHASIA-INTERNAL'));          // detail internal tidak bocor
  assert.equal(bad.errors.length, 1);                                       // tetapi tercatat untuk operator
  assert.equal((await bad.call('GET', '/products', { token: X.accessToken })).json.length, 1);
});

test('hak akses per peran lewat HTTP: kasir boleh jual, ditolak untuk produk/laporan/pembatalan', async () => {
  const { call } = await boot();
  const O = await signup(call);
  const pv = await call('POST', '/products', { token: O.accessToken, body: { name: 'Pulpen', variants: [{ sellPrice: 3000, costPrice: 1000, openingQtyMilli: 10_000 }] } });
  await call('POST', '/members', { token: O.accessToken, body: { email: 'sari@toko.id', password: 'Kasir-Sari-2026', displayName: 'Sari', role: 'staff' } });
  const S = (await call('POST', '/auth/login', { body: { email: 'sari@toko.id', password: 'Kasir-Sari-2026' } })).json.accessToken;
  const sale = await call('POST', '/sales', { token: S, body: { items: [{ variantId: pv.json.variantIds[0], qtyMilli: 1000 }] } });
  assert.equal(sale.status, 201);
  assert.equal((await call('POST', '/products', { token: S, body: { name: 'X' } })).status, 403);
  assert.equal((await call('POST', `/sales/${sale.json.saleId}/void`, { token: S, body: { reason: 'iseng' } })).status, 403);
  assert.equal((await call('GET', '/reports/profit-loss?from=2026-10-01&to=2026-10-31', { token: S })).status, 403);
  assert.equal((await call('GET', '/members', { token: S })).status, 403);
  assert.equal((await call('PATCH', '/business', { token: S, body: { taxBp: 1100 } })).status, 403);
  assert.equal((await call('GET', '/reports/dashboard', { token: S })).json.profitToday, null);
  assert.equal((await call('POST', `/sales/${sale.json.saleId}/void`, { token: O.accessToken, body: { reason: 'salah' } })).status, 200);
  assert.equal((await call('POST', `/sales/${sale.json.saleId}/void`, { token: O.accessToken, body: { reason: 'lagi' } })).status, 409);
  const members = await call('GET', '/members', { token: O.accessToken });
  const sari = members.json.find((m: { displayName: string }) => m.displayName === 'Sari');
  await call('PATCH', `/members/${sari.id}`, { token: O.accessToken, body: { isActive: false } });
  assert.equal((await call('GET', '/products', { token: S })).status, 403);            // anggota nonaktif langsung tertolak
  assert.equal((await call('PATCH', `/members/${members.json[0].id}`, { token: O.accessToken, body: { isActive: false } })).status, 409); // pemilik tak bisa dinonaktifkan
});

test('isolasi antar-akun: akun B tidak bisa membaca/mengubah data akun A lewat ID', async () => {
  const { call } = await boot();
  const A = await signup(call, 'a@x.id'), B = await signup(call, 'b@x.id');
  const pa = await call('POST', '/products', { token: A.accessToken, body: { name: 'Rahasia A', variants: [{ sellPrice: 10, openingQtyMilli: 5000 }] } });
  const vid = pa.json.variantIds[0];
  const sale = await call('POST', '/sales', { token: A.accessToken, body: { items: [{ variantId: vid, qtyMilli: 1000 }] } });
  assert.equal((await call('GET', '/products', { token: B.accessToken })).json.length, 0);
  assert.equal((await call('GET', `/sales/${sale.json.saleId}`, { token: B.accessToken })).status, 404);
  assert.equal((await call('POST', '/sales', { token: B.accessToken, body: { items: [{ variantId: vid, qtyMilli: 1000 }] } })).status, 404);
  assert.equal((await call('PATCH', `/variants/${vid}`, { token: B.accessToken, body: { sellPrice: 1 } })).status, 404);
  assert.equal((await call('POST', `/variants/${vid}/adjust`, { token: B.accessToken, body: { mode: 'set', qtyMilli: 0 } })).status, 404);
  assert.equal((await call('POST', `/sales/${sale.json.saleId}/void`, { token: B.accessToken, body: { reason: 'sabotase' } })).status, 404);
  assert.equal((await call('GET', `/variants/${vid}/card`, { token: B.accessToken })).json.length, 0);
  assert.equal((await call('GET', '/products', { token: A.accessToken })).json[0].stockQtyMilli, 4000); // utuh
});

test('autentikasi lewat HTTP: tanpa/berbentuk salah/dirusak token ditolak; cookie refresh untuk web', async () => {
  const { call } = await boot();
  assert.equal((await call('GET', '/products')).status, 401);
  assert.equal((await call('GET', '/products', { headers: { authorization: 'Basic abc' } })).status, 401);
  assert.equal((await call('GET', '/products', { token: 'a.b.c' })).status, 401);
  const A = await signup(call);
  const [h, p, s] = A.accessToken.split('.') as [string, string, string];
  const forged = Buffer.from(JSON.stringify({ sub: 'x', bid: A.businessId, mid: 'y', exp: 9e9 })).toString('base64url');
  assert.equal((await call('GET', '/products', { token: `${h}.${forged}.${s}` })).status, 401);
  assert.equal((await call('GET', '/products', { token: A.accessToken })).status, 200);
  void p;

  // klien web: refresh token hanya di cookie HttpOnly, tidak ada di badan respons
  const w = await call('POST', '/auth/login', { body: { email: 'budi@toko.id', password: PW, client: 'web' } });
  assert.equal(w.json.refreshToken, undefined);
  const cookie = w.headers.get('set-cookie') ?? '';
  assert.match(cookie, /^ficoim_rt=[\w-]+; HttpOnly; SameSite=Strict; Path=\/api\/auth; Max-Age=\d+; Secure$/);
  const c = cookie.split(';')[0]!;
  assert.equal((await call('POST', '/auth/refresh', { headers: { cookie: c, origin: 'https://evil.example' } })).status, 403);
  const ok = await call('POST', '/auth/refresh', { headers: { cookie: c, origin: 'https://app.ficoim.id' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.accessToken); assert.equal(ok.json.refreshToken, undefined);
  assert.notEqual((ok.headers.get('set-cookie') ?? '').split(';')[0], c); // cookie ikut berotasi
  assert.equal((await call('POST', '/auth/refresh', { headers: { cookie: c } })).status, 401);   // yang lama tak bisa dipakai lagi
  const out = await call('POST', '/auth/logout', { headers: { cookie: (ok.headers.get('set-cookie') ?? '').split(';')[0]! } });
  assert.match(out.headers.get('set-cookie') ?? '', /Max-Age=0/);
});

test('2FA lewat HTTP: login butuh kode setelah diaktifkan', async () => {
  const { call } = await boot();
  const A = await signup(call);
  const start = await call('POST', '/auth/totp/start', { token: A.accessToken });
  const secret = base32Decode(start.json.base32);
  assert.equal((await call('POST', '/auth/totp/confirm', { token: A.accessToken, body: { code: totp(secret, Date.now() / 1000) } })).status, 200);
  const r = await call('POST', '/auth/login', { body: { email: 'budi@toko.id', password: PW } });
  assert.equal(r.status, 401); assert.equal(r.json.error.code, 'TOTP_REQUIRED');
  assert.equal((await call('GET', '/me', { token: A.accessToken })).json.totpEnabled, true);
});

test('keamanan HTTP: header, CORS, rate limit, ukuran, JSON, content-type, rute/metode salah', async () => {
  const strict = await boot({ limits: { authPerMin: 5 } });
  const h = await strict.call('GET', '/health');
  assert.equal(h.status, 200);
  assert.equal(h.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(h.headers.get('cache-control'), 'no-store');
  assert.match(h.headers.get('strict-transport-security') ?? '', /max-age=/);
  assert.match(h.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  const ok = await strict.call('GET', '/health', { headers: { origin: 'https://app.ficoim.id' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.ficoim.id');
  assert.equal((await strict.call('GET', '/health', { headers: { origin: 'https://evil.example' } })).headers.get('access-control-allow-origin'), null);
  const pre = await strict.call('OPTIONS', '/products', { headers: { origin: 'https://app.ficoim.id' } });
  assert.equal(pre.status, 204); assert.match(pre.headers.get('access-control-allow-headers') ?? '', /authorization/);
  assert.equal((await strict.call('OPTIONS', '/products', { headers: { origin: 'https://evil.example' } })).status, 403);

  assert.equal((await strict.call('GET', '/tidak-ada')).status, 404);
  assert.equal((await strict.call('DELETE', '/health')).status, 405);
  assert.equal((await strict.call('POST', '/auth/login', { raw: '{rusak' })).status, 400);
  assert.equal((await strict.call('POST', '/auth/login', { raw: '[1,2]' })).status, 400);
  const ct = await fetch(`${strict.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' });
  assert.equal(ct.status, 415);
  const big = await strict.call('POST', '/auth/login', { raw: JSON.stringify({ email: 'a@b.id', password: 'x'.repeat(1_200_000) }) });
  assert.equal(big.status, 413);

  // batas laju login (5/menit/IP): yang ke-6 ditolak 429 + Retry-After; (sudah terpakai oleh 4 percobaan di atas -> kirim sampai tertolak)
  let last = 0, retry: string | null = null;
  for (let i = 0; i < 8 && last !== 429; i++) { const r = await strict.call('POST', '/auth/login', { body: { email: 'x@y.id', password: 'salah' } }); last = r.status; retry = r.headers.get('retry-after'); }
  assert.equal(last, 429);
  assert.ok(Number(retry) >= 1);
});

test('profil bisnis & pajak: PATCH oleh pemilik memengaruhi penjualan berikutnya; zona waktu', async () => {
  const { call } = await boot();
  const A = await signup(call);
  assert.equal((await call('PATCH', '/business', { token: A.accessToken, body: { taxBp: 1100, allowNegativeStock: true } })).json.taxBp, 1100);
  const pv = await call('POST', '/products', { token: A.accessToken, body: { name: 'X', variants: [{ sellPrice: 100_000 }] } });
  const s = await call('POST', '/sales', { token: A.accessToken, body: { items: [{ variantId: pv.json.variantIds[0], qtyMilli: 1000 }] } });
  assert.deepEqual([s.json.tax, s.json.total], [11_000, 111_000]);
  assert.equal((await call('PATCH', '/business', { token: A.accessToken, body: { taxBp: 20_000 } })).status, 400);
  assert.equal((await call('PATCH', '/business', { token: A.accessToken, body: { businessType: 'kripto' } })).status, 400);
});
