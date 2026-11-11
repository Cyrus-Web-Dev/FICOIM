/** Memilih & mengecilkan gambar di peramban (tanpa pustaka): sisi terpanjang ≤ 1280 px, JPEG ≤ ± 300 KB. */
const MAX_SIDE = 1280;
const TARGET_BYTES = 300_000;
const HARD_LIMIT = 1_400_000; // di bawah batas server (1,5 MB)

async function decode(file: File): Promise<{ w: number; h: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; close: () => void }> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions); // hormati rotasi EXIF foto HP
    return { w: bmp.width, h: bmp.height, draw: (c, w, h) => c.drawImage(bmp, 0, 0, w, h), close: () => bmp.close() };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { w: img.naturalWidth, h: img.naturalHeight, draw: (c, w, h) => c.drawImage(img, 0, 0, w, h), close: () => URL.revokeObjectURL(url) };
    } catch {
      URL.revokeObjectURL(url);
      throw new Error('Gambar tidak bisa dibuka. Gunakan JPEG, PNG, atau WebP.');
    }
  }
}

const toBlob = (c: HTMLCanvasElement, q: number) => new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', q));

export async function compressImage(file: File): Promise<{ bytes: Uint8Array; fileName: string }> {
  if (!file.type.startsWith('image/')) throw new Error('Berkas yang dipilih bukan gambar.');
  const src = await decode(file);
  try {
    let side = MAX_SIDE, q = 0.82, blob: Blob | null = null;
    for (let i = 0; i < 8; i++) {
      const scale = Math.min(1, side / Math.max(src.w, src.h));
      const w = Math.max(1, Math.round(src.w * scale)), h = Math.max(1, Math.round(src.h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Peramban tidak mendukung pengolahan gambar.');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); // PNG transparan -> latar putih (JPEG tidak punya alfa)
      src.draw(ctx, w, h);
      blob = await toBlob(canvas, q);
      if (!blob) throw new Error('Gagal mengecilkan gambar.');
      if (blob.size <= TARGET_BYTES) break;
      if (q > 0.56) q -= 0.1; else side = Math.round(side * 0.8);
    }
    if (!blob || blob.size > HARD_LIMIT) throw new Error('Gambar terlalu besar untuk dikecilkan. Pilih gambar lain.');
    const base = (file.name.replace(/\.[^.]+$/, '') || 'foto').slice(0, 60);
    return { bytes: new Uint8Array(await blob.arrayBuffer()), fileName: `${base}.jpg` };
  } finally { src.close(); }
}

/** Dialog pilih berkas. `camera` = minta kamera belakang di peramban HP (di desktop menjadi pemilih berkas biasa). null bila dibatalkan. */
export function pickFile(accept: string, capture?: 'environment'): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.style.display = 'none';
    if (capture) input.setAttribute('capture', capture);
    let done = false;
    const finish = (f: File | null) => { if (done) return; done = true; window.removeEventListener('focus', onFocus); input.remove(); resolve(f); };
    // Peramban lama tidak memicu "cancel": setelah jendela fokus kembali & tidak ada berkas, anggap dibatalkan.
    const onFocus = () => setTimeout(() => finish(input.files?.[0] ?? null), 1500);
    input.onchange = () => finish(input.files?.[0] ?? null);
    input.oncancel = () => finish(null);
    document.body.appendChild(input);
    window.addEventListener('focus', onFocus, { once: true });
    input.click();
  });
}
