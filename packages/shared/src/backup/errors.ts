import type { ValidationIssue } from '../schema/validate';

export type BackupErrorCode =
  | 'NOT_A_BACKUP'              // bukan file .ficoim
  | 'UNSUPPORTED_FORMAT'        // versi format/KDF belum didukung aplikasi ini
  | 'INVALID_KDF_PARAMS'        // parameter KDF di luar batas aman
  | 'WRONG_PASSWORD_OR_CORRUPT' // GCM gagal: kata sandi salah ATAU file rusak/diubah (tidak bisa dibedakan, by design)
  | 'SCHEMA_TOO_NEW'            // backup dibuat aplikasi yang lebih baru
  | 'INVALID_CONTENT'           // lolos dekripsi tetapi isinya tidak valid
  | 'WEAK_PASSWORD'
  | 'LIMIT_EXCEEDED';

export class BackupError extends Error {
  readonly code: BackupErrorCode;
  readonly issues?: ValidationIssue[];
  constructor(code: BackupErrorCode, message: string, issues?: ValidationIssue[]) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
    this.issues = issues;
  }
}
