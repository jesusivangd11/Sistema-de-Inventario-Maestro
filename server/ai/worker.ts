import sharp from 'sharp';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, type DBOrTx } from '../db/client';
import { businesses, categories, importRows, media, type AiSuggestion, type FieldMeta, type ImportRowData } from '../db/schema';
import { storage } from '../lib/storage';
import { config } from '../config';
import { AnthropicProvider } from './anthropic';
import { AiNotConfiguredError, AiPermanentError, type AiImage, type AiProvider } from './provider';

const MAX_ATTEMPTS = 3;
let provider: AiProvider | null | undefined;

export function getAiProvider(): AiProvider | null {
  if (provider === undefined) {
    provider = config.ai.apiKey ? new AnthropicProvider(config.ai.apiKey, config.ai.model, config.ai.effort) : null;
  }
  return provider;
}

/** Solo para pruebas automatizadas: permite inyectar un proveedor de prueba explícito. */
export function setAiProviderForTests(p: AiProvider | null) {
  provider = p;
}

export function aiStatus() {
  const p = getAiProvider();
  return p ? { configured: true, provider: p.name, model: p.model } : { configured: false, provider: null, model: null };
}

export async function loadAiImage(key: string, maxSide = config.ai.imageSide): Promise<AiImage> {
  const buf = await storage().get(key);
  const data = await sharp(buf).resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  return { data, mime: 'image/jpeg' };
}

// ───────────────────────── Cola ─────────────────────────

export async function queueRows(db: DBOrTx, businessId: string, batchId: string, rowIds?: string[]) {
  if (!getAiProvider()) throw new AiNotConfiguredError();
  const res = await db
    .update(importRows)
    .set({ aiStatus: 'queued', aiError: null, aiAttempts: 0 })
    .where(
      and(
        eq(importRows.businessId, businessId),
        eq(importRows.batchId, batchId),
        sql`${importRows.status} NOT IN ('committed','skipped')`,
        sql`cardinality(${importRows.mediaIds}) > 0`,
        sql`${importRows.aiStatus} <> 'processing'`,
        rowIds?.length ? inArray(importRows.id, rowIds) : undefined,
      ),
    )
    .returning({ id: importRows.id });
  kick();
  return { queued: res.length };
}

let running = 0;
let stopped = false;
let kickScheduled = false;

export function kick() {
  if (stopped || kickScheduled) return;
  kickScheduled = true;
  setImmediate(() => {
    kickScheduled = false;
    void pump();
  });
}

async function pump() {
  if (!getAiProvider()) return;
  while (!stopped && running < config.ai.concurrency) {
    const db = getDb();
    const claimed = await db.execute<{ id: string }>(sql`
      UPDATE import_rows SET ai_status = 'processing', ai_attempts = ai_attempts + 1
      WHERE id = (SELECT id FROM import_rows WHERE ai_status = 'queued' ORDER BY updated_at, position LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id`);
    const row = claimed.rows[0];
    if (!row) return;
    running++;
    processRow(row.id)
      .catch((e) => console.error('[ia] error inesperado', e))
      .finally(() => {
        running--;
        kick();
      });
  }
}

async function processRow(rowId: string) {
  const db = getDb();
  const [row] = await db.select().from(importRows).where(eq(importRows.id, rowId));
  if (!row) return;
  const p = getAiProvider();
  try {
    if (!p) throw new AiNotConfiguredError();
    const ms = await db
      .select({ storageKey: media.storageKey })
      .from(media)
      .where(and(eq(media.businessId, row.businessId), inArray(media.id, row.mediaIds)));
    if (!ms.length) throw new AiPermanentError('La fila no tiene fotografías');
    const [b] = await db.select({ name: businesses.name, description: businesses.description }).from(businesses).where(eq(businesses.id, row.businessId));
    const cats = await db.select({ name: categories.name }).from(categories).where(eq(categories.businessId, row.businessId));
    const images = await Promise.all(ms.slice(0, config.ai.maxImages).map((m) => loadAiImage(m.storageKey)));
    const known = Object.fromEntries(
      Object.entries(row.data).filter(([k, v]) => row.fieldMeta[k]?.source === 'user' || row.fieldMeta[k]?.source === 'import' ? v !== undefined : false),
    );
    const suggestion = await p.analyzeProduct(images, {
      businessName: b.name,
      businessDescription: b.description,
      categories: cats.map((c) => c.name),
      known,
    });
    // Se vuelve a leer la fila: el usuario pudo editarla mientras la IA trabajaba.
    const [fresh] = await db.select().from(importRows).where(eq(importRows.id, rowId));
    const { data, fieldMeta } = applySuggestion(fresh.data, fresh.fieldMeta, suggestion);
    const warnings = suggestion.differentProductsWarning
      ? [...fresh.warnings, `IA: ${suggestion.differentProductsWarning}`]
      : fresh.warnings;
    await db
      .update(importRows)
      .set({ aiStatus: 'done', aiSuggestion: suggestion, aiError: null, data, fieldMeta, warnings, updatedAt: new Date() })
      .where(eq(importRows.id, rowId));
  } catch (e) {
    const permanent = e instanceof AiPermanentError || e instanceof AiNotConfiguredError;
    const failed = permanent || row.aiAttempts >= MAX_ATTEMPTS;
    if (!failed) await new Promise((r) => setTimeout(r, 2000 * row.aiAttempts)); // espera creciente antes de reintentar
    await db
      .update(importRows)
      .set({ aiStatus: failed ? 'failed' : 'queued', aiError: (e as Error).message.slice(0, 500) })
      .where(eq(importRows.id, rowId));
  }
}

/**
 * Aplica la propuesta de IA SOLO a campos vacíos. Nunca sobrescribe datos del usuario o de la importación.
 * Todo lo que llena la IA queda marcado "por revisar" hasta que el usuario lo confirme.
 */
export function applySuggestion(data: ImportRowData, meta: FieldMeta, s: AiSuggestion) {
  const d: ImportRowData = { ...data, attributes: { ...(data.attributes ?? {}) } };
  const m: FieldMeta = { ...meta };
  const uncertain = new Set((s.uncertain ?? []).map((u) => u.toLowerCase()));
  const set = (key: keyof ImportRowData, value: unknown, source: 'ai_detected' | 'ai_inferred') => {
    const cur = d[key];
    const empty = cur === undefined || cur === null || cur === '' || (Array.isArray(cur) && cur.length === 0);
    if (!empty || value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return;
    (d as Record<string, unknown>)[key] = value;
    m[key] = { source, review: true, note: uncertain.has(String(key).toLowerCase()) ? 'La IA indicó incertidumbre' : undefined };
  };
  set('name', s.name, 'ai_inferred');
  set('categoryName', s.categoryName, 'ai_inferred');
  set('shortDescription', s.shortDescription, 'ai_inferred');
  set('longDescription', s.longDescription, 'ai_inferred');
  set('keywords', s.keywords, 'ai_inferred');
  set('brand', s.brandVisible, 'ai_detected');
  set('material', s.materialOnLabel, 'ai_detected');
  if (!d.variants?.length) set('colors', s.colors, 'ai_detected');
  for (const a of s.attributes ?? []) {
    if (!a.key || !a.value || d.attributes![a.key]) continue;
    d.attributes![a.key] = a.value;
    m[`attr:${a.key}`] = { source: a.basis === 'visible' ? 'ai_detected' : 'ai_inferred', review: true };
  }
  return { data: d, fieldMeta: m };
}

export async function resumeQueue() {
  // Trabajos interrumpidos por un reinicio vuelven a la cola.
  await getDb().update(importRows).set({ aiStatus: 'queued' }).where(eq(importRows.aiStatus, 'processing'));
  kick();
}

export function stopQueue() {
  stopped = true;
}
export function startQueue() {
  stopped = false;
}
