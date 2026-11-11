# FICOIM — Finance Control & Inventory Management

Aplikasi **keuangan + inventaris + kasir untuk UMKM** (elektronik, non-elektronik, perabotan, fashion, makanan/minuman, dll.).
Satu mesin bisnis dipakai di dua tempat: **web** (React + server) dan **HP** (React Native/Expo, *offline-first*), dengan **backup
terenkripsi** yang bisa dipindah web ↔ HP.

**Fitur utama:** kasir (barcode, diskon, PPN, cicilan/piutang) · produk bervarian + **foto produk** · stok bertahap & opname ·
pembelian + **foto nota belanja** · **struk digital** (bagikan/cetak) · hutang-piutang · dompet, anggaran, tagihan berulang, target ·
aset (peminjaman, perawatan, penyusutan) · laporan laba-rugi · tim & peran (pemilik/manajer/kasir) · 2FA · backup/pulihkan.

---

## 1. Stack

| Lapisan | Teknologi |
|---|---|
| **Frontend web** | React 19, **d3-shape + d3-scale** (grafik area/donat/sparkline interaktif), ikon SVG buatan sendiri, tema terang/gelap lewat variabel warna, Vite 7, Tailwind CSS v4, **Framer Motion** (transisi halaman, sheet, tombol), **GSAP** (angka berhitung naik), **Three.js** (latar 3D layar masuk, dimuat malas), PWA manifest |
| **Frontend mobile** | React Native 0.86 + **Expo SDK 57**, NativeWind v5 (Tailwind v4), `expo-sqlite`, `expo-camera` (barcode), `expo-image-picker` + `expo-image-manipulator` (foto), `expo-file-system`, `expo-sharing`, `expo-document-picker`, Reanimated |
| **Layar (UI bersama)** | `packages/screens` — SEMUA layar ditulis sekali di atas primitif UI (`Box/Txt/Btn/Field/Sheet/…`); web dan HP masing-masing menyediakan implementasinya |
| **Backend** | Node ≥ 22.5, TypeScript, router HTTP buatan sendiri di atas `node:http` (tanpa framework), JWT HS256 + refresh berotasi, TOTP 2FA (RFC 6238), scrypt/Argon2id |
| **Database** | **PostgreSQL** (server produksi, Row-Level Security) · **SQLite** (HP, dev server, dan seluruh tes) |
| **Skema** | Satu definisi TypeScript (`packages/shared`) → DDL PostgreSQL + SQLite + validator, otomatis sinkron |
| **Backup** | AES-256-GCM + scrypt, `@noble/*` + `fflate` di web/HP, `node:crypto/zlib` di server |
| **Ekspor** | Penulis `.xlsx`, ZIP, dan PDF buatan sendiri (tanpa dependensi), encoder QR buatan sendiri (ISO 18004, level M) — diverifikasi dengan `openpyxl` dan pembaca QR independen |
| **Pengujian** | `node:test` + `tsx`, Playwright (e2e), `esbuild` |

## 2. Struktur

```
packages/shared    skema 25 tabel, validator, uang/qty (integer), UUIDv7, format backup .ficoim
packages/core      mesin bisnis: penjualan, stok, pembelian, hutang-piutang, keuangan, aset, laporan, lampiran, restore
packages/api       auth (refresh berotasi, 2FA), izin peran, router, batas laju, penyimpanan berkas (foto)
packages/client    antarmuka Backend: RemoteBackend (web→API) & LocalBackend (HP→core di SQLite), keranjang, struk
packages/screens   semua layar + primitif UI + komponen foto
apps/web           Vite + React + Tailwind v4 + Framer Motion + GSAP + Three.js
apps/mobile        Expo SDK 57 + NativeWind (offline-first)
database/          DDL PostgreSQL (+RLS) & SQLite (hasil generate), tabel autentikasi
scripts/           audit-imports.ts
```

## 3. Instalasi

Prasyarat: **Node ≥ 22.5**, npm ≥ 10. (Opsional: PostgreSQL untuk produksi; Android Studio/Expo Go untuk HP.)

```bash
npm install                     # dari root monorepo — satu kali untuk semua paket
npm run audit                   # semua impor valid
npm test                        # 179 tes
npm run typecheck
npx playwright install chromium && npm run test:e2e     # opsional: uji web di browser nyata
```

> **Jika sebelumnya instalasi sempat gagal (ERESOLVE / duplikat `expo-file-system`):** hapus sisa instalasi dulu, lalu ulangi.
> ```bash
> # Windows PowerShell
> Remove-Item -Recurse -Force node_modules, package-lock.json, apps\mobile\node_modules -ErrorAction SilentlyContinue
> npm install
> cd apps\mobile && npx expo install --check     # menyelaraskan versi native; jawab Y
> npx expo-doctor                                # harus bersih
> ```
> Penyebab masalah lama: versi paket ditulis `"*"`, sehingga npm memasang `react-native` terbaru (0.88) dan `expo-*` 58, padahal
> **Expo SDK 57 = React Native 0.86.3 + React 19.2.3**. Kini semua versi dikunci sesuai SDK 57, `react` dipaksa satu versi lewat
> `overrides` di `package.json` root, dan `.npmrc` sengaja **tidak** memakai `legacy-peer-deps` (konflik harus diselesaikan, bukan disembunyikan).
> Peringatan `allow-scripts` untuk `esbuild`/`argon2` boleh diabaikan di pengembangan (`argon2` hanya untuk server produksi).

## 4. Menjalankan

```bash
npm run dev:api      # terminal 1 → http://127.0.0.1:8787/api/health  (SQLite di ./data, foto di ./data/attachments)
npm run dev:web      # terminal 2 → http://localhost:5173
npm run dev:mobile   # terminal 3 → Expo (lihat bagian 6)
```

**Beranda (dashboard):** kartu hero dengan sparkline & perubahan vs kemarin; **Ringkasan cerdas** (wawasan otomatis: kenaikan/penurunan, hari terbaik, margin tipis, stok habis, kas, piutang terlambat);
**Tren penjualan** interaktif 7 hari/30 hari/6 bulan (sentuh/arahkan untuk tooltip, total, rata-rata, perubahan periode); arus kas bulan ini; **donat** penjualan per kategori; produk terlaris; kesehatan stok.
Kasir hanya melihat hero & aksi cepat (tanpa angka laporan).
**Tampilan web:** beranda berkartu gradasi, ikon vektor, ubin aksi cepat, kasir berupa grid produk berfoto, kerangka pemuatan (skeleton), dan **tema gelap** (tombol di *Lainnya*; mengikuti pengaturan perangkat bila belum dipilih).
**Alur pembayaran web:** *Selesaikan pembayaran* → layar "Koneksi aman" (cincin + persen) → centang hijau + confetti + nominal → struk kertas. Transaksi sungguhan berjalan di belakang layar dan sheet terkunci selama proses.

Gerak/animasi web aktif otomatis. Mati sendiri bila sistem meminta *reduce motion* atau browser berupa otomatisasi (Playwright);
paksa nyala dengan `?motion=on` pada URL.

## 5. Petunjuk penggunaan

1. **Daftar** (web) atau **Mulai** (HP): isi nama, nama bisnis, jenis usaha, kas awal. Kategori & dompet bawaan dibuat otomatis.
2. **Produk → + Baru**: nama, **foto** (kamera/galeri), kategori, harga beli/jual, stok awal & minimum. Satu produk boleh punya banyak
   varian (ukuran/warna/kapasitas) — tiap varian punya SKU, barcode, harga, dan stok sendiri. Foto bisa diganti dari halaman detail produk.
3. **Kasir**: cari nama/SKU atau scan barcode (HP: kamera; web: pemindai USB sebagai keyboard + Enter) → ketuk produk → **Bayar**.
   Atur diskon, uang diterima (kembalian otomatis), pelanggan, dompet. Bayar sebagian = **cicilan** → sisa jadi piutang.
4. **Struk**: setelah transaksi (dan di *Lainnya → Riwayat penjualan → detail*) web menampilkan **kertas struk animasi** (keluar dari printer, stempel
   LUNAS/CICILAN, barcode nomor transaksi, bisa **Sobek** lalu **Cetak ulang**); HP menampilkan struk teks. Tombol **Bagikan** (WhatsApp dsb.),
   **Cetak** (lebar 58 mm), **Gambar** (PNG untuk WhatsApp) dan **Salin**. Nama toko, alamat, telepon, dan catatan kaki diatur di *Lainnya → Pengaturan bisnis*.
5. **Pembelian stok**: tambah barang, harga beli, pemasok, dibayar sekarang (kosong = lunas; kurang = hutang). **Foto nota belanja**
   bisa dilampirkan; ketuk pembelian untuk melihat nota atau membatalkannya (stok & kas dikembalikan).
6. **Keuangan**: dompet & transfer, transaksi manual (dengan **foto bukti/struk**), hutang-piutang (lunasi bertahap), anggaran per kategori,
   tagihan berulang, target tabungan.
7. **Laporan**: laba kotor & bersih, produk terlaris, nilai persediaan, produk mendekati kedaluwarsa. Tombol **PDF** dan **Excel** membuat laporan yang sama; Excel (`.xlsx`)
   berisi 8 sheet (Laba Rugi, Penjualan, Penjualan Harian, Produk Terlaris, Pembelian, Kas, Hutang Piutang, Persediaan) sesuai periode yang dipilih.
   **Label produk** (web: *Produk → 🏷️ Label*): pilih produk & jumlah, ukuran A4 3 kolom / 50×30 mm / 40×30 mm, lalu **Cetak label**. QR berisi barcode atau SKU
   (produk tanpa kode bisa dibuatkan kode otomatis), jadi bisa dipindai langsung di kasir. **Grafik laporan:** tren 6 bulan (pendapatan vs laba kotor) dan margin per kategori (sehat ≥30%, sedang 15–30%, tipis <15%).
   **Impor produk** (*Lainnya → Impor produk*): unduh template Excel/CSV, isi, pilih berkas; sistem memvalidasi tiap baris (angka format Indonesia seperti "15.000" dan "1,5" dikenali),
   menampilkan pratinjau & baris bermasalah, lalu mengimpor. Baris dengan Nama sama + Varian terisi digabung jadi satu produk bervarian; kategori baru dibuat otomatis; baris yang gagal
   (mis. SKU sudah dipakai) dilaporkan tanpa membatalkan yang lain. Membaca .xlsx di HP belum tersedia (pakai CSV); di web keduanya jalan.
   **Stok opname massal** (*Lainnya*): unduh daftar hitung (Excel, berisi kolom ID sehingga produk tanpa SKU pun cocok), isi "Stok Fisik", unggah, cek selisih, terapkan —
   tercatat di kartu stok sebagai opname (kolom kosong = tidak dihitung).
   **Struk**: di *Pengaturan bisnis → Struk* ada logo toko (tampil di kertas animasi dan gambar PNG), catatan kaki, dan lebar kertas teks 58/80 mm.
   **Pelanggan & Pemasok** (*Lainnya*): ringkasan transaksi, piutang/hutang per pihak, ubah, hapus, dan **kirim pengingat piutang** (WhatsApp dsb.).
   **Notifikasi** (lonceng di beranda): stok menipis, kedaluwarsa,
   tagihan jatuh tempo, piutang terlambat. **Aset**: peminjaman, perawatan
   (biaya otomatis tercatat), penyusutan garis lurus; foto aset.
8. **Tim** (web, pemilik): tambah **Manajer** atau **Kasir**. Kasir hanya boleh menjual & menagih piutang; tidak melihat laporan/tidak membatalkan.
9. **Akun & keamanan** (web): ganti sandi, aktifkan **2FA** (Google Authenticator/Authy).
10. **Backup & pulihkan**: *Lainnya → Backup* membuat berkas `.ficoim` terenkripsi (**termasuk foto**). Pulihkan di perangkat lain:
    **Timpa** (ganti semua) atau **Gabung** (baris terbaru menang). Sebelum menimpa, backup pengaman dibuat otomatis.
    **Lupa kata sandi backup = backup tidak bisa dibuka** (tidak ada pemulihan).

**Foto:** otomatis dikecilkan (sisi terpanjang 1280 px, JPEG ± 300 KB). Batas keras 1,5 MB per gambar; hanya JPEG/PNG/WebP (jenis dicek dari isi berkas).

## 6. Aplikasi mobile (Expo / EAS)

Data tersimpan di SQLite perangkat; logika bisnis = `@ficoim/core` yang sama dengan server. Foto disimpan sebagai berkas di folder dokumen aplikasi.

### Mencoba cepat (Expo Go)
```bash
npm install                      # dari root
cd apps/mobile
npx expo install --check         # pastikan versi cocok SDK 57
npx expo start --clear           # scan QR dengan Expo Go
```
Expo Go untuk SDK 57 mungkin belum tersedia di toko aplikasi; gunakan `eas go`/Expo CLI sesuai [catatan rilis SDK 57](https://expo.dev/changelog/sdk-57)
atau langsung **development build** di bawah.

### Membuat APK/AAB/IPA dengan EAS
```bash
npm i -g eas-cli                 # atau: npx eas-cli <perintah>
eas login
cd apps/mobile
eas init                         # menautkan proyek Expo (menulis projectId ke app.json)
eas build -p android --profile preview      # APK untuk dibagikan/diuji (distribusi internal)
eas build -p android --profile production   # AAB untuk Google Play
eas build -p ios --profile production       # perlu akun Apple Developer
eas submit -p android                        # kirim ke Play Console (opsional)
```
Profil ada di `apps/mobile/eas.json` (`development`, `preview`, `production`). Sebelum rilis toko: tambahkan `icon`, `splash`, dan
`android.adaptiveIcon.foregroundImage` di `app.json`, serta ubah `id.ficoim.app` menjadi ID paket milik Anda.
Izin kamera/foto sudah dideklarasikan lewat plugin `expo-camera` dan `expo-image-picker` di `app.json`.

### Jika sesuatu bermasalah di HP
| Gejala | Periksa |
|---|---|
| Layar tampil tanpa gaya | NativeWind v5 masih *preview*: `src/ui.native.tsx` (satu-satunya berkas ber-`className`); alternatif NativeWind v4 + Tailwind 3 |
| "Invalid hook call" | `npm run check:deps` — `react` harus satu versi (19.2.3) |
| "Unable to resolve @ficoim/…" | `metro.config.js` (`watchFolders`, `nodeModulesPaths`) |
| Ekspor/impor backup gagal | `src/files.ts` (API `File/Directory/Paths` dari `expo-file-system`) |
| "Mengenkripsi…" terlalu lama | turunkan `backupKdf: { logN: 14, r: 8, p: 1 }` di `App.tsx` (batas aman 14–17) |
| Foto gagal dipilih/dikecilkan | `src/images.ts` (`expo-image-picker`, `expo-image-manipulator`) dan izin di `app.json` |
| Tombol kembali Android keluar aplikasi | `App.tsx` (BackHandler) |

## 7. Produksi (server + PostgreSQL)

```bash
createdb ficoim
psql ficoim -f database/postgres/001_core.sql
psql ficoim -f database/postgres/002_server_auth.sql
# role aplikasi: BUKAN superuser, tanpa BYPASSRLS, hanya hak DML
psql ficoim -c "CREATE ROLE ficoim_app LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ficoim_app;"
cp packages/api/.env.example .env     # isi DATABASE_URL, TOKEN_SECRET, TOTP_KEY, ALLOWED_ORIGINS, ATTACHMENTS_DIR
npm run start -w packages/api
npm run build:web                      # hasil di apps/web/dist — sajikan lewat reverse proxy satu origin dengan /api
```
**Penting:** folder `ATTACHMENTS_DIR` (foto & nota) harus ikut dicadangkan bersama database. Atur reverse proxy agar `/api` meneruskan badan
permintaan ≥ 200 MB untuk restore (batas aplikasi: 2 MB unggah gambar, 200 MB restore, 1 MB lainnya).

## 8. API (ringkas)

Awalan `/api`. JSON in/out; galat `{ "error": { "code", "message", "details?" } }`. Otorisasi `Authorization: Bearer <accessToken>` (15 menit),
kecuali `/auth/*` dan `/health`. Uang = Rupiah bulat; qty = ×1000 (1 pcs = 1000, 1,5 kg = 1500). Total penjualan **selalu dihitung server**.

- **Sesi:** `POST /auth/register|login|refresh|logout|password`, `GET /me`, `POST /auth/totp/start|confirm|disable`. Klien `web` → refresh token
  di cookie `HttpOnly; SameSite=Strict`; klien mobile → di badan respons. Refresh **berotasi**; pemakaian ulang token lama = seluruh sesi dicabut.
- **Lampiran:** `POST /attachments?name=…` (badan = byte gambar mentah, ≤ 2 MB; hasil `{id,mime,sizeBytes,fileName}`) dan `GET /attachments/:id`.
  Id dipakai sebagai `photoAttachmentId` (produk/aset) atau `receiptAttachmentId` (pembelian/transaksi). Kasir tidak boleh mengunggah, boleh melihat.
- **Backup:** `POST /backup/export {password}` → `.ficoim`; `POST /backup/restore {password, mode, dataBase64, regenerateIds?}` (hanya pemilik).
  Bila respons memuat `session`, klien WAJIB memakainya. `409 ID_COLLISION` → ulangi dengan `regenerateIds: true`.
- **Data:** `/business`, `/members`, `/products`, `/variants`, `/customers`, `/suppliers`, `/sales`, `/purchases`, `/wallets`, `/finance/categories`,
  `/transactions`, `/transfers`, `/budgets`, `/bills`, `/debts`, `/goals`, `/assets`, `/loans`, `/maintenance`, `/reports/*`.
- **Batas & keamanan:** auth 10/menit/IP, backup 6/menit/IP, lainnya 600/menit/IP. Header `nosniff`, `no-store`, CSP `default-src 'none'`, HSTS.
  CORS hanya untuk `ALLOWED_ORIGINS`.

## 9. Arsitektur & keputusan

| Topik | Keputusan | Alasan |
|---|---|---|
| Mobile | Offline-first, SQLite lokal | Toko tetap jalan tanpa internet; syarat backup dua arah |
| Jembatan data | Berkas `.ficoim` terenkripsi | Satu format web ↔ HP |
| Skema | Satu definisi TS → DDL + validator | Web & HP tidak mungkin menyimpang |
| ID | UUID v7 | Dibuat offline tanpa bentrok, terurut waktu |
| Uang/qty | Integer Rupiah / integer ×1000 | Tanpa floating point |
| Hapus | Soft delete (`deleted_at`) | Aman untuk merge & audit |
| Stok | Buku besar `stock_movements`; `stock_qty_milli` hanya cache | Bisa dihitung ulang & diaudit |
| Multi-bisnis | `business_id` di semua tabel + RLS PostgreSQL | Isolasi dipaksa database |
| Gambar | Jenis ditentukan dari **isi** berkas; nama berkas = id; klien mengecilkan | Mencegah HTML/SVG disamarkan sebagai gambar; backup tetap ringan |
| Animasi | Hanya di web, lewat primitif opsional (`Reveal`, `AnimatedNumber`, `Backdrop`, `Img`) dengan cadangan polos | HP tidak terbebani; layar bersama tetap satu |
| Keamanan | Argon2id/scrypt, token pendek + refresh berotasi, TOTP, RLS `FORCE`, backup AES-256-GCM | — |

**Format backup `.ficoim` v1:** header 40 byte (`FICOIM`, versi, KDF, `logN/r/p`, salt 16, nonce 12) diautentikasi sebagai AAD; isi = `u32(meta) ‖ gzip(JSON manifest) ‖ blob…`
dienkripsi AES-256-GCM. Kata sandi dinormalisasi NFKC. Kredensial/sesi dan `storage_key` tidak ikut. Pembukaan defensif: parameter KDF dibatasi
(`logN` 14–17) sebelum komputasi, batas dekompresi, validasi penuh tabel/enum/rentang/referensi, tiap blob diverifikasi SHA-256.
v1 mengenkripsi di memori (± 2–3× ukuran berkas; batas 512 MB) — karena itu foto dikecilkan.

## 10. Pengujian

```bash
npm test                   # 179 tes: mesin bisnis, restore, backup, API, auth/2FA, klien, kontrak web≡HP, lampiran, struk
npm run test:e2e           # web nyata di Chromium (22 langkah) — perlu: npx playwright install chromium
npm run audit              # semua impor/paket valid
npm run check:sql          # database/*.sql sesuai tables.ts
npm run typecheck
```
Cakupan: tes kontrak membuktikan `RemoteBackend` (web) dan `LocalBackend` (HP) menghasilkan transkrip **identik** (termasuk foto & nota);
pratinjau keranjang = hasil server untuk 300 keranjang acak; balapan stok; isolasi antar-bisnis; kerusakan/pemalsuan backup; foto ikut backup.
Cek manual web (10 menit): daftar → produk berfoto → kasir tunai & cicilan → struk → pembelian + nota → laporan → batalkan penjualan →
muat ulang (sesi pulih) → backup & pulihkan → 2FA → tambah kasir (tidak boleh lihat laporan).

## 11. Mengubah skema data
Edit `packages/shared/src/schema/tables.ts` → naikkan `SCHEMA_VERSION` → tambah migrasi di `backup/migrations.ts` dan `core/src/migrate.ts` →
`npm run gen:sql` → `npm test`.

## 12. Keterbatasan & rencana
- Database HP belum dienkripsi saat disimpan (rencana: SQLCipher + `expo-secure-store`); mengandalkan enkripsi penyimpanan OS.
- Lupa kata sandi backup = backup tidak bisa dibuka. Lampiran yatim (foto diunggah lalu form dibatalkan) tidak dibersihkan otomatis (kecil, tak ikut backup).
- Manajemen tim/2FA hanya di web. URL web belum sinkron dengan tombol "kembali" browser.
- Belum teruji di mesin nyata: PostgreSQL/RLS/Argon2, build Vite + tampilan animasi/3D di browser, dan aplikasi HP (Expo) — ikuti bagian 3, 4, 6, 7.
- Label QR: kapasitas 213 byte (cukup untuk SKU/barcode). Pencetakan memakai dialog cetak browser (belum diuji di printer fisik).
- Notifikasi saat ini ada di dalam aplikasi (lonceng); notifikasi push butuh service worker/server push dan belum ada. Gambar struk hanya di web.
- Impor .xlsx memakai `DecompressionStream` (web modern); di HP gunakan CSV. File .xls lama tidak didukung.
- Logo tampil di struk kertas & PNG (web); struk teks tidak memuat gambar. Pada mode pulihkan "Salinan" (ID dibuat ulang) logo tidak ikut tertaut dan perlu dipasang ulang.
- Ide berikutnya: notifikasi push, sinkronisasi multi-perangkat, grafik di beranda, cetak struk langsung ke printer Bluetooth (HP).

## Lisensi
Proyek internal — tentukan lisensi sebelum dipublikasikan.
