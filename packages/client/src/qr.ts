/**
 * Pembuat QR Code (mode byte/UTF-8, koreksi galat level M, versi 1–10 → hingga 213 byte). Tanpa dependensi.
 * Dibuat mengikuti ISO/IEC 18004: pola fungsi, Reed-Solomon GF(256), penyisipan blok, 8 mask + penalti.
 * Keluaran diverifikasi dengan pembaca QR independen pada rentang panjang data v1–v10 (lihat test/qr.test.ts).
 */
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];   // level M, indeks = versi
const NUM_BLOCKS    = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const MAX_VERSION = 10;

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2, size = ver * 4 + 17;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const res = [6];
  for (let pos = size - 7; res.length < n; pos -= step) res.splice(1, 0, pos);
  return res;
}
function rawDataModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) { const a = Math.floor(ver / 7) + 2; r -= (25 * a - 10) * a - 55; if (ver >= 7) r -= 36; }
  return r;
}
const rawCodewords = (ver: number): number => Math.floor(rawDataModules(ver) / 8);
const dataCodewords = (ver: number): number => rawCodewords(ver) - ECC_PER_BLOCK[ver]! * NUM_BLOCKS[ver]!;

// ---- Reed-Solomon (GF(256), polinomial 0x11D)
function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
  return z & 0xff;
}
function rsGenerator(deg: number): number[] {
  const res = new Array<number>(deg).fill(0); res[deg - 1] = 1;
  let root = 1;
  for (let i = 0; i < deg; i++) {
    for (let j = 0; j < deg; j++) { res[j] = gfMul(res[j]!, root); if (j + 1 < deg) res[j] = res[j]! ^ res[j + 1]!; }
    root = gfMul(root, 2);
  }
  return res;
}
function rsRemainder(data: number[], gen: number[]): number[] {
  const res = new Array<number>(gen.length).fill(0);
  for (const b of data) {
    const f = b ^ res.shift()!; res.push(0);
    gen.forEach((c, i) => { res[i] = res[i]! ^ gfMul(c, f); });
  }
  return res;
}

const bit = (x: number, i: number): boolean => ((x >>> i) & 1) !== 0;

/** Byte data (UTF-8) → codeword data, lengkap dengan header, terminator, dan pengisi. */
function encodeData(bytes: Uint8Array, ver: number): number[] {
  const bits: number[] = [];
  const push = (v: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  push(0b0100, 4); push(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const cap = dataCodewords(ver) * 8;
  push(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; out.length < dataCodewords(ver); pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

function interleave(data: number[], ver: number): number[] {
  const nb = NUM_BLOCKS[ver]!, ecl = ECC_PER_BLOCK[ver]!, raw = rawCodewords(ver);
  const numShort = nb - (raw % nb), shortLen = Math.floor(raw / nb);
  const blocks: number[][] = []; const gen = rsGenerator(ecl);
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = data.slice(k, k + shortLen - ecl + (i < numShort ? 0 : 1)); k += dat.length;
    const ec = rsRemainder(dat, gen);
    if (i < numShort) dat.push(0); // marker; dilewati saat penyisipan
    blocks.push([...dat, ...ec]);
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++) blocks.forEach((b, j) => { if (i !== shortLen - ecl || j >= numShort) out.push(b[i]!); });
  return out;
}

class Grid {
  readonly size: number; m: boolean[][]; fn: boolean[][];
  constructor(readonly ver: number) {
    this.size = ver * 4 + 17;
    this.m = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fn = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.patterns();
  }
  set(x: number, y: number, dark: boolean): void { this.m[y]![x] = dark; this.fn[y]![x] = true; }
  private patterns(): void {
    const s = this.size;
    for (let i = 0; i < s; i++) { this.set(6, i, i % 2 === 0); this.set(i, 6, i % 2 === 0); }
    this.finder(3, 3); this.finder(s - 4, 3); this.finder(3, s - 4);
    const al = alignmentPositions(this.ver), n = al.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.set(al[i]! + dx, al[j]! + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    this.format(0); this.version();
  }
  private finder(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) this.set(xx, yy, d !== 2 && d !== 4);
    }
  }
  format(mask: number): void {
    const data = (0 << 3) | mask; // level M = 00
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412, s = this.size;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(bits, i));
    this.set(8, 7, bit(bits, 6)); this.set(8, 8, bit(bits, 7)); this.set(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) this.set(s - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) this.set(8, s - 15 + i, bit(bits, i));
    this.set(8, s - 8, true);
  }
  private version(): void {
    if (this.ver < 7) return;
    let rem = this.ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.ver << 12) | rem;
    for (let i = 0; i < 18; i++) { const c = bit(bits, i), a = this.size - 11 + (i % 3), b = Math.floor(i / 3); this.set(a, b, c); this.set(b, a, c); }
  }
  place(cw: number[]): void {
    let i = 0; const s = this.size;
    for (let right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < s; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? s - 1 - vert : vert;
        if (!this.fn[y]![x] && i < cw.length * 8) { this.m[y]![x] = bit(cw[i >>> 3]!, 7 - (i & 7)); i++; }
      }
    }
  }
  mask(k: number): void {
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) {
      let inv: boolean;
      switch (k) {
        case 0: inv = (x + y) % 2 === 0; break; case 1: inv = y % 2 === 0; break; case 2: inv = x % 3 === 0; break; case 3: inv = (x + y) % 3 === 0; break;
        case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break; case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break; default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      }
      if (inv && !this.fn[y]![x]) this.m[y]![x] = !this.m[y]![x];
    }
  }
  penalty(): number {
    const s = this.size, m = this.m; let p = 0;
    const line = (get: (i: number) => boolean) => {
      let run = 1;
      for (let i = 1; i < s; i++) { if (get(i) === get(i - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; }
      const str = Array.from({ length: s }, (_, i) => (get(i) ? '1' : '0')).join('');
      for (const pat of ['000010111010', '010111010000']) { let k = -1; while ((k = str.indexOf(pat, k + 1)) !== -1) p += 40; } // pola mirip finder
    };
    for (let y = 0; y < s; y++) line((i) => m[y]![i]!);
    for (let x = 0; x < s; x++) line((i) => m[i]![x]!);
    // blok 2×2 sewarna
    for (let y = 0; y < s - 1; y++) for (let x = 0; x < s - 1; x++) { const c = m[y]![x]; if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) p += 3; }
    let dark = 0; for (const r of m) for (const c of r) if (c) dark++;
    p += Math.floor(Math.abs(dark * 20 - s * s * 10) / (s * s)) * 10;
    return p;
  }
}

/** Matriks QR (true = modul gelap), tanpa zona tenang. Melempar bila data > 213 byte. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length === 0) throw new Error('Teks QR kosong.');
  let ver = 1;
  while (ver <= MAX_VERSION && 4 + (ver < 10 ? 8 : 16) + bytes.length * 8 > dataCodewords(ver) * 8) ver++;
  if (ver > MAX_VERSION) throw new Error('Teks terlalu panjang untuk QR (maksimal 213 byte).');
  const cw = interleave(encodeData(bytes, ver), ver);
  let best: Grid | null = null, bestP = Infinity;
  for (let k = 0; k < 8; k++) {
    const g = new Grid(ver); g.place(cw); g.mask(k); g.format(k);
    const p = g.penalty();
    if (p < bestP) { best = g; bestP = p; }
  }
  return best!.m;
}

/** QR sebagai path SVG (satu <path>, hemat) dengan zona tenang `quiet` modul. */
export function qrSvgPath(matrix: boolean[][], quiet = 4): { d: string; size: number } {
  const n = matrix.length; let d = '';
  matrix.forEach((row, y) => { let x = 0; while (x < n) { if (!row[x]) { x++; continue; } let e = x; while (e < n && row[e]) e++; d += `M${x + quiet} ${y + quiet}h${e - x}v1h${-(e - x)}z`; x = e; } });
  return { d, size: n + quiet * 2 };
}
