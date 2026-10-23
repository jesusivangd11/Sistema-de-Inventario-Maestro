import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { DBOrTx } from '../db/client';
import {
  categories,
  collections,
  media,
  productChannels,
  productCollections,
  products,
  variants,
  type FieldDef,
  type FieldMeta,
} from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { getSkuConfig, nextProductSku, renderVariantSku, skuTaken, variantSkusTaken } from './sku';

// ───────────────────────── Validación de entrada ─────────────────────────

const money = z.union([z.number(), z.string(), z.null()]).optional().transform((v, ctx) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) {
    ctx.addIssue({ code: 'custom', message: 'Debe ser un número mayor o igual a 0' });
    return z.NEVER;
  }
  return Math.round(n * 100) / 100;
});

const optText = z.string().trim().max(5000).nullable().optional();
const dims = z
  .object({ length: z.number().positive().optional(), width: z.number().positive().optional(), height: z.number().positive().optional() })
  .nullable()
  .optional();

export const variantInput = z.object({
  id: z.string().uuid().optional(),
  sku: z.string().trim().max(80).optional().nullable(),
  barcode: z.string().trim().max(64).optional().nullable(),
  color: z.string().trim().max(60).optional().nullable(),
  size: z.string().trim().max(40).optional().nullable(),
  options: z.record(z.string(), z.string()).optional(),
  stock: z.coerce.number().int().min(0, 'Las existencias no pueden ser negativas').optional(),
  cost: money,
  price: money,
  weightGrams: z.coerce.number().int().positive().nullable().optional(),
  dimensions: dims,
  status: z.enum(['active', 'inactive']).optional(),
});

const fieldMetaSchema = z.record(
  z.string(),
  z.object({ source: z.enum(['user', 'import', 'ai_detected', 'ai_inferred']), review: z.boolean().optional(), note: z.string().optional() }),
);

export const productInput = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(200),
  sku: z.string().trim().max(80).optional().nullable(),
  brand: optText,
  model: optText,
  categoryId: z.string().uuid().nullable().optional(),
  shortDescription: z.string().max(500).optional(),
  longDescription: z.string().max(20000).optional(),
  cost: money,
  price: money,
  promoPrice: money,
  currency: z.string().length(3).optional(),
  material: optText,
  dimensions: dims,
  weightGrams: z.coerce.number().int().positive().nullable().optional(),
  keywords: z.array(z.string().trim().max(60)).max(50).optional(),
  attributes: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  fieldMeta: fieldMetaSchema.optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  collectionIds: z.array(z.string().uuid()).optional(),
  variants: z.array(variantInput).max(300).optional(),
  /** Stock para productos sin variantes (se guarda en la variante única). */
  stock: z.coerce.number().int().min(0).optional(),
  mediaIds: z.array(z.string().uuid()).optional(),
});
export type ProductInput = z.infer<typeof productInput>;
type VariantIn = z.infer<typeof variantInput>;

const str = (n: number | null | undefined) => (n === null || n === undefined ? null : n.toFixed(2));

// ───────────────────────── Completitud ─────────────────────────

export const ISSUE_LABELS: Record<string, string> = {
  sin_categoria: 'Sin categoría',
  sin_precio: 'Sin precio de venta',
  sin_fotos: 'Sin fotografías',
  sin_descripcion: 'Sin descripción',
  por_revisar: 'Datos marcados para revisión',
  atributos_faltantes: 'Faltan atributos obligatorios de la categoría',
  promo_mayor: 'El precio promocional es mayor o igual al precio',
};

export async function categoryFields(db: DBOrTx, businessId: string, categoryId: string | null): Promise<FieldDef[]> {
  if (!categoryId) return [];
  const out: FieldDef[] = [];
  let current: string | null = categoryId;
  for (let depth = 0; current && depth < 5; depth++) {
    const [c] = await db
      .select({ parentId: categories.parentId, fields: categories.fields })
      .from(categories)
      .where(and(eq(categories.businessId, businessId), eq(categories.id, current)));
    if (!c) break;
    for (const f of c.fields) if (!out.some((o) => o.key === f.key)) out.push(f);
    current = c.parentId;
  }
  return out;
}

function computeIssues(p: {
  categoryId: string | null;
  price: string | null;
  promoPrice: string | null;
  shortDescription: string;
  longDescription: string;
  attributes: Record<string, string | number>;
  fieldMeta: FieldMeta;
  mediaCount: number;
  fields: FieldDef[];
  variantPrices: (string | null)[];
}) {
  const issues: string[] = [];
  if (!p.categoryId) issues.push('sin_categoria');
  if (!p.price && !p.variantPrices.some(Boolean)) issues.push('sin_precio');
  if (p.mediaCount === 0) issues.push('sin_fotos');
  if (!p.shortDescription.trim() && !p.longDescription.trim()) issues.push('sin_descripcion');
  if (Object.values(p.fieldMeta).some((m) => m.review)) issues.push('por_revisar');
  if (p.fields.some((f) => f.required && (p.attributes[f.key] === undefined || p.attributes[f.key] === ''))) issues.push('atributos_faltantes');
  if (p.price && p.promoPrice && Number(p.promoPrice) >= Number(p.price)) issues.push('promo_mayor');
  return issues;
}

/** Recalcula existencias totales, número de fotos y problemas de completitud. */
export async function refreshProductStats(db: DBOrTx, businessId: string, productId: string) {
  const [p] = await db
    .select()
    .from(products)
    .where(and(eq(products.businessId, businessId), eq(products.id, productId)));
  if (!p) return;
  const vs = await db
    .select({ stock: variants.stock, price: variants.price, status: variants.status })
    .from(variants)
    .where(and(eq(variants.businessId, businessId), eq(variants.productId, productId)));
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(media)
    .where(and(eq(media.businessId, businessId), eq(media.productId, productId), isNull(media.deletedAt)));
  const fields = await categoryFields(db, businessId, p.categoryId);
  const issues = computeIssues({ ...p, mediaCount: count, fields, variantPrices: vs.map((v) => v.price) });
  const totalStock = vs.filter((v) => v.status === 'active').reduce((s, v) => s + v.stock, 0);
  await db
    .update(products)
    .set({ issues, totalStock, mediaCount: count })
    .where(and(eq(products.businessId, businessId), eq(products.id, productId)));
}

// ───────────────────────── Alta / edición ─────────────────────────

async function assertOwnedIds(db: DBOrTx, businessId: string, input: Pick<ProductInput, 'categoryId' | 'collectionIds' | 'mediaIds'>) {
  if (input.categoryId) {
    const c = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.businessId, businessId), eq(categories.id, input.categoryId)));
    if (!c.length) throw badRequest('La categoría no pertenece a este negocio');
  }
  if (input.collectionIds?.length) {
    const c = await db
      .select({ id: collections.id })
      .from(collections)
      .where(and(eq(collections.businessId, businessId), inArray(collections.id, input.collectionIds)));
    if (c.length !== new Set(input.collectionIds).size) throw badRequest('Alguna colección no pertenece a este negocio');
  }
  if (input.mediaIds?.length) {
    const m = await db
      .select({ id: media.id })
      .from(media)
      .where(and(eq(media.businessId, businessId), inArray(media.id, input.mediaIds), isNull(media.deletedAt)));
    if (m.length !== new Set(input.mediaIds).size) throw badRequest('Alguna fotografía no pertenece a este negocio');
  }
}

export async function saveProduct(
  db: DBOrTx,
  ctx: { businessId: string; userId: string | null; isDemo?: boolean },
  raw: unknown,
  productId?: string,
) {
  const input = productInput.parse(raw);
  const { businessId } = ctx;
  await assertOwnedIds(db, businessId, input);

  let existing: typeof products.$inferSelect | undefined;
  if (productId) {
    [existing] = await db
      .select()
      .from(products)
      .where(and(eq(products.businessId, businessId), eq(products.id, productId)));
    if (!existing) throw notFound('Producto no encontrado');
  }

  let categoryName: string | null = null;
  const catId = input.categoryId !== undefined ? input.categoryId : existing?.categoryId ?? null;
  if (catId) {
    const [c] = await db.select({ name: categories.name, code: categories.code }).from(categories).where(eq(categories.id, catId));
    categoryName = c?.code || c?.name || null;
  }

  // SKU de producto: manual (validado) o automático según la regla del negocio.
  let sku = input.sku?.trim() || existing?.sku || '';
  if (!sku) sku = await nextProductSku(db, businessId, categoryName);
  else if ((!existing || existing.sku !== sku) && (await skuTaken(db, businessId, sku, productId))) {
    throw conflict(`El SKU ${sku} ya existe en este negocio`);
  }

  const values = {
    businessId,
    sku,
    name: input.name,
    brand: input.brand ?? (existing ? existing.brand : null),
    model: input.model ?? (existing ? existing.model : null),
    categoryId: catId,
    shortDescription: input.shortDescription ?? existing?.shortDescription ?? '',
    longDescription: input.longDescription ?? existing?.longDescription ?? '',
    cost: input.cost !== undefined ? str(input.cost) : existing?.cost ?? null,
    price: input.price !== undefined ? str(input.price) : existing?.price ?? null,
    promoPrice: input.promoPrice !== undefined ? str(input.promoPrice) : existing?.promoPrice ?? null,
    currency: input.currency ?? existing?.currency ?? 'MXN',
    material: input.material !== undefined ? input.material : existing?.material ?? null,
    dimensions: input.dimensions !== undefined ? input.dimensions : existing?.dimensions ?? null,
    weightGrams: input.weightGrams !== undefined ? input.weightGrams : existing?.weightGrams ?? null,
    keywords: input.keywords ?? existing?.keywords ?? [],
    attributes: input.attributes ?? existing?.attributes ?? {},
    fieldMeta: input.fieldMeta ?? existing?.fieldMeta ?? {},
    status: input.status ?? existing?.status ?? 'draft',
    archivedAt: (input.status ?? existing?.status) === 'archived' ? existing?.archivedAt ?? new Date() : null,
    updatedAt: new Date(),
  };

  let id: string;
  if (existing) {
    await db.update(products).set(values).where(and(eq(products.businessId, businessId), eq(products.id, existing.id)));
    id = existing.id;
  } else {
    const [row] = await db
      .insert(products)
      .values({ ...values, createdBy: ctx.userId, isDemo: ctx.isDemo ?? false })
      .returning({ id: products.id });
    id = row.id;
  }

  await syncVariants(db, businessId, id, sku, input, !existing);

  if (input.collectionIds) {
    await db.delete(productCollections).where(and(eq(productCollections.businessId, businessId), eq(productCollections.productId, id)));
    if (input.collectionIds.length) {
      await db
        .insert(productCollections)
        .values([...new Set(input.collectionIds)].map((collectionId) => ({ businessId, productId: id, collectionId })));
    }
  }

  if (input.mediaIds) {
    // Fotos que salen de la ficha quedan sin producto (no se borran); las nuevas se ordenan según la lista.
    await db
      .update(media)
      .set({ productId: null, variantId: null })
      .where(
        and(
          eq(media.businessId, businessId),
          eq(media.productId, id),
          input.mediaIds.length ? sql`${media.id} NOT IN (${sql.join(input.mediaIds.map((m) => sql`${m}`), sql`, `)})` : sql`true`,
        ),
      );
    for (const [position, mid] of input.mediaIds.entries()) {
      await db.update(media).set({ productId: id, position }).where(and(eq(media.businessId, businessId), eq(media.id, mid)));
    }
  }

  await refreshProductStats(db, businessId, id);
  await audit(db, {
    businessId,
    userId: ctx.userId,
    action: existing ? 'product.update' : 'product.create',
    entity: 'product',
    entityId: id,
    details: { sku, name: input.name },
  });
  return id;
}

async function syncVariants(db: DBOrTx, businessId: string, productId: string, productSku: string, input: ProductInput, isNew: boolean) {
  const cfg = await getSkuConfig(db, businessId);
  const current = await db
    .select()
    .from(variants)
    .where(and(eq(variants.businessId, businessId), eq(variants.productId, productId)));

  let desired: VariantIn[] | undefined = input.variants;
  if (!desired) {
    if (!isNew) {
      // Sin lista de variantes: solo se actualiza el stock de la variante única si se envió.
      if (input.stock !== undefined && current.length === 1) {
        await db.update(variants).set({ stock: input.stock, updatedAt: new Date() }).where(eq(variants.id, current[0].id));
      }
      return;
    }
    desired = [{ sku: productSku, stock: input.stock ?? 0, cost: undefined, price: undefined }];
  }
  if (desired.length === 0) throw badRequest('Un producto debe tener al menos una variante');

  // Combinaciones repetidas color/talla
  const combos = new Set<string>();
  for (const v of desired) {
    const k = `${(v.color ?? '').toLowerCase()}|${(v.size ?? '').toLowerCase()}|${JSON.stringify(v.options ?? {})}`;
    if (combos.has(k)) throw badRequest(`Variante repetida: ${[v.color, v.size].filter(Boolean).join(' / ') || 'sin opciones'}`);
    combos.add(k);
  }

  const single = desired.length === 1 && !desired[0].color && !desired[0].size && !Object.keys(desired[0].options ?? {}).length;
  const resolved = desired.map((v) => ({
    ...v,
    sku: v.sku?.trim() || (single ? productSku : renderVariantSku(cfg.variantSkuPattern, productSku, v)),
  }));
  const seen = new Set<string>();
  for (const v of resolved) {
    if (seen.has(v.sku)) throw conflict(`SKU de variante duplicado: ${v.sku}`);
    seen.add(v.sku);
  }
  const taken = await variantSkusTaken(db, businessId, [...seen], productId);
  if (taken.length) throw conflict(`SKU ya usado por otro producto: ${taken.join(', ')}`);

  const keepIds = new Set(resolved.filter((v) => v.id).map((v) => v.id!));
  for (const c of current) if (!c.id || !keepIds.has(c.id)) await db.delete(variants).where(eq(variants.id, c.id));
  // Se liberan SKU primero para permitir intercambios entre variantes de la misma ficha.
  for (const v of resolved) if (v.id) await db.update(variants).set({ sku: `__tmp_${v.id}` }).where(and(eq(variants.businessId, businessId), eq(variants.id, v.id)));

  for (const [position, v] of resolved.entries()) {
    const row = {
      sku: v.sku,
      barcode: v.barcode ?? null,
      color: v.color ?? null,
      size: v.size ?? null,
      options: v.options ?? {},
      stock: v.stock ?? 0,
      cost: str(v.cost ?? null),
      price: str(v.price ?? null),
      weightGrams: v.weightGrams ?? null,
      dimensions: v.dimensions ?? null,
      status: v.status ?? 'active',
      position,
      updatedAt: new Date(),
    };
    if (v.id && current.some((c) => c.id === v.id)) {
      await db.update(variants).set(row).where(and(eq(variants.businessId, businessId), eq(variants.id, v.id)));
    } else {
      await db.insert(variants).values({ ...row, businessId, productId });
    }
  }
}

/** Combina colores × tallas en variantes (sin crear fichas independientes). */
export function combineVariants(colors: string[], sizes: string[], base: { stock?: number; price?: number | null } = {}) {
  const cs = colors.length ? colors : [null];
  const ss = sizes.length ? sizes : [null];
  const out: z.input<typeof variantInput>[] = [];
  for (const color of cs) for (const size of ss) out.push({ color, size, stock: base.stock ?? 0, price: base.price ?? null });
  return out;
}

// ───────────────────────── Lectura ─────────────────────────

export async function getProduct(db: DBOrTx, businessId: string, productId: string) {
  const [p] = await db
    .select()
    .from(products)
    .where(and(eq(products.businessId, businessId), eq(products.id, productId)));
  if (!p) throw notFound('Producto no encontrado');
  const [vs, ms, cols, chans] = await Promise.all([
    db.select().from(variants).where(and(eq(variants.businessId, businessId), eq(variants.productId, productId))).orderBy(asc(variants.position)),
    db
      .select()
      .from(media)
      .where(and(eq(media.businessId, businessId), eq(media.productId, productId), isNull(media.deletedAt)))
      .orderBy(asc(media.position), asc(media.createdAt)),
    db
      .select({ id: collections.id, name: collections.name, kind: collections.kind })
      .from(productCollections)
      .innerJoin(collections, eq(collections.id, productCollections.collectionId))
      .where(and(eq(productCollections.businessId, businessId), eq(productCollections.productId, productId))),
    db.select().from(productChannels).where(and(eq(productChannels.businessId, businessId), eq(productChannels.productId, productId))),
  ]);
  const fields = await categoryFields(db, businessId, p.categoryId);
  return { ...p, variants: vs, media: ms, collections: cols, channels: chans, categoryFields: fields };
}

export const listQuery = z.object({
  q: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  collectionId: z.string().uuid().optional(),
  status: z.enum(['draft', 'active', 'archived', 'all', 'current']).optional().default('current'),
  stock: z.enum(['in', 'out']).optional(),
  issue: z.string().optional(),
  channel: z.string().optional(),
  channelStatus: z.enum(['none', 'file_generated', 'linked']).optional(),
  createdFrom: z.string().optional(),
  createdTo: z.string().optional(),
  sort: z.enum(['created_desc', 'created_asc', 'name_asc', 'price_desc', 'price_asc', 'stock_asc', 'updated_desc']).optional().default('created_desc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(500).optional().default(50),
});

export async function listProducts(db: DBOrTx, businessId: string, rawQuery: unknown) {
  const q = listQuery.parse(rawQuery);
  const conds: SQL[] = [eq(products.businessId, businessId)];
  if (q.status === 'current') conds.push(sql`${products.status} <> 'archived'`);
  else if (q.status !== 'all') conds.push(eq(products.status, q.status));
  if (q.q) {
    const like = `%${q.q.trim()}%`;
    conds.push(
      or(
        ilike(products.name, like),
        ilike(products.sku, like),
        ilike(products.brand, like),
        sql`EXISTS (SELECT 1 FROM variants v WHERE v.product_id = ${products.id} AND (v.sku ILIKE ${like} OR v.barcode ILIKE ${like}))`,
        sql`array_to_string(${products.keywords}, ' ') ILIKE ${like}`,
      )!,
    );
  }
  if (q.categoryId) {
    conds.push(sql`${products.categoryId} IN (SELECT id FROM categories WHERE business_id = ${businessId} AND (id = ${q.categoryId} OR parent_id = ${q.categoryId}))`);
  }
  if (q.collectionId) {
    conds.push(sql`EXISTS (SELECT 1 FROM product_collections pc WHERE pc.product_id = ${products.id} AND pc.collection_id = ${q.collectionId})`);
  }
  if (q.stock === 'out') conds.push(eq(products.totalStock, 0));
  if (q.stock === 'in') conds.push(sql`${products.totalStock} > 0`);
  if (q.issue === 'incomplete') conds.push(sql`cardinality(${products.issues}) > 0`);
  else if (q.issue) conds.push(sql`${q.issue} = ANY(${products.issues})`);
  if (q.channel) {
    const st = q.channelStatus ?? 'none';
    if (st === 'none') {
      conds.push(sql`NOT EXISTS (SELECT 1 FROM product_channels pch WHERE pch.product_id = ${products.id} AND pch.channel = ${q.channel} AND pch.status <> 'none')`);
    } else {
      conds.push(sql`EXISTS (SELECT 1 FROM product_channels pch WHERE pch.product_id = ${products.id} AND pch.channel = ${q.channel} AND pch.status = ${st})`);
    }
  }
  if (q.createdFrom) conds.push(sql`${products.createdAt} >= ${new Date(q.createdFrom)}`);
  if (q.createdTo) conds.push(sql`${products.createdAt} < ${new Date(new Date(q.createdTo).getTime() + 86400_000)}`);

  const order = {
    created_desc: [desc(products.createdAt)],
    created_asc: [asc(products.createdAt)],
    updated_desc: [desc(products.updatedAt)],
    name_asc: [asc(products.name)],
    price_desc: [sql`${products.price} DESC NULLS LAST`],
    price_asc: [sql`${products.price} ASC NULLS LAST`],
    stock_asc: [asc(products.totalStock)],
  }[q.sort];

  const where = and(...conds);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        brand: products.brand,
        categoryId: products.categoryId,
        categoryName: categories.name,
        price: products.price,
        promoPrice: products.promoPrice,
        cost: products.cost,
        status: products.status,
        totalStock: products.totalStock,
        mediaCount: products.mediaCount,
        issues: products.issues,
        isDemo: products.isDemo,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt,
        variantCount: sql<number>`(SELECT count(*)::int FROM variants v WHERE v.product_id = ${products.id})`,
        thumbId: sql<string | null>`(SELECT m.id FROM media m WHERE m.product_id = ${products.id} AND m.deleted_at IS NULL ORDER BY m.position, m.created_at LIMIT 1)`,
        collectionNames: sql<string[]>`COALESCE((SELECT array_agg(c.name ORDER BY c.name) FROM product_collections pc JOIN collections c ON c.id = pc.collection_id WHERE pc.product_id = ${products.id}), '{}')`,
      })
      .from(products)
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .where(where)
      .orderBy(...order, asc(products.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(products).where(where),
  ]);
  return { items: rows, total, page: q.page, pageSize: q.pageSize };
}

// ───────────────────────── Edición masiva ─────────────────────────

export const bulkInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  patch: z
    .object({
      status: z.enum(['draft', 'active', 'archived']).optional(),
      categoryId: z.string().uuid().nullable().optional(),
      brand: z.string().trim().max(200).nullable().optional(),
      material: z.string().trim().max(500).nullable().optional(),
      addCollectionIds: z.array(z.string().uuid()).optional(),
      removeCollectionIds: z.array(z.string().uuid()).optional(),
      price: z.object({ mode: z.enum(['set', 'percent', 'add']), value: z.number() }).optional(),
      promoPrice: z.number().min(0).nullable().optional(),
      addKeywords: z.array(z.string().trim().min(1)).optional(),
    })
    .strict(),
});

export async function bulkUpdate(db: DBOrTx, ctx: { businessId: string; userId: string }, raw: unknown) {
  const { ids, patch } = bulkInput.parse(raw);
  const { businessId } = ctx;
  const owned = await db
    .select({ id: products.id, status: products.status, archivedAt: products.archivedAt })
    .from(products)
    .where(and(eq(products.businessId, businessId), inArray(products.id, ids)));
  if (owned.length !== new Set(ids).size) throw badRequest('Algunos productos no pertenecen a este negocio');
  await assertOwnedIds(db, businessId, {
    categoryId: patch.categoryId ?? undefined,
    collectionIds: [...(patch.addCollectionIds ?? []), ...(patch.removeCollectionIds ?? [])],
  });

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.status) {
    set.status = patch.status;
    set.archivedAt = patch.status === 'archived' ? new Date() : null;
  }
  if (patch.categoryId !== undefined) set.categoryId = patch.categoryId;
  if (patch.brand !== undefined) set.brand = patch.brand;
  if (patch.material !== undefined) set.material = patch.material;
  if (patch.promoPrice !== undefined) set.promoPrice = str(patch.promoPrice);
  if (patch.price) {
    const v = patch.price.value;
    if (patch.price.mode === 'set') {
      if (v < 0) throw badRequest('El precio no puede ser negativo');
      set.price = str(v);
    } else if (patch.price.mode === 'percent') {
      set.price = sql`CASE WHEN ${products.price} IS NULL THEN NULL ELSE GREATEST(0, round(${products.price} * (1 + ${v}::numeric / 100), 2)) END`;
    } else {
      set.price = sql`CASE WHEN ${products.price} IS NULL THEN NULL ELSE GREATEST(0, ${products.price} + ${v}::numeric) END`;
    }
  }
  if (patch.addKeywords?.length) {
    const add = sql`ARRAY[${sql.join(patch.addKeywords.map((k) => sql`${k}`), sql`, `)}]::text[]`;
    set.keywords = sql`ARRAY(SELECT DISTINCT unnest(${products.keywords} || ${add}))`;
  }
  await db.update(products).set(set).where(and(eq(products.businessId, businessId), inArray(products.id, ids)));

  if (patch.addCollectionIds?.length) {
    const rows = ids.flatMap((productId) => patch.addCollectionIds!.map((collectionId) => ({ businessId, productId, collectionId })));
    await db.insert(productCollections).values(rows).onConflictDoNothing();
  }
  if (patch.removeCollectionIds?.length) {
    await db
      .delete(productCollections)
      .where(
        and(
          eq(productCollections.businessId, businessId),
          inArray(productCollections.productId, ids),
          inArray(productCollections.collectionId, patch.removeCollectionIds),
        ),
      );
  }
  for (const id of ids) await refreshProductStats(db, businessId, id);
  await audit(db, { businessId, userId: ctx.userId, action: 'product.bulk_update', entity: 'product', details: { count: ids.length, patch } });
  return { updated: ids.length };
}

export async function duplicateProduct(db: DBOrTx, ctx: { businessId: string; userId: string }, productId: string) {
  const p = await getProduct(db, ctx.businessId, productId);
  const newId = await saveProduct(db, ctx, {
    name: `${p.name} (copia)`,
    brand: p.brand,
    model: p.model,
    categoryId: p.categoryId,
    shortDescription: p.shortDescription,
    longDescription: p.longDescription,
    cost: p.cost,
    price: p.price,
    promoPrice: p.promoPrice,
    currency: p.currency,
    material: p.material,
    dimensions: p.dimensions,
    weightGrams: p.weightGrams,
    keywords: p.keywords,
    attributes: p.attributes,
    fieldMeta: p.fieldMeta,
    status: 'draft',
    collectionIds: p.collections.map((c) => c.id),
    // Las variantes se copian sin SKU (se regeneran) y con existencias en 0.
    variants: p.variants.map((v) => ({ color: v.color, size: v.size, options: v.options, stock: 0, price: v.price, cost: v.cost, weightGrams: v.weightGrams })),
  });
  return newId;
}
