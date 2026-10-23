import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DBOrTx } from '../db/client';
import { businesses, products, skuCounters, variants } from '../db/schema';
import { code } from '../lib/text';

type SkuConfig = {
  skuPattern: string;
  variantSkuPattern: string;
  skuPrefix: string;
  skuSeqDigits: number;
};

export async function getSkuConfig(db: DBOrTx, businessId: string): Promise<SkuConfig> {
  const [b] = await db
    .select({
      skuPattern: businesses.skuPattern,
      variantSkuPattern: businesses.variantSkuPattern,
      skuPrefix: businesses.skuPrefix,
      skuSeqDigits: businesses.skuSeqDigits,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId));
  return b;
}

/**
 * Genera el siguiente SKU de producto según el patrón del negocio.
 * Ejemplo con "{CAT}-{SEQ}" y categoría "Pijamas": PIJ-001, PIJ-002…
 * El consecutivo vive en sku_counters (UPSERT atómico) y se salta valores ya ocupados.
 */
export async function nextProductSku(db: DBOrTx, businessId: string, categoryCode: string | null) {
  const cfg = await getSkuConfig(db, businessId);
  const cat = categoryCode ? code(categoryCode, 3) : 'PRD';
  const yy = String(new Date().getFullYear()).slice(2);
  const render = (seq: number) =>
    cfg.skuPattern
      .replaceAll('{CAT}', cat)
      .replaceAll('{PREFIX}', cfg.skuPrefix)
      .replaceAll('{YY}', yy)
      .replaceAll('{SEQ}', String(seq).padStart(cfg.skuSeqDigits, '0'))
      .replace(/^-+|-+$/g, '')
      .replace(/--+/g, '-');
  const counterKey = render(0);
  for (let attempt = 0; attempt < 50; attempt++) {
    const [row] = await db
      .insert(skuCounters)
      .values({ businessId, prefix: counterKey, value: 1 })
      .onConflictDoUpdate({ target: [skuCounters.businessId, skuCounters.prefix], set: { value: sql`${skuCounters.value} + 1` } })
      .returning({ value: skuCounters.value });
    const candidate = render(row.value);
    if (!(await skuTaken(db, businessId, candidate))) return candidate;
  }
  throw new Error('No se pudo generar un SKU único; revisa el patrón de SKU del negocio');
}

function sizeCode(size: string) {
  const c = code(size, 6);
  return c.length <= 3 ? c : c.slice(0, 2);
}

/** SKU de variante: "{SKU}-{COLOR}-{SIZE}" → PIJ-001-ROS-CH */
export function renderVariantSku(pattern: string, productSku: string, v: { color?: string | null; size?: string | null; options?: Record<string, string> }) {
  const opt = Object.values(v.options ?? {})
    .map((o) => code(o, 3))
    .join('-');
  return pattern
    .replaceAll('{SKU}', productSku)
    .replaceAll('{COLOR}', v.color ? code(v.color, 3) : '')
    .replaceAll('{SIZE}', v.size ? sizeCode(v.size) : '')
    .replaceAll('{OPT}', opt)
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function skuTaken(db: DBOrTx, businessId: string, sku: string, exceptProductId?: string) {
  const p = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.businessId, businessId), eq(products.sku, sku)))
    .limit(1);
  if (p.length && p[0].id !== exceptProductId) return true;
  const v = await db
    .select({ productId: variants.productId })
    .from(variants)
    .where(and(eq(variants.businessId, businessId), eq(variants.sku, sku)))
    .limit(1);
  return v.length > 0 && v[0].productId !== exceptProductId;
}

/** Devuelve los SKU de la lista que ya existen en variantes de otros productos del negocio. */
export async function variantSkusTaken(db: DBOrTx, businessId: string, skus: string[], exceptProductId?: string) {
  if (!skus.length) return [];
  const rows = await db
    .select({ sku: variants.sku, productId: variants.productId })
    .from(variants)
    .where(and(eq(variants.businessId, businessId), inArray(variants.sku, skus)));
  return rows.filter((r) => r.productId !== exceptProductId).map((r) => r.sku);
}
