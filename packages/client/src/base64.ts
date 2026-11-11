const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 murni-JS (tidak bergantung btoa/Buffer yang berbeda antar runtime: browser, Hermes, Node). */
export function toBase64(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = ((b[i] as number) << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += CH.charAt((n >> 18) & 63) + CH.charAt((n >> 12) & 63) + (i + 1 < b.length ? CH.charAt((n >> 6) & 63) : '=') + (i + 2 < b.length ? CH.charAt(n & 63) : '=');
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = CH.indexOf(clean[i] as string), b = CH.indexOf(clean[i + 1] as string);
    const c = i + 2 < clean.length ? CH.indexOf(clean[i + 2] as string) : -1, d = i + 3 < clean.length ? CH.indexOf(clean[i + 3] as string) : -1;
    out[o++] = (a << 2) | (b >> 4);
    if (c >= 0) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0) out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}
