/**
 * Encode/decode UTF-8. Memakai TextEncoder/TextDecoder bila ada, dan fallback murni-JS
 * untuk runtime yang belum punya (sebagian versi Hermes) agar backup tetap identik di semua platform.
 */
export function utf8EncodeJs(str: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const d = str.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd; // surrogate yatim
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

export function utf8DecodeJs(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++] as number;
    let cp: number;
    if (b < 0x80) cp = b;
    else if (b >= 0xc2 && b < 0xe0) cp = ((b & 31) << 6) | ((bytes[i++] ?? 0) & 63);
    else if (b >= 0xe0 && b < 0xf0) cp = ((b & 15) << 12) | (((bytes[i++] ?? 0) & 63) << 6) | ((bytes[i++] ?? 0) & 63);
    else if (b >= 0xf0 && b < 0xf5)
      cp = ((b & 7) << 18) | (((bytes[i++] ?? 0) & 63) << 12) | (((bytes[i++] ?? 0) & 63) << 6) | ((bytes[i++] ?? 0) & 63);
    else cp = 0xfffd;
    if (cp > 0xffff) {
      cp -= 0x10000;
      s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
    } else s += String.fromCharCode(cp);
  }
  return s;
}

const hasNative = typeof TextEncoder !== 'undefined' && typeof TextDecoder !== 'undefined';

export function utf8Encode(str: string): Uint8Array {
  return hasNative ? new TextEncoder().encode(str) : utf8EncodeJs(str);
}

export function utf8Decode(bytes: Uint8Array): string {
  return hasNative ? new TextDecoder('utf-8').decode(bytes) : utf8DecodeJs(bytes);
}

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += (bytes[i] as number).toString(16).padStart(2, '0');
  return s;
}
