// Inicia una instancia AISLADA de Catálogo Maestro para grabar el tutorial:
// base de datos y archivos en una carpeta temporal nueva, puerto propio. Nunca toca los datos reales.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '../..');

export async function startInstance({ port = 4300, pgPort = 54371 } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogo-tutorial-'));
  const env = { ...process.env, DATA_DIR: dataDir, PORT: String(port), EMBEDDED_PG_PORT: String(pgPort), ANTHROPIC_API_KEY: '', PUBLIC_BASE_URL: '' };
  const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'server/index.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 240; i++) {
    if (child.exitCode !== null) throw new Error(`La instancia terminó al iniciar:\n${log}`);
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) break;
    } catch {
      /* todavía iniciando */
    }
    await new Promise((r) => setTimeout(r, 500));
    if (i === 239) throw new Error(`La instancia no respondió:\n${log}`);
  }
  return {
    url,
    dataDir,
    async stop() {
      child.kill();
      // En Windows el proceso se termina sin señal: se detiene también el PostgreSQL embebido de esta instancia.
      const pidFile = path.join(dataDir, 'pgdata', 'postmaster.pid');
      await new Promise((r) => setTimeout(r, 500));
      if (fs.existsSync(pidFile)) {
        const pid = Number(fs.readFileSync(pidFile, 'utf8').split(/\r?\n/)[0]);
        try {
          if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
          else process.kill(pid);
        } catch {
          /* ya terminó */
        }
      }
    },
  };
}

/** Cliente HTTP simple para preparar datos de demostración fuera de cámara. */
export function apiClient(url) {
  let cookie = '';
  async function call(method, p, body, isForm = false) {
    const headers = { 'X-Requested-With': 'catalogo-maestro', cookie };
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    const r = await fetch(url + p, { method, headers, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = (r.headers.get('content-type') ?? '').includes('json') ? await r.json() : await r.text();
    if (!r.ok) throw new Error(`${method} ${p} → ${r.status}: ${JSON.stringify(data)}`);
    return data;
  }
  return {
    get: (p) => call('GET', p),
    post: (p, b = {}) => call('POST', p, b),
    put: (p, b) => call('PUT', p, b),
    upload: (p, files, fields = {}) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      for (const f of files) fd.append('files', new Blob([fs.readFileSync(f)]), path.basename(f));
      return call('POST', p, fd, true);
    },
  };
}
