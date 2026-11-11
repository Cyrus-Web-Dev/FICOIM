import type { PlatformServices } from '@ficoim/screens';
import { compressImage, pickFile } from './image';

function toast(message: string, kind: 'ok' | 'error'): void {
  const el = document.createElement('div');
  el.setAttribute('data-testid', 'toast');
  el.setAttribute('role', 'status');
  el.textContent = message;
  el.className = `fixed bottom-20 left-1/2 z-[60] -translate-x-1/2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow ${kind === 'error' ? 'bg-rose-600' : 'bg-slate-900'}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function download(bytes: Uint8Array, fileName: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function createWebPlatform(): PlatformServices {
  return {
    os: 'web',
    async confirm(title, message) { return window.confirm(`${title}\n\n${message}`); },
    notify(message, kind = 'ok') { toast(message, kind); },
    async saveBackup({ bytes, fileName }) { download(bytes, fileName, 'application/octet-stream'); },
    async saveFile({ bytes, fileName, mime }) { download(bytes, fileName, mime); },
    pickBackup() {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.ficoim,application/octet-stream'; input.style.display = 'none';
        input.onchange = async () => { const f = input.files?.[0]; resolve(f ? new Uint8Array(await f.arrayBuffer()) : null); input.remove(); };
        input.oncancel = () => { resolve(null); input.remove(); };
        document.body.appendChild(input);
        input.click();
      });
    },
    async shareText(title, text) {
      if (typeof navigator.share === 'function') {
        try { await navigator.share({ title, text }); return; }
        catch (e) { if ((e as DOMException).name === 'AbortError') return; /* gagal lain: jatuh ke salin */ }
      }
      await navigator.clipboard.writeText(text);
      toast('Struk disalin — tempel di WhatsApp/pesan', 'ok');
    },
    printLabels(size) {
      const sheet = document.querySelector('.label-sheet');
      if (!sheet) return;
      // Salinan lembar label dicetak lewat #print-root (sama seperti struk) supaya tidak terpotong oleh wadah gulir aplikasi.
      const root = document.createElement('div');
      root.id = 'print-root';
      root.appendChild(sheet.cloneNode(true));
      const page = document.createElement('style');
      page.textContent = size === 'a4' ? '@page { size: A4; margin: 8mm; }' : `@page { size: ${size === '50x30' ? '50mm 30mm' : '40mm 30mm'}; margin: 0; }`;
      document.head.appendChild(page);
      document.body.appendChild(root);
      document.body.classList.add('printing', 'printing-labels');
      const cleanup = () => { root.remove(); page.remove(); document.body.classList.remove('printing', 'printing-labels'); window.removeEventListener('afterprint', cleanup); };
      window.addEventListener('afterprint', cleanup);
      window.print();
    },
    async copyText(text) { await navigator.clipboard.writeText(text); toast('Struk disalin', 'ok'); },
    printReceipt(title, text) {
      // Dicetak lewat elemen sementara; CSS @media print menyembunyikan seluruh halaman selain elemen ini. textContent (bukan innerHTML) = aman.
      const root = document.createElement('div');
      root.id = 'print-root';
      const pre = document.createElement('pre');
      pre.textContent = text;
      root.appendChild(pre);
      document.body.appendChild(root);
      document.body.classList.add('printing');
      const prevTitle = document.title;
      document.title = title;
      const cleanup = () => { root.remove(); document.body.classList.remove('printing'); document.title = prevTitle; window.removeEventListener('afterprint', cleanup); };
      window.addEventListener('afterprint', cleanup);
      window.print();
    },
    async pickDataFile() {
      const f = await pickFile('.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      if (!f) return null;
      if (f.size > 10_000_000) throw new Error('Berkas terlalu besar (maks 10 MB).');
      return { bytes: new Uint8Array(await f.arrayBuffer()), fileName: f.name };
    },
    async pickImage(source) {
      const file = await pickFile('image/*', source === 'camera' ? 'environment' : undefined);
      return file ? compressImage(file) : null;
    },
    // Web: tidak ada pemindai kamera. Pemindai USB/Bluetooth bekerja sebagai keyboard (+Enter) di kolom pencarian kasir.
  };
}
