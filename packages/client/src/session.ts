export interface StoredSession {
  accessToken: string;
  /** Hanya klien mobile; klien web memakai cookie HttpOnly sehingga tidak pernah memegang refresh token. */
  refreshToken?: string;
  businessId: string;
  role: 'owner' | 'manager' | 'staff';
  user: { id: string; email: string; displayName: string; totpEnabled: boolean };
}

export interface TokenStore {
  get(): Promise<StoredSession | null>;
  set(s: StoredSession | null): Promise<void>;
}

/** Penyimpanan di memori: dipakai web (token akses TIDAK ditulis ke localStorage; sesi dipulihkan lewat cookie refresh). */
export function memoryTokenStore(): TokenStore {
  let cur: StoredSession | null = null;
  return { get: async () => cur, set: async (s) => { cur = s; } };
}
