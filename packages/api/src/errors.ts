import { DomainError } from '@ficoim/core';
import { BackupError } from '@ficoim/shared';
import { AuthError } from './auth';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) { super(message); this.name = 'ApiError'; }
}

const DOMAIN_STATUS: Record<string, number> = { VALIDATION: 400, NOT_FOUND: 404, CONFLICT: 409, FORBIDDEN: 403, INSUFFICIENT_STOCK: 409, INVALID_STATE: 409 };
const BACKUP_STATUS: Record<string, number> = { WRONG_PASSWORD_OR_CORRUPT: 422, SCHEMA_TOO_NEW: 422, WEAK_PASSWORD: 400, LIMIT_EXCEEDED: 413 };

export function toHttpError(e: unknown): { status: number; code: string; message: string; details?: unknown } | null {
  if (e instanceof ApiError) return { status: e.status, code: e.code, message: e.message, details: e.details };
  if (e instanceof AuthError) return { status: e.status, code: e.code, message: e.message };
  if (e instanceof DomainError) return { status: DOMAIN_STATUS[e.code] ?? 400, code: e.code, message: e.message, details: e.details };
  if (e instanceof BackupError) {
    // jangan bocorkan struktur data internal; cukup ringkas jumlah masalah validasi
    return { status: BACKUP_STATUS[e.code] ?? 400, code: `BACKUP_${e.code}`, message: e.message, details: e.issues ? { issues: e.issues.slice(0, 5), total: e.issues.length } : undefined };
  }
  return null;
}
