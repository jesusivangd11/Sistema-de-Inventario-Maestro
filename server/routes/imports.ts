import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { importBatches, media } from '../db/schema';
import { biz } from '../lib/auth';
import { badRequest } from '../lib/errors';
import { readMultipart } from '../app';
import { storeImage } from '../services/media';
import {
  addEmptyRow,
  batchDetail,
  commitBatch,
  createBatch,
  deleteRows,
  getBatch,
  groupUnassignedPhotos,
  importSpreadsheet,
  linkPhotosByName,
  IMPORT_FIELDS,
  mergeRows,
  patchRows,
  previewSpreadsheet,
  splitRow,
  validateBatch,
} from '../services/imports';
import { aiStatus, getAiProvider, loadAiImage, queueRows } from '../ai/worker';
import { AiNotConfiguredError } from '../ai/provider';
import { bizScope, idParam } from './scope';

export async function importRoutes(app: FastifyInstance) {
  app.get('/api/ai/status', async () => aiStatus());

  await bizScope(app, async (r) => {
    r.get('/batches', async (req) => {
      return getDb()
        .select({
          id: importBatches.id,
          name: importBatches.name,
          status: importBatches.status,
          summary: importBatches.summary,
          createdAt: importBatches.createdAt,
          committedAt: importBatches.committedAt,
          rowCount: sql<number>`(SELECT count(*)::int FROM import_rows r WHERE r.batch_id = ${importBatches.id})`,
          errorCount: sql<number>`(SELECT count(*)::int FROM import_rows r WHERE r.batch_id = ${importBatches.id} AND r.status = 'error')`,
          photoCount: sql<number>`(SELECT count(*)::int FROM media m WHERE m.batch_id = ${importBatches.id} AND m.deleted_at IS NULL)`,
          aiPending: sql<number>`(SELECT count(*)::int FROM import_rows r WHERE r.batch_id = ${importBatches.id} AND r.ai_status IN ('queued','processing'))`,
        })
        .from(importBatches)
        .where(eq(importBatches.businessId, biz(req).id))
        .orderBy(desc(importBatches.createdAt))
        .limit(200);
    });

    r.post('/batches', async (req) => createBatch(getDb(), { businessId: biz(req).id, userId: req.user!.id }, req.body));

    r.get('/batches/:id', async (req) => ({ ...(await batchDetail(getDb(), biz(req).id, idParam(req))), fields: IMPORT_FIELDS }));

    r.post('/batches/:id/cancel', async (req) => {
      const b = biz(req);
      const batch = await getBatch(getDb(), b.id, idParam(req));
      if (batch.status !== 'draft') throw badRequest('Solo se pueden cancelar lotes en borrador');
      await getDb().update(importBatches).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(importBatches.id, batch.id));
      return { ok: true };
    });

    r.post('/batches/:id/photos', async (req) => {
      const b = biz(req);
      const batchId = idParam(req);
      const batch = await getBatch(getDb(), b.id, batchId);
      if (batch.status === 'committed' || batch.status === 'cancelled') throw badRequest('El lote está cerrado');
      const { files } = await readMultipart(req);
      if (!files.length) throw badRequest('No se recibieron archivos');
      const results = [];
      for (const f of files) {
        const res = await storeImage(getDb(), { businessId: b.id, fileName: f.fileName, data: f.data, batchId });
        results.push({ fileName: res.fileName, error: res.error, mediaId: res.media?.id, duplicates: res.duplicates });
      }
      // Si ya se importó una hoja con columna de fotos, las nuevas fotos se asocian a su producto de inmediato
      const linked = await linkPhotosByName(getDb(), b.id, batchId);
      return { results, uploaded: results.filter((r) => !r.error).length, failed: results.filter((r) => r.error).length, linked };
    });

    r.post('/batches/:id/group', async (req) => groupUnassignedPhotos(getDb(), biz(req).id, idParam(req)));

    /** Agrupación sugerida por IA para fotos que quedaron sueltas o mal agrupadas (máx. 24 por llamada). */
    r.post('/batches/:id/ai-group', async (req) => {
      const b = biz(req);
      const batchId = idParam(req);
      const p = getAiProvider();
      if (!p) throw badRequest(new AiNotConfiguredError().message);
      const { mediaIds } = z.object({ mediaIds: z.array(z.string().uuid()).min(2).max(24) }).parse(req.body);
      const ms = await getDb()
        .select({ id: media.id, thumbKey: media.thumbKey })
        .from(media)
        .where(and(eq(media.businessId, b.id), eq(media.batchId, batchId), inArray(media.id, mediaIds)));
      if (ms.length !== mediaIds.length) throw badRequest('Algunas fotos no pertenecen a este lote');
      const ordered = mediaIds.map((id) => ms.find((m) => m.id === id)!);
      const thumbs = await Promise.all(ordered.map((m) => loadAiImage(m.thumbKey, 384)));
      const res = await p.suggestGroups(thumbs);
      const seen = new Set<number>();
      const groups = res.groups
        .map((g) => g.filter((i) => i >= 0 && i < ordered.length && !seen.has(i) && (seen.add(i), true)).map((i) => ordered[i].id))
        .filter((g) => g.length);
      for (let i = 0; i < ordered.length; i++) if (!seen.has(i)) groups.push([ordered[i].id]);
      return { groups, notes: res.notes, source: 'ai' };
    });

    r.post('/batches/:id/spreadsheet/preview', async (req) => {
      const { files } = await readMultipart(req);
      if (!files[0]) throw badRequest('Selecciona un archivo .csv o .xlsx');
      try {
        return await previewSpreadsheet(files[0].data, files[0].fileName);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
    });

    r.post('/batches/:id/spreadsheet', async (req) => {
      const { files, fields } = await readMultipart(req);
      if (!files[0]) throw badRequest('Selecciona un archivo .csv o .xlsx');
      let mapping: Record<string, string> | undefined;
      if (fields.mapping) {
        try {
          mapping = z.record(z.string(), z.string()).parse(JSON.parse(fields.mapping));
        } catch {
          throw badRequest('Mapeo de columnas inválido');
        }
      }
      const db = getDb();
      try {
        return await db.transaction((tx) => importSpreadsheet(tx, { businessId: biz(req).id, userId: req.user!.id }, idParam(req), files[0], mapping));
      } catch (e) {
        if (e instanceof Error && /Formato no soportado|no contiene filas|máximo|No se pudo leer/.test(e.message)) throw badRequest(e.message);
        throw e;
      }
    });

    r.patch('/batches/:id/rows', async (req) => getDb().transaction((tx) => patchRows(tx, biz(req).id, idParam(req), req.body)));

    r.post('/batches/:id/rows', async (req) => {
      const { mediaIds } = z.object({ mediaIds: z.array(z.string().uuid()).optional() }).parse(req.body ?? {});
      return addEmptyRow(getDb(), biz(req).id, idParam(req), mediaIds);
    });

    r.post('/batches/:id/rows/merge', async (req) => {
      const { ids } = z.object({ ids: z.array(z.string().uuid()).min(2) }).parse(req.body);
      return getDb().transaction((tx) => mergeRows(tx, biz(req).id, idParam(req), ids));
    });

    r.post('/batches/:id/rows/:rowId/split', async (req) => getDb().transaction((tx) => splitRow(tx, biz(req).id, idParam(req), idParam(req, 'rowId'))));

    r.post('/batches/:id/rows/delete', async (req) => {
      const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1) }).parse(req.body);
      return deleteRows(getDb(), biz(req).id, idParam(req), ids);
    });

    r.post('/batches/:id/validate', async (req) => validateBatch(getDb(), biz(req).id, idParam(req)));

    r.post('/batches/:id/commit', async (req) => {
      const { onlyValid } = z.object({ onlyValid: z.boolean().default(false) }).parse(req.body ?? {});
      return commitBatch(getDb(), { businessId: biz(req).id, userId: req.user!.id }, idParam(req), { onlyValid });
    });

    r.post('/batches/:id/ai', async (req) => {
      const { rowIds } = z.object({ rowIds: z.array(z.string().uuid()).optional() }).parse(req.body ?? {});
      try {
        return await queueRows(getDb(), biz(req).id, idParam(req), rowIds);
      } catch (e) {
        if (e instanceof AiNotConfiguredError) throw badRequest(e.message);
        throw e;
      }
    });
  });
}
