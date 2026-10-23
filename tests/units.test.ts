import { describe, expect, it } from 'vitest';
import { renderVariantSku } from '../server/services/sku';
import { groupPhotos } from '../server/services/media';
import { applySuggestion } from '../server/ai/worker';
import { detectMapping } from '../server/services/imports';
import { autoMap, resolveExpr } from '../server/channels/template';
import { mercadolibre } from '../server/channels/mercadolibre';
import { tiktok } from '../server/channels/tiktok';
import { dHash, hamming } from '../server/lib/images';
import { testImage } from './helpers';

describe('SKU', () => {
  it('genera SKU de variante con el patrón configurable', () => {
    expect(renderVariantSku('{SKU}-{COLOR}-{SIZE}', 'PIJ-001', { color: 'Rosa', size: 'Chica' })).toBe('PIJ-001-ROS-CH');
    expect(renderVariantSku('{SKU}-{COLOR}-{SIZE}', 'PIJ-001', { color: 'Negra', size: 'Mediana' })).toBe('PIJ-001-NEG-ME');
    expect(renderVariantSku('{SKU}-{COLOR}-{SIZE}', 'FAJ-010', { color: 'Beige', size: 'XL' })).toBe('FAJ-010-BEI-XL');
    expect(renderVariantSku('{SKU}-{SIZE}', 'BOL-003', { size: 'Única' })).toBe('BOL-003-UN');
    expect(renderVariantSku('{SKU}-{COLOR}-{SIZE}', 'X-1', { color: null, size: 'M' })).toBe('X-1-M');
  });
});

describe('Agrupación de fotos sin IA', () => {
  it('agrupa por nombre de archivo y separa productos distintos', () => {
    const g = groupPhotos([
      { id: '1', originalName: 'blusa-roja_1.jpg', phash: '0000000000000000' },
      { id: '2', originalName: 'blusa-roja_2.jpg', phash: 'ffffffffffffffff' },
      { id: '3', originalName: 'falda (1).jpg', phash: '0f0f0f0f0f0f0f0f' },
      { id: '4', originalName: 'falda (2).jpg', phash: '0f0f0f0f0f0f0f0f' },
      { id: '5', originalName: 'bolsa.png', phash: '1234123412341234' },
    ]);
    expect(g.map((x) => x.ids)).toEqual([['1', '2'], ['3', '4'], ['5']]);
  });
  it('fotos de cámara se agrupan solo si son visualmente muy parecidas', async () => {
    const a = await dHash(await testImage(1));
    const b = await dHash(await testImage(2));
    expect(hamming(a, a)).toBe(0);
    expect(hamming(a, b)).toBeGreaterThan(12);
    const g = groupPhotos([
      { id: 'a', originalName: 'IMG_001.jpg', phash: a },
      { id: 'a2', originalName: 'IMG_002.jpg', phash: a },
      { id: 'b', originalName: 'IMG_003.jpg', phash: b },
    ]);
    expect(g.map((x) => x.ids)).toEqual([['a', 'a2'], ['b']]);
  });
});

describe('Reglas de la IA', () => {
  it('nunca sobrescribe datos del usuario y marca todo lo sugerido para revisión', () => {
    const { data, fieldMeta } = applySuggestion(
      { name: 'Nombre del usuario', price: 100 },
      { name: { source: 'user' }, price: { source: 'user' } },
      {
        name: 'Nombre IA',
        categoryName: 'Blusas',
        shortDescription: 'Blusa de manga larga.',
        brandVisible: null,
        materialOnLabel: '95% algodón 5% elastano',
        colors: ['Rojo'],
        attributes: [{ key: 'manga', value: 'larga', basis: 'visible' }],
        uncertain: ['categoryName'],
      },
    );
    expect(data.name).toBe('Nombre del usuario');
    expect(fieldMeta.name.source).toBe('user');
    expect(data.brand).toBeUndefined(); // no se inventa marca
    expect(data.material).toBe('95% algodón 5% elastano');
    expect(fieldMeta.material).toMatchObject({ source: 'ai_detected', review: true });
    expect(fieldMeta.categoryName).toMatchObject({ source: 'ai_inferred', review: true, note: 'La IA indicó incertidumbre' });
    expect(data.attributes?.manga).toBe('larga');
    expect(fieldMeta['attr:manga'].source).toBe('ai_detected');
  });
});

describe('Mapeo de columnas', () => {
  it('reconoce encabezados en español e inglés y conserva columnas desconocidas como atributos', () => {
    const m = detectMapping(['Nombre', 'Precio de venta', 'Tallas', 'COLOR', 'Existencias', 'Composición', 'Tipo de compresión']);
    expect(m).toMatchObject({ Nombre: 'name', 'Precio de venta': 'price', Tallas: 'sizes', COLOR: 'colors', Existencias: 'stock', Composición: 'material', 'Tipo de compresión': 'attr:Tipo de compresión' });
  });
  it('cada canal usa sus propios sinónimos de plantilla', () => {
    const cols = [
      { index: 1, header: 'Product Name', required: true },
      { index: 2, header: 'Seller SKU', required: true },
      { index: 3, header: 'Título', required: true },
      { index: 4, header: 'Imagen 2', required: false },
    ];
    const tk = autoMap(cols, tiktok.headerSynonyms);
    const ml = autoMap(cols, mercadolibre.headerSynonyms);
    expect(tk['1']).toBe('product.title');
    expect(tk['2']).toBe('variant.sku');
    expect(tk['4']).toBe('image:2');
    expect(ml['1']).toBeUndefined();
    expect(ml['3']).toBe('product.title');
  });
  it('recorta el título al máximo del canal', () => {
    const p = { name: 'x'.repeat(80), channel: { attributes: {} } } as any;
    expect(resolveExpr('product.title', p, {} as any, { titleMax: 60 })).toHaveLength(60);
  });
});
