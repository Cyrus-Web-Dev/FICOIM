# Perbaikan build mobile FICOIM (setelah expo-doctor)

## 4 error expo-doctor & perbaikannya

| Error | Perbaikan |
|---|---|
| `newArchEnabled` not allowed | Dihapus dari `app.json` (SDK 55+ New Arch selalu ON, field ini tidak valid) |
| `disableHierarchicalLookup` mismatch | Metro disederhanakan: Expo SDK 52+ sudah handle monorepo otomatis |
| Duplicate `expo-file-system` | Override root + reinstall bersih |
| `react-native-worklets` 0.10.4 vs 0.10.1 | Dipin ke `0.10.1` lewat package.json + root overrides |

## Langkah di mesin Anda (WAJIB urut)

Dari root `C:\xampp\htdocs\FICOIM`:

```powershell
# 1. Salin file perbaikan ke apps\mobile:
#    - package.json
#    - metro.config.js
#    - app.json
#    - babel.config.js (jika belum ada)
#    - eas.json

# 2. Pastikan root package.json punya bagian overrides:
# {
#   "overrides": {
#     "react": "19.2.3",
#     "react-dom": "19.2.3",
#     "react-native-css": "3.1.0-rc.1",
#     "nativewind": "5.0.0-rc.1",
#     "react-native-worklets": "0.10.1",
#     "expo-file-system": "~57.0.7"
#   }
# }

# 3. HAPUS SEMUA node_modules + lock (penting untuk duplicate)
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force apps\mobile\node_modules -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue

# 4. Install ulang dari root
npm install

# 5. Masuk mobile, selaraskan versi Expo, cek doctor
cd apps\mobile
npx expo install --check
npx expo-doctor

# 6. Jika doctor bersih, build
eas build -p android --profile preview
```

Jika `npx expo install --check` menawarkan upgrade worklets ke 0.10.4, **tolak** (jawab N) — kita sengaja pin 0.10.1 sesuai yang diharapkan doctor untuk SDK 57.

## Jika masih ada duplicate expo-file-system

```powershell
# Dari root
npm ls expo-file-system
# Harusnya hanya satu versi. Jika masih dua, paksa:
npm dedupe
# atau hapus node_modules lagi + npm install
```
