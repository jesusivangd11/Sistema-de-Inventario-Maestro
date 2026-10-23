import type { ExportIssue } from '../db/schema';
import type { ChannelAdapter } from './types';

/*
 * TikTok Shop México.
 * TikTok Shop entrega una plantilla de carga masiva por categoría desde Seller Center
 * (Productos → Herramientas por lote → Carga masiva). Este adaptador NO reutiliza la plantilla
 * de Mercado Libre: las columnas obligatorias se leen de la plantilla oficial que sube el usuario.
 * Las reglas adicionales que no se pudieron contrastar con documentación oficial accesible se
 * reportan como advertencias y se identifican como "no verificadas".
 */

export const tiktok: ChannelAdapter = {
  id: 'tiktok',
  name: 'TikTok Shop',
  market: 'México',
  verification: {
    verified: [
      'Columnas y campos obligatorios: se detectan directamente de la plantilla oficial por categoría que descargas de Seller Center y subes al sistema.',
    ],
    unverified: [
      'La documentación oficial de TikTok Shop (Partner Center / Seller University) no fue accesible para verificación automática; las reglas de tamaño de imagen y longitud de título se muestran como advertencias, no como errores.',
      'Publicación y sincronización por API: pendiente (requiere app aprobada en TikTok Shop Partner Center y autorización de la tienda).',
    ],
    sources: [
      { label: 'TikTok Shop Seller Center México', url: 'https://seller-mx.tiktok.com/' },
      { label: 'TikTok Shop Partner Center (API)', url: 'https://partner.tiktokshop.com/docv2' },
    ],
  },
  capabilities: [
    { key: 'file', label: 'Archivo de carga masiva (plantilla oficial)', status: 'available' },
    { key: 'link', label: 'Vincular SKU con ID de producto de TikTok', status: 'available' },
    { key: 'api_publish', label: 'Publicar directamente por API', status: 'pending', note: 'Requiere app en TikTok Shop Partner Center, aprobación y autorización de la tienda.' },
    { key: 'api_stock', label: 'Sincronizar existencias y precios', status: 'pending', note: 'Depende de la integración por API.' },
  ],
  headerSynonyms: {
    'variant.salePrice': ['precio promocional', 'precio de oferta', 'precio con descuento', 'sale price', 'special price', 'precio especial'],
    'product.title': ['product name', 'nombre del producto', 'título del producto', 'titulo del producto', 'product title', 'nombre de producto'],
    'product.description': ['product description', 'descripción del producto', 'descripcion del producto', 'description', 'descripción'],
    'product.externalCategoryId': ['category', 'categoría', 'categoria', 'category id'],
    'product.brand': ['brand', 'marca'],
    'variant.sku': ['seller sku', 'sku del vendedor', 'sku'],
    'variant.price': ['price', 'precio', 'retail price', 'precio de venta', 'precio minorista'],
    'variant.stock': ['quantity', 'cantidad', 'stock', 'inventario', 'existencias'],
    'variant.color': ['color', 'colour', 'variation 1 value', 'valor de variación 1', 'valor de variacion 1'],
    'variant.size': ['size', 'talla', 'variation 2 value', 'valor de variación 2', 'valor de variacion 2'],
    'variant.barcode': ['gtin', 'ean', 'upc', 'código de barras', 'codigo de barras', 'identifier code'],
    'product.weightKg': ['package weight', 'peso del paquete', 'peso del paquete (kg)', 'weight (kg)', 'parcel weight'],
    'dim.length': ['package length', 'largo del paquete', 'length (cm)', 'longitud'],
    'dim.width': ['package width', 'ancho del paquete', 'width (cm)'],
    'dim.height': ['package height', 'alto del paquete', 'height (cm)'],
    'image:1': ['main image', 'imagen principal', 'product image 1', 'main product image'],
    'image:auto': ['image…', 'imagen…', 'product image…', 'imagen del producto…'],
    'product.sku': ['parent sku', 'sku principal', 'product id', 'id del producto principal'],
  },
  async validate(p) {
    const issues: ExportIssue[] = [];
    if (!p.images.length) issues.push({ level: 'error', field: 'fotos', message: 'Se requiere al menos una fotografía.' });
    if (p.price === null && p.variants.every((v) => v.price === null)) issues.push({ level: 'error', field: 'precio', message: 'Falta el precio.' });
    if (!p.longDescription && !p.shortDescription) issues.push({ level: 'error', field: 'descripción', message: 'TikTok Shop requiere descripción del producto.' });
    if (p.weightGrams === null) issues.push({ level: 'warning', field: 'peso', message: 'Sin peso del paquete: normalmente es obligatorio para envíos. Verifícalo en la plantilla.' });
    for (const img of p.images) {
      if (img.width < 600 || img.height < 600) {
        issues.push({ level: 'warning', field: 'fotos', message: `Foto de ${img.width}×${img.height} px: se recomienda al menos 600×600 px (regla no verificada con documentación oficial).` });
        break;
      }
    }
    if (p.images.length > 9) issues.push({ level: 'warning', field: 'fotos', message: 'Se exportarán solo las primeras 9 fotos (límite reportado; no verificado).' });
    if (p.totalStock <= 0) issues.push({ level: 'warning', field: 'existencias', message: 'Todas las variantes están sin existencias.' });
    return issues;
  },
  prepNote:
    'ARCHIVO DE PREPARACIÓN — NO es la plantilla oficial de TikTok Shop. Descarga la plantilla de tu categoría en Seller Center (Carga masiva) y súbela al sistema para generar el archivo final.',
  async prepColumns(products) {
    const headers = ['SKU producto', 'Seller SKU', 'Nombre del producto', 'Categoría', 'Marca', 'Descripción', 'Precio', 'Existencias', 'Color', 'Talla', 'Código de barras', 'Peso (kg)', 'Largo (cm)', 'Ancho (cm)', 'Alto (cm)'];
    const exprs = ['product.sku', 'variant.sku', 'product.title', 'product.externalCategoryName', 'product.brand', 'product.description', 'variant.price', 'variant.stock', 'variant.color', 'variant.size', 'variant.barcode', 'product.weightKg', 'dim.length', 'dim.width', 'dim.height'];
    const maxImg = Math.min(9, Math.max(1, ...products.map((p) => p.images.length)));
    for (let i = 1; i <= maxImg; i++) {
      headers.push(`Imagen ${i} (URL)`);
      exprs.push(`image:${i}`);
    }
    return { headers, exprs };
  },
};
