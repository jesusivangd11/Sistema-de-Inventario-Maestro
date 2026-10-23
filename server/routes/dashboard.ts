import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { accessibleBusinessIds, requireUser } from '../lib/auth';
import { notFound } from '../lib/errors';

/** Tablero con cifras reales de la base de datos, consolidado o por negocio (solo negocios autorizados). */
export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/api/dashboard', async (req) => {
    const user = requireUser(req);
    const { businessId } = z.object({ businessId: z.string().uuid().optional() }).parse(req.query);
    const allowed = await accessibleBusinessIds(user);
    if (businessId && allowed && !allowed.includes(businessId)) throw notFound('Negocio no encontrado');
    const ids = businessId ? [businessId] : allowed;
    const db = getDb();
    // Filtro de negocios para cada consulta (null = administrador general, todos)
    const scope = (col: string) =>
      ids === null ? sql`true` : ids.length ? sql`${sql.raw(col)} IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})` : sql`false`;

    const [counts] = (
      await db.execute<Record<string, number>>(sql`
      SELECT
        (SELECT count(*)::int FROM businesses b WHERE b.archived_at IS NULL AND ${scope('b.id')}) AS businesses,
        (SELECT count(*)::int FROM products p WHERE p.status <> 'archived' AND ${scope('p.business_id')}) AS products,
        (SELECT count(*)::int FROM variants v JOIN products p ON p.id = v.product_id WHERE p.status <> 'archived' AND ${scope('v.business_id')}) AS variants,
        (SELECT count(*)::int FROM products p WHERE p.status = 'active' AND ${scope('p.business_id')}) AS active,
        (SELECT count(*)::int FROM products p WHERE p.status = 'draft' AND ${scope('p.business_id')}) AS drafts,
        (SELECT count(*)::int FROM products p WHERE p.status <> 'archived' AND p.total_stock = 0 AND ${scope('p.business_id')}) AS out_of_stock,
        (SELECT count(*)::int FROM products p WHERE p.status <> 'archived' AND cardinality(p.issues) > 0 AND ${scope('p.business_id')}) AS incomplete,
        (SELECT count(*)::int FROM products p WHERE p.status <> 'archived' AND p.media_count = 0 AND ${scope('p.business_id')}) AS no_photos,
        (SELECT count(*)::int FROM products p WHERE p.status = 'active' AND ${scope('p.business_id')}
            AND NOT EXISTS (SELECT 1 FROM product_channels pc WHERE pc.product_id = p.id AND pc.status <> 'none')) AS pending_export,
        (SELECT count(*)::int FROM import_batches ib WHERE ib.status IN ('draft','partially_committed') AND ${scope('ib.business_id')}) AS open_batches,
        (SELECT count(*)::int FROM import_rows ir WHERE ir.status = 'error' AND ${scope('ir.business_id')}
            AND EXISTS (SELECT 1 FROM import_batches ib WHERE ib.id = ir.batch_id AND ib.status IN ('draft','partially_committed'))) AS row_errors,
        (SELECT count(*)::int FROM import_rows ir WHERE ir.ai_status = 'failed' AND ir.status NOT IN ('committed','skipped') AND ${scope('ir.business_id')}) AS ai_failed,
        (SELECT count(*)::int FROM import_rows ir WHERE ir.ai_status IN ('queued','processing') AND ${scope('ir.business_id')}) AS ai_pending
    `)
    ).rows;

    const recentExports = (
      await db.execute(sql`
      SELECT e.id, e.channel, e.format, e.file_name, e.product_count, e.row_count, e.created_at, e.business_id, b.name AS business_name
      FROM exports e JOIN businesses b ON b.id = e.business_id WHERE ${scope('e.business_id')} ORDER BY e.created_at DESC LIMIT 6`)
    ).rows;
    const openBatches = (
      await db.execute(sql`
      SELECT ib.id, ib.name, ib.status, ib.created_at, ib.business_id, b.name AS business_name,
        (SELECT count(*)::int FROM import_rows r WHERE r.batch_id = ib.id) AS rows,
        (SELECT count(*)::int FROM import_rows r WHERE r.batch_id = ib.id AND r.status = 'error') AS errors
      FROM import_batches ib JOIN businesses b ON b.id = ib.business_id
      WHERE ib.status IN ('draft','partially_committed') AND ${scope('ib.business_id')} ORDER BY ib.created_at DESC LIMIT 6`)
    ).rows;
    const activity = (
      await db.execute(sql`
      SELECT a.id, a.action, a.entity, a.entity_id, a.details, a.created_at, a.business_id, b.name AS business_name, u.name AS user_name
      FROM audit_log a LEFT JOIN businesses b ON b.id = a.business_id LEFT JOIN users u ON u.id = a.user_id
      WHERE ${ids === null ? sql`true` : scope('a.business_id')} ORDER BY a.created_at DESC LIMIT 15`)
    ).rows;
    const perBusiness = businessId
      ? []
      : (
          await db.execute(sql`
      SELECT b.id, b.name, b.primary_color,
        (SELECT count(*)::int FROM products p WHERE p.business_id = b.id AND p.status <> 'archived') AS products,
        (SELECT count(*)::int FROM products p WHERE p.business_id = b.id AND p.status <> 'archived' AND cardinality(p.issues) > 0) AS incomplete,
        (SELECT count(*)::int FROM products p WHERE p.business_id = b.id AND p.status <> 'archived' AND p.total_stock = 0) AS out_of_stock
      FROM businesses b WHERE b.archived_at IS NULL AND ${scope('b.id')} ORDER BY b.name`)
        ).rows;
    return { counts, recentExports, openBatches, activity, perBusiness };
  });
}
