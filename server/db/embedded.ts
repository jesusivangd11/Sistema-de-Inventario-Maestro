import fs from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

/**
 * PostgreSQL embebido para desarrollo/uso local: binarios oficiales de PostgreSQL distribuidos por npm.
 * En producción, define DATABASE_URL y esto no se usa.
 */
export async function startEmbeddedPostgres(opts: { dir: string; port: number; database: string; password: string }) {
  const firstRun = !fs.existsSync(path.join(opts.dir, 'PG_VERSION'));
  const server = new EmbeddedPostgres({
    databaseDir: opts.dir,
    user: 'postgres',
    password: opts.password,
    port: opts.port,
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
    onError: (m) => {
      const s = String(m);
      if (/error|fatal/i.test(s)) console.error('[postgres]', s.trim());
    },
  });
  if (firstRun) {
    fs.mkdirSync(path.dirname(opts.dir), { recursive: true });
    await server.initialise();
  }
  // Un cierre abrupto (p. ej. cerrar la terminal) puede dejar un PostgreSQL huérfano o colgado sobre
  // NUESTRA carpeta de datos. Si no responde, se detiene ese proceso (su PID está en postmaster.pid).
  const pidFile = path.join(opts.dir, 'postmaster.pid');
  if (fs.existsSync(pidFile) && !(await canConnect(opts))) {
    const pid = Number(fs.readFileSync(pidFile, 'utf8').split(/\r?\n/)[0]);
    if (pid > 0) {
      try {
        process.kill(pid);
        console.log(`[db] Se detuvo un PostgreSQL anterior que no respondía (PID ${pid})`);
      } catch {
        /* el proceso ya no existe */
      }
      for (let i = 0; i < 20 && isAlive(pid); i++) await new Promise((r) => setTimeout(r, 250));
    }
    fs.rmSync(pidFile, { force: true });
  }
  if (!(await canConnect(opts))) {
    try {
      await server.start();
    } catch (e) {
      throw new Error(`No se pudo iniciar PostgreSQL embebido en ${opts.dir} (puerto ${opts.port}): ${e instanceof Error ? e.message : 'revisa que el puerto esté libre'}`);
    }
  }
  const client = new pg.Client({ host: 'localhost', port: opts.port, user: 'postgres', password: opts.password, database: 'postgres' });
  await client.connect();
  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [opts.database]);
  if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${opts.database}"`);
  await client.end();
  return {
    url: `postgres://postgres:${encodeURIComponent(opts.password)}@localhost:${opts.port}/${opts.database}`,
    stop: () => server.stop(),
  };
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function canConnect(opts: { port: number; password: string }) {
  const c = new pg.Client({ host: 'localhost', port: opts.port, user: 'postgres', password: opts.password, database: 'postgres', connectionTimeoutMillis: 4000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}
