import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Api } from './router';

class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limit) { reject(new BodyTooLarge()); return; }
    const chunks: Buffer[] = []; let size = 0;
    req.on('data', (c: Buffer) => { size += c.length; if (size > limit) { reject(new BodyTooLarge()); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Adapter node:http (tanpa dependensi). Untuk Fastify/Express cukup panggil api.handle() dari handler masing-masing. */
export function createHttpServer(api: Api, o: { trustProxy?: boolean } = {}): Server {
  return createServer(async (req, res) => {
    const send = (status: number, headers: Record<string, string>, body?: string | Uint8Array) => { res.writeHead(status, headers); res.end(body); };
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const method = (req.method ?? 'GET').toUpperCase();
      let body: unknown;
      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        const raw = await readBody(req, api.maxBodyFor(method, url.pathname));
        if (api.isRawBody(method, url.pathname)) {
          if (raw.length) body = new Uint8Array(raw); // rute unggah gambar: isi diperiksa dari byte-nya oleh core
        } else if (raw.length) {
          if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json'))
            return send(415, { 'content-type': 'application/json' }, JSON.stringify({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type harus application/json.' } }));
          try { body = JSON.parse(raw.toString('utf8')); }
          catch { return send(400, { 'content-type': 'application/json' }, JSON.stringify({ error: { code: 'BAD_JSON', message: 'JSON tidak valid.' } })); }
        }
      }
      const xff = o.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim() : '';
      const out = await api.handle({
        method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, ip: xff || req.socket.remoteAddress || 'unknown',
        headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v])),
      });
      if (out.bytes) return send(out.status, out.headers, out.bytes);
      if (out.json === undefined) return send(out.status, out.headers);
      send(out.status, { ...out.headers, 'content-type': 'application/json; charset=utf-8' }, JSON.stringify(out.json));
    } catch (e) {
      if (e instanceof BodyTooLarge) return send(413, { 'content-type': 'application/json' }, JSON.stringify({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Ukuran data terlalu besar.' } }));
      send(500, { 'content-type': 'application/json' }, JSON.stringify({ error: { code: 'INTERNAL', message: 'Terjadi kesalahan pada server.' } }));
    }
  });
}
