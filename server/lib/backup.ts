import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

/*
 * Respaldo y restauración del modo local (PostgreSQL embebido + archivos).
 * Se copian las carpetas completas con la base DETENIDA, lo que da una copia consistente.
 * La restauración nunca borra: la versión actual se mueve a una carpeta "antes-de-restaurar-<fecha>".
 */

export type DataPaths = { pgDir: string; storageDir: string; backupsDir: string };

const MANIFEST = 'respaldo.json';

export function portInUse(port: number) {
  return new Promise<boolean>((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => (s.destroy(), resolve(true)));
    s.on('error', () => resolve(false));
  });
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  return n;
}

export function createBackup(p: DataPaths) {
  if (!fs.existsSync(path.join(p.pgDir, 'PG_VERSION'))) throw new Error(`No hay base de datos en ${p.pgDir}`);
  const dest = path.join(p.backupsDir, stamp());
  fs.mkdirSync(dest, { recursive: true });
  // postmaster.pid y postmaster.opts son de la ejecución anterior; no se copian.
  fs.cpSync(p.pgDir, path.join(dest, 'pgdata'), { recursive: true, filter: (src) => !/postmaster\.(pid|opts)$/.test(src) });
  if (fs.existsSync(p.storageDir)) fs.cpSync(p.storageDir, path.join(dest, 'storage'), { recursive: true });
  const manifest = {
    createdAt: new Date().toISOString(),
    pgVersion: fs.readFileSync(path.join(p.pgDir, 'PG_VERSION'), 'utf8').trim(),
    dbFiles: countFiles(path.join(dest, 'pgdata')),
    storageFiles: countFiles(path.join(dest, 'storage')),
  };
  fs.writeFileSync(path.join(dest, MANIFEST), JSON.stringify(manifest, null, 2));
  return { dest, ...manifest };
}

export function listBackups(backupsDir: string) {
  if (!fs.existsSync(backupsDir)) return [];
  return fs
    .readdirSync(backupsDir)
    .filter((d) => fs.existsSync(path.join(backupsDir, d, MANIFEST)))
    .sort()
    .reverse();
}

// En Windows un rename puede fallar con EBUSY/EPERM mientras antivirus o Postgres sueltan archivos:
// se reintenta y, como último recurso, se copia y se borra el origen.
function moveDir(from: string, to: string) {
  for (let i = 0; i < 5; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e: any) {
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300 * (i + 1));
    }
  }
  fs.cpSync(from, to, { recursive: true });
  fs.rmSync(from, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

export function restoreBackup(p: DataPaths, backupName: string) {
  const src = path.isAbsolute(backupName) ? backupName : path.join(p.backupsDir, backupName);
  if (!fs.existsSync(path.join(src, MANIFEST)) || !fs.existsSync(path.join(src, 'pgdata', 'PG_VERSION'))) {
    throw new Error(`${src} no es un respaldo válido (falta ${MANIFEST} o pgdata)`);
  }
  const keep = path.join(path.dirname(p.pgDir), `antes-de-restaurar-${stamp()}`);
  fs.mkdirSync(keep, { recursive: true });
  if (fs.existsSync(p.pgDir)) moveDir(p.pgDir, path.join(keep, 'pgdata'));
  if (fs.existsSync(p.storageDir)) moveDir(p.storageDir, path.join(keep, 'storage'));
  fs.cpSync(path.join(src, 'pgdata'), p.pgDir, { recursive: true });
  if (fs.existsSync(path.join(src, 'storage'))) fs.cpSync(path.join(src, 'storage'), p.storageDir, { recursive: true });
  else fs.mkdirSync(p.storageDir, { recursive: true });
  return { restoredFrom: src, previousSavedIn: keep };
}
