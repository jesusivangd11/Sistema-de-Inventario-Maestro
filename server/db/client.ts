import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type DBOrTx = DB | Tx;

// numeric → string por defecto en pg; lo convertimos en la capa de servicio.
let pool: pg.Pool | null = null;
let db: DB | null = null;

export function connect(url: string) {
  pool = new pg.Pool({ connectionString: url, max: 10 });
  db = drizzle(pool, { schema });
  return db;
}

export function getDb(): DB {
  if (!db) throw new Error('Base de datos no inicializada');
  return db;
}

export async function disconnect() {
  await pool?.end();
  pool = null;
  db = null;
}
