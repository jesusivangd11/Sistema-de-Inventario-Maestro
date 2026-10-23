import type { FastifyInstance } from 'fastify';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { businesses, categories, collections, memberships, products, productCollections, users } from '../db/schema';
import { biz, requireBizAdmin, requireSuperadmin } from '../lib/auth';
import { badRequest, conflict, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { code, slugify } from '../lib/text';
import { processImage } from '../lib/images';
import { newKey, storage } from '../lib/storage';
import { readMultipart } from '../app';
import { bizScope, idParam } from './scope';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido (usa formato #RRGGBB)');

const businessInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  primaryColor: hex.optional(),
  secondaryColor: hex.optional(),
  currency: z.string().trim().toUpperCase().length(3).optional(),
  locale: z.string().trim().max(10).optional(),
  skuPattern: z.string().trim().min(1).max(60).refine((s) => s.includes('{SEQ}'), 'El patrón de SKU debe incluir {SEQ}').optional(),
  variantSkuPattern: z.string().trim().min(1).max(60).optional(),
  skuPrefix: z.string().trim().toUpperCase().max(10).optional(),
  skuSeqDigits: z.number().int().min(2).max(8).optional(),
});

const fieldDef = z.object({
  key: z.string().trim().min(1).max(40).regex(/^[a-zA-Z0-9_]+$/, 'La clave solo admite letras, números y guion bajo'),
  label: z.string().trim().min(1).max(60),
  type: z.enum(['text', 'number', 'select']),
  options: z.array(z.string().trim().min(1)).optional(),
  required: z.boolean().optional(),
  unit: z.string().max(10).optional(),
});

export async function businessRoutes(app: FastifyInstance) {
  app.post('/api/businesses', async (req) => {
    const user = requireSuperadmin(req);
    const input = businessInput.parse(req.body);
    const db = getDb();
    let slug = slugify(input.name) || 'negocio';
    for (let i = 2; (await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, slug))).length; i++) slug = `${slugify(input.name)}-${i}`;
    const [b] = await db.insert(businesses).values({ ...input, slug }).returning();
    await audit(db, { businessId: b.id, userId: user.id, action: 'business.create', entity: 'business', entityId: b.id, details: { name: b.name } });
    return b;
  });

  await bizScope(app, async (r) => {
    r.get('/', async (req) => {
      const [b] = await getDb().select().from(businesses).where(eq(businesses.id, biz(req).id));
      return { ...b, role: biz(req).role };
    });

    r.patch('/', async (req) => {
      const b = requireBizAdmin(req);
      const input = businessInput.partial().parse(req.body);
      const db = getDb();
      const [row] = await db.update(businesses).set({ ...input, updatedAt: new Date() }).where(eq(businesses.id, b.id)).returning();
      await audit(db, { businessId: b.id, userId: req.user!.id, action: 'business.update', entity: 'business', entityId: b.id, details: input });
      return row;
    });

    r.post('/logo', async (req) => {
      const b = requireBizAdmin(req);
      const { files } = await readMultipart(req);
      if (!files[0]) throw badRequest('Selecciona una imagen');
      let img;
      try {
        img = await processImage(files[0].data);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
      const key = newKey(b.id, 'brand', img.mainExt);
      await storage().put(key, img.main);
      await getDb().update(businesses).set({ logoKey: key, updatedAt: new Date() }).where(eq(businesses.id, b.id));
      return { ok: true };
    });

    r.get('/logo', async (req, reply) => {
      const [b] = await getDb().select({ logoKey: businesses.logoKey }).from(businesses).where(eq(businesses.id, biz(req).id));
      if (!b?.logoKey) throw notFound('Sin logotipo');
      reply.header('Cache-Control', 'private, max-age=300');
      return reply.type(b.logoKey.endsWith('.png') ? 'image/png' : 'image/jpeg').send(await storage().get(b.logoKey));
    });

    /** Archivar un negocio (recuperable). Requiere escribir el nombre exacto como confirmación. */
    r.post('/archive', async (req) => {
      const user = requireSuperadmin(req);
      const { confirmName } = z.object({ confirmName: z.string() }).parse(req.body);
      const b = biz(req);
      if (confirmName.trim() !== b.name) throw badRequest('El nombre de confirmación no coincide');
      await getDb().update(businesses).set({ archivedAt: new Date() }).where(eq(businesses.id, b.id));
      await audit(getDb(), { businessId: b.id, userId: user.id, action: 'business.archive', entity: 'business', entityId: b.id });
      return { ok: true };
    });

    // ───────── Miembros del negocio ─────────
    r.get('/members', async (req) => {
      const b = requireBizAdmin(req);
      return getDb()
        .select({ userId: users.id, name: users.name, email: users.email, role: memberships.role, active: users.active })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.businessId, b.id))
        .orderBy(asc(users.name));
    });

    r.put('/members', async (req) => {
      const b = requireBizAdmin(req);
      const input = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(['admin', 'operator']) }).parse(req.body);
      const db = getDb();
      const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
      if (!u) throw notFound('No existe un usuario con ese correo. El administrador general debe crearlo primero.');
      await db
        .insert(memberships)
        .values({ userId: u.id, businessId: b.id, role: input.role })
        .onConflictDoUpdate({ target: [memberships.userId, memberships.businessId], set: { role: input.role } });
      await audit(db, { businessId: b.id, userId: req.user!.id, action: 'member.upsert', entity: 'user', entityId: u.id, details: input });
      return { ok: true };
    });

    r.delete('/members/:userId', async (req) => {
      const b = requireBizAdmin(req);
      const userId = idParam(req, 'userId');
      if (userId === req.user!.id) throw badRequest('No puedes quitarte acceso a ti mismo');
      await getDb().delete(memberships).where(and(eq(memberships.businessId, b.id), eq(memberships.userId, userId)));
      await audit(getDb(), { businessId: b.id, userId: req.user!.id, action: 'member.remove', entity: 'user', entityId: userId });
      return { ok: true };
    });

    // ───────── Categorías ─────────
    r.get('/categories', async (req) => {
      const db = getDb();
      return db
        .select({
          id: categories.id,
          parentId: categories.parentId,
          name: categories.name,
          code: categories.code,
          fields: categories.fields,
          productCount: sql<number>`(SELECT count(*)::int FROM products p WHERE p.category_id = ${categories.id} AND p.status <> 'archived')`,
        })
        .from(categories)
        .where(eq(categories.businessId, biz(req).id))
        .orderBy(asc(categories.name));
    });

    const categoryInput = z.object({
      name: z.string().trim().min(1).max(120),
      parentId: z.string().uuid().nullable().optional(),
      code: z.string().trim().toUpperCase().max(6).optional(),
      fields: z.array(fieldDef).max(40).optional(),
    });

    r.post('/categories', async (req) => {
      const b = biz(req);
      const input = categoryInput.parse(req.body);
      const db = getDb();
      if (input.parentId) {
        const p = await db.select({ id: categories.id }).from(categories).where(and(eq(categories.businessId, b.id), eq(categories.id, input.parentId)));
        if (!p.length) throw badRequest('La categoría padre no pertenece a este negocio');
      }
      const [c] = await db
        .insert(categories)
        .values({ businessId: b.id, name: input.name, parentId: input.parentId ?? null, code: input.code || code(input.name, 3) || 'CAT', fields: input.fields ?? [] })
        .returning();
      return c;
    });

    r.patch('/categories/:id', async (req) => {
      const b = biz(req);
      const id = idParam(req);
      const input = categoryInput.partial().parse(req.body);
      if (input.parentId === id) throw badRequest('Una categoría no puede ser su propia categoría padre');
      const [c] = await getDb()
        .update(categories)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(categories.businessId, b.id), eq(categories.id, id)))
        .returning();
      if (!c) throw notFound('Categoría no encontrada');
      return c;
    });

    r.delete('/categories/:id', async (req) => {
      const b = requireBizAdmin(req);
      const id = idParam(req);
      const db = getDb();
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(products).where(and(eq(products.businessId, b.id), eq(products.categoryId, id)));
      if (n > 0) throw conflict(`La categoría tiene ${n} producto(s). Reasígnalos antes de eliminarla.`);
      const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(categories).where(and(eq(categories.businessId, b.id), eq(categories.parentId, id)));
      if (c > 0) throw conflict('La categoría tiene subcategorías.');
      await db.delete(categories).where(and(eq(categories.businessId, b.id), eq(categories.id, id)));
      return { ok: true };
    });

    // ───────── Colecciones y temporadas ─────────
    r.get('/collections', async (req) => {
      return getDb()
        .select({
          id: collections.id,
          name: collections.name,
          kind: collections.kind,
          description: collections.description,
          startsAt: collections.startsAt,
          endsAt: collections.endsAt,
          archivedAt: collections.archivedAt,
          createdAt: collections.createdAt,
          productCount: sql<number>`(SELECT count(*)::int FROM product_collections pc WHERE pc.collection_id = ${collections.id})`,
        })
        .from(collections)
        .where(eq(collections.businessId, biz(req).id))
        .orderBy(sql`${collections.archivedAt} NULLS FIRST`, asc(collections.name));
    });

    const collectionInput = z.object({
      name: z.string().trim().min(1).max(120),
      kind: z.enum(['season', 'collection']).optional(),
      description: z.string().max(1000).optional(),
      startsAt: z.coerce.date().nullable().optional(),
      endsAt: z.coerce.date().nullable().optional(),
    });

    r.post('/collections', async (req) => {
      const b = biz(req);
      const input = collectionInput.parse(req.body);
      const [c] = await getDb().insert(collections).values({ ...input, businessId: b.id }).returning();
      await audit(getDb(), { businessId: b.id, userId: req.user!.id, action: 'collection.create', entity: 'collection', entityId: c.id, details: { name: c.name } });
      return c;
    });

    r.patch('/collections/:id', async (req) => {
      const b = biz(req);
      const id = idParam(req);
      const input = collectionInput.partial().extend({ archived: z.boolean().optional() }).parse(req.body);
      const { archived, ...rest } = input;
      const set: Record<string, unknown> = { ...rest, updatedAt: new Date() };
      if (archived !== undefined) set.archivedAt = archived ? new Date() : null;
      const [c] = await getDb().update(collections).set(set).where(and(eq(collections.businessId, b.id), eq(collections.id, id))).returning();
      if (!c) throw notFound('Colección no encontrada');
      return c;
    });

    /** Asignar/quitar productos a una colección (sin duplicar registros de producto). */
    r.post('/collections/:id/products', async (req) => {
      const b = biz(req);
      const id = idParam(req);
      const input = z.object({ add: z.array(z.string().uuid()).optional(), remove: z.array(z.string().uuid()).optional() }).parse(req.body);
      const db = getDb();
      const [c] = await db.select({ id: collections.id }).from(collections).where(and(eq(collections.businessId, b.id), eq(collections.id, id)));
      if (!c) throw notFound('Colección no encontrada');
      if (input.add?.length) {
        await db
          .insert(productCollections)
          .values(input.add.map((productId) => ({ businessId: b.id, productId, collectionId: id })))
          .onConflictDoNothing();
      }
      if (input.remove?.length) {
        for (const productId of input.remove) {
          await db.delete(productCollections).where(and(eq(productCollections.businessId, b.id), eq(productCollections.collectionId, id), eq(productCollections.productId, productId)));
        }
      }
      return { ok: true };
    });
  });
}
