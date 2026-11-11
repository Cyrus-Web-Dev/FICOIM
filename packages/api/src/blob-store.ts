import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { imageExtension, type BlobStore } from '@ficoim/core';
import { isUuid } from '@ficoim/shared';

// Nama berkas dibuat SENDIRI dari id (uuid) + ekstensi dari jenis gambar: tidak pernah memakai teks dari klien/backup
// sebagai jalur, sehingga "../" dan sejenisnya tidak mungkin sampai ke sistem berkas.
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

/** Penyimpanan lampiran di disk server (satu folder datar). Isolasi antar-bisnis dijaga oleh pencarian baris `attachments` (business_id) sebelum byte dibaca. */
export function fileBlobStore(dir: string): BlobStore {
  const root = resolve(dir);
  return {
    async write(id, mime, data) {
      const ext = imageExtension(mime);
      if (!isUuid(id) || ext === 'bin') throw new Error('Lampiran tidak valid untuk disimpan.');
      const key = `${id}.${ext}`;
      await mkdir(root, { recursive: true });
      const tmp = join(root, `${key}.tmp-${randomBytes(6).toString('hex')}`);
      await writeFile(tmp, data, { mode: 0o600 });
      await rename(tmp, join(root, key)); // atomik: pembaca tidak pernah melihat berkas setengah jadi
      return key;
    },
    async read(a) {
      const key = String(a.storage_key ?? '');
      if (!KEY.test(key)) return null;
      try { return new Uint8Array(await readFile(join(root, key))); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
    },
  };
}
