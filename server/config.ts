import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';

function expandHome(p: string) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

const dataDir = path.resolve(expandHome(process.env.DATA_DIR || '~/.catalogo-maestro'));

export const config = {
  port: Number(process.env.PORT || 4000),
  appSecret: process.env.APP_SECRET || '',
  databaseUrl: process.env.DATABASE_URL || '',
  dataDir,
  storageDir: path.join(dataDir, 'storage'),
  pgDir: path.join(dataDir, 'pgdata'),
  pgPort: Number(process.env.EMBEDDED_PG_PORT || 54330),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  ai: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.AI_MODEL || 'claude-opus-5-5',
    effort: (process.env.AI_EFFORT || 'low') as 'low' | 'medium' | 'high',
    concurrency: Math.max(1, Number(process.env.AI_CONCURRENCY || 3)),
    /** Fotos por producto que se envían a la IA (más fotos = más costo). */
    maxImages: Math.min(8, Math.max(1, Number(process.env.AI_MAX_IMAGES || 4))),
    /** Lado mayor de cada foto enviada (px). 1024 px ≈ 1,400 tokens de entrada por foto. */
    imageSide: Math.min(1568, Math.max(512, Number(process.env.AI_IMAGE_SIDE || 1024))),
  },
  maxUploadBytes: 15 * 1024 * 1024,
  sessionDays: 14,
};

export function assertSecret() {
  if (config.appSecret.length < 32) {
    throw new Error(
      'APP_SECRET debe tener al menos 32 caracteres. Copia .env.example a .env y genera un secreto aleatorio.',
    );
  }
}
