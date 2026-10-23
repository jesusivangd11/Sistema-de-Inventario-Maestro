import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { catalogs } from '../db/schema';
import { biz } from '../lib/auth';
import { notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { randomToken } from '../lib/crypto';
import { assertCatalogItems, buildCatalogData, catalogInput, renderCatalogPdf } from '../services/catalogs';
import { bizScope, idParam } from './scope';

export async function catalogRoutes(app: FastifyInstance) {
  await bizScope(app, async (r) => {
    r.get('/catalogs', async (req) => getDb().select().from(catalogs).where(eq(catalogs.businessId, biz(req).id)).orderBy(desc(catalogs.updatedAt)));

    r.post('/catalogs', async (req) => {
      const b = biz(req);
      const input = catalogInput.parse(req.body);
      await assertCatalogItems(getDb(), b.id, input.items ?? []);
      const [c] = await getDb()
        .insert(catalogs)
        .values({ ...input, items: input.items?.map((i) => ({ productId: i.productId, mediaId: i.mediaId ?? null })) ?? [], businessId: b.id })
        .returning();
      await audit(getDb(), { businessId: b.id, userId: req.user!.id, action: 'catalog.create', entity: 'catalog', entityId: c.id });
      return c;
    });

    r.get('/catalogs/:id', async (req) => {
      const data = await buildCatalogData(getDb(), biz(req).id, idParam(req));
      return { ...data.catalog, entries: data.entries.map(({ mediaKey, ...e }) => e) };
    });

    r.put('/catalogs/:id', async (req) => {
      const b = biz(req);
      const input = catalogInput.partial().parse(req.body);
      if (input.items) await assertCatalogItems(getDb(), b.id, input.items);
      const [c] = await getDb()
        .update(catalogs)
        .set({ ...input, items: input.items?.map((i) => ({ productId: i.productId, mediaId: i.mediaId ?? null })), updatedAt: new Date() })
        .where(and(eq(catalogs.businessId, b.id), eq(catalogs.id, idParam(req))))
        .returning();
      if (!c) throw notFound('Catálogo no encontrado');
      return c;
    });

    r.delete('/catalogs/:id', async (req) => {
      const b = biz(req);
      const [c] = await getDb().delete(catalogs).where(and(eq(catalogs.businessId, b.id), eq(catalogs.id, idParam(req)))).returning({ id: catalogs.id });
      if (!c) throw notFound('Catálogo no encontrado');
      await audit(getDb(), { businessId: b.id, userId: req.user!.id, action: 'catalog.delete', entity: 'catalog', entityId: c.id });
      return { ok: true };
    });

    r.get('/catalogs/:id/pdf', async (req, reply) => {
      const data = await buildCatalogData(getDb(), biz(req).id, idParam(req));
      const pdf = await renderCatalogPdf(data);
      const name = `${data.catalog.title}`.replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '').trim() || 'catalogo';
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}.pdf"; filename*=UTF-8''${encodeURIComponent(name)}.pdf`);
      return reply.type('application/pdf').send(pdf);
    });

    /** Enlace público opcional: se crea o revoca explícitamente. */
    r.post('/catalogs/:id/share', async (req) => {
      const b = biz(req);
      const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
      const [c] = await getDb()
        .update(catalogs)
        .set({ publicToken: enabled ? randomToken(18) : null, updatedAt: new Date() })
        .where(and(eq(catalogs.businessId, b.id), eq(catalogs.id, idParam(req))))
        .returning();
      if (!c) throw notFound('Catálogo no encontrado');
      await audit(getDb(), { businessId: b.id, userId: req.user!.id, action: enabled ? 'catalog.share' : 'catalog.unshare', entity: 'catalog', entityId: c.id });
      return { publicToken: c.publicToken };
    });
  });
}
