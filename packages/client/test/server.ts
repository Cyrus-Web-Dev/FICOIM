import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { nodeRuntime } from '@ficoim/shared/backup/runtime-node';
import { memoryBlobStore } from '@ficoim/core';
import { AuthService, createApi, createHttpServer, memoryAuthStore, scryptHasher, RateLimiter } from '@ficoim/api';
import { newDb } from '../../core/test/helpers';

export const PW = 'Toko-Maju-2026!';
export const BPW = 'Backup-Rahasia-77!';
const servers: Server[] = [];
export const closeAll = () => { for (const s of servers) s.close(); };

/** API sungguhan (router + auth + core) di atas SQLite memori, dengan jam token yang bisa dimajukan. */
export async function bootApi(o: { accessTtlSec?: number } = {}) {
  const db = newDb();
  const clock = { t: Date.now() };
  const auth = new AuthService({ store: memoryAuthStore(), hasher: scryptHasher({ logN: 12, r: 8, p: 1 }), tenancy: { run: (_b, fn) => fn(db) }, tokenSecret: Buffer.alloc(32, 9), totpKey: Buffer.alloc(32, 5), now: () => clock.t, accessTtlSec: o.accessTtlSec });
  const calls: string[] = [];
  const api = createApi({
    auth, tenancy: { run: (_b, fn) => fn(db) }, runtime: nodeRuntime, allowedOrigins: ['https://app.ficoim.id'], appVersion: '0.1.0', secureCookies: false,
    limits: { authPerMin: 100000, defaultPerMin: 100000, backupPerMin: 100000 }, rateLimiter: new RateLimiter(), safetyBackupSink: async () => {}, blobStore: memoryBlobStore(),
    onError: (e) => { console.error('API error:', e); },
  });
  const srv = createHttpServer(api);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  servers.push(srv);
  return { db, clock, calls, baseUrl: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api` };
}

/** fetch dengan "toples cookie" sederhana, meniru perilaku browser untuk cookie refresh HttpOnly. */
export function cookieFetch(log?: string[]): typeof fetch {
  const jar = new Map<string, string>();
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const headers = new Headers(init?.headers);
    if (jar.size && init?.credentials === 'include') headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    log?.push(`${init?.method ?? 'GET'} ${String(input).replace(/^https?:\/\/[^/]+/, '')}`);
    const res = await fetch(input, { ...init, headers });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = c.split(';');
      const [k, v] = (pair as string).split('=') as [string, string];
      if (attrs.some((a) => /max-age=0/i.test(a))) jar.delete(k.trim()); else jar.set(k.trim(), v);
    }
    return res;
  }) as typeof fetch;
}
