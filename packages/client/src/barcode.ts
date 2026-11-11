/**
 * Barcode Code 39 (huruf besar, angka, spasi dan - . $ / + %). Dipilih karena tabelnya kecil dan bisa diverifikasi:
 * setiap karakter = 9 elemen (5 garis + 4 spasi) dengan TEPAT 3 elemen lebar. Dipakai untuk hiasan/arsip pada struk
 * (nomor dokumen); pemindai umum membacanya.
 */
const W = 'w';
const PATTERNS: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn', F: 'nnwnwwnnn', G: 'nnnnnwwnw',
  H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn', K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn', P: 'nnwnwnnwn',
  Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn', U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '$': 'nwnwnwnnn', '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
};
export const CODE39_PATTERNS: Readonly<Record<string, string>> = PATTERNS;

/** Teks yang benar-benar dikodekan: huruf besar; karakter tak didukung diganti '-'; maksimal 40 karakter. */
export function code39Text(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g, '-').slice(0, 40);
}

/** Lebar elemen bergantian [garis, spasi, garis, …] dalam satuan modul (sempit = 1, lebar = 3), dengan awal/akhir `*`. */
export function code39Modules(value: string): number[] {
  const out: number[] = [];
  const chars = ['*', ...code39Text(value), '*'];
  chars.forEach((ch, ci) => {
    const p = PATTERNS[ch] as string;
    for (const e of p) out.push(e === W ? 3 : 1);
    if (ci < chars.length - 1) out.push(1); // jarak antar-karakter (spasi sempit)
  });
  return out;
}
