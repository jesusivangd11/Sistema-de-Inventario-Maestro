/**
 * Restaurar un respaldo local: `npm run restore` (lista respaldos) · `npm run restore -- <nombre>`
 * Requiere la aplicación DETENIDA. No borra nada: la versión actual se mueve a DATA_DIR/antes-de-restaurar-<fecha>.
 */
import path from 'node:path';
import { config } from '../server/config';
import { listBackups, portInUse, restoreBackup } from '../server/lib/backup';

async function main() {
  if (config.databaseUrl) {
    console.log('Usas un PostgreSQL externo (DATABASE_URL): restaura con las herramientas de tu proveedor.');
    return;
  }
  const backupsDir = path.join(config.dataDir, 'backups');
  const name = process.argv[2];
  if (!name) {
    const list = listBackups(backupsDir);
    console.log(list.length ? `Respaldos disponibles en ${backupsDir}:\n  ${list.join('\n  ')}\n\nUso: npm run restore -- <nombre>` : `No hay respaldos en ${backupsDir}`);
    return;
  }
  if (await portInUse(config.pgPort)) {
    console.error('La base de datos está en uso. Detén la aplicación (Ctrl+C) antes de restaurar.');
    process.exit(1);
  }
  const r = restoreBackup({ pgDir: config.pgDir, storageDir: config.storageDir, backupsDir }, name);
  console.log(`Restaurado desde: ${r.restoredFrom}`);
  console.log(`La versión anterior se conservó en: ${r.previousSavedIn}`);
  console.log('Inicia la aplicación con `npm start`.');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
