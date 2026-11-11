import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'node:crypto';
import { gunzip, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { BackupRuntime } from './runtime';

const scryptP = promisify(scrypt) as (pw: Uint8Array, salt: Uint8Array, keylen: number, opts: object) => Promise<Buffer>;
const gzipP = promisify(gzip) as (b: Uint8Array) => Promise<Buffer>;
const gunzipP = promisify(gunzip) as (b: Uint8Array, o: object) => Promise<Buffer>;

const u8 = (b: Buffer): Uint8Array => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);

export const nodeRuntime: BackupRuntime = {
  randomBytes: (n) => u8(randomBytes(n)),
  async scrypt(password, salt, { logN, r, p }) {
    const N = 2 ** logN;
    return u8(await scryptP(password, salt, 32, { N, r, p, maxmem: 128 * N * r * 2 + 1024 * 1024 }));
  },
  async aesGcmEncrypt(key, nonce, aad, plaintext) {
    const c = createCipheriv('aes-256-gcm', key, nonce);
    c.setAAD(aad);
    const enc = Buffer.concat([c.update(plaintext), c.final()]);
    return u8(Buffer.concat([enc, c.getAuthTag()]));
  },
  async aesGcmDecrypt(key, nonce, aad, data) {
    if (data.length < 16) throw new Error('data terlalu pendek');
    const d = createDecipheriv('aes-256-gcm', key, nonce);
    d.setAAD(aad);
    d.setAuthTag(data.subarray(data.length - 16));
    return u8(Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]));
  },
  gzip: async (data) => u8(await gzipP(data)),
  gunzip: async (data, maxOutput) => u8(await gunzipP(data, { maxOutputLength: maxOutput })),
  sha256: async (data) => u8(createHash('sha256').update(data).digest()),
};
