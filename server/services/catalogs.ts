import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { DBOrTx } from '../db/client';
import { businesses, catalogs, media, products, variants } from '../db/schema';
import { badRequest, notFound } from '../lib/errors';
import { storage } from '../lib/storage';

export const catalogInput = z.object({
  title: z.string().trim().min(1).max(120),
  subtitle: z.string().max(200).optional(),
  layout: z.enum(['grid2', 'grid3', 'list']).optional(),
  showPrices: z.boolean().optional(),
  showVariants: z.boolean().optional(),
  showDescription: z.boolean().optional(),
  showSku: z.boolean().optional(),
  items: z.array(z.object({ productId: z.string().uuid(), mediaId: z.string().uuid().nullable().optional() })).max(1000).optional(),
});

export async function assertCatalogItems(db: DBOrTx, businessId: string, items: { productId: string; mediaId?: string | null }[]) {
  if (!items.length) return;
  const ids = [...new Set(items.map((i) => i.productId))];
  const owned = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.businessId, businessId), inArray(products.id, ids)));
  if (owned.length !== ids.length) throw badRequest('Algún producto no pertenece a este negocio');
  const mids = items.map((i) => i.mediaId).filter(Boolean) as string[];
  if (mids.length) {
    const ms = await db
      .select({ id: media.id, productId: media.productId })
      .from(media)
      .where(and(eq(media.businessId, businessId), inArray(media.id, mids)));
    for (const it of items) {
      if (it.mediaId && ms.find((m) => m.id === it.mediaId)?.productId !== it.productId) {
        throw badRequest('La fotografía elegida no pertenece al producto');
      }
    }
  }
}

export type CatalogEntry = {
  productId: string;
  name: string;
  sku: string | null;
  description: string;
  price: number | null;
  promoPrice: number | null;
  colors: string[];
  sizes: string[];
  inStock: boolean;
  mediaId: string | null;
  mediaKey: string | null;
};

/** Datos públicos del catálogo. Nunca incluye costos; el SKU solo si el catálogo lo permite. */
export async function buildCatalogData(db: DBOrTx, businessId: string, catalogId: string) {
  const [cat] = await db
    .select()
    .from(catalogs)
    .where(and(eq(catalogs.businessId, businessId), eq(catalogs.id, catalogId)));
  if (!cat) throw notFound('Catálogo no encontrado');
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  const ids = cat.items.map((i) => i.productId);
  const entries: CatalogEntry[] = [];
  if (ids.length) {
    const ps = await db
      .select()
      .from(products)
      .where(and(eq(products.businessId, businessId), inArray(products.id, ids)));
    const vs = await db
      .select()
      .from(variants)
      .where(and(eq(variants.businessId, businessId), inArray(variants.productId, ids)))
      .orderBy(asc(variants.position));
    const ms = await db
      .select({ id: media.id, productId: media.productId, storageKey: media.storageKey, position: media.position })
      .from(media)
      .where(and(eq(media.businessId, businessId), inArray(media.productId, ids), isNull(media.deletedAt)))
      .orderBy(asc(media.position), asc(media.createdAt));
    for (const it of cat.items) {
      const p = ps.find((x) => x.id === it.productId);
      if (!p || p.status === 'archived') continue;
      const pv = vs.filter((v) => v.productId === p.id && v.status === 'active');
      const m = (it.mediaId && ms.find((x) => x.id === it.mediaId)) || ms.find((x) => x.productId === p.id) || null;
      const variantPrices = pv.map((v) => (v.price ? Number(v.price) : null)).filter((x): x is number => x !== null);
      entries.push({
        productId: p.id,
        name: p.name,
        sku: cat.showSku ? p.sku : null,
        description: p.shortDescription || p.longDescription.slice(0, 280),
        price: p.price ? Number(p.price) : variantPrices.length ? Math.min(...variantPrices) : null,
        promoPrice: p.promoPrice ? Number(p.promoPrice) : null,
        colors: [...new Set(pv.map((v) => v.color).filter(Boolean) as string[])],
        sizes: [...new Set(pv.map((v) => v.size).filter(Boolean) as string[])],
        inStock: p.totalStock > 0,
        mediaId: m?.id ?? null,
        mediaKey: m?.storageKey ?? null,
      });
    }
  }
  return { catalog: cat, business: biz, entries };
}

export function formatMoney(n: number, currency: string, locale: string) {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
  } catch {
    return `$${n.toFixed(2)} ${currency}`;
  }
}

async function pdfImage(key: string, box: number) {
  try {
    const buf = await storage().get(key);
    return await sharp(buf).resize({ width: box * 2, height: box * 2, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toBuffer();
  } catch {
    return null;
  }
}

export async function renderCatalogPdf(data: Awaited<ReturnType<typeof buildCatalogData>>): Promise<Buffer> {
  const { catalog, business, entries } = data;
  const doc = new PDFDocument({ size: 'LETTER', margin: 40, bufferPages: true, info: { Title: catalog.title, Author: business.name } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const primary = business.primaryColor || '#4f46e5';
  const dark = business.secondaryColor || '#0f172a';
  const W = doc.page.width;
  const H = doc.page.height;
  const M = 40;

  // Portada
  doc.rect(0, 0, W, H).fill('#ffffff');
  doc.rect(0, 0, W, 12).fill(primary);
  let y = 150;
  if (business.logoKey) {
    const logo = await pdfImage(business.logoKey, 160);
    if (logo) {
      doc.image(logo, (W - 160) / 2, y, { fit: [160, 120], align: 'center', valign: 'center' });
      y += 140;
    }
  }
  doc.fillColor(dark).font('Helvetica-Bold').fontSize(30).text(business.name, M, y, { width: W - 2 * M, align: 'center' });
  doc.moveDown(0.6).font('Helvetica').fontSize(20).fillColor(primary).text(catalog.title, { width: W - 2 * M, align: 'center' });
  if (catalog.subtitle) doc.moveDown(0.4).fontSize(13).fillColor('#475569').text(catalog.subtitle, { width: W - 2 * M, align: 'center' });
  doc
    .fontSize(10)
    .fillColor('#64748b')
    .text(new Date().toLocaleDateString(business.locale, { year: 'numeric', month: 'long', day: 'numeric' }), M, H - 90, { width: W - 2 * M, align: 'center' });
  if (!catalog.showPrices) doc.text('Precios disponibles bajo solicitud', { width: W - 2 * M, align: 'center' });

  const cols = catalog.layout === 'grid3' ? 3 : catalog.layout === 'grid2' ? 2 : 1;
  const rowsPerPage = catalog.layout === 'grid3' ? 3 : catalog.layout === 'grid2' ? 2 : 4;
  const perPage = cols * rowsPerPage;
  const top = M + 24;
  const gap = 16;
  const cellW = (W - 2 * M - gap * (cols - 1)) / cols;
  const cellH = (H - top - M - 20 - gap * (rowsPerPage - 1)) / rowsPerPage;

  for (let i = 0; i < entries.length; i++) {
    if (i % perPage === 0) {
      doc.addPage();
      doc.rect(0, 0, W, 6).fill(primary);
      doc.fillColor(dark).font('Helvetica-Bold').fontSize(10).text(business.name, M, M - 14, { width: W / 2 });
      doc.font('Helvetica').fillColor('#64748b').text(catalog.title, W / 2, M - 14, { width: W / 2 - M, align: 'right' });
    }
    const e = entries[i];
    const k = i % perPage;
    const cx = M + (k % cols) * (cellW + gap);
    const cy = top + Math.floor(k / cols) * (cellH + gap);
    doc.roundedRect(cx, cy, cellW, cellH, 6).lineWidth(0.6).strokeColor('#e2e8f0').stroke();
    const list = cols === 1;
    const imgBox = list ? Math.min(cellH - 16, 150) : Math.min(cellW - 16, cellH * 0.58);
    const imgX = list ? cx + 8 : cx + (cellW - imgBox) / 2;
    const imgY = cy + 8;
    if (e.mediaKey) {
      const img = await pdfImage(e.mediaKey, Math.round(imgBox));
      if (img) doc.image(img, imgX, imgY, { fit: [imgBox, imgBox], align: 'center', valign: 'center' });
    } else {
      doc.rect(imgX, imgY, imgBox, imgBox).fill('#f1f5f9');
      doc.fillColor('#94a3b8').fontSize(9).text('Sin foto', imgX, imgY + imgBox / 2 - 5, { width: imgBox, align: 'center' });
    }
    const tx = list ? imgX + imgBox + 14 : cx + 10;
    const tw = list ? cx + cellW - tx - 10 : cellW - 20;
    let ty = list ? cy + 12 : imgY + imgBox + 8;
    const maxY = cy + cellH - 8;
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(cols === 3 ? 9.5 : 11).text(e.name, tx, ty, { width: tw, height: 28, ellipsis: true });
    ty = doc.y + 2;
    if (e.sku) {
      doc.font('Helvetica').fontSize(7.5).fillColor('#94a3b8').text(`SKU ${e.sku}`, tx, ty, { width: tw });
      ty = doc.y + 1;
    }
    if (catalog.showPrices && e.price !== null) {
      const cur = business.currency;
      if (e.promoPrice !== null && e.promoPrice < e.price) {
        doc.font('Helvetica-Bold').fontSize(cols === 3 ? 10 : 12).fillColor(primary).text(formatMoney(e.promoPrice, cur, business.locale), tx, ty, { continued: true, width: tw });
        doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text(`  antes ${formatMoney(e.price, cur, business.locale)}`, { strike: true });
      } else {
        doc.font('Helvetica-Bold').fontSize(cols === 3 ? 10 : 12).fillColor(primary).text(formatMoney(e.price, cur, business.locale), tx, ty, { width: tw });
      }
      ty = doc.y + 2;
    }
    if (catalog.showVariants && (e.colors.length || e.sizes.length) && ty < maxY - 10) {
      doc.font('Helvetica').fontSize(7.5).fillColor('#475569');
      if (e.colors.length) doc.text(`Colores: ${e.colors.join(', ')}`, tx, ty, { width: tw, height: 20, ellipsis: true });
      if (e.sizes.length) doc.text(`Tallas: ${e.sizes.join(', ')}`, tx, doc.y, { width: tw, height: 20, ellipsis: true });
      ty = doc.y + 2;
    }
    if (!e.inStock && ty < maxY - 10) {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#b91c1c').text('Agotado', tx, ty, { width: tw });
      ty = doc.y + 2;
    }
    if (catalog.showDescription && e.description && ty < maxY - 12) {
      doc.font('Helvetica').fontSize(7.5).fillColor('#64748b').text(e.description, tx, ty, { width: tw, height: maxY - ty, ellipsis: true });
    }
  }
  if (!entries.length) {
    doc.addPage();
    doc.fillColor('#64748b').fontSize(12).text('Este catálogo todavía no tiene productos.', M, H / 2, { width: W - 2 * M, align: 'center' });
  }
  const range = doc.bufferedPageRange();
  for (let p = range.start + 1; p < range.start + range.count; p++) {
    doc.switchToPage(p);
    doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text(`${p} / ${range.count - 1}`, M, H - M + 8, { width: W - 2 * M, align: 'center', lineBreak: false });
  }
  doc.end();
  return done;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderCatalogHtml(data: Awaited<ReturnType<typeof buildCatalogData>>, token: string) {
  const { catalog, business, entries } = data;
  const cols = catalog.layout === 'grid3' ? 3 : catalog.layout === 'grid2' ? 2 : 1;
  const money = (n: number) => esc(formatMoney(n, business.currency, business.locale));
  const cards = entries
    .map((e) => {
      const price =
        catalog.showPrices && e.price !== null
          ? e.promoPrice !== null && e.promoPrice < e.price
            ? `<p class="price">${money(e.promoPrice)} <s>${money(e.price)}</s></p>`
            : `<p class="price">${money(e.price)}</p>`
          : '';
      const vars =
        catalog.showVariants && (e.colors.length || e.sizes.length)
          ? `<p class="vars">${e.colors.length ? `Colores: ${esc(e.colors.join(', '))}` : ''}${e.colors.length && e.sizes.length ? '<br>' : ''}${e.sizes.length ? `Tallas: ${esc(e.sizes.join(', '))}` : ''}</p>`
          : '';
      return `<article class="card">
        ${e.mediaId ? `<img loading="lazy" src="/public/c/${token}/img/${e.mediaId}" alt="${esc(e.name)}">` : '<div class="noimg">Sin foto</div>'}
        <div class="body"><h2>${esc(e.name)}</h2>${e.sku ? `<p class="sku">SKU ${esc(e.sku)}</p>` : ''}${price}${vars}
        ${!e.inStock ? '<p class="out">Agotado</p>' : ''}
        ${catalog.showDescription && e.description ? `<p class="desc">${esc(e.description)}</p>` : ''}</div>
      </article>`;
    })
    .join('\n');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(catalog.title)} · ${esc(business.name)}</title>
<style>
:root{--p:${esc(business.primaryColor)};--d:${esc(business.secondaryColor)}}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;color:var(--d)}
header{background:#fff;border-top:6px solid var(--p);padding:32px 16px;text-align:center;border-bottom:1px solid #e2e8f0}
header img{max-height:80px;max-width:200px;margin-bottom:8px}h1{margin:4px 0;font-size:28px}header p{margin:4px 0;color:#64748b}
.actions{margin-top:12px}.actions a{display:inline-block;background:var(--p);color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px}
main{max-width:1100px;margin:24px auto;padding:0 16px;display:grid;gap:16px;grid-template-columns:repeat(${cols},minmax(0,1fr))}
@media(max-width:700px){main{grid-template-columns:repeat(${Math.min(cols, 2)},minmax(0,1fr))}}
@media(max-width:420px){main{grid-template-columns:1fr}}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;display:flex;flex-direction:${cols === 1 ? 'row' : 'column'}}
.card img,.noimg{width:${cols === 1 ? '180px' : '100%'};aspect-ratio:1;object-fit:contain;background:#f1f5f9;flex-shrink:0}
.noimg{display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:14px}
.body{padding:12px 14px}h2{font-size:16px;margin:0 0 4px}.price{color:var(--p);font-weight:700;font-size:17px;margin:4px 0}.price s{color:#94a3b8;font-weight:400;font-size:13px}
.vars,.desc,.sku{font-size:13px;color:#475569;margin:4px 0}.sku{color:#94a3b8}.out{color:#b91c1c;font-weight:600;font-size:13px;margin:4px 0}
footer{text-align:center;color:#94a3b8;font-size:12px;padding:24px}
</style></head><body>
<header>${business.logoKey ? `<img src="/public/c/${token}/logo" alt="${esc(business.name)}">` : ''}
<h1>${esc(business.name)}</h1><p><strong>${esc(catalog.title)}</strong></p>${catalog.subtitle ? `<p>${esc(catalog.subtitle)}</p>` : ''}
<div class="actions"><a href="/public/c/${token}/pdf">Descargar PDF</a></div></header>
<main>${cards || '<p>Este catálogo todavía no tiene productos.</p>'}</main>
<footer>${esc(business.name)}</footer></body></html>`;
}
