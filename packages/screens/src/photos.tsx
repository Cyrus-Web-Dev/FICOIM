import { useEffect, useState } from 'react';
import type { Backend } from '@ficoim/client';
import { Box, Btn, Icon, Img, Txt, type IconName } from './ui';
import { useApp } from './platform';
import { useAction } from './hooks';

type Loaded = { bytes: Uint8Array; mime: string };

// Gambar tidak pernah berubah untuk id yang sama, jadi aman di-cache. Cache per backend (ganti akun = cache baru).
const caches = new WeakMap<Backend, Map<string, Promise<Loaded>>>();

function load(backend: Backend, id: string): Promise<Loaded> {
  let m = caches.get(backend);
  if (!m) { m = new Map(); caches.set(backend, m); }
  let p = m.get(id);
  if (!p) {
    p = backend.getImage(id);
    const map = m;
    p.catch(() => map.delete(id)); // galat (jaringan putus) jangan di-cache: coba lagi nanti
    m.set(id, p);
  }
  return p;
}

/** null = belum selesai / tidak ada; 'error' = gagal dimuat. */
export function useImage(id: string | null | undefined): Loaded | null | 'error' {
  const { backend } = useApp();
  const [st, setSt] = useState<Loaded | null | 'error'>(null);
  useEffect(() => {
    let live = true;
    setSt(null);
    if (!id) return;
    load(backend, id).then((r) => { if (live) setSt(r); }, () => { if (live) setSt('error'); });
    return () => { live = false; };
  }, [backend, id]);
  return st;
}

/** Foto (atau penampung bergambar bila belum ada / gagal dimuat). Ukuran diatur lewat className, mis. "h-12 w-12 rounded-lg". */
export function Photo({ id, className = 'h-12 w-12 rounded-lg', icon = 'package', testID }: { id: string | null | undefined; className?: string; icon?: IconName; testID?: string }) {
  const img = useImage(id);
  if (img && img !== 'error') return <Img bytes={img.bytes} mime={img.mime} className={className} testID={testID} />;
  return (
    <Box className={`items-center justify-center bg-slate-100 ${className}`}>
      <Icon name={icon} size={22} className="text-slate-400" />
    </Box>
  );
}

/**
 * Isian foto: ambil dari kamera / pilih dari galeri, kecilkan (oleh platform), unggah, lalu laporkan id lampiran.
 * Foto yang diganti sebelum disimpan tertinggal sebagai lampiran tanpa pemilik (tidak tampil di mana pun, ukurannya kecil).
 */
export function PhotoField({ label, value, onChange, testID, icon = 'camera' }: { label: string; value: string | null; onChange: (id: string | null) => void; testID?: string; icon?: IconName }) {
  const { backend, platform } = useApp();
  const act = useAction();
  const pick = (source: 'camera' | 'library') => act.run(async () => {
    const picked = await platform.pickImage?.(source);
    if (!picked) return;
    const up = await backend.uploadImage({ bytes: picked.bytes, fileName: picked.fileName });
    onChange(up.id);
  });
  if (!platform.pickImage) return null;
  return (
    <Box className="gap-2" testID={testID}>
      <Txt className="text-sm text-slate-600">{label}</Txt>
      <Box className="flex-row items-center gap-3">
        <Photo id={value} className="h-20 w-20 rounded-xl" icon={icon} testID={testID ? `${testID}-preview` : undefined} />
        <Box className="flex-1 gap-2">
          <Box className="flex-row flex-wrap gap-2">
            {platform.os !== 'web' ? <Btn label="📷 Kamera" variant="secondary" onPress={() => pick('camera')} loading={act.busy} testID={testID ? `${testID}-camera` : undefined} /> : null}
            <Btn label={value ? 'Ganti' : platform.os === 'web' ? '🖼️ Pilih gambar' : '🖼️ Galeri'} variant="secondary" onPress={() => pick('library')} loading={act.busy} testID={testID ? `${testID}-pick` : undefined} />
            {value ? <Btn label="Hapus" variant="ghost" onPress={() => onChange(null)} testID={testID ? `${testID}-remove` : undefined} /> : null}
          </Box>
          {act.error ? <Txt className="text-sm text-rose-600">{act.error}</Txt> : null}
        </Box>
      </Box>
    </Box>
  );
}
