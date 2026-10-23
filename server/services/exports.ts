import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB, DBOrTx } from '../db/client';
import {
  categories,
  channelTemplates,
  exportItems,
  exportsTable,
  media,
  productChannels,
  products,
  variantChannelLinks,
  variants,
  type ExportIssue,
} from '../db/schema';
import { config } from '../config';
import { audit } from '../lib/audit';
import { signMediaId } from '../lib/crypto';
import { badRequest, notFound } from '../lib/errors';
import { newKey, storage } from '../lib/storage';
import { writeXlsx } from '../lib/tabular';
import { getChannel } from '../channels/registry';
import { mlAttrValue, mlGetCategory } from '../channels/mercadolibre';
import { analyzeTemplate, autoMap, fillTemplate, reanalyze, resolveExpr } from '../channels/template';
import type { ExportProduct } from '../channels/types';

export function publicMediaUrl(mediaId: string) {
  const path = `/public/m/${mediaId}/${signMediaId(mediaId)}.jpg`;
  return { url: `${config.publicBaseUrl || 'http://localhost:' + config.port}${path}`, publicReady: Boolean(config.publicBaseUrl) && !/localhost|127\.0\.0\.1/.test(config.publicBaseUrl) };
}

/** Diagnóstico de PUBLIC_BASE_URL: los marketplaces descargan las fotos desde esa dirección. */
export function publicUrlProblem(): string | null {
  const u = config.publicBaseUrl;
  if (!u) return 'PUBLIC_BASE_URL no está configurada: las URLs de las fotos apuntan a este equipo y el marketplace no podrá descargarlas. Configura un dominio público antes de subir el archivo.';
  if (/localhost|127\.0\.0\.1|192\.168\.|10\.\d+\.|\.local\b/.test(u)) return `PUBLIC_BASE_URL (${u}) es una dirección local o de red privada: el marketplace no podrá descargar las fotos.`;
  if (!u.startsWith('https://')) return `PUBLIC_BASE_URL (${u}) no usa HTTPS; algunos marketplaces rechazan imágenes sin HTTPS.`;
  return null;
}

export async function loadExportProducts(db: DBOrTx, businessId: string, channel: string, productIds: string[]): Promise<ExportProduct[]> {
  if (!productIds.length) return [];
  const ps = await db
    .select({ p: products, categoryName: categories.name })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(eq(products.businessId, businessId), inArray(products.id, productIds)));
  if (ps.length !== new Set(productIds).size) throw badRequest('Algunos productos no pertenecen a este negocio');
  const [vs, ms, chs] = await Promise.all([
    db.select().from(variants).where(and(eq(variants.businessId, businessId), inArray(variants.productId, productIds))).orderBy(asc(variants.position)),
    db
      .select()
      .from(media)
      .where(and(eq(media.businessId, businessId), inArray(media.productId, productIds), isNull(media.deletedAt)))
      .orderBy(asc(media.position), asc(media.createdAt)),
    db
      .select()
      .from(productChannels)
      .where(and(eq(productChannels.businessId, businessId), eq(productChannels.channel, channel), inArray(productChannels.productId, productIds))),
  ]);
  const order = new Map(productIds.map((id, i) => [id, i]));
  return ps
    .sort((a, b) => order.get(a.p.id)! - order.get(b.p.id)!)
    .map(({ p, categoryName }) => {
      const ch = chs.find((c) => c.productId === p.id);
      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        brand: p.brand,
        model: p.model,
        categoryName,
        shortDescription: p.shortDescription,
        longDescription: p.longDescription,
        price: p.price !== null ? Number(p.price) : null,
        promoPrice: p.promoPrice !== null ? Number(p.promoPrice) : null,
        currency: p.currency,
        material: p.material,
        weightGrams: p.weightGrams,
        dimensions: p.dimensions,
        keywords: p.keywords,
        attributes: p.attributes,
        status: p.status,
        totalStock: p.totalStock,
        variants: vs
          .filter((v) => v.productId === p.id && v.status === 'active')
          .map((v) => ({ id: v.id, sku: v.sku, color: v.color, size: v.size, stock: v.stock, price: v.price !== null ? Number(v.price) : null, barcode: v.barcode, status: v.status })),
        images: ms
          .filter((m) => m.productId === p.id)
          .map((m) => ({ id: m.id, width: m.width, height: m.height, ...publicMediaUrl(m.id) })),
        channel: {
          externalCategoryId: ch?.externalCategoryId ?? null,
          externalCategoryName: ch?.externalCategoryName ?? null,
          attributes: ch?.attributes ?? {},
          externalId: ch?.externalId ?? null,
          status: ch?.status ?? 'none',
        },
      };
    });
}

// ───────────────────────── Plantillas oficiales ─────────────────────────

export async function uploadTemplate(db: DBOrTx, ctx: { businessId: string; userId: string }, channel: string, file: { data: Buffer; fileName: string }, name?: string) {
  const adapter = getChannel(channel);
  if (!/\.xlsx$/i.test(file.fileName)) throw badRequest('La plantilla debe ser un archivo .xlsx');
  let analysis;
  try {
    analysis = await analyzeTemplate(file.data, adapter.headerSynonyms);
  } catch (e) {
    throw badRequest((e as Error).message);
  }
  const best = analysis.best;
  const key = newKey(ctx.businessId, 'templates', '.xlsx');
  await storage().put(key, file.data);
  const mapping = autoMap(best.columns, adapter.headerSynonyms);
  const [tpl] = await db
    .insert(channelTemplates)
    .values({
      businessId: ctx.businessId,
      channel,
      name: name?.trim() || file.fileName.replace(/\.xlsx$/i, ''),
      originalName: file.fileName,
      storageKey: key,
      sheetName: best.sheetName,
      headerRow: best.headerRow,
      dataStartRow: best.dataStartRow,
      columns: best.columns,
      mapping,
    })
    .returning();
  await audit(db, { businessId: ctx.businessId, userId: ctx.userId, action: 'template.upload', entity: 'channel_template', entityId: tpl.id, details: { channel, file: file.fileName, columns: best.columns.length } });
  return { template: tpl, sheets: analysis.sheets.map((s) => ({ sheetName: s.sheetName, headerRow: s.headerRow, columns: s.columns.length })) };
}

export async function getTemplate(db: DBOrTx, businessId: string, templateId: string) {
  const [t] = await db
    .select()
    .from(channelTemplates)
    .where(and(eq(channelTemplates.businessId, businessId), eq(channelTemplates.id, templateId)));
  if (!t) throw notFound('Plantilla no encontrada');
  return t;
}

export const templatePatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  mapping: z.record(z.string(), z.string().max(300)).optional(),
  sheetName: z.string().optional(),
  headerRow: z.number().int().min(1).max(50).optional(),
  dataStartRow: z.number().int().min(2).max(60).optional(),
  externalCategoryId: z.string().max(40).nullable().optional(),
});

export async function updateTemplate(db: DBOrTx, businessId: string, templateId: string, raw: unknown) {
  const input = templatePatch.parse(raw);
  const t = await getTemplate(db, businessId, templateId);
  const set: Partial<typeof channelTemplates.$inferInsert> = { updatedAt: new Date() };
  if (input.name) set.name = input.name;
  if (input.externalCategoryId !== undefined) set.externalCategoryId = input.externalCategoryId;
  if (input.sheetName || input.headerRow || input.dataStartRow) {
    const data = await storage().get(t.storageKey);
    try {
      const a = await reanalyze(data, input.sheetName ?? t.sheetName, input.headerRow ?? t.headerRow, input.dataStartRow, getChannel(t.channel).headerSynonyms);
      set.sheetName = a.sheetName;
      set.headerRow = a.headerRow;
      set.dataStartRow = input.dataStartRow ?? a.dataStartRow;
      set.columns = a.columns;
      set.mapping = autoMap(a.columns, getChannel(t.channel).headerSynonyms);
    } catch (e) {
      throw badRequest((e as Error).message);
    }
  }
  if (input.mapping) {
    const cols = (set.columns ?? t.columns).map((c) => String(c.index));
    set.mapping = Object.fromEntries(Object.entries(input.mapping).filter(([k, v]) => cols.includes(k) && v));
  }
  const [row] = await db.update(channelTemplates).set(set).where(eq(channelTemplates.id, t.id)).returning();
  return row;
}

// ───────────────────────── Validación ─────────────────────────

export type ProductReport = { productId: string; sku: string; name: string; issues: ExportIssue[]; ok: boolean; rows: number; channelStatus: string };

export async function validateForChannel(db: DBOrTx, businessId: string, channel: string, productIds: string[], templateId?: string | null) {
  const adapter = getChannel(channel);
  const ps = await loadExportProducts(db, businessId, channel, productIds);
  const tpl = templateId ? await getTemplate(db, businessId, templateId) : null;
  if (tpl && tpl.channel !== channel) throw badRequest('La plantilla pertenece a otro canal');
  const globalIssues: ExportIssue[] = [];
  const pub = publicUrlProblem();
  if (pub) globalIssues.push({ level: 'warning', message: pub });
  if (false) {
    globalIssues.push({
      level: 'warning',
      message: 'PUBLIC_BASE_URL no está configurada: las URLs de las fotos apuntan a este equipo y el marketplace no podrá descargarlas. Configura un dominio público antes de subir el archivo.',
    });
  }
  if (tpl) {
    const unmapped = tpl.columns.filter((c) => c.required && !tpl.mapping[String(c.index)]);
    for (const c of unmapped) globalIssues.push({ level: 'error', field: c.header, message: `La columna obligatoria "${c.header}" de la plantilla no tiene un campo asignado.` });
  } else {
    globalIssues.push({ level: 'warning', message: 'Sin plantilla oficial: se generará un archivo de PREPARACIÓN que no es el formato oficial de carga.' });
  }
  const reports: ProductReport[] = [];
  for (const p of ps) {
    const issues = await adapter.validate(p);
    if (p.status === 'archived') issues.push({ level: 'error', message: 'El producto está archivado.' });
    if (!p.variants.length) issues.push({ level: 'error', message: 'El producto no tiene variantes activas.' });
    if (tpl) {
      const attrResolver = channel === 'mercadolibre' ? mlResolver : undefined;
      for (const c of tpl.columns) {
        const expr = tpl.mapping[String(c.index)];
        if (!c.required || !expr) continue;
        const missing = (p.variants.length ? p.variants : [null]).some((v) => {
          if (!v) return true;
          const val = resolveExpr(expr, p, v, { titleMax: adapter.titleMax, attrResolver });
          return val === null || val === '';
        });
        if (missing) issues.push({ level: 'error', field: c.header, message: `Columna obligatoria "${c.header}" sin valor.` });
      }
    }
    reports.push({ productId: p.id, sku: p.sku, name: p.name, issues, ok: !issues.some((i) => i.level === 'error'), rows: p.variants.length, channelStatus: p.channel.status });
  }
  const blocking = globalIssues.some((i) => i.level === 'error');
  return { channel, template: tpl ? { id: tpl.id, name: tpl.name } : null, globalIssues, blocking, reports, validCount: reports.filter((r) => r.ok).length, errorCount: reports.filter((r) => !r.ok).length };
}

const mlResolver = (id: string, p: ExportProduct, v: ExportProduct['variants'][number]) => mlAttrValue({ id, name: id }, p, v);

// ───────────────────────── Generación ─────────────────────────

/**
 * Genera el archivo solo con los productos que pasan la validación. Marca esos productos como
 * "archivo generado" — nunca como publicados: la publicación ocurre en el marketplace.
 */
export async function generateExport(db: DB, ctx: { businessId: string; userId: string }, channel: string, productIds: string[], templateId?: string | null) {
  const adapter = getChannel(channel);
  const report = await validateForChannel(db, ctx.businessId, channel, productIds, templateId);
  if (report.blocking) throw badRequest('La plantilla tiene columnas obligatorias sin asignar. Completa el mapeo.', report);
  const okIds = report.reports.filter((r) => r.ok).map((r) => r.productId);
  if (!okIds.length) throw badRequest('Ningún producto pasó la validación. Corrige los errores y vuelve a intentar.', report);
  const ps = await loadExportProducts(db, ctx.businessId, channel, okIds);
  if (channel === 'mercadolibre') {
    for (const p of ps) {
      if (!p.channel.externalCategoryId) continue;
      const cat = await mlGetCategory(p.channel.externalCategoryId).catch(() => null);
      if (cat?.settings.max_pictures_per_item) p.images = p.images.slice(0, cat.settings.max_pictures_per_item);
    }
  }
  if (channel === 'tiktok') for (const p of ps) p.images = p.images.slice(0, 9);
  const rows = ps.flatMap((p) => p.variants.map((v) => ({ p, v })));
  const opts = { titleMax: adapter.titleMax, attrResolver: channel === 'mercadolibre' ? mlResolver : undefined };
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  let buffer: Buffer;
  let format: 'official_template' | 'internal_prep';
  let fileName: string;
  if (templateId) {
    const tpl = await getTemplate(db, ctx.businessId, templateId);
    buffer = await fillTemplate(await storage().get(tpl.storageKey), tpl, rows, opts);
    format = 'official_template';
    fileName = `${channel}-${tpl.name.replace(/[^\w-]+/g, '_')}-${stamp}.xlsx`;
  } else {
    const { headers, exprs } = await adapter.prepColumns(ps);
    buffer = await writeXlsx([
      { name: 'Preparación', note: adapter.prepNote, headers, rows: rows.map(({ p, v }) => exprs.map((e) => resolveExpr(e, p, v, opts))) },
    ]);
    format = 'internal_prep';
    fileName = `${channel}-PREPARACION-no-oficial-${stamp}.xlsx`;
  }
  const key = newKey(ctx.businessId, 'exports', '.xlsx');
  await storage().put(key, buffer);
  return db.transaction(async (tx) => {
    const warningCount = report.reports.filter((r) => r.ok).reduce((s, r) => s + r.issues.length, 0) + report.globalIssues.length;
    const [exp] = await tx
      .insert(exportsTable)
      .values({ businessId: ctx.businessId, channel, templateId: templateId ?? null, format, fileKey: key, fileName, productCount: ps.length, rowCount: rows.length, warningCount, createdBy: ctx.userId })
      .returning();
    await tx.insert(exportItems).values(
      report.reports.filter((r) => r.ok).map((r) => ({ businessId: ctx.businessId, exportId: exp.id, productId: r.productId, issues: r.issues })),
    );
    for (const p of ps) {
      await tx
        .insert(productChannels)
        .values({ businessId: ctx.businessId, productId: p.id, channel, status: 'file_generated', lastExportId: exp.id })
        .onConflictDoUpdate({
          target: [productChannels.productId, productChannels.channel],
          // Un producto ya vinculado a una publicación conserva su estado "linked".
          set: { lastExportId: exp.id, updatedAt: new Date(), status: sql`CASE WHEN ${productChannels.status} = 'linked' THEN 'linked' ELSE 'file_generated' END` },
        });
    }
    await audit(tx, { businessId: ctx.businessId, userId: ctx.userId, action: 'export.generate', entity: 'export', entityId: exp.id, details: { channel, format, products: ps.length, excluded: report.errorCount } });
    return { export: exp, excluded: report.reports.filter((r) => !r.ok), report };
  });
}

export async function listExports(db: DBOrTx, businessId: string, channel?: string) {
  return db
    .select()
    .from(exportsTable)
    .where(and(eq(exportsTable.businessId, businessId), channel ? eq(exportsTable.channel, channel) : undefined))
    .orderBy(desc(exportsTable.createdAt))
    .limit(100);
}

// ───────────────────────── Datos por canal y vinculación ─────────────────────────

export const productChannelPatch = z.object({
  externalCategoryId: z.string().trim().max(40).nullable().optional(),
  externalCategoryName: z.string().trim().max(200).nullable().optional(),
  attributes: z.record(z.string(), z.string().max(500)).optional(),
  externalId: z.string().trim().max(80).nullable().optional(),
});

export async function upsertProductChannel(db: DBOrTx, businessId: string, productId: string, channel: string, raw: unknown) {
  getChannel(channel);
  const input = productChannelPatch.parse(raw);
  const [p] = await db.select({ id: products.id }).from(products).where(and(eq(products.businessId, businessId), eq(products.id, productId)));
  if (!p) throw notFound('Producto no encontrado');
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.externalCategoryId !== undefined) set.externalCategoryId = input.externalCategoryId || null;
  if (input.externalCategoryName !== undefined) set.externalCategoryName = input.externalCategoryName || null;
  if (input.attributes) set.attributes = Object.fromEntries(Object.entries(input.attributes).filter(([, v]) => v !== ''));
  if (input.externalId !== undefined) {
    set.externalId = input.externalId || null;
    if (input.externalId) set.status = 'linked';
  }
  await db
    .insert(productChannels)
    .values({ businessId, productId, channel, ...(set as object) })
    .onConflictDoUpdate({ target: [productChannels.productId, productChannels.channel], set });
  const [row] = await db.select().from(productChannels).where(and(eq(productChannels.productId, productId), eq(productChannels.channel, channel)));
  return row;
}

/**
 * Vincula SKU internos con identificadores externos (p. ej. MLM123456789) después de publicar en el marketplace.
 * Acepta SKU de producto o de variante.
 */
export async function linkExternalIds(db: DBOrTx, ctx: { businessId: string; userId: string }, channel: string, rows: { sku: string; externalId: string }[]) {
  getChannel(channel);
  let linkedProducts = 0;
  let linkedVariants = 0;
  const notFoundSkus: string[] = [];
  for (const r of rows) {
    const sku = r.sku.trim();
    const ext = r.externalId.trim();
    if (!sku || !ext) continue;
    const [p] = await db.select({ id: products.id }).from(products).where(and(eq(products.businessId, ctx.businessId), eq(products.sku, sku)));
    if (p) {
      await upsertProductChannel(db, ctx.businessId, p.id, channel, { externalId: ext });
      linkedProducts++;
      continue;
    }
    const [v] = await db
      .select({ id: variants.id, productId: variants.productId })
      .from(variants)
      .where(and(eq(variants.businessId, ctx.businessId), eq(variants.sku, sku)));
    if (v) {
      await db
        .insert(variantChannelLinks)
        .values({ businessId: ctx.businessId, variantId: v.id, channel, externalId: ext })
        .onConflictDoUpdate({ target: [variantChannelLinks.variantId, variantChannelLinks.channel], set: { externalId: ext, updatedAt: new Date() } });
      linkedVariants++;
      continue;
    }
    notFoundSkus.push(sku);
  }
  await audit(db, { businessId: ctx.businessId, userId: ctx.userId, action: 'channel.link_ids', entity: 'channel', entityId: channel, details: { linkedProducts, linkedVariants, notFound: notFoundSkus.length } });
  return { linkedProducts, linkedVariants, notFound: notFoundSkus };
}

export async function channelOverview(db: DBOrTx, businessId: string, channel: string) {
  const counts = await db
    .select({ status: productChannels.status, n: sql<number>`count(*)::int` })
    .from(productChannels)
    .where(and(eq(productChannels.businessId, businessId), eq(productChannels.channel, channel)))
    .groupBy(productChannels.status);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(products)
    .where(and(eq(products.businessId, businessId), or(eq(products.status, 'active'), eq(products.status, 'draft'))));
  const by = Object.fromEntries(counts.map((c) => [c.status, c.n]));
  return { totalProducts: total, fileGenerated: by.file_generated ?? 0, linked: by.linked ?? 0 };
}
