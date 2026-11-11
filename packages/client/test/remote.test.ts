import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, ApiError, RemoteBackend, memoryTokenStore, toBase64, fromBase64 } from '../src/index';
import { BPW, PW, bootApi, closeAll, cookieFetch } from './server';

after(closeAll);
const reg = { email: 'budi@toko.id', password: PW, displayName: 'Budi', businessName: 'Toko', businessType: 'elektronik' };

test('base64 murni-JS identik dengan Buffer untuk berbagai panjang & byte acak', () => {
  for (let n = 0; n < 70; n++) {
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 97 + n * 13) & 255);
    assert.equal(toBase64(b), Buffer.from(b).toString('base64'), `n=${n}`);
    assert.deepEqual(fromBase64(toBase64(b)), b);
  }
  assert.deepEqual(fromBase64('AQID\n'), Uint8Array.of(1, 2, 3));
});

test('mobile: login, token akses kedaluwarsa -> refresh otomatis & permintaan diulang; refresh token berotasi', async () => {
  const s = await bootApi({ accessTtlSec: 60 });
  const tokens = memoryTokenStore();
  const api = new ApiClient({ baseUrl: s.baseUrl, tokens, client: 'mobile' });
  const sess = await api.login({ email: 'x', password: 'y' }).catch((e: ApiError) => e);
  assert.ok(sess instanceof ApiError && sess.code === 'INVALID_CREDENTIALS' && sess.status === 401);
  await api.register(reg);
  const first = (await tokens.get())!;
  assert.ok(first.refreshToken && first.accessToken);
  const be = new RemoteBackend(api);
  assert.equal((await be.business()).name, 'Toko');
  s.clock.t += 120_000; // token akses (60 dtk) kedaluwarsa
  assert.equal((await be.business()).name, 'Toko'); // 401 -> refresh -> ulang, tanpa terlihat pengguna
  const second = (await tokens.get())!;
  assert.notEqual(second.accessToken, first.accessToken);
  assert.notEqual(second.refreshToken, first.refreshToken); // rotasi
});

test('SINGLE-FLIGHT: 8 permintaan bersamaan dengan token kedaluwarsa hanya memicu 1 refresh (bukan "pencurian token")', async () => {
  const s = await bootApi({ accessTtlSec: 60 });
  const log: string[] = [];
  const api = new ApiClient({ baseUrl: s.baseUrl, tokens: memoryTokenStore(), client: 'mobile', fetchImpl: cookieFetch(log) });
  await api.register(reg);
  const be = new RemoteBackend(api);
  s.clock.t += 120_000;
  log.length = 0;
  const res = await Promise.all(Array.from({ length: 8 }, () => be.listProducts()));
  assert.equal(res.length, 8);
  assert.equal(log.filter((l) => l.includes('/auth/refresh')).length, 1);
  assert.equal((await be.business()).name, 'Toko'); // sesi masih hidup (keluarga token tidak dicabut)
});

test('refresh gagal (sesi dicabut): token dibersihkan, onSessionExpired dipanggil, galat 401 jelas', async () => {
  const s = await bootApi({ accessTtlSec: 60 });
  let expired = 0;
  const tokens = memoryTokenStore();
  const api = new ApiClient({ baseUrl: s.baseUrl, tokens, client: 'mobile', onSessionExpired: () => { expired++; } });
  await api.register(reg);
  const old = (await tokens.get())!;
  await api.changePassword(PW, 'Sandi-Baru-2026!'); // mencabut semua refresh token
  s.clock.t += 120_000;
  await assert.rejects(new RemoteBackend(api).business(), (e: ApiError) => e.status === 401);
  assert.equal(expired, 1);
  assert.equal(await tokens.get(), null);
  void old;
});

test('jaringan putus: ApiError NETWORK, sesi TIDAK dihapus (bisa dicoba lagi)', async () => {
  const s = await bootApi();
  const tokens = memoryTokenStore();
  let down = false;
  const flaky = ((...a: Parameters<typeof fetch>) => (down ? Promise.reject(new TypeError('fetch failed')) : fetch(...a))) as typeof fetch;
  const api = new ApiClient({ baseUrl: s.baseUrl, tokens, client: 'mobile', fetchImpl: flaky });
  await api.register(reg);
  down = true;
  await assert.rejects(new RemoteBackend(api).business(), (e: ApiError) => e.code === 'NETWORK' && e.status === 0);
  assert.ok(await tokens.get());
  down = false;
  assert.equal((await new RemoteBackend(api).business()).name, 'Toko');
});

test('web: refresh token hanya di cookie; sesi dipulihkan setelah "muat ulang halaman" (store kosong) lewat cookie; logout membersihkan', async () => {
  const s = await bootApi();
  const f = cookieFetch();
  const api1 = new ApiClient({ baseUrl: s.baseUrl, tokens: memoryTokenStore(), client: 'web', fetchImpl: f });
  await api1.register(reg);
  assert.equal(((await (api1 as unknown as { o: { tokens: { get(): Promise<{ refreshToken?: string }> } } }).o.tokens.get()).refreshToken), undefined); // tidak ada refresh token di JS
  await new RemoteBackend(api1).createProduct({ name: 'Bertahan' });

  // "muat ulang": memori JS hilang, cookie tetap
  const api2 = new ApiClient({ baseUrl: s.baseUrl, tokens: memoryTokenStore(), client: 'web', fetchImpl: f });
  const restored = await api2.restoreSession();
  assert.ok(restored && restored.user.email === 'budi@toko.id');
  assert.equal((await new RemoteBackend(api2).listProducts())[0]!.productName, 'Bertahan');

  await api2.logout();
  const api3 = new ApiClient({ baseUrl: s.baseUrl, tokens: memoryTokenStore(), client: 'web', fetchImpl: f });
  assert.equal(await api3.restoreSession(), null);
});

test('restore lintas-akun lewat klien: sesi baru dari server dipakai otomatis sehingga pengguna TIDAK terkunci', async () => {
  const s = await bootApi();
  const mk = async (email: string, name: string) => { const t = memoryTokenStore(); const api = new ApiClient({ baseUrl: s.baseUrl, tokens: t, client: 'mobile' }); await api.register({ ...reg, email, businessName: name }); return { api, be: new RemoteBackend(api), t }; };
  const A = await mk('a@x.id', 'Toko A'), B = await mk('b@x.id', 'Toko B');
  await A.be.createProduct({ name: 'Milik A', variants: [{ sellPrice: 100, openingQtyMilli: 1000 }] });
  await B.be.createProduct({ name: 'Lama B' });
  const { bytes, fileName } = await A.be.exportBackup(BPW);
  assert.match(fileName, /^ficoim-toko-a-\d{8}-\d{4}\.ficoim$/);
  await assert.rejects(B.be.restoreBackup({ password: BPW, mode: 'replace', bytes }), (e: ApiError) => e.status === 409 && (e.details as { code: string }).code === 'ID_COLLISION');
  await assert.rejects(B.be.restoreBackup({ password: 'salah-total-123', mode: 'replace', bytes, regenerateIds: true }), (e: ApiError) => e.status === 422);
  const before = (await B.t.get())!.accessToken;
  const rep = await B.be.restoreBackup({ password: BPW, mode: 'replace', bytes, regenerateIds: true });
  assert.ok(rep.replacementMemberId);
  assert.notEqual((await B.t.get())!.accessToken, before);                       // sesi baru diadopsi
  assert.deepEqual((await B.be.listProducts()).map((p) => p.productName), ['Milik A']);  // dan langsung bisa dipakai
  assert.equal((await B.be.business()).name, 'Toko A'); // mode TIMPA: profil bisnis ikut dari backup (mode gabung tidak menimpa profil)
});

test('galat server dipetakan ke ApiError berpesan jelas (validasi, konflik, izin)', async () => {
  const s = await bootApi();
  const api = new ApiClient({ baseUrl: s.baseUrl, tokens: memoryTokenStore(), client: 'mobile' });
  await api.register(reg);
  const be = new RemoteBackend(api);
  await be.createProduct({ name: 'Kabel', variants: [{ sku: 'K1' }] });
  await assert.rejects(be.createProduct({ name: 'Lain', variants: [{ sku: 'K1' }] }), (e: ApiError) => e.status === 409 && e.code === 'CONFLICT' && /SKU "K1"/.test(e.message));
  await assert.rejects(be.createProduct({ name: '' }), (e: ApiError) => e.status === 400 && e.code === 'VALIDATION');
  await assert.rejects(be.getSale('tidak-ada'), (e: ApiError) => e.status === 404);
  assert.equal(await be.findByCode('tidak-ada'), null);
});
