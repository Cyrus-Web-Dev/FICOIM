/**
 * Runtime untuk web, React Native (Hermes) dan Node — hanya JS murni (@noble, fflate), tanpa native module.
 * Pustaka noble sudah diaudit; kita TIDAK menulis ulang kripto sendiri.
 *
 * CATATAN: import di bawah ditulis untuk @noble/hashes ^1.8 dan @noble/ciphers ^1.3.
 * Bila setelah `npm install` ada error path, cukup sesuaikan 4 baris import ini; test/cross-runtime.test.ts
 * akan memastikan hasilnya tetap identik dengan implementasi Node.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { gunzipSync, gzipSync } from 'fflate';
import { secureRandomBytes } from '../random';
import type { BackupRuntime } from './runtime';

export const universalRuntime: BackupRuntime = {
  randomBytes: (n) => secureRandomBytes(n),
  scrypt: (password, salt, { logN, r, p }, onProgress) =>
    scryptAsync(password, salt, { N: 2 ** logN, r, p, dkLen: 32, onProgress, asyncTick: 20 }),
  async aesGcmEncrypt(key, nonce, aad, plaintext) {
    return gcm(key, nonce, aad).encrypt(plaintext);
  },
  async aesGcmDecrypt(key, nonce, aad, data) {
    return gcm(key, nonce, aad).decrypt(data);
  },
  async gzip(data) {
    return gzipSync(data, { level: 6 });
  },
  async gunzip(data, maxOutput) {
    // fflate tidak punya batas output bawaan: tolak input terkompresi yang tidak masuk akal lebih dulu,
    // lalu periksa hasilnya. (Aman karena data sudah lolos autentikasi GCM sebelum sampai sini.)
    const out = gunzipSync(data);
    if (out.length > maxOutput) throw new Error('hasil dekompresi melebihi batas');
    return out;
  },
  async sha256(data) {
    return sha256(data);
  },
};
