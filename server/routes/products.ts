import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { categories, media, products, variants } from '../db/schema';
import { biz } from '../lib/auth';
import { badRequest, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { storage } from '../lib/storage';
import { toCsv, writeXlsx } from '../lib/tabular';
import { readMultipart } from '../app';
import { bulkUpdate, combineVariants, duplicateProduct, getProduct, ISSUE_LABELS, listProducts, refreshProductStats, saveProduct } from '../services/products';
import { restoreMedia, softDeleteMedia, storeImage } from '../services/media';
import { bizScope, idParam } from './scope';

export async function productRoutes(app: FastifyInstance) {
  await bizScope(app, async (r) => {
    r.get('/products', async (req) => listProducts(getDb(), biz(req).id, req.query));

    r.get('/products/issue-labels', async () => ISSUE_LABELS);

    r.post('/products', async (req) => {
      const db = getDb();
      const id = await db.transaction((tx) => saveProduct(tx, { businessId: biz(req).id, userId: req.user!.id }, req.body));
      return getProduct(db, biz(req).id, id);
    });

    r.get('/products/:id', async (req) => getProduct(getDb(), biz(req).id, idParam(req)));

    r.put('/products/:id', async (req) => {
      const db = getDb();
      const id = await db.transaction((tx) => saveProduct(tx, { businessId: biz(req).id, userId: req.user!.id }, req.body, idParam(req)));
      return getProduct(db, biz(req).id, id);
    });

    r.post('/products/:id/duplicate', async (req) => {
      const db = getDb();
      const id = await db.transaction((tx) => duplicateProduct(tx, { businessId: biz(req).id, userId: req.user!.id }, idParam(req)));
      return getProduct(db, biz(req).id, id);
    });

    r.post('/products/bulk', async (req) => {
      const db = getDb();
      return db.transaction((tx) => bulkUpdate(tx, { businessId: biz(req).id, userId: req.user!.id }, req.body));
    });

    /** Edición rápida de existencias/precio de variantes desde la tabla. */
    r.patch('/variants', async (req) => {
      const b = biz(req);
      const input = z
        .object({
          items: z
            .array(
              z.object({
                id: z.string().uuid(),
                stock: z.number().int().min(0).optional(),
                price: z.number().min(0).nullable().optional(),
                barcode: z.string().max(64).nullable().optional(),
              }),
            )
            .min(1)
            .max(1000),
        })
        .parse(req.body);
      const db = getDb();
      return db.transaction(async (tx) => {
        const touched = new Set<string>();
        for (const it of input.items) {
          const set: Record<string, unknown> = { updatedAt: new Date() };
          if (it.stock !== undefined) set.stock = it.stock;
          if (it.price !== undefined) set.price = it.price === null ? null : it.price.toFixed(2);
          if (it.barcode !== undefined) set.barcode = it.barcode;
          const [v] = await tx.update(variants).set(set).where(and(eq(variants.businessId, b.id), eq(variants.id, it.id))).returning({ productId: variants.productId });
          if (!v) throw notFound('Variante no encontrada en este negocio');
          touched.add(v.productId);
        }
        for (const pid of touched) await refreshProductStats(tx, b.id, pid);
        await audit(tx, { businessId: b.id, userId: req.user!.id, action: 'variant.bulk_update', entity: 'variant', details: { count: input.items.length } });
        return { updated: input.items.length };
      });
    });

    r.post('/variants/combine', async (req) => {
      const input = z.object({ colors: z.array(z.string().trim().min(1)).max(50), sizes: z.array(z.string().trim().min(1)).max(50), stock: z.number().int().min(0).optional() }).parse(req.body);
      return combineVariants(input.colors, input.sizes, { stock: input.stock });
    });

    // ───────── Fotografías ─────────

    /** Sube una o varias fotos; si se indica productId se asignan a ese producto. */
    r.post('/media', async (req) => {
      const b = biz(req);
      const { files, fields } = await readMultipart(req);
      if (!files.length) throw badRequest('No se recibieron archivos');
      const productId = fields.productId || null;
      const db = getDb();
      if (productId) {
        const p = await db.select({ id: products.id }).from(products).where(and(eq(products.businessId, b.id), eq(products.id, productId)));
        if (!p.length) throw notFound('Producto no encontrado');
      }
      const results = [];
      for (const f of files) results.push(await storeImage(db, { businessId: b.id, fileName: f.fileName, data: f.data, productId }));
      return { results };
    });

    r.get('/media/:id/:size', async (req, reply) => {
      const b = biz(req);
      const id = idParam(req);
      const { size } = req.params as { size: string };
      const [m] = await getDb().select().from(media).where(and(eq(media.businessId, b.id), eq(media.id, id)));
      if (!m) throw notFound('Imagen no encontrada');
      const key = size === 'thumb' ? m.thumbKey : m.storageKey;
      reply.header('Cache-Control', 'private, max-age=86400, immutable');
      if (size === 'download') reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(m.originalName)}"`);
      return reply.type(size === 'thumb' ? 'image/webp' : m.mime).send(await storage().get(key));
    });

    r.post('/media/delete', async (req) => {
      const b = biz(req);
      const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).parse(req.body);
      const n = await softDeleteMedia(getDb(), b.id, ids);
      await audit(getDb(), { businessId: b.id, userId: req.user!.id, action: 'media.delete', entity: 'media', details: { ids } });
      return { deleted: n };
    });

    r.post('/media/restore', async (req) => {
      const b = biz(req);
      const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).parse(req.body);
      return { restored: await restoreMedia(getDb(), b.id, ids) };
    });

    r.get('/media-trash', async (req) => {
      return getDb()
        .select({ id: media.id, originalName: media.originalName, productId: media.productId, deletedAt: media.deletedAt })
        .from(media)
        .where(and(eq(media.businessId, biz(req).id), isNotNull(media.deletedAt)))
        .orderBy(sql`${media.deletedAt} DESC`)
        .limit(200);
    });

    /** Asigna una foto a una variante específica (p. ej. foto del color rosa). */
    r.patch('/media/:id', async (req) => {
      const b = biz(req);
      const id = idParam(req);
      const input = z.object({ variantId: z.string().uuid().nullable() }).parse(req.body);
      const db = getDb();
      const [m] = await db.select().from(media).where(and(eq(media.businessId, b.id), eq(media.id, id)));
      if (!m) throw notFound('Imagen no encontrada');
      if (input.variantId) {
        const [v] = await db.select({ productId: variants.productId }).from(variants).where(and(eq(variants.businessId, b.id), eq(variants.id, input.variantId)));
        if (!v || v.productId !== m.productId) throw badRequest('La variante no pertenece al producto de esta foto');
      }
      await db.update(media).set({ variantId: input.variantId }).where(eq(media.id, id));
      return { ok: true };
    });

    // ───────── Exportación del catálogo maestro (Excel/CSV) ─────────

    r.get('/products-export', async (req, reply) => {
      const b = biz(req);
      const { format = 'xlsx', ids } = req.query as { format?: string; ids?: string };
      const db = getDb();
      const idList = ids ? ids.split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x)) : null;
      const rows = await db
        .select({ p: products, v: variants, categoryName: categories.name })
        .from(variants)
        .innerJoin(products, eq(products.id, variants.productId))
        .leftJoin(categories, eq(categories.id, products.categoryId))
        .where(and(eq(variants.businessId, b.id), idList ? inArray(products.id, idList) : sql`${products.status} <> 'archived'`))
        .orderBy(asc(products.sku), asc(variants.position));
      const headers = ['grupo', 'sku', 'nombre', 'marca', 'modelo', 'categoria', 'color', 'talla', 'existencias', 'costo', 'precio', 'precio promocional', 'codigo de barras', 'material', 'peso (g)', 'palabras clave', 'descripcion corta', 'descripcion', 'estado'];
      const data = rows.map(({ p, v, categoryName }) => [
        p.sku,
        v.sku,
        p.name,
        p.brand,
        p.model,
        categoryName,
        v.color,
        v.size,
        v.stock,
        v.cost ?? p.cost,
        v.price ?? p.price,
        p.promoPrice,
        v.barcode,
        p.material,
        p.weightGrams,
        p.keywords.join(', '),
        p.shortDescription,
        p.longDescription,
        p.status,
      ]);
      const name = `catalogo-${b.slug}-${new Date().toISOString().slice(0, 10)}`;
      if (format === 'csv') {
        reply.header('Content-Disposition', `attachment; filename="${name}.csv"`);
        return reply.type('text/csv; charset=utf-8').send(toCsv(headers, data));
      }
      reply.header('Content-Disposition', `attachment; filename="${name}.xlsx"`);
      return reply
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .send(await writeXlsx([{ name: 'Catálogo', headers, rows: data as (string | number | null)[][] }]));
    });

    r.get('/import-template', async (_req, reply) => {
      const headers = ['grupo', 'sku', 'nombre', 'marca', 'modelo', 'categoria', 'color', 'talla', 'existencias', 'costo', 'precio', 'precio promocional', 'codigo de barras', 'material', 'peso (g)', 'palabras clave', 'descripcion corta', 'descripcion', 'fotos'];
      const example = [
        ['PIJ-TERM', '', 'Pijama térmica de dos piezas', '', '', 'Pijamas', 'Rosa', 'Chica', 5, 180, 399, '', '', '', 450, 'pijama, invierno', '', '', 'pijama_rosa_1.jpg, pijama_rosa_2.jpg'],
        ['PIJ-TERM', '', 'Pijama térmica de dos piezas', '', '', 'Pijamas', 'Rosa', 'Mediana', 4, 180, 399, '', '', '', 450, '', '', '', ''],
        ['PIJ-TERM', '', 'Pijama térmica de dos piezas', '', '', 'Pijamas', 'Negra', 'Chica', 3, 180, 399, '', '', '', 450, '', '', '', 'pijama_negra_1.jpg'],
      ];
      reply.header('Content-Disposition', 'attachment; filename="plantilla-importacion-catalogo.xlsx"');
      return reply
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .send(
          await writeXlsx([
            {
              name: 'Productos',
              headers,
              rows: example,
              note: 'Una fila por variante. Filas con el mismo "grupo" se combinan en un solo producto. Deja "sku" vacío para generarlo automáticamente. Borra estas filas de ejemplo.',
            },
          ]),
        );
    });
  });
}
