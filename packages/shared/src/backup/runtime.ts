/**
 * Antarmuka primitif kripto/kompresi. Format backup (format.ts) murni logika & tidak bergantung
 * pada platform; yang berbeda per platform hanya implementasi ini:
 *   - runtime-universal.ts : @noble + fflate  (web, React Native/Hermes, Node)
 *   - runtime-node.ts      : node:crypto + node:zlib (server & pengujian)
 * Keduanya WAJIB menghasilkan keluaran yang identik (diuji silang di test/cross-runtime.test.ts).
 */
export interface ScryptParams { logN: number; r: number; p: number }

export interface BackupRuntime {
  randomBytes(length: number): Uint8Array;
  /** Turunkan kunci 32 byte. onProgress 0..1 (opsional; berguna di HP karena JS murni lambat). */
  scrypt(password: Uint8Array, salt: Uint8Array, params: ScryptParams, onProgress?: (p: number) => void): Promise<Uint8Array>;
  /** AES-256-GCM; hasil = ciphertext || tag(16 byte). */
  aesGcmEncrypt(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array>;
  /** Melempar error bila tag tidak cocok (kata sandi salah / data diubah). */
  aesGcmDecrypt(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, data: Uint8Array): Promise<Uint8Array>;
  gzip(data: Uint8Array): Promise<Uint8Array>;
  /** maxOutput = batas keras ukuran hasil (anti "zip bomb"). */
  gunzip(data: Uint8Array, maxOutput: number): Promise<Uint8Array>;
  sha256(data: Uint8Array): Promise<Uint8Array>;
}
