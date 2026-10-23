/**
 * Copia de seguridad local: `npm run backup`
 * Copia la base de datos embebida (pgdata) y las fotos/archivos (storage) a DATA_DIR/backups/<fecha>.
 * Requiere la aplicación DETENIDA (copia consistente). Restaurar: `npm run restore`.
 * Con un PostgreSQL administrado (DATABASE_URL), usa los respaldos del proveedor o pg_dump.
 */
import path from 'node:path';
import { config } from '../server/config';
import { createBackup, portInUse } from '../server/lib/backup';

async function main() {
  if (config.databaseUrl) {
    console.log('Usas un PostgreSQL externo (DATABASE_URL): respalda la base con las herramientas de tu proveedor o pg_dump.');
    console.log(`Los archivos subidos están en: ${config.storageDir}`);
    return;
  }
  if (await portInUse(config.pgPort)) {
    console.error('La base de datos está en uso. Detén la aplicación (Ctrl+C) y vuelve a ejecutar `npm run backup`.');
    process.exit(1);
  }
  const r = createBackup({ pgDir: config.pgDir, storageDir: config.storageDir, backupsDir: path.join(config.dataDir, 'backups') });
  console.log(`Respaldo creado en: ${r.dest}`);
  console.log(`  Base de datos: ${r.dbFiles} archivos (PostgreSQL ${r.pgVersion}) · Fotos y archivos: ${r.storageFiles}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
