import { Directory, File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { imageExtension, type BlobStore } from '@ficoim/core';
import { isUuid } from '@ficoim/shared';

function writeBytes(file: File, bytes: Uint8Array): void {
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
}

/** Menulis backup ke cache lalu membuka lembar bagikan OS (simpan ke Drive/WhatsApp/penyimpanan, dll.). */
export async function shareBackup(f: { bytes: Uint8Array; fileName: string }): Promise<void> {
  const file = new File(Paths.cache, f.fileName);
  writeBytes(file, f.bytes);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Berbagi berkas tidak tersedia di perangkat ini.');
  await Sharing.shareAsync(file.uri, { mimeType: 'application/octet-stream', dialogTitle: 'Simpan backup FICOIM' });
}

/** Menulis berkas apa pun (laporan, gambar) ke cache lalu membuka lembar bagikan OS. */
export async function shareFile(f: { bytes: Uint8Array; fileName: string; mime: string }): Promise<void> {
  const file = new File(Paths.cache, f.fileName.replace(/[\\/:*?"<>|]/g, '_'));
  writeBytes(file, f.bytes);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Berbagi berkas tidak tersedia di perangkat ini.');
  await Sharing.shareAsync(file.uri, { mimeType: f.mime, dialogTitle: f.fileName });
}

export async function pickDataFile(): Promise<{ bytes: Uint8Array; fileName: string } | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '*/*'], copyToCacheDirectory: true, multiple: false });
  const asset = r.canceled ? null : r.assets[0];
  if (!asset) return null;
  if (asset.size !== undefined && asset.size > 10_000_000) throw new Error('Berkas terlalu besar (maks 10 MB).');
  return { bytes: await new File(asset.uri).bytes(), fileName: asset.name };
}

export async function pickBackupFile(): Promise<Uint8Array | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  const asset = r.canceled ? null : r.assets[0];
  return asset ? new File(asset.uri).bytes() : null;
}

/** Backup pengaman otomatis sebelum restore menimpa data: disimpan di folder dokumen aplikasi. */
export async function writeSafetyBackup(fileName: string, bytes: Uint8Array): Promise<void> {
  const dir = new Directory(Paths.document, 'safety');
  if (!dir.exists) dir.create();
  writeBytes(new File(dir, fileName), bytes);
}

// Nama berkas dibuat dari id (uuid) + ekstensi jenis gambar — tidak pernah dari teks luar. storage_key hanya NAMA berkas (relatif):
// folder dokumen aplikasi bisa berpindah jalur setelah pembaruan OS, sehingga jalur penuh tidak boleh disimpan.
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

/** Foto produk/nota disimpan sebagai berkas di folder dokumen aplikasi (ikut backup lewat BlobStore). */
export function fileBlobStore(): BlobStore {
  const dir = () => { const d = new Directory(Paths.document, 'attachments'); if (!d.exists) d.create(); return d; };
  return {
    async write(id, mime, data) {
      const ext = imageExtension(mime);
      if (!isUuid(id) || ext === 'bin') throw new Error('Lampiran tidak valid untuk disimpan.');
      const key = `${id}.${ext}`;
      writeBytes(new File(dir(), key), data);
      return key;
    },
    async read(a) {
      const key = String(a.storage_key ?? '');
      if (!KEY.test(key)) return null;
      const f = new File(dir(), key);
      return f.exists ? await f.bytes() : null;
    },
  };
}
