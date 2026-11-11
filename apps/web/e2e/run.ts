/**
 * Uji end-to-end: aplikasi web NYATA di Chromium + API nyata (SQLite memori), satu origin lewat proxy.
 *   npm run test:e2e -w apps/web
 * Prasyarat: `esbuild` dan `playwright` (+ browser: npx playwright install chromium).
 */
import http from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { nodeRuntime } from '@ficoim/shared/backup/runtime-node';
import { AuthService, RateLimiter, base32Decode, createApi, createHttpServer, memoryAuthStore, scryptHasher, totp } from '@ficoim/api';
import { newDb } from '../../../packages/core/test/helpers';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const { build } = require('esbuild') as typeof import('esbuild');
const { chromium } = require('playwright') as typeof import('playwright');

const PW = 'Toko-Maju-2026!', BPW = 'Backup-Rahasia-77!';
const out = mkdtempSync(join(tmpdir(), 'ficoim-e2e-'));
let step = 0;
const log = (m: string) => console.log(`  ${String(++step).padStart(2, '0')}. ${m}`);
const fail = (m: string): never => { throw new Error(`E2E GAGAL @ langkah ${step}: ${m}`); };

async function main() {
  // ---- 1. bundel aplikasi web (esbuild); CSS diabaikan (Tailwind dicek terpisah oleh build Vite)
  await build({
    entryPoints: [resolve(root, 'apps/web/src/main.tsx')], bundle: true, outfile: join(out, 'app.js'), format: 'iife', platform: 'browser', target: 'es2022',
    jsx: 'automatic', loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' },
    tsconfig: resolve(root, 'tsconfig.json'), nodePaths: (process.env.NODE_PATH ?? '').split(':').filter(Boolean), logLevel: 'warning',
  });
  const bundle = readFileSync(join(out, 'app.js'), 'utf8');
  if (/node:sqlite|node:crypto/.test(bundle)) fail('bundel web membawa modul Node (seharusnya tidak)');
  if (bundle.includes('createBusiness') || bundle.includes('restoreBackup(db')) fail('bundel web membawa mesin bisnis server (seharusnya hanya klien)');
  console.log(`Bundel web: ${(bundle.length / 1024).toFixed(0)} KB (tanpa mesin bisnis/server)`);
  writeFileSync(join(out, 'index.html'), '<!doctype html><html lang="id"><head><meta charset="utf-8"><title>FICOIM</title><style>.rn{display:flex;flex-direction:column;min-width:0}html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>');

  // ---- 2. server: proxy satu origin (statis + /api) -> API nyata
  let apiPort = 0;
  const proxy = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/api/')) {
      const p = http.request({ host: '127.0.0.1', port: apiPort, path: url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
      p.on('error', () => { res.writeHead(502); res.end(); });
      req.pipe(p);
      return;
    }
    res.setHeader('content-type', url === '/app.js' ? 'text/javascript' : 'text/html; charset=utf-8');
    res.end(readFileSync(join(out, url === '/app.js' ? 'app.js' : 'index.html')));
  });
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;

  const db = newDb();
  const auth = new AuthService({ store: memoryAuthStore(), hasher: scryptHasher({ logN: 12, r: 8, p: 1 }), tenancy: { run: (_b, fn) => fn(db) }, tokenSecret: Buffer.alloc(32, 9), totpKey: Buffer.alloc(32, 5) });
  const serverErrors: unknown[] = [];
  const api = createApi({
    auth, tenancy: { run: (_b, fn) => fn(db) }, runtime: nodeRuntime, allowedOrigins: [origin], appVersion: 'e2e', secureCookies: false, rateLimiter: new RateLimiter(),
    limits: { authPerMin: 10000, defaultPerMin: 100000, backupPerMin: 10000 }, safetyBackupSink: async () => {}, onError: (e) => serverErrors.push(e),
  });
  const apiSrv = createHttpServer(api);
  await new Promise<void>((r) => apiSrv.listen(0, '127.0.0.1', r));
  apiPort = (apiSrv.address() as AddressInfo).port;

  // ---- 3. browser
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 420, height: 900 }, acceptDownloads: true })).newPage();
  page.setDefaultTimeout(8000);
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*(401|409|422)/.test(m.text())) problems.push(`console.error: ${m.text()}`); });
  page.on('dialog', (d) => { void d.accept(); });

  const T = (id: string) => page.getByTestId(id);
  const click = (id: string) => T(id).first().click();
  const fill = (id: string, v: string) => T(id).first().fill(v);
  const text = async (id: string) => (await T(id).first().innerText()).replace(/\s+/g, ' ').trim();
  const expectText = async (id: string, re: RegExp | string) => { await T(id).first().waitFor(); const t = await text(id); if (!(typeof re === 'string' ? t.includes(re) : re.test(t))) fail(`[${id}] diharapkan ${re}, dapat "${t}"`); };
  const toast = async (re: RegExp | string) => { const t = page.getByTestId('toast').filter({ hasText: re }); await t.first().waitFor(); };

  try {
    await page.goto(origin);
    log('buka aplikasi -> layar masuk'); await T('login-email').waitFor();

    log('daftar bisnis baru (jenis Elektronik, kas awal Rp 1.000.000)');
    await click('goto-register');
    await fill('reg-name', 'Budi'); await fill('reg-email', 'budi@toko.id'); await fill('reg-password', PW); await fill('reg-business', 'Toko E2E');
    await click('chip-elektronik'); await fill('reg-cash', '1000000'); await click('reg-submit');
    await expectText('stat-sales', 'Rp 0');
    log('dashboard tampil (penjualan hari ini Rp 0)');

    log('tambah produk: Kabel USB, beli 8.000, jual 25.000, stok 40');
    await click('tab-products'); await click('add-product');
    await fill('pf-name', 'Kabel USB'); await fill('vf-sku-0', 'KB-1'); await fill('vf-cost-0', '8000'); await fill('vf-sell-0', '25000'); await fill('vf-qty-0', '40');
    await click('pf-save'); await toast('Produk disimpan');
    await expectText('product-row', 'Kabel USB');
    await expectText('product-row', '40 pcs');

    log('kasir: 2 kabel, bayar Rp 100.000 -> kembalian Rp 50.000');
    await click('tab-pos'); await fill('pos-search', 'kabel'); await T('pos-result').first().click();
    await click('qty-plus-0'); await expectText('cart-total', 'Rp 50.000');
    await click('pay'); await expectText('checkout-total', 'Rp 50.000');
    await fill('received', '100000'); await click('confirm-pay');
    await expectText('receipt-total', 'Rp 50.000'); await expectText('receipt-change', 'Rp 50.000');
    await click('new-sale');

    log('stok produk berkurang menjadi 38');
    await click('tab-products'); await expectText('product-row', '38 pcs');

    log('dashboard: penjualan hari ini Rp 50.000 (1 transaksi)');
    await click('tab-dashboard'); await expectText('stat-sales', 'Rp 50.000'); await expectText('stat-count', '1');

    log('kasir: penjualan CICILAN (1 kabel, bayar Rp 10.000, pelanggan baru Rina) -> piutang Rp 15.000');
    await click('tab-pos'); await fill('pos-search', 'kabel'); await T('pos-result').first().click();
    await click('pay'); await fill('new-customer', 'Rina'); await page.getByRole('button', { name: 'Tambah', exact: true }).click();
    await fill('received', '10000'); await click('confirm-pay');
    await T('receipt').waitFor(); if (!(await text('receipt')).includes('Sisa Rp 15.000')) fail('struk tidak menyebut sisa piutang Rp 15.000');
    await click('new-sale');

    log('keuangan: piutang Rina muncul, dilunasi -> hilang');
    await click('tab-finance'); await click('chip-debts');
    await expectText('debt-row', 'Rina'); await expectText('debt-sum', 'Rp 15.000');
    await click('debt-row'); await T('debt-amount').waitFor(); await click('debt-pay-save'); await toast('Lunas');
    await T('debt-row').first().waitFor({ state: 'detached' });

    log('keuangan: saldo dompet = 1.000.000 + 50.000 + 10.000 + 15.000');
    await click('chip-wallets'); await expectText('wallet-total', 'Rp 1.075.000');

    log('keuangan: catat biaya Rp 100.000 (kategori pertama)');
    await click('chip-tx'); await click('open-add-tx'); await fill('tx-amount', '100000'); await click('tx-save');
    await page.getByTestId('tx-row').filter({ hasText: '−Rp 100.000' }).first().waitFor();

    log('laporan: laba kotor Rp 51.000 (75.000 - HPP 24.000) dan laba bersih negatif');
    await click('tab-more'); await click('more-reports');
    await expectText('pl-gross', 'Rp 51.000'); await expectText('pl-net', '49.000');

    log('muat ulang halaman: sesi pulih lewat cookie refresh (token akses tidak disimpan di disk)');
    await page.reload(); await T('stat-sales').waitFor();

    log('backup: buat berkas terenkripsi (kata sandi kuat + persetujuan)');
    await click('tab-more'); await click('more-backup');
    await fill('bk-pw', BPW); await fill('bk-pw2', BPW);
    if (await T('bk-make').first().isEnabled()) fail('tombol backup aktif sebelum persetujuan dicentang');
    await click('bk-ack');
    const [dl] = await Promise.all([page.waitForEvent('download'), click('bk-make')]);
    const file = readFileSync((await dl.path()) as string);
    if (file.subarray(0, 6).toString() !== 'FICOIM') fail('berkas unduhan bukan .ficoim');
    if (file.includes('Kabel USB') || file.includes('Toko E2E')) fail('isi backup TIDAK terenkripsi');
    if (!/^ficoim-toko-e2e-\d{8}-\d{4}\.ficoim$/.test(dl.suggestedFilename())) fail(`nama berkas aneh: ${dl.suggestedFilename()}`);
    log(`   berkas ${dl.suggestedFilename()} (${file.length} byte) terenkripsi`);

    log('backup: kata sandi lemah ditolak (tombol tetap nonaktif)');
    await fill('bk-pw', 'abc'); await fill('bk-pw2', 'abc');
    if (await T('bk-make').first().isEnabled()) fail('kata sandi lemah diterima');
    await expectText('bk-strength', 'Minimal');

    log('pulihkan: kata sandi salah -> pesan galat, data tidak berubah');
    const pick = async () => { const [fc] = await Promise.all([page.waitForEvent('filechooser'), click('rs-pick')]); await fc.setFiles({ name: 'x.ficoim', mimeType: 'application/octet-stream', buffer: file }); };
    await pick(); await fill('rs-pw', 'salah-total-123'); await click('rs-go');
    await T('form-error').first().waitFor(); if (!/salah|rusak/i.test(await text('form-error'))) fail('pesan galat kata sandi salah tidak jelas');

    log('pulihkan: kata sandi benar, mode Gabung -> berhasil, 0 data baru (backup dirinya sendiri)');
    await fill('rs-pw', BPW); await click('rs-go');
    await expectText('rs-report', 'Pemulihan selesai'); await expectText('rs-report', 'Ditambahkan 0');
    await click('tab-products'); await expectText('product-row', 'Kabel USB');

    log('2FA: aktifkan lewat kunci rahasia, keluar, masuk lagi dengan kode');
    await click('tab-more'); await click('more-account'); await click('totp-start');
    const secret = base32Decode(await text('totp-secret'));
    await fill('totp-code', totp(secret, Date.now() / 1000)); await click('totp-confirm'); await toast('2FA aktif');
    await click('logout'); await T('login-email').waitFor();
    log('login salah sandi -> pesan galat'); await fill('login-email', 'budi@toko.id'); await fill('login-password', 'salah-sandi'); await click('login-submit');
    await T('form-error').first().waitFor(); if (!/salah/i.test(await text('form-error'))) fail('pesan login salah tidak muncul');
    await fill('login-password', PW); await click('login-submit');
    await T('login-totp').waitFor(); log('login benar -> diminta kode 2FA');
    await fill('login-totp', totp(secret, Date.now() / 1000 + 30)); // langkah berikutnya (jendela ±1) agar tidak bentrok anti-ulang
    await click('login-submit'); await T('stat-sales').waitFor();
    await click('tab-products'); await expectText('product-row', 'Kabel USB');
    log('masuk lagi dengan 2FA berhasil; data utuh');

    if (serverErrors.length) fail(`galat internal server: ${String(serverErrors[0])}`);
    if (problems.length) fail(`galat di browser:\n   ${problems.join('\n   ')}`);
    console.log(`\nE2E LULUS: ${step} langkah, 0 galat browser, 0 galat server.`);
  } catch (e) {
    await page.screenshot({ path: join(out, 'gagal.png') }).catch(() => undefined);
    console.error(`\n${(e as Error).message}\nScreenshot: ${join(out, 'gagal.png')}`);
    if (problems.length) console.error(`Galat browser:\n   ${problems.join('\n   ')}`);
    process.exitCode = 1;
  } finally {
    await browser.close(); apiSrv.close(); proxy.close();
  }
}

void main();
