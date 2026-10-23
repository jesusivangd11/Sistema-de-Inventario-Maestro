import fs from 'node:fs';
import { assertSecret, config } from './config';
import { connect, disconnect } from './db/client';
import { startEmbeddedPostgres } from './db/embedded';
import { runMigrations } from './db/migrate';
import { buildApp } from './app';
import { resumeQueue, stopQueue } from './ai/worker';
import { sha256 } from './lib/crypto';
import { publicUrlProblem } from './services/exports';

async function main() {
  assertSecret();
  fs.mkdirSync(config.storageDir, { recursive: true });

  let stopPg: (() => Promise<void>) | null = null;
  let url = config.databaseUrl;
  if (!url) {
    console.log(`[db] Iniciando PostgreSQL embebido en ${config.pgDir} (puerto ${config.pgPort})…`);
    const pg = await startEmbeddedPostgres({
      dir: config.pgDir,
      port: config.pgPort,
      database: 'catalogo',
      // contraseña local derivada del secreto (el servidor solo escucha en localhost)
      password: sha256(`pg:${config.appSecret}`).slice(0, 32),
    });
    url = pg.url;
    stopPg = pg.stop;
  }
  const db = connect(url);
  await runMigrations(db);
  console.log('[db] Migraciones aplicadas');

  const app = await buildApp({ logger: false });
  await app.listen({ port: config.port, host: process.env.HOST || '127.0.0.1' });
  console.log(`\n  Catálogo Maestro listo en http://localhost:${config.port}`);
  console.log(`  IA: ${config.ai.apiKey ? `configurada (${config.ai.model})` : 'no configurada (captura manual habilitada)'}`);
  console.log(`  Archivos: ${config.storageDir}`);
  const pub = publicUrlProblem();
  console.log(pub ? `  Aviso (fotos para marketplaces): ${pub}\n` : `  Fotos públicas para marketplaces: ${config.publicBaseUrl}\n`);
  await resumeQueue();

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    console.log('\nCerrando…');
    stopQueue();
    await app.close();
    await disconnect();
    if (stopPg) await stopPg();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('\n[error] No se pudo iniciar:', msg === 'undefined' ? e : msg);
  if (/EADDRINUSE/.test(String((e as { code?: string })?.code ?? msg))) console.error(`El puerto ${config.port} ya está en uso: cierra la otra instancia o cambia PORT en .env.`);
  process.exit(1);
});
