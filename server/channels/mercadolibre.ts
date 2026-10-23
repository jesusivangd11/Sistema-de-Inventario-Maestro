import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { externalCategoryCache, type ExportIssue } from '../db/schema';
import { normalizeKey } from '../lib/text';
import type { ChannelAdapter, ExportProduct, ExportVariant } from './types';

/*
 * Mercado Libre México (sitio MLM).
 * Fuente oficial usada para validar: API pública https://api.mercadolibre.com
 *   - /sites/MLM/domain_discovery/search  → predicción de categoría
 *   - /categories/{id}                     → settings (max_title_length, max_pictures_per_item, minimum_price…)
 *   - /categories/{id}/attributes          → atributos y etiquetas (required, allow_variations, conditional_required…)
 * Requisitos de imagen: documentación oficial "Trabajar con imágenes" (JPG/PNG, mínimo 500×500 px,
 * recomendado 1200×1200, máximo 10 MB).
 */

const API = 'https://api.mercadolibre.com';
const CACHE_DAYS = 7;

export type MlAttribute = {
  id: string;
  name: string;
  value_type: string;
  tags: Record<string, boolean>;
  values?: { id: string; name: string }[];
  hint?: string;
};
export type MlCategory = {
  id: string;
  name: string;
  path: string[];
  settings: {
    max_title_length?: number;
    max_pictures_per_item?: number;
    max_variations_allowed?: number;
    minimum_price?: number;
    currencies?: string[];
    listing_allowed?: boolean;
    stock?: string;
  };
  attributes: MlAttribute[];
};

type Fetcher = (url: string) => Promise<unknown>;
let fetcher: Fetcher = async (url) => {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'CatalogoMaestro/0.1' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Mercado Libre respondió ${res.status} para ${url.replace(API, '')}`);
  return res.json();
};
/** Permite a las pruebas usar respuestas oficiales guardadas en tests/fixtures. */
export function setMlFetcher(f: Fetcher) {
  fetcher = f;
}

export async function mlSuggestCategory(q: string) {
  const data = (await fetcher(`${API}/sites/MLM/domain_discovery/search?limit=6&q=${encodeURIComponent(q)}`)) as {
    category_id: string;
    category_name: string;
    domain_name: string;
  }[];
  return data.map((d) => ({ categoryId: d.category_id, categoryName: d.category_name, domainName: d.domain_name }));
}

export async function mlGetCategory(categoryId: string, opts: { refresh?: boolean } = {}): Promise<MlCategory> {
  if (!/^MLM\d+$/.test(categoryId)) throw new Error(`ID de categoría de Mercado Libre inválido: ${categoryId}`);
  const db = getDb();
  if (!opts.refresh) {
    const [c] = await db
      .select()
      .from(externalCategoryCache)
      .where(
        and(
          eq(externalCategoryCache.channel, 'mercadolibre'),
          eq(externalCategoryCache.categoryId, categoryId),
          sql`${externalCategoryCache.fetchedAt} > now() - make_interval(days => ${CACHE_DAYS})`,
        ),
      );
    if (c) return c.data as unknown as MlCategory;
  }
  const [cat, attrs] = (await Promise.all([fetcher(`${API}/categories/${categoryId}`), fetcher(`${API}/categories/${categoryId}/attributes`)])) as [
    { id: string; name: string; path_from_root?: { name: string }[]; settings: MlCategory['settings'] },
    MlAttribute[],
  ];
  const data: MlCategory = {
    id: cat.id,
    name: cat.name,
    path: (cat.path_from_root ?? []).map((p) => p.name),
    settings: cat.settings,
    attributes: attrs.map((a) => ({ id: a.id, name: a.name, value_type: a.value_type, tags: a.tags ?? {}, values: (a.values ?? []).slice(0, 200).map((v) => ({ id: v.id, name: v.name })), hint: a.hint })),
  };
  await db
    .insert(externalCategoryCache)
    .values({ channel: 'mercadolibre', categoryId, data: data as unknown as Record<string, unknown> })
    .onConflictDoUpdate({ target: [externalCategoryCache.channel, externalCategoryCache.categoryId], set: { data: data as unknown as Record<string, unknown>, fetchedAt: new Date() } });
  return data;
}

/** Atributos que el vendedor debe capturar (oculta los de solo lectura/ocultos). */
export function mlRelevantAttributes(cat: MlCategory) {
  return cat.attributes.filter((a) => !a.tags.hidden && !a.tags.read_only && (a.tags.required || a.tags.catalog_required || a.tags.conditional_required || a.tags.allow_variations));
}

const FIELD_FOR_ATTR: Record<string, (p: ExportProduct, v?: ExportVariant) => string | null> = {
  BRAND: (p) => p.brand,
  MODEL: (p) => p.model,
  COLOR: (_p, v) => v?.color ?? null,
  SIZE: (_p, v) => v?.size ?? null,
  GTIN: (_p, v) => v?.barcode ?? null,
  SELLER_SKU: (p, v) => v?.sku ?? p.sku,
  MATERIAL: (p) => p.material,
  MAIN_MATERIAL: (p) => p.material,
  COMPOSITION: (p) => p.material,
};

export function mlAttrValue(attr: { id: string; name: string }, p: ExportProduct, v?: ExportVariant) {
  if (p.channel.attributes[attr.id]) return p.channel.attributes[attr.id];
  const f = FIELD_FOR_ATTR[attr.id]?.(p, v);
  if (f) return f;
  const key = Object.keys(p.attributes).find((k) => normalizeKey(k) === normalizeKey(attr.name) || k.toUpperCase() === attr.id);
  return key ? String(p.attributes[key]) : null;
}

export const mercadolibre: ChannelAdapter = {
  id: 'mercadolibre',
  name: 'Mercado Libre',
  market: 'México (MLM)',
  titleMax: 60,
  verification: {
    verified: [
      'Atributos obligatorios, atributos de variación y límites de cada categoría (título, fotos, precio mínimo, variaciones) se consultan en vivo en la API pública oficial de Mercado Libre.',
      'Requisitos de imagen según la documentación oficial para desarrolladores: JPG/PNG, mínimo 500×500 px, recomendado 1200×1200 px.',
      'Predicción de categoría mediante el servicio oficial domain_discovery.',
    ],
    unverified: [
      'La estructura de columnas de la plantilla Excel de carga masiva varía por categoría y solo se obtiene desde tu cuenta de vendedor: el sistema la lee de la plantilla que subas; no se asume un formato fijo.',
      'Publicación directa, actualización de precio/stock y consulta de estado por API: pendiente (requiere app registrada y autorización OAuth de tu cuenta).',
    ],
    sources: [
      { label: 'API pública de categorías (MLM)', url: 'https://api.mercadolibre.com/sites/MLM/categories' },
      { label: 'Desarrolladores: atributos', url: 'https://developers.mercadolibre.com.mx/es_ar/atributos' },
      { label: 'Desarrolladores: trabajar con imágenes', url: 'https://developers.mercadolibre.com.mx/es_ar/trabajar-con-imagenes' },
    ],
  },
  capabilities: [
    { key: 'file', label: 'Archivo de carga masiva (plantilla oficial)', status: 'available' },
    { key: 'validate', label: 'Validación contra la API oficial de categorías', status: 'available' },
    { key: 'link', label: 'Vincular SKU con ID de publicación', status: 'available' },
    { key: 'api_publish', label: 'Publicar directamente por API', status: 'pending', note: 'Requiere registrar una app en developers.mercadolibre.com.mx y autorizar tu cuenta (OAuth).' },
    { key: 'api_stock', label: 'Sincronizar existencias y precios', status: 'pending', note: 'Depende de la integración OAuth.' },
    { key: 'api_status', label: 'Consultar estado de publicaciones', status: 'pending', note: 'Depende de la integración OAuth.' },
  ],
  headerSynonyms: {
    'variant.salePrice': ['precio promocional', 'precio de oferta', 'precio con descuento', 'sale price', 'special price', 'precio especial'],
    'product.title': ['título', 'titulo', 'title', 'título de la publicación', 'titulo de la publicacion'],
    'product.description': ['descripción', 'descripcion', 'description'],
    'variant.sku': ['sku', 'sku del vendedor', 'seller sku', 'código del vendedor', 'codigo de vendedor'],
    'variant.price': ['precio', 'price', 'precio de venta'],
    'variant.stock': ['cantidad', 'stock', 'cantidad disponible', 'available quantity', 'unidades disponibles'],
    'product.brand': ['marca', 'brand'],
    'product.model': ['modelo', 'model'],
    'variant.color': ['color'],
    'variant.size': ['talla', 'talle', 'size'],
    'variant.barcode': ['código universal de producto', 'codigo universal de producto', 'gtin', 'ean', 'upc', 'código de barras'],
    'product.currency': ['moneda', 'currency'],
    'const:Nuevo': ['condición', 'condicion', 'condition'],
    'images:all': ['fotos', 'imágenes', 'imagenes', 'pictures'],
    'image:auto': ['foto…', 'imagen…', 'picture…', 'url foto…', 'url de la imagen…'],
    'product.externalCategoryId': ['categoría', 'categoria', 'id de categoría', 'category id'],
  },
  async validate(p) {
    const issues: ExportIssue[] = [];
    const title = p.channel.attributes.__title || p.name;
    if (!p.channel.externalCategoryId) {
      issues.push({ level: 'error', field: 'categoría', message: 'Asigna una categoría de Mercado Libre (puedes usar la sugerencia oficial).' });
    }
    if (!p.images.length) issues.push({ level: 'error', field: 'fotos', message: 'Mercado Libre requiere al menos una fotografía.' });
    for (const img of p.images) {
      if (img.width < 500 || img.height < 500) {
        issues.push({ level: 'error', field: 'fotos', message: `Foto de ${img.width}×${img.height} px: el mínimo oficial es 500×500 px.` });
      } else if (img.width < 1200 && img.height < 1200) {
        issues.push({ level: 'warning', field: 'fotos', message: `Foto de ${img.width}×${img.height} px: se recomienda 1200×1200 px para zoom.` });
      }
    }
    const price = p.price ?? Math.min(...p.variants.map((v) => v.price ?? Infinity));
    if (!Number.isFinite(price)) issues.push({ level: 'error', field: 'precio', message: 'Falta el precio.' });
    if (p.totalStock <= 0) issues.push({ level: 'error', field: 'existencias', message: 'Mercado Libre requiere existencias disponibles (todas las variantes están en 0).' });
    else if (p.variants.some((v) => v.stock <= 0)) issues.push({ level: 'warning', field: 'existencias', message: 'Hay variantes sin existencias.' });
    if (!p.channel.externalCategoryId) {
      if (title.length > 60) issues.push({ level: 'warning', field: 'título', message: `El título tiene ${title.length} caracteres; la mayoría de categorías permite 60.` });
      return issues;
    }
    let cat: MlCategory;
    try {
      cat = await mlGetCategory(p.channel.externalCategoryId);
    } catch (e) {
      issues.push({ level: 'warning', field: 'categoría', message: `No se pudieron verificar los requisitos oficiales de la categoría: ${(e as Error).message}` });
      return issues;
    }
    const s = cat.settings;
    if (s.listing_allowed === false) issues.push({ level: 'error', field: 'categoría', message: `La categoría ${cat.name} no permite publicar; elige una subcategoría más específica.` });
    if (s.max_title_length && title.length > s.max_title_length) {
      issues.push({ level: 'error', field: 'título', message: `El título tiene ${title.length} caracteres; el máximo de la categoría es ${s.max_title_length}.` });
    }
    if (s.minimum_price && Number.isFinite(price) && price < s.minimum_price) {
      issues.push({ level: 'error', field: 'precio', message: `El precio ${price} es menor al mínimo de la categoría (${s.minimum_price} MXN).` });
    }
    if (s.max_pictures_per_item && p.images.length > s.max_pictures_per_item) {
      issues.push({ level: 'warning', field: 'fotos', message: `Se exportarán solo las primeras ${s.max_pictures_per_item} fotos (máximo de la categoría).` });
    }
    if (s.max_variations_allowed && p.variants.length > s.max_variations_allowed) {
      issues.push({ level: 'error', field: 'variantes', message: `Tiene ${p.variants.length} variantes; el máximo es ${s.max_variations_allowed}.` });
    }
    const variantAttrIds = new Set(cat.attributes.filter((a) => a.tags.allow_variations).map((a) => a.id));
    for (const a of cat.attributes) {
      if (a.tags.hidden || a.tags.read_only) continue;
      const perVariant = variantAttrIds.has(a.id) && p.variants.length > 0;
      const values = perVariant ? p.variants.map((v) => mlAttrValue(a, p, v)) : [mlAttrValue(a, p)];
      const missing = values.some((v) => !v);
      if (a.tags.required && missing) {
        const opts = a.values?.length ? ` Valores oficiales: ${a.values.slice(0, 8).map((v) => v.name).join(', ')}${a.values.length > 8 ? '…' : ''}` : '';
        issues.push({ level: 'error', field: a.id, message: `Atributo obligatorio "${a.name}" sin valor${perVariant ? ' en alguna variante' : ''}.${opts}` });
      } else if (a.tags.conditional_required && missing) {
        issues.push({ level: 'warning', field: a.id, message: `"${a.name}" es obligatorio de forma condicional (p. ej. si el producto tiene código universal). Revísalo.` });
      }
      if (a.value_type === 'list' && a.values?.length) {
        for (const v of values) {
          if (v && !a.values.some((x) => normalizeKey(x.name) === normalizeKey(v))) {
            issues.push({ level: 'warning', field: a.id, message: `"${v}" no está en la lista oficial de "${a.name}".` });
            break;
          }
        }
      }
    }
    return issues;
  },
  prepNote:
    'ARCHIVO DE PREPARACIÓN — NO es la plantilla oficial de carga masiva de Mercado Libre. Sube la plantilla oficial descargada desde tu cuenta para generar el archivo final, o copia estos datos a ella.',
  async prepColumns(products) {
    const headers = ['SKU producto', 'SKU variante', 'Título', 'ID categoría ML', 'Categoría ML', 'Precio', 'Moneda', 'Existencias', 'Color', 'Talla', 'Código universal (GTIN)', 'Marca', 'Modelo', 'Descripción', 'Condición'];
    const exprs = ['product.sku', 'variant.sku', 'product.title', 'product.externalCategoryId', 'product.externalCategoryName', 'variant.price', 'product.currency', 'variant.stock', 'variant.color', 'variant.size', 'variant.barcode', 'product.brand', 'product.model', 'product.description', 'const:Nuevo'];
    const attrIds = new Map<string, string>();
    for (const p of products) {
      if (!p.channel.externalCategoryId) continue;
      try {
        const cat = await mlGetCategory(p.channel.externalCategoryId);
        for (const a of mlRelevantAttributes(cat)) if (!['BRAND', 'MODEL', 'COLOR', 'SIZE', 'GTIN', 'SELLER_SKU'].includes(a.id)) attrIds.set(a.id, a.name);
      } catch {
        /* sin conexión: se omiten columnas de atributos */
      }
    }
    for (const [id, name] of attrIds) {
      headers.push(`${name} [${id}]`);
      exprs.push(`attr:${id}`);
    }
    const maxImg = Math.min(12, Math.max(1, ...products.map((p) => p.images.length)));
    for (let i = 1; i <= maxImg; i++) {
      headers.push(`Foto ${i} (URL)`);
      exprs.push(`image:${i}`);
    }
    return { headers, exprs };
  },
};
