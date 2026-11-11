export type DomainErrorCode =
  | 'VALIDATION'          // input tidak valid
  | 'NOT_FOUND'
  | 'CONFLICT'            // bentrok data (SKU kembar, bisnis sudah ada, dll)
  | 'FORBIDDEN'           // peran tidak berhak
  | 'INSUFFICIENT_STOCK'
  | 'INVALID_STATE';      // mis. membatalkan penjualan yang sudah batal

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: unknown;
  constructor(code: DomainErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export const validation = (m: string, d?: unknown) => new DomainError('VALIDATION', m, d);
export const notFound = (what: string) => new DomainError('NOT_FOUND', `${what} tidak ditemukan.`);
