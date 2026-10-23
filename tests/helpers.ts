import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server/app';
import { connect, disconnect, getDb } from '../server/db/client';
import { startEmbeddedPostgres } from '../server/db/embedded';
import { runMigrations } from '../server/db/migrate';
import { setStorageRoot } from '../server/lib/storage';

process.env.APP_SECRET ||= 'test-secret-'.padEnd(48, 'x');

/** Entorno de prueba aislado: PostgreSQL real en carpeta temporal + almacenamiento temporal. */
export async function startTestEnv(port: number) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogo-test-'));
  const pgDir = path.join(root, 'pg');
  const storageDir = path.join(root, 'storage');
  setStorageRoot(storageDir);
  const opts = { dir: pgDir, port, database: 'catalogo_test', password: 'test' };
  let pg = await startEmbeddedPostgres(opts);
  connect(pg.url);
  await runMigrations(getDb());
  let app = await buildApp({ serveWeb: false });
  const env = {
    root,
    pgDir,
    storageDir,
    get app() {
      return app;
    },
    /** Cierra la aplicación, la conexión y el servidor PostgreSQL; luego vuelve a abrir todo desde disco. */
    async restart() {
      await app.close();
      await disconnect();
      await pg.stop();
      pg = await startEmbeddedPostgres(opts);
      connect(pg.url);
      await runMigrations(getDb());
      app = await buildApp({ serveWeb: false });
    },
    /** Detiene app y PostgreSQL (para respaldar/restaurar carpetas). */
    async pause() {
      await app.close();
      await disconnect();
      await pg.stop();
    },
    async resume() {
      pg = await startEmbeddedPostgres(opts);
      connect(pg.url);
      await runMigrations(getDb());
      app = await buildApp({ serveWeb: false });
    },
    async stop() {
      await app.close();
      await disconnect();
      await pg.stop();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
  return env;
}

type Res = { status: number; body: any; headers: Record<string, unknown>; raw: Buffer };

/** Cliente HTTP con sesión (cookie) sobre fastify.inject. */
export function client(getApp: () => FastifyInstance) {
  let cookie = '';
  const call = async (method: string, url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Res> => {
    const res = await getApp().inject({
      method: method as 'GET',
      url,
      payload: payload as string,
      headers: { cookie, 'x-requested-with': 'catalogo-maestro', ...headers },
    });
    const set = res.headers['set-cookie'];
    if (set) {
      const first = (Array.isArray(set) ? set : [set]).find((c) => c.startsWith('cm_session='));
      if (first) cookie = first.split(';')[0];
    }
    let body: any = res.body;
    if (String(res.headers['content-type'] ?? '').includes('application/json')) body = res.json();
    return { status: res.statusCode, body, headers: res.headers, raw: res.rawPayload };
  };
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, body?: unknown) => call('POST', url, body ?? {}),
    put: (url: string, body?: unknown) => call('PUT', url, body),
    patch: (url: string, body?: unknown) => call('PATCH', url, body),
    del: (url: string) => call('DELETE', url),
    upload: (url: string, files: { name: string; data: Buffer; field?: string }[], fields: Record<string, string> = {}) => {
      const boundary = '----catalogo' + Math.random().toString(16).slice(2);
      const parts: Buffer[] = [];
      for (const [k, v] of Object.entries(fields)) {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
      }
      for (const f of files) {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.field ?? 'files'}"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
        parts.push(f.data, Buffer.from('\r\n'));
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`));
      return call('POST', url, Buffer.concat(parts), { 'content-type': `multipart/form-data; boundary=${boundary}` });
    },
    clearSession: () => (cookie = ''),
  };
}

/** Genera una "fotografía" de prueba única (patrón de bloques de colores determinista por semilla). */
export async function testImage(seed: number, size = 1200, format: 'jpeg' | 'png' = 'jpeg') {
  const n = 8;
  const cell = Math.floor(size / n);
  const raw = Buffer.alloc(size * size * 3);
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280) * 255;
  const colors = Array.from({ length: n * n }, () => [rnd(), rnd(), rnd()]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = colors[Math.min(n - 1, Math.floor(y / cell)) * n + Math.min(n - 1, Math.floor(x / cell))];
      const i = (y * size + x) * 3;
      raw[i] = c[0];
      raw[i + 1] = c[1];
      raw[i + 2] = c[2];
    }
  }
  const img = sharp(raw, { raw: { width: size, height: size, channels: 3 } });
  return format === 'png' ? img.png().toBuffer() : img.jpeg({ quality: 90 }).toBuffer();
}

export function fixture(name: string) {
  return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8'));
}
