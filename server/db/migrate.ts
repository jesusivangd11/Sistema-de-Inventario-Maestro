import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { DB } from './client';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Aplica las migraciones versionadas de /drizzle (controladas, en orden, una sola vez cada una). */
export async function runMigrations(db: DB) {
  await migrate(db, { migrationsFolder: path.resolve(here, '../../drizzle') });
}
