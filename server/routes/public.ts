import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db/client';
import { businesses, catalogs, media } from '../db/schema';
import { notFound } from '../lib/errors';
import { verifyMediaSig } from '../lib/crypto';
import { storage } from '../lib/storage';
import { buildCatalogData, renderCatalogHtml, renderCatalogPdf } from '../services/catalogs';

/** Rutas públicas sin sesión. Solo exponen lo que el catálogo compartido incluye (nunca costos). */
export async function publicRoutes(app: FastifyInstance) {
  async function byToken(token: string) {
    if (!/^[\w-]{10,64}$/.test(token)) throw notFound('Catálogo no disponible');
    const [c] = await getDb()
      .select({ id: catalogs.id, businessId: catalogs.businessId })
      .from(catalogs)
      .innerJoin(businesses, eq(businesses.id, catalogs.businessId))
      .where(and(eq(catalogs.publicToken, token), isNull(businesses.archivedAt)));
    if (!c) throw notFound('Catálogo no disponible');
    return c;
  }

  app.get('/public/c/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const c = await byToken(token);
    const data = await buildCatalogData(getDb(), c.businessId, c.id);
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(renderCatalogHtml(data, token));
  });

  app.get('/public/c/:token/pdf', async (req, reply) => {
    const { token } = req.params as { token: string };
    const c = await byToken(token);
    const data = await buildCatalogData(getDb(), c.businessId, c.id);
    return reply.type('application/pdf').header('Content-Disposition', 'inline; filename="catalogo.pdf"').send(await renderCatalogPdf(data));
  });

  app.get('/public/c/:token/img/:mediaId', async (req, reply) => {
    const { token, mediaId } = req.params as { token: string; mediaId: string };
    const c = await byToken(token);
    const data = await buildCatalogData(getDb(), c.businessId, c.id);
    const entry = data.entries.find((e) => e.mediaId === mediaId);
    if (!entry?.mediaKey) throw notFound('Imagen no disponible');
    return reply.type(entry.mediaKey.endsWith('.png') ? 'image/png' : 'image/jpeg').header('Cache-Control', 'public, max-age=3600').send(await storage().get(entry.mediaKey));
  });

  app.get('/public/c/:token/logo', async (req, reply) => {
    const { token } = req.params as { token: string };
    const c = await byToken(token);
    const [b] = await getDb().select({ logoKey: businesses.logoKey }).from(businesses).where(eq(businesses.id, c.businessId));
    if (!b?.logoKey) throw notFound('Sin logotipo');
    return reply.type(b.logoKey.endsWith('.png') ? 'image/png' : 'image/jpeg').send(await storage().get(b.logoKey));
  });

  /** URL firmada de imagen para archivos de exportación (los marketplaces descargan las fotos desde aquí). */
  app.get('/public/m/:mediaId/:sig', async (req, reply) => {
    const { mediaId, sig } = req.params as { mediaId: string; sig: string };
    const cleanSig = sig.replace(/\.(jpg|png)$/, '');
    if (!/^[0-9a-f-]{36}$/i.test(mediaId) || !verifyMediaSig(mediaId, cleanSig)) throw notFound('Imagen no disponible');
    const [m] = await getDb().select().from(media).where(and(eq(media.id, mediaId), isNull(media.deletedAt)));
    if (!m) throw notFound('Imagen no disponible');
    return reply.type(m.mime).header('Cache-Control', 'public, max-age=86400').send(await storage().get(m.storageKey));
  });
}
