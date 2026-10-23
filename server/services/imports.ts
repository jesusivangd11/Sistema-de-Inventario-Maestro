import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB, DBOrTx } from '../db/client';
import {
  categories,
  collections,
  importBatches,
  importRows,
  media,
  products,
  variants,
  type FieldMeta,
  type ImportRowData,
} from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { code, normalizeKey, splitList, toNum } from '../lib/text';
import { parseSpreadsheet } from '../lib/tabular';
import { groupPhotos } from './media';
import { combineVariants, saveProduct } from './products';

// ───────────────────────── Lotes ─────────────────────────

export async function getBatch(db: DBOrTx, businessId: string, batchId: string) {
  const [b] = await db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.businessId, businessId), eq(importBatches.id, batchId)));
  if (!b) throw notFound('Lote no encontrado');
  return b;
}

export async function createBatch(db: DBOrTx, ctx: { businessId: string; userId: string }, raw: unknown) {
  const input = z
    .object({
      name: z.string().trim().min(1).max(120),
      collectionId: z.string().uuid().nullable().optional(),
      newCollection: z.object({ name: z.string().trim().min(1).max(120), kind: z.enum(['season', 'collection']) }).optional(),
    })
    .parse(raw);
  let collectionId = input.collectionId ?? null;
  if (input.newCollection) {
    const [existing] = await db
      .select({ id: collections.id })
      .from(collections)
      .where(and(eq(collections.businessId, ctx.businessId), eq(collections.name, input.newCollection.name)));
    collectionId =
      existing?.id ??
      (await db.insert(collections).values({ businessId: ctx.businessId, ...input.newCollection }).returning({ id: collections.id }))[0].id;
  } else if (collectionId) {
    const c = await db
      .select({ id: collections.id })
      .from(collections)
      .where(and(eq(collections.businessId, ctx.businessId), eq(collections.id, collectionId)));
    if (!c.length) throw badRequest('La colección no pertenece a este negocio');
  }
  const [b] = await db
    .insert(importBatches)
    .values({ businessId: ctx.businessId, name: input.name, collectionId, createdBy: ctx.userId })
    .returning();
  await audit(db, { businessId: ctx.businessId, userId: ctx.userId, action: 'batch.create', entity: 'import_batch', entityId: b.id });
  return b;
}

function assertEditable(b: { status: string }) {
  if (b.status === 'committed' || b.status === 'cancelled') throw conflict('Este lote ya fue cerrado y no se puede modificar');
}

export async function batchDetail(db: DBOrTx, businessId: string, batchId: string) {
  const batch = await getBatch(db, businessId, batchId);
  const rows = await db
    .select()
    .from(importRows)
    .where(and(eq(importRows.businessId, businessId), eq(importRows.batchId, batchId)))
    .orderBy(asc(importRows.position));
  const photos = await db
    .select({
      id: media.id,
      originalName: media.originalName,
      width: media.width,
      height: media.height,
      productId: media.productId,
    })
    .from(media)
    .where(and(eq(media.businessId, businessId), eq(media.batchId, batchId), isNull(media.deletedAt)))
    .orderBy(asc(media.createdAt));
  const inRows = new Set(rows.flatMap((r) => r.mediaIds));
  const aiUsage = rows.reduce(
    (acc, r) => {
      const u = r.aiSuggestion?.usage;
      if (u) {
        acc.calls++;
        acc.inputTokens += u.inputTokens;
        acc.outputTokens += u.outputTokens;
        acc.model = u.model;
      }
      return acc;
    },
    { calls: 0, inputTokens: 0, outputTokens: 0, model: '' },
  );
  return { batch, rows, photos, aiUsage, unassignedPhotoIds: photos.filter((p) => !inRows.has(p.id) && !p.productId).map((p) => p.id) };
}

// ───────────────────────── Agrupación de fotos → filas ─────────────────────────

export async function groupUnassignedPhotos(db: DBOrTx, businessId: string, batchId: string) {
  const batch = await getBatch(db, businessId, batchId);
  assertEditable(batch);
  // Primero: fotos que la hoja de cálculo menciona por nombre van a su producto
  await linkPhotosByName(db, businessId, batchId);
  const detail = await batchDetail(db, businessId, batchId);
  const unassigned = await db
    .select({ id: media.id, originalName: media.originalName, phash: media.phash })
    .from(media)
    .where(and(eq(media.businessId, businessId), inArray(media.id, detail.unassignedPhotoIds.length ? detail.unassignedPhotoIds : ['00000000-0000-0000-0000-000000000000'])))
    .orderBy(asc(media.originalName));
  if (!unassigned.length) return { created: 0 };
  const groups = groupPhotos(unassigned);
  let pos = detail.rows.length;
  for (const g of groups) {
    await db.insert(importRows).values({
      businessId,
      batchId,
      position: pos++,
      source: 'photos',
      mediaIds: g.ids,
      data: {},
      warnings: g.reason === 'similitud' ? ['Fotos agrupadas por similitud visual: confirma que son el mismo producto'] : [],
    });
  }
  return { created: groups.length };
}

// ───────────────────────── Importación de hoja de cálculo ─────────────────────────

/** Sinónimos de encabezados (es/en) → campo del catálogo. */
const HEADER_MAP: Record<string, string[]> = {
  group: ['grupo', 'sku padre', 'parent sku', 'modelo padre', 'id grupo', 'group'],
  name: ['nombre', 'nombre comercial', 'producto', 'nombre del producto', 'titulo', 'title', 'product name', 'name'],
  sku: ['sku', 'sku interno', 'clave', 'codigo', 'código interno', 'codigo interno'],
  brand: ['marca', 'brand'],
  model: ['modelo', 'referencia', 'model', 'ref'],
  categoryName: ['categoria', 'category', 'subcategoria', 'tipo de producto', 'tipo'],
  shortDescription: ['descripcion corta', 'resumen', 'short description'],
  longDescription: ['descripcion', 'descripcion larga', 'description', 'detalle'],
  cost: ['costo', 'costo unitario', 'cost'],
  price: ['precio', 'precio de venta', 'precio venta', 'price', 'pvp'],
  promoPrice: ['precio promocional', 'precio oferta', 'oferta', 'promo', 'sale price'],
  material: ['material', 'composicion', 'tela', 'materiales'],
  weightGrams: ['peso', 'peso g', 'peso (g)', 'peso gramos', 'weight'],
  keywords: ['palabras clave', 'etiquetas', 'tags', 'keywords'],
  colors: ['color', 'colores', 'colors'],
  sizes: ['talla', 'tallas', 'tamano', 'tamaño', 'size', 'sizes', 'talle'],
  stock: ['existencias', 'stock', 'cantidad', 'inventario', 'qty', 'quantity', 'piezas'],
  barcode: ['codigo de barras', 'ean', 'upc', 'gtin', 'barcode'],
  images: ['fotos', 'foto', 'imagenes', 'imagen', 'images', 'image', 'archivo foto'],
};

export const IMPORT_FIELDS = Object.keys(HEADER_MAP);

export function detectMapping(headers: string[]) {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const h of headers) {
    const n = normalizeKey(h);
    for (const [field, syns] of Object.entries(HEADER_MAP)) {
      if (used.has(field)) continue;
      if (syns.some((s) => normalizeKey(s) === n)) {
        mapping[h] = field;
        used.add(field);
        break;
      }
    }
    if (!mapping[h]) mapping[h] = `attr:${h}`; // columnas desconocidas → atributos personalizados
  }
  return mapping;
}

export async function previewSpreadsheet(data: Buffer, fileName: string) {
  const table = await parseSpreadsheet(data, fileName);
  if (!table.rows.length) throw badRequest('El archivo no contiene filas de datos');
  return { headers: table.headers, mapping: detectMapping(table.headers), sample: table.rows.slice(0, 5), total: table.rows.length };
}

/**
 * Convierte filas de la hoja en filas del lote. Varias filas con el mismo grupo (o mismo nombre)
 * se combinan en un solo producto con variantes, en lugar de crear una ficha por talla/color.
 */
export async function importSpreadsheet(
  db: DBOrTx,
  ctx: { businessId: string; userId: string },
  batchId: string,
  file: { data: Buffer; fileName: string },
  mappingOverride?: Record<string, string>,
) {
  const batch = await getBatch(db, ctx.businessId, batchId);
  assertEditable(batch);
  const table = await parseSpreadsheet(file.data, file.fileName);
  if (!table.rows.length) throw badRequest('El archivo no contiene filas de datos');
  const mapping = mappingOverride ?? detectMapping(table.headers);

  type Acc = { data: ImportRowData; meta: FieldMeta; sourceRows: number[] };
  const groups = new Map<string, Acc>();
  table.rows.forEach((row, idx) => {
    const get = (field: string) => {
      const h = Object.keys(mapping).find((k) => mapping[k] === field);
      return h ? row[h] ?? '' : '';
    };
    const name = get('name');
    const key = (get('group') || name || get('sku') || `fila-${idx}`).toLowerCase();
    let acc = groups.get(key);
    if (!acc) {
      const d: ImportRowData = {
        name: name || undefined,
        brand: get('brand') || undefined,
        model: get('model') || undefined,
        categoryName: get('categoryName') || undefined,
        shortDescription: get('shortDescription') || undefined,
        longDescription: get('longDescription') || undefined,
        cost: toNum(get('cost')),
        price: toNum(get('price')),
        promoPrice: toNum(get('promoPrice')),
        material: get('material') || undefined,
        weightGrams: toNum(get('weightGrams')),
        keywords: splitList(get('keywords')),
        attributes: {},
        variants: [],
        imageNames: [],
      };
      for (const [h, f] of Object.entries(mapping)) if (f.startsWith('attr:') && row[h]) d.attributes![f.slice(5)] = row[h];
      const meta: FieldMeta = {};
      for (const [k, v] of Object.entries(d)) if (v !== undefined && v !== null && !(Array.isArray(v) && !v.length)) meta[k] = { source: 'import' };
      acc = { data: d, meta, sourceRows: [] };
      groups.set(key, acc);
    }
    acc.sourceRows.push(idx + 2);
    const color = get('colors');
    const size = get('sizes');
    const stock = toNum(get('stock'));
    const sku = get('sku');
    const colors = splitList(color);
    const sizes = splitList(size);
    if (colors.length > 1 || sizes.length > 1) {
      // Una sola fila con listas "Rosa, Negro" × "CH, M": se combinan
      for (const v of combineVariants(colors, sizes)) acc.data.variants!.push({ color: v.color ?? undefined, size: v.size ?? undefined, stock: stock ?? 0 });
    } else {
      acc.data.variants!.push({ color: color || undefined, size: size || undefined, stock, sku: sku || undefined, barcode: get('barcode') || undefined, price: toNum(get('price')) });
    }
    for (const img of splitList(get('images'))) acc.data.imageNames!.push(img);
  });

  // Normaliza: un producto sin color/talla con una sola fila → sin variantes explícitas
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${importRows.position}), -1)::int` })
    .from(importRows)
    .where(eq(importRows.batchId, batchId));
  let pos = max + 1;
  const created: string[] = [];
  for (const acc of groups.values()) {
    const vs = acc.data.variants!;
    if (vs.length === 1 && !vs[0].color && !vs[0].size) {
      acc.data.sku = vs[0].sku;
      acc.data.barcode = vs[0].barcode;
      acc.data.stockPerVariant = vs[0].stock ?? null;
      acc.data.variants = [];
    }
    const [r] = await db
      .insert(importRows)
      .values({
        businessId: ctx.businessId,
        batchId,
        position: pos++,
        source: 'spreadsheet',
        data: acc.data,
        fieldMeta: acc.meta,
        warnings: acc.sourceRows.length > 1 ? [`Combinado de las filas ${acc.sourceRows.join(', ')} de la hoja`] : [],
      })
      .returning({ id: importRows.id });
    created.push(r.id);
  }
  const linked = await linkPhotosByName(db, ctx.businessId, batchId);
  await audit(db, {
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: 'batch.import_spreadsheet',
    entity: 'import_batch',
    entityId: batchId,
    details: { file: file.fileName, sheetRows: table.rows.length, products: created.length, linkedPhotos: linked },
  });
  return { products: created.length, sheetRows: table.rows.length, linkedPhotos: linked, mapping };
}

/** Asocia fotos del lote a las filas cuyo campo "fotos" menciona el nombre del archivo. */
/** Asocia fotos del lote a las filas que las mencionan por nombre. Funciona sin importar el orden (fotos antes o después del Excel). */
export async function linkPhotosByName(db: DBOrTx, businessId: string, batchId: string) {
  const detail = await batchDetail(db, businessId, batchId);
  const nameKey = (n: string) => n.toLowerCase().replace(/\.[a-z0-9]+$/, '').trim();
  const photoByName = new Map(detail.photos.map((p) => [nameKey(p.originalName), p.id]));
  let linked = 0;
  for (const row of detail.rows) {
    const names = row.data.imageNames ?? [];
    if (!names.length || row.status === 'committed') continue;
    const ids = names.map((n) => photoByName.get(nameKey(n))).filter(Boolean) as string[];
    const add = ids.filter((id) => !row.mediaIds.includes(id));
    if (!add.length) continue;
    // Si esas fotos estaban en filas creadas solo a partir de fotos, se retiran de ahí.
    for (const other of detail.rows) {
      if (other.id === row.id || other.source !== 'photos' || other.status === 'committed') continue;
      const remaining = other.mediaIds.filter((m) => !add.includes(m));
      if (remaining.length !== other.mediaIds.length) {
        if (remaining.length === 0) await db.delete(importRows).where(eq(importRows.id, other.id));
        else await db.update(importRows).set({ mediaIds: remaining }).where(eq(importRows.id, other.id));
      }
    }
    await db.update(importRows).set({ mediaIds: [...row.mediaIds, ...add], updatedAt: new Date() }).where(eq(importRows.id, row.id));
    linked += add.length;
  }
  return linked;
}

// ───────────────────────── Edición de filas ─────────────────────────

const rowDataSchema = z
  .object({
    name: z.string().max(200).optional(),
    sku: z.string().max(80).optional(),
    brand: z.string().max(200).optional(),
    model: z.string().max(200).optional(),
    categoryName: z.string().max(120).optional(),
    shortDescription: z.string().max(500).optional(),
    longDescription: z.string().max(20000).optional(),
    cost: z.number().min(0).nullable().optional(),
    price: z.number().min(0).nullable().optional(),
    promoPrice: z.number().min(0).nullable().optional(),
    material: z.string().max(500).optional(),
    weightGrams: z.number().int().positive().nullable().optional(),
    keywords: z.array(z.string()).optional(),
    colors: z.array(z.string()).optional(),
    sizes: z.array(z.string()).optional(),
    stockPerVariant: z.number().int().min(0).nullable().optional(),
    barcode: z.string().max(64).optional(),
    attributes: z.record(z.string(), z.string()).optional(),
    variants: z
      .array(
        z.object({
          color: z.string().optional(),
          size: z.string().optional(),
          stock: z.number().int().min(0).nullable().optional(),
          sku: z.string().optional(),
          barcode: z.string().optional(),
          price: z.number().min(0).nullable().optional(),
        }),
      )
      .optional(),
  })
  .partial();

export const rowsPatchSchema = z.object({
  rows: z
    .array(
      z.object({
        id: z.string().uuid(),
        data: rowDataSchema.optional(),
        mediaIds: z.array(z.string().uuid()).optional(),
        /** Campos que el usuario confirmó/corrigió: pasan a origen "user" y salen de revisión. */
        confirmFields: z.array(z.string()).optional(),
        status: z.enum(['pending', 'skipped']).optional(),
      }),
    )
    .min(1)
    .max(1000),
});

export async function patchRows(db: DBOrTx, businessId: string, batchId: string, raw: unknown) {
  const batch = await getBatch(db, businessId, batchId);
  assertEditable(batch);
  const { rows } = rowsPatchSchema.parse(raw);
  const existing = await db
    .select()
    .from(importRows)
    .where(and(eq(importRows.businessId, businessId), eq(importRows.batchId, batchId), inArray(importRows.id, rows.map((r) => r.id))));
  const byId = new Map(existing.map((r) => [r.id, r]));
  const allMedia = rows.flatMap((r) => r.mediaIds ?? []);
  if (allMedia.length) {
    const owned = await db
      .select({ id: media.id })
      .from(media)
      .where(and(eq(media.businessId, businessId), inArray(media.id, allMedia)));
    if (owned.length !== new Set(allMedia).size) throw badRequest('Alguna fotografía no pertenece a este negocio');
  }
  for (const r of rows) {
    const cur = byId.get(r.id);
    if (!cur) throw notFound('Fila no encontrada en este lote');
    if (cur.status === 'committed') throw conflict('Una fila ya importada no se puede editar desde el lote; edita el producto');
    const data = { ...cur.data, ...(r.data ?? {}) };
    const meta: FieldMeta = { ...cur.fieldMeta };
    for (const k of Object.keys(r.data ?? {})) meta[k] = { source: 'user' };
    for (const k of r.confirmFields ?? []) meta[k] = { source: meta[k]?.source === 'user' ? 'user' : meta[k]?.source ?? 'user', review: false };
    await db
      .update(importRows)
      .set({
        data,
        fieldMeta: meta,
        mediaIds: r.mediaIds ?? cur.mediaIds,
        status: r.status ?? (cur.status === 'skipped' && !r.status ? 'skipped' : 'pending'),
        updatedAt: new Date(),
      })
      .where(eq(importRows.id, r.id));
  }
  return { updated: rows.length };
}

export async function addEmptyRow(db: DBOrTx, businessId: string, batchId: string, mediaIds: string[] = []) {
  const batch = await getBatch(db, businessId, batchId);
  assertEditable(batch);
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${importRows.position}), -1)::int` })
    .from(importRows)
    .where(eq(importRows.batchId, batchId));
  const [r] = await db.insert(importRows).values({ businessId, batchId, position: max + 1, source: 'manual', mediaIds }).returning();
  return r;
}

/** Combina varias filas en una (p. ej. fotos que el agrupador separó y son el mismo modelo). */
export async function mergeRows(db: DBOrTx, businessId: string, batchId: string, ids: string[]) {
  const batch = await getBatch(db, businessId, batchId);
  assertEditable(batch);
  const rows = await db
    .select()
    .from(importRows)
    .where(and(eq(importRows.businessId, businessId), eq(importRows.batchId, batchId), inArray(importRows.id, ids)))
    .orderBy(asc(importRows.position));
  if (rows.length < 2) throw badRequest('Selecciona al menos dos filas para combinar');
  if (rows.some((r) => r.status === 'committed')) throw conflict('No se pueden combinar filas ya importadas');
  const [first, ...rest] = rows;
  const data: ImportRowData = { ...first.data };
  for (const r of rest) for (const [k, v] of Object.entries(r.data)) if ((data as Record<string, unknown>)[k] === undefined) (data as Record<string, unknown>)[k] = v;
  await db
    .update(importRows)
    .set({ data, mediaIds: [...new Set(rows.flatMap((r) => r.mediaIds))], status: 'pending', updatedAt: new Date() })
    .where(eq(importRows.id, first.id));
  await db.delete(importRows).where(inArray(importRows.id, rest.map((r) => r.id)));
  return { kept: first.id };
}

/** Separa cada foto de una fila en filas independientes. */
export async function splitRow(db: DBOrTx, businessId: string, batchId: string, rowId: string) {
  const batch = await getBatch(db, businessId, batchId);
  assertEditable(batch);
  const [row] = await db.select().from(importRows).where(and(eq(importRows.businessId, businessId), eq(importRows.id, rowId)));
  if (!row || row.batchId !== batchId) throw notFound('Fila no encontrada');
  if (row.mediaIds.length < 2) return { created: 0 };
  const [keep, ...others] = row.mediaIds;
  await db.update(importRows).set({ mediaIds: [keep], updatedAt: new Date() }).where(eq(importRows.id, row.id));
  for (const m of others) await addEmptyRow(db, businessId, batchId, [m]);
  return { created: others.length };
}

/** Descarta filas del lote (son propuestas, todavía no productos). */
export async function deleteRows(db: DBOrTx, businessId: string, batchId: string, ids: string[]) {
  const batch = await getBatch(db, businessId, batchId);
  assertEditable(batch);
  const res = await db
    .delete(importRows)
    .where(and(eq(importRows.businessId, businessId), eq(importRows.batchId, batchId), inArray(importRows.id, ids), sql`${importRows.status} <> 'committed'`))
    .returning({ id: importRows.id });
  return { deleted: res.length };
}

// ───────────────────────── Validación ─────────────────────────

type RowVariant = NonNullable<ImportRowData['variants']>[number];

function rowVariants(d: ImportRowData): RowVariant[] {
  if (d.variants?.length) return d.variants;
  const combos = combineVariants(d.colors ?? [], d.sizes ?? [], { stock: d.stockPerVariant ?? 0 });
  return combos.map((c) => ({ color: c.color ?? undefined, size: c.size ?? undefined, stock: Number(c.stock ?? 0) }));
}

export async function validateBatch(db: DBOrTx, businessId: string, batchId: string) {
  const batch = await getBatch(db, businessId, batchId);
  const rows = await db
    .select()
    .from(importRows)
    .where(and(eq(importRows.businessId, businessId), eq(importRows.batchId, batchId)))
    .orderBy(asc(importRows.position));
  const cats = await db.select({ name: categories.name }).from(categories).where(eq(categories.businessId, businessId));
  const catNames = new Set(cats.map((c) => normalizeKey(c.name)));
  const existingProducts = await db
    .select({ name: products.name, sku: products.sku })
    .from(products)
    .where(eq(products.businessId, businessId));
  const existingNames = new Set(existingProducts.map((p) => normalizeKey(p.name)));
  const existingSkus = new Set(existingProducts.map((p) => p.sku.toUpperCase()));
  const existingVariantSkus = new Set(
    (await db.select({ sku: variants.sku }).from(variants).where(eq(variants.businessId, businessId))).map((v) => v.sku.toUpperCase()),
  );
  const batchVariantSkus = new Map<string, number>();
  for (const r of rows) {
    if (r.status === 'committed' || r.status === 'skipped') continue;
    for (const v of r.data.variants ?? []) if (v.sku) batchVariantSkus.set(v.sku.toUpperCase(), (batchVariantSkus.get(v.sku.toUpperCase()) ?? 0) + 1);
  }
  const batchSkus = new Map<string, number>();
  const batchNames = new Map<string, number>();
  for (const r of rows) {
    if (r.status === 'committed' || r.status === 'skipped') continue;
    if (r.data.sku) batchSkus.set(r.data.sku.toUpperCase(), (batchSkus.get(r.data.sku.toUpperCase()) ?? 0) + 1);
    if (r.data.name) batchNames.set(normalizeKey(r.data.name), (batchNames.get(normalizeKey(r.data.name)) ?? 0) + 1);
  }

  const mediaDup = await db.execute<{ id: string; dup_product: string | null }>(sql`
    SELECT m.id, (SELECT p.name FROM media m2 JOIN products p ON p.id = m2.product_id
                  WHERE m2.business_id = m.business_id AND m2.sha256 = m.sha256 AND m2.id <> m.id AND m2.deleted_at IS NULL LIMIT 1) AS dup_product
    FROM media m WHERE m.business_id = ${businessId} AND m.batch_id = ${batchId}`);
  const dupByMedia = new Map(mediaDup.rows.filter((r) => r.dup_product).map((r) => [r.id, r.dup_product!]));

  let valid = 0;
  let errors = 0;
  for (const r of rows) {
    if (r.status === 'committed' || r.status === 'skipped') continue;
    const e: string[] = [];
    const w: string[] = r.warnings.filter((x) => x.startsWith('Combinado') || x.startsWith('Fotos agrupadas'));
    const d = r.data;
    if (!d.name?.trim()) e.push('Falta el nombre del producto');
    if (d.price === undefined || d.price === null) {
      if (!(d.variants ?? []).some((v) => v.price !== undefined && v.price !== null)) e.push('Falta el precio de venta');
    }
    if (d.promoPrice && d.price && d.promoPrice >= d.price) e.push('El precio promocional debe ser menor al precio');
    if (d.sku && existingSkus.has(d.sku.toUpperCase())) e.push(`El SKU ${d.sku} ya existe en el catálogo`);
    if (d.sku && (batchSkus.get(d.sku.toUpperCase()) ?? 0) > 1) e.push(`El SKU ${d.sku} está repetido en el lote`);
    if (d.sku && existingVariantSkus.has(d.sku.toUpperCase()) && !existingSkus.has(d.sku.toUpperCase())) e.push(`El SKU ${d.sku} ya lo usa una variante del catálogo`);
    for (const v of d.variants ?? []) {
      if (!v.sku) continue;
      const k = v.sku.toUpperCase();
      if (existingSkus.has(k) || existingVariantSkus.has(k)) e.push(`El SKU de variante ${v.sku} ya existe en el catálogo`);
      else if ((batchVariantSkus.get(k) ?? 0) > 1) e.push(`El SKU de variante ${v.sku} está repetido en el lote`);
    }
    const vs = rowVariants(d);
    const combos = new Set<string>();
    for (const v of vs) {
      const k = `${(v.color ?? '').toLowerCase()}|${(v.size ?? '').toLowerCase()}`;
      if (combos.has(k)) e.push(`Variante repetida: ${[v.color, v.size].filter(Boolean).join(' / ')}`);
      combos.add(k);
    }
    if (!d.categoryName) w.push('Sin categoría');
    else if (!catNames.has(normalizeKey(d.categoryName))) w.push(`Se creará la categoría "${d.categoryName}"`);
    if (!r.mediaIds.length) w.push('Sin fotografías');
    if (d.name && existingNames.has(normalizeKey(d.name))) w.push('Posible duplicado: ya existe un producto con este nombre');
    if (d.name && (batchNames.get(normalizeKey(d.name)) ?? 0) > 1) w.push('Posible duplicado: otro renglón del lote tiene el mismo nombre');
    const dupNames = [...new Set(r.mediaIds.map((m) => dupByMedia.get(m)).filter(Boolean))];
    if (dupNames.length) w.push(`Foto idéntica a una del producto existente "${dupNames[0]}"`);
    if (Object.values(r.fieldMeta).some((m) => m.review)) w.push('Hay datos sugeridos por IA pendientes de revisión');
    const status = e.length ? 'error' : 'valid';
    if (status === 'valid') valid++;
    else errors++;
    await db.update(importRows).set({ errors: e, warnings: w, status }).where(eq(importRows.id, r.id));
  }
  const committed = rows.filter((r) => r.status === 'committed').length;
  const skipped = rows.filter((r) => r.status === 'skipped').length;
  return { batchId: batch.id, valid, errors, committed, skipped, total: rows.length };
}

// ───────────────────────── Confirmación (transaccional) ─────────────────────────

/**
 * Crea los productos del lote dentro de UNA transacción: si algo falla, no queda nada a medias.
 * Las filas ya confirmadas se saltan, por lo que reintentar es seguro (idempotente).
 */
export async function commitBatch(db: DB, ctx: { businessId: string; userId: string }, batchId: string, opts: { onlyValid: boolean }) {
  const pre = await validateBatch(db, ctx.businessId, batchId);
  if (pre.errors > 0 && !opts.onlyValid) {
    throw badRequest(`Hay ${pre.errors} fila(s) con errores. Corrígelas o confirma importando solo las válidas.`, pre);
  }
  return db.transaction(async (tx) => {
    // Bloqueo del lote: evita dobles confirmaciones simultáneas.
    await tx.execute(sql`SELECT id FROM import_batches WHERE id = ${batchId} AND business_id = ${ctx.businessId} FOR UPDATE`);
    const batch = await getBatch(tx, ctx.businessId, batchId);
    assertEditable(batch);
    const rows = await tx
      .select()
      .from(importRows)
      .where(and(eq(importRows.businessId, ctx.businessId), eq(importRows.batchId, batchId), eq(importRows.status, 'valid')))
      .orderBy(asc(importRows.position));
    const catCache = new Map<string, string>();
    const cats = await tx.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.businessId, ctx.businessId));
    for (const c of cats) catCache.set(normalizeKey(c.name), c.id);
    const created: { rowId: string; productId: string; name: string }[] = [];
    for (const r of rows) {
      const d = r.data;
      let categoryId: string | null = null;
      if (d.categoryName) {
        const k = normalizeKey(d.categoryName);
        categoryId = catCache.get(k) ?? null;
        if (!categoryId) {
          const [c] = await tx
            .insert(categories)
            .values({ businessId: ctx.businessId, name: d.categoryName.trim(), code: code(d.categoryName, 3) || 'CAT' })
            .returning({ id: categories.id });
          categoryId = c.id;
          catCache.set(k, c.id);
        }
      }
      const vs = rowVariants(d);
      const hasOptions = vs.some((v) => v.color || v.size);
      const productId = await saveProduct(tx, ctx, {
        name: d.name!,
        sku: d.sku || null,
        brand: d.brand || null,
        model: d.model || null,
        categoryId,
        shortDescription: d.shortDescription ?? '',
        longDescription: d.longDescription ?? '',
        cost: d.cost ?? null,
        price: d.price ?? null,
        promoPrice: d.promoPrice ?? null,
        material: d.material || null,
        weightGrams: d.weightGrams ?? null,
        keywords: d.keywords ?? [],
        attributes: d.attributes ?? {},
        fieldMeta: r.fieldMeta,
        status: 'draft',
        collectionIds: batch.collectionId ? [batch.collectionId] : [],
        mediaIds: r.mediaIds,
        ...(hasOptions
          ? {
              variants: vs.map((v) => ({
                color: v.color || null,
                size: v.size || null,
                stock: v.stock ?? 0,
                sku: v.sku || null,
                barcode: v.barcode || null,
                price: v.price ?? null,
              })),
            }
          : { stock: vs[0]?.stock ?? d.stockPerVariant ?? 0 }),
      });
      if (!hasOptions && d.barcode) {
        await tx.execute(sql`UPDATE variants SET barcode = ${d.barcode} WHERE product_id = ${productId} AND business_id = ${ctx.businessId}`);
      }
      await tx.update(importRows).set({ status: 'committed', productId, updatedAt: new Date() }).where(eq(importRows.id, r.id));
      created.push({ rowId: r.id, productId, name: d.name! });
    }
    const remaining = await tx
      .select({ status: importRows.status, n: sql<number>`count(*)::int` })
      .from(importRows)
      .where(eq(importRows.batchId, batchId))
      .groupBy(importRows.status);
    const counts = Object.fromEntries(remaining.map((x) => [x.status, x.n]));
    const pendingLeft = (counts.error ?? 0) + (counts.pending ?? 0) + (counts.valid ?? 0);
    const summary = {
      createdNow: created.length,
      committed: counts.committed ?? 0,
      skipped: counts.skipped ?? 0,
      withErrors: counts.error ?? 0,
      lastCommitAt: new Date().toISOString(),
    };
    await tx
      .update(importBatches)
      .set({ status: pendingLeft > 0 ? 'partially_committed' : 'committed', summary, committedAt: new Date(), updatedAt: new Date() })
      .where(eq(importBatches.id, batchId));
    await audit(tx, { businessId: ctx.businessId, userId: ctx.userId, action: 'batch.commit', entity: 'import_batch', entityId: batchId, details: summary });
    return { ...summary, created };
  });
}
