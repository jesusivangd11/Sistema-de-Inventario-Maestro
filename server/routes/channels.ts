import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { channelOperations, channelTemplates, exportsTable } from '../db/schema';
import { biz, requireBizAdmin } from '../lib/auth';
import { badRequest, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { storage } from '../lib/storage';
import { parseSpreadsheet } from '../lib/tabular';
import { normalizeKey } from '../lib/text';
import { readMultipart } from '../app';
import { CHANNELS, getChannel } from '../channels/registry';
import { FIELD_EXPRESSIONS } from '../channels/template';
import { mlGetCategory, mlRelevantAttributes, mlSuggestCategory } from '../channels/mercadolibre';
import {
  channelOverview,
  generateExport,
  getTemplate,
  linkExternalIds,
  listExports,
  updateTemplate,
  upsertProductChannel,
  uploadTemplate,
  validateForChannel,
} from '../services/exports';
import { bizScope, idParam } from './scope';

const channelParam = (req: { params: unknown }) => getChannel((req.params as { channel: string }).channel).id;

export async function channelRoutes(app: FastifyInstance) {
  app.get('/api/channels', async () =>
    Object.values(CHANNELS).map((c) => ({ id: c.id, name: c.name, market: c.market, verification: c.verification, capabilities: c.capabilities })),
  );
  app.get('/api/channels/fields', async () => FIELD_EXPRESSIONS);

  // Servicios oficiales públicos de Mercado Libre (no requieren cuenta)
  app.get('/api/channels/mercadolibre/suggest', async (req) => {
    const { q } = z.object({ q: z.string().trim().min(2).max(200) }).parse(req.query);
    try {
      return await mlSuggestCategory(q);
    } catch (e) {
      throw badRequest(`No se pudo consultar Mercado Libre: ${(e as Error).message}`);
    }
  });
  app.get('/api/channels/mercadolibre/categories/:categoryId', async (req) => {
    const { categoryId } = req.params as { categoryId: string };
    try {
      const cat = await mlGetCategory(categoryId);
      return { ...cat, relevant: mlRelevantAttributes(cat) };
    } catch (e) {
      throw badRequest((e as Error).message);
    }
  });

  await bizScope(app, async (r) => {
    r.get('/channels/:channel', async (req) => {
      const b = biz(req);
      const channel = channelParam(req);
      const db = getDb();
      const templates = await db
        .select()
        .from(channelTemplates)
        .where(and(eq(channelTemplates.businessId, b.id), eq(channelTemplates.channel, channel)))
        .orderBy(desc(channelTemplates.createdAt));
      const ops = await db
        .select()
        .from(channelOperations)
        .where(and(eq(channelOperations.businessId, b.id), eq(channelOperations.channel, channel)))
        .orderBy(desc(channelOperations.createdAt))
        .limit(20);
      return { overview: await channelOverview(db, b.id, channel), templates, exports: await listExports(db, b.id, channel), operations: ops };
    });

    r.post('/channels/:channel/templates', async (req) => {
      const { files, fields } = await readMultipart(req);
      if (!files[0]) throw badRequest('Selecciona la plantilla .xlsx descargada del marketplace');
      return uploadTemplate(getDb(), { businessId: biz(req).id, userId: req.user!.id }, channelParam(req), files[0], fields.name);
    });

    r.patch('/channels/:channel/templates/:id', async (req) => updateTemplate(getDb(), biz(req).id, idParam(req), req.body));

    r.delete('/channels/:channel/templates/:id', async (req) => {
      const b = requireBizAdmin(req);
      const t = await getTemplate(getDb(), b.id, idParam(req));
      await getDb().delete(channelTemplates).where(eq(channelTemplates.id, t.id));
      await audit(getDb(), { businessId: b.id, userId: req.user!.id, action: 'template.delete', entity: 'channel_template', entityId: t.id });
      return { ok: true };
    });

    const selection = z.object({ productIds: z.array(z.string().uuid()).min(1).max(2000), templateId: z.string().uuid().nullable().optional() });

    r.post('/channels/:channel/validate', async (req) => {
      const { productIds, templateId } = selection.parse(req.body);
      return validateForChannel(getDb(), biz(req).id, channelParam(req), productIds, templateId);
    });

    r.post('/channels/:channel/exports', async (req) => {
      const { productIds, templateId } = selection.parse(req.body);
      return generateExport(getDb(), { businessId: biz(req).id, userId: req.user!.id }, channelParam(req), productIds, templateId);
    });

    r.get('/exports/:id/download', async (req, reply) => {
      const b = biz(req);
      const [e] = await getDb().select().from(exportsTable).where(and(eq(exportsTable.businessId, b.id), eq(exportsTable.id, idParam(req))));
      if (!e) throw notFound('Exportación no encontrada');
      reply.header('Content-Disposition', `attachment; filename="${e.fileName}"`);
      return reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(await storage().get(e.fileKey));
    });

    r.put('/products/:id/channels/:channel', async (req) => upsertProductChannel(getDb(), biz(req).id, idParam(req), channelParam(req), req.body));

    /** Vincular SKU ↔ ID externo, por JSON o subiendo un CSV/XLSX con columnas sku e id. */
    r.post('/channels/:channel/links', async (req) => {
      const ctx = { businessId: biz(req).id, userId: req.user!.id };
      const channel = channelParam(req);
      if (req.isMultipart()) {
        const { files } = await readMultipart(req);
        if (!files[0]) throw badRequest('Selecciona un archivo');
        const t = await parseSpreadsheet(files[0].data, files[0].fileName);
        const skuCol = t.headers.find((h) => /sku/i.test(normalizeKey(h)));
        const idCol = t.headers.find((h) => /(^id$|id de publicacion|id publicacion|item id|product id|id del producto|mlm|external)/i.test(normalizeKey(h)) && h !== skuCol);
        if (!skuCol || !idCol) throw badRequest('El archivo debe tener una columna "sku" y otra con el ID (p. ej. "id de publicación").');
        return linkExternalIds(getDb(), ctx, channel, t.rows.map((r) => ({ sku: r[skuCol], externalId: r[idCol] })));
      }
      const { rows } = z.object({ rows: z.array(z.object({ sku: z.string(), externalId: z.string() })).min(1).max(5000) }).parse(req.body);
      return linkExternalIds(getDb(), ctx, channel, rows);
    });

    /**
     * Operaciones por API (publicar, sincronizar stock…). Mientras no existan credenciales e integración,
     * se registran como "pendiente de integración" y NO se reportan como exitosas.
     */
    r.post('/channels/:channel/operations', async (req) => {
      const b = biz(req);
      const channel = channelParam(req);
      const input = z.object({ operation: z.enum(['publish', 'update_price', 'sync_stock', 'fetch_status']), productIds: z.array(z.string().uuid()).max(2000).default([]) }).parse(req.body);
      const [op] = await getDb()
        .insert(channelOperations)
        .values({ businessId: b.id, channel, operation: input.operation, payload: { productIds: input.productIds }, status: 'pending_integration', lastError: 'Integración por API no disponible todavía: requiere credenciales y autorización del marketplace.' })
        .returning();
      return { operation: op, executed: false, message: 'Operación registrada como pendiente. No se envió nada al marketplace.' };
    });
  });
}
