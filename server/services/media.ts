import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { DBOrTx } from '../db/client';
import { media, products } from '../db/schema';
import { processImage, hamming } from '../lib/images';
import { newKey, storage } from '../lib/storage';
import { refreshProductStats } from './products';

export type UploadResult = {
  media?: typeof media.$inferSelect;
  fileName: string;
  error?: string;
  duplicates?: { mediaId: string; productId: string | null; productName: string | null; kind: 'exact' | 'similar' }[];
};

export async function storeImage(
  db: DBOrTx,
  opts: { businessId: string; fileName: string; data: Buffer; productId?: string | null; batchId?: string | null },
): Promise<UploadResult> {
  let img;
  try {
    img = await processImage(opts.data);
  } catch (e) {
    return { fileName: opts.fileName, error: (e as Error).message };
  }
  const duplicates = await findDuplicates(db, opts.businessId, img.sha256, img.phash);
  const st = storage();
  const storageKey = newKey(opts.businessId, 'media', img.mainExt);
  const thumbKey = storageKey.replace(/\.[a-z]+$/, '_thumb.webp');
  await st.put(storageKey, img.main);
  await st.put(thumbKey, img.thumb);
  let position = 0;
  if (opts.productId) {
    const [{ max }] = await db
      .select({ max: sql<number>`coalesce(max(${media.position}), -1)::int` })
      .from(media)
      .where(and(eq(media.businessId, opts.businessId), eq(media.productId, opts.productId)));
    position = max + 1;
  }
  const [row] = await db
    .insert(media)
    .values({
      businessId: opts.businessId,
      productId: opts.productId ?? null,
      batchId: opts.batchId ?? null,
      storageKey,
      thumbKey,
      originalName: opts.fileName.slice(0, 255),
      mime: img.mime,
      sizeBytes: img.main.length,
      width: img.width,
      height: img.height,
      sha256: img.sha256,
      phash: img.phash,
      position,
    })
    .returning();
  if (opts.productId) await refreshProductStats(db, opts.businessId, opts.productId);
  return { media: row, fileName: opts.fileName, duplicates };
}

/** Busca fotos idénticas (SHA-256) o casi idénticas (dHash, distancia ≤ 5) dentro del mismo negocio. */
export async function findDuplicates(db: DBOrTx, businessId: string, sha: string, phash: string, excludeId?: string) {
  const rows = await db
    .select({ id: media.id, sha256: media.sha256, phash: media.phash, productId: media.productId, productName: products.name })
    .from(media)
    .leftJoin(products, eq(products.id, media.productId))
    .where(and(eq(media.businessId, businessId), isNull(media.deletedAt), excludeId ? ne(media.id, excludeId) : undefined));
  const out: NonNullable<UploadResult['duplicates']> = [];
  for (const r of rows) {
    if (r.sha256 === sha) out.push({ mediaId: r.id, productId: r.productId, productName: r.productName, kind: 'exact' });
    else if (hamming(r.phash, phash) <= 5) out.push({ mediaId: r.id, productId: r.productId, productName: r.productName, kind: 'similar' });
  }
  return out.slice(0, 10);
}

/** Eliminación recuperable: la foto se oculta y se puede restaurar; el archivo no se borra. */
export async function softDeleteMedia(db: DBOrTx, businessId: string, ids: string[]) {
  const rows = await db
    .update(media)
    .set({ deletedAt: new Date() })
    .where(and(eq(media.businessId, businessId), inArray(media.id, ids)))
    .returning({ productId: media.productId });
  for (const pid of new Set(rows.map((r) => r.productId).filter(Boolean) as string[])) await refreshProductStats(db, businessId, pid);
  return rows.length;
}

export async function restoreMedia(db: DBOrTx, businessId: string, ids: string[]) {
  const rows = await db
    .update(media)
    .set({ deletedAt: null })
    .where(and(eq(media.businessId, businessId), inArray(media.id, ids)))
    .returning({ productId: media.productId });
  for (const pid of new Set(rows.map((r) => r.productId).filter(Boolean) as string[])) await refreshProductStats(db, businessId, pid);
  return rows.length;
}

/**
 * Agrupa fotografías que probablemente pertenecen al mismo producto, sin IA:
 * 1) por patrón de nombre de archivo (PIJ001_1.jpg, PIJ001_2.jpg → "PIJ001")
 * 2) por similitud visual (dHash) entre fotos consecutivas.
 */
export function groupPhotos(items: { id: string; originalName: string; phash: string }[]) {
  const stem = (n: string) =>
    n
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/([_\-\s(]+)(\d{1,2}|[a-z])\)?$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  const isCameraName = (n: string) => /^(img|dsc|pxl|photo|image|whatsapp|captura|screenshot)[_\-\s]?/i.test(n);
  const groups: { key: string; ids: string[]; reason: 'nombre' | 'similitud' | 'individual' }[] = [];
  const byStem = new Map<string, number>();
  for (const it of items) {
    if (!isCameraName(it.originalName)) {
      const s = stem(it.originalName);
      const gi = byStem.get(s);
      if (gi !== undefined) {
        groups[gi].ids.push(it.id);
        groups[gi].reason = 'nombre';
        continue;
      }
      byStem.set(s, groups.length);
      groups.push({ key: s, ids: [it.id], reason: 'individual' });
      continue;
    }
    // Nombres de cámara: se agrupa con el grupo anterior si la foto es visualmente muy parecida.
    const prev = groups[groups.length - 1];
    const prevItem = prev && items.find((x) => x.id === prev.ids[prev.ids.length - 1]);
    if (prev && prevItem && hamming(prevItem.phash, it.phash) <= 12) {
      prev.ids.push(it.id);
      if (prev.reason === 'individual') prev.reason = 'similitud';
    } else {
      groups.push({ key: it.originalName, ids: [it.id], reason: 'individual' });
    }
  }
  return groups;
}
