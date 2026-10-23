/**
 * Pruebas de estabilización: CSV reales, lotes grandes (rendimiento), recuperación sin duplicados,
 * duplicados de fotos, validaciones de Mercado Libre, plantillas con varias filas de encabezado,
 * respaldo y restauración, y controles de seguridad.
 * Todos los datos son de prueba ("[PRUEBA]") y viven en una carpeta temporal.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { getDb } from '../server/db/client';
import { client, fixture, startTestEnv, testImage } from './helpers';
import { setMlFetcher } from '../server/channels/mercadolibre';
import { createBackup, restoreBackup } from '../server/lib/backup';

let env: Awaited<ReturnType<typeof startTestEnv>>;
const admin = client(() => env.app);
const S: Record<string, any> = {};
const timings: Record<string, number> = {};

setMlFetcher(async (url) => {
  if (url.includes('/categories/MLM194132/attributes')) return fixture('ml-MLM194132-attributes.json');
  if (url.includes('/categories/MLM194132')) return fixture('ml-MLM194132-category.json');
  throw new Error(`URL no esperada: ${url}`);
});

async function timed<T>(label: string, fn: () => Promise<T>) {
  const t = Date.now();
  const r = await fn();
  timings[label] = Date.now() - t;
  return r;
}

beforeAll(async () => {
  env = await startTestEnv(54393);
  await admin.post('/api/auth/setup', { name: 'Admin', email: 'admin@prueba.mx', password: 'contrasena-segura' });
  S.A = (await admin.post('/api/businesses', { name: '[PRUEBA] Tienda grande' })).body.id;
  S.B = (await admin.post('/api/businesses', { name: '[PRUEBA] Otra tienda' })).body.id;
});
afterAll(async () => {
  console.log('Tiempos (ms):', timings);
  await env?.stop();
});

describe('Importación CSV', () => {
  it('lee CSV de Excel en Windows (Windows-1252, punto y coma) sin perder acentos', async () => {
    const batch = (await admin.post(`/api/b/${S.A}/batches`, { name: '[PRUEBA] CSV' })).body;
    const csv = 'grupo;nombre;categoría;color;talla;existencias;precio\r\nCAM-1;[PRUEBA] Camisón de algodón;Pijamas;Rosa;CH;3;299\r\nCAM-1;[PRUEBA] Camisón de algodón;Pijamas;Rosa;M;2;299\r\n';
    const res = await admin.upload(`/api/b/${S.A}/batches/${batch.id}/spreadsheet`, [{ name: 'lote.csv', data: Buffer.from(csv, 'latin1') }]);
    expect(res.status).toBe(200);
    expect(res.body.products).toBe(1);
    const d = (await admin.get(`/api/b/${S.A}/batches/${batch.id}`)).body;
    expect(d.rows[0].data.name).toBe('[PRUEBA] Camisón de algodón');
    expect(d.rows[0].data.categoryName).toBe('Pijamas');
    expect(d.rows[0].data.variants).toHaveLength(2);
    expect(d.rows[0].data.price).toBe(299);
  });

  it('lee CSV UTF-8 con BOM, comas, comillas y listas de tallas en una celda', async () => {
    const batch = (await admin.post(`/api/b/${S.A}/batches`, { name: '[PRUEBA] CSV 2' })).body;
    const csv = '﻿nombre,precio,colores,tallas,existencias,descripcion\n"[PRUEBA] Legging, térmico","$1,299.00","Negro, Gris","CH, M, G",4,"Tela ""peach skin"""\n';
    const res = await admin.upload(`/api/b/${S.A}/batches/${batch.id}/spreadsheet`, [{ name: 'lote.csv', data: Buffer.from(csv, 'utf8') }]);
    expect(res.status).toBe(200);
    const row = (await admin.get(`/api/b/${S.A}/batches/${batch.id}`)).body.rows[0];
    expect(row.data.name).toBe('[PRUEBA] Legging, térmico');
    expect(row.data.price).toBe(1299);
    expect(row.data.variants).toHaveLength(6);
    expect(row.data.longDescription).toBe('Tela "peach skin"');
  });

  it('asocia fotos subidas DESPUÉS del Excel a su producto (el orden no importa)', async () => {
    const batch = (await admin.post(`/api/b/${S.A}/batches`, { name: '[PRUEBA] Orden' })).body;
    const csv = 'grupo,nombre,precio,color,fotos\nG1,[PRUEBA] Blusa orden,199,Rojo,blusa-orden_1.jpg; blusa-orden_2.jpg\nG2,[PRUEBA] Falda orden,249,Azul,falda-orden.jpg\n';
    await admin.upload(`/api/b/${S.A}/batches/${batch.id}/spreadsheet`, [{ name: 'orden.csv', data: Buffer.from(csv) }]);
    const up = await admin.upload(`/api/b/${S.A}/batches/${batch.id}/photos`, [
      { name: 'blusa-orden_1.jpg', data: await testImage(901) },
      { name: 'blusa-orden_2.jpg', data: await testImage(902) },
      { name: 'falda-orden.jpg', data: await testImage(903) },
      { name: 'extra-suelta.jpg', data: await testImage(904) },
    ]);
    expect(up.body.linked).toBe(3);
    await admin.post(`/api/b/${S.A}/batches/${batch.id}/group`);
    const d = (await admin.get(`/api/b/${S.A}/batches/${batch.id}`)).body;
    expect(d.rows.find((r: any) => r.data.name === '[PRUEBA] Blusa orden').mediaIds).toHaveLength(2);
    expect(d.rows.find((r: any) => r.data.name === '[PRUEBA] Falda orden').mediaIds).toHaveLength(1);
    expect(d.rows.filter((r: any) => r.source === 'photos')).toHaveLength(1); // solo la foto suelta
  });

  it('rechaza archivos que no son hojas de cálculo y hojas sin filas', async () => {
    const batch = (await admin.post(`/api/b/${S.A}/batches`, { name: '[PRUEBA] CSV malo' })).body;
    expect((await admin.upload(`/api/b/${S.A}/batches/${batch.id}/spreadsheet`, [{ name: 'x.pdf', data: Buffer.from('%PDF-1.4') }])).status).toBe(400);
    expect((await admin.upload(`/api/b/${S.A}/batches/${batch.id}/spreadsheet`, [{ name: 'x.csv', data: Buffer.from('nombre,precio\n') }])).status).toBe(400);
    const bad = await admin.upload(`/api/b/${S.A}/batches/${batch.id}/spreadsheet`, [{ name: 'x.xlsx', data: Buffer.from('no es un zip') }]);
    expect(bad.status).toBe(400);
  });
});

describe('Lote grande (rendimiento)', () => {
  const N = 300;
  it(`importa ${N} productos con 6 variantes cada uno y 60 fotos`, async () => {
    const batch = (await admin.post(`/api/b/${S.A}/batches`, { name: '[PRUEBA] Lote grande', newCollection: { name: '[PRUEBA] Temporada grande', kind: 'season' } })).body;
    S.bigBatch = batch.id;
    const files = await Promise.all(Array.from({ length: 60 }, async (_, i) => ({ name: `modelo-${String(i).padStart(3, '0')}_1.jpg`, data: await testImage(1000 + i, 800) })));
    await timed('subir 60 fotos (10 tandas)', async () => {
      for (let i = 0; i < files.length; i += 6) {
        const r = await admin.upload(`/api/b/${S.A}/batches/${batch.id}/photos`, files.slice(i, i + 6));
        expect(r.body.failed).toBe(0);
      }
    });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Productos');
    ws.addRow(['grupo', 'nombre', 'categoria', 'color', 'talla', 'existencias', 'precio', 'costo', 'fotos']);
    for (let i = 0; i < N; i++) {
      for (const color of ['Negro', 'Rosa']) {
        for (const talla of ['CH', 'M', 'G']) {
          ws.addRow([`M-${i}`, `[PRUEBA] Modelo ${i}`, `Categoría ${i % 5}`, color, talla, 2, 199 + (i % 50), 90, i < 60 && color === 'Negro' && talla === 'CH' ? `modelo-${String(i).padStart(3, '0')}_1.jpg` : '']);
        }
      }
    }
    const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
    const imp = await timed(`importar Excel (${N * 6} filas)`, () => admin.upload(`/api/b/${S.A}/batches/${batch.id}/spreadsheet`, [{ name: 'grande.xlsx', data: xlsx }]));
    expect(imp.status).toBe(200);
    expect(imp.body.products).toBe(N);
    expect(imp.body.linkedPhotos).toBe(60);
    const v = await timed('validar lote', () => admin.post(`/api/b/${S.A}/batches/${batch.id}/validate`));
    expect(v.body).toMatchObject({ valid: N, errors: 0 });
    const c = await timed('confirmar lote (transacción)', () => admin.post(`/api/b/${S.A}/batches/${batch.id}/commit`, {}));
    expect(c.status).toBe(200);
    expect(c.body.createdNow).toBe(N);
    const list = await timed('listar productos (página de 50)', () => admin.get(`/api/b/${S.A}/products?collectionId=${batch.collectionId}`));
    expect(list.body.total).toBe(N);
    expect(timings['confirmar lote (transacción)']).toBeLessThan(120_000);
    S.bigIds = (await admin.get(`/api/b/${S.A}/products?collectionId=${batch.collectionId}&pageSize=500`)).body.items.map((p: any) => p.id);
    const one = (await admin.get(`/api/b/${S.A}/products/${S.bigIds[0]}`)).body;
    expect(one.variants).toHaveLength(6);
    expect(new Set(one.variants.map((x: any) => x.sku)).size).toBe(6);
  }, 300_000);

  it('edita 300 productos a la vez y exporta el catálogo maestro a Excel', async () => {
    const r = await timed('edición masiva 300', () => admin.post(`/api/b/${S.A}/products/bulk`, { ids: S.bigIds, patch: { price: { mode: 'add', value: 10 }, status: 'active' } }));
    expect(r.body.updated).toBe(300);
    const x = await timed('exportar catálogo a Excel', () => admin.get(`/api/b/${S.A}/products-export?format=xlsx`));
    expect(x.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.raw as unknown as ArrayBuffer);
    expect(wb.worksheets[0].rowCount).toBeGreaterThan(1800);
  }, 120_000);
});

describe('Recuperación de errores sin duplicar registros', () => {
  it('si la confirmación falla a mitad, no se crea nada; tras corregir, se crea exactamente una vez', async () => {
    const batch = (await admin.post(`/api/b/${S.A}/batches`, { name: '[PRUEBA] Recuperación' })).body;
    const csv = 'nombre,sku,precio\n[PRUEBA] R1,REC-1,100\n[PRUEBA] R2,REC-2,100\n[PRUEBA] R3,REC-3,100\n';
    await admin.upload(`/api/b/${S.A}/batches/${batch.id}/spreadsheet`, [{ name: 'r.csv', data: Buffer.from(csv) }]);
    expect((await admin.post(`/api/b/${S.A}/batches/${batch.id}/validate`)).body.valid).toBe(3);
    // Otro usuario crea un producto con el SKU de la tercera fila DESPUÉS de validar
    await admin.post(`/api/b/${S.A}/products`, { name: '[PRUEBA] Intruso', sku: 'REC-3', price: 1 });
    const fail = await admin.post(`/api/b/${S.A}/batches/${batch.id}/commit`, { onlyValid: true });
    expect(fail.status).toBe(200); // la revalidación previa detecta el conflicto y excluye esa fila
    expect(fail.body.createdNow).toBe(2);
    const d = (await admin.get(`/api/b/${S.A}/batches/${batch.id}`)).body;
    const r3 = d.rows.find((r: any) => r.data.sku === 'REC-3');
    expect(r3.status).toBe('error');
    await admin.patch(`/api/b/${S.A}/batches/${batch.id}/rows`, { rows: [{ id: r3.id, data: { sku: 'REC-3B' } }] });
    const again = await admin.post(`/api/b/${S.A}/batches/${batch.id}/commit`, {});
    expect(again.body.createdNow).toBe(1);
    const all = (await admin.get(`/api/b/${S.A}/products?q=REC-&pageSize=50`)).body.items.map((p: any) => p.sku).sort();
    expect(all).toEqual(['REC-1', 'REC-2', 'REC-3', 'REC-3B']);
  });

  it('una falla dentro de la transacción revierte todo el lote', async () => {
    const batch = (await admin.post(`/api/b/${S.A}/batches`, { name: '[PRUEBA] Rollback' })).body;
    await admin.upload(`/api/b/${S.A}/batches/${batch.id}/spreadsheet`, [{ name: 'r.csv', data: Buffer.from('nombre,precio\n[PRUEBA] T1,10\n[PRUEBA] T2,10\n') }]);
    await admin.post(`/api/b/${S.A}/batches/${batch.id}/validate`);
    // La validación ya detecta SKU de variante en conflicto
    const d = (await admin.get(`/api/b/${S.A}/batches/${batch.id}`)).body;
    await admin.patch(`/api/b/${S.A}/batches/${batch.id}/rows`, { rows: [{ id: d.rows[1].id, data: { variants: [{ color: 'Rojo', sku: 'REC-1' }, { color: 'Azul' }] } }] });
    const v = (await admin.post(`/api/b/${S.A}/batches/${batch.id}/validate`)).body;
    expect(v.errors).toBe(1);
    await admin.patch(`/api/b/${S.A}/batches/${batch.id}/rows`, { rows: [{ id: d.rows[1].id, data: { variants: [] } }] });
    // Falla inesperada a mitad de la transacción: dato corrupto en la segunda fila (escrito directo en BD)
    await getDb().execute(sql`UPDATE import_rows SET data = jsonb_set(data, '{weightGrams}', '-5') WHERE id = ${d.rows[1].id}::uuid`);
    const before = (await admin.get(`/api/b/${S.A}/products?status=all&pageSize=1`)).body.total;
    const r = await admin.post(`/api/b/${S.A}/batches/${batch.id}/commit`, {});
    expect(r.status).toBe(400);
    expect((await admin.get(`/api/b/${S.A}/products?status=all&pageSize=1`)).body.total).toBe(before); // T1 tampoco quedó
    expect((await admin.get(`/api/b/${S.A}/batches/${batch.id}`)).body.batch.status).toBe('draft');
    // Corrección y reintento: se crean ambos, una sola vez
    await getDb().execute(sql`UPDATE import_rows SET data = data - 'weightGrams' WHERE id = ${d.rows[1].id}::uuid`);
    const ok = await admin.post(`/api/b/${S.A}/batches/${batch.id}/commit`, {});
    expect(ok.body.createdNow).toBe(2);
    expect((await admin.get(`/api/b/${S.A}/products?status=all&pageSize=1`)).body.total).toBe(before + 2);
  });

  it('dos confirmaciones simultáneas del mismo lote no duplican productos', async () => {
    const batch = (await admin.post(`/api/b/${S.A}/batches`, { name: '[PRUEBA] Concurrencia' })).body;
    await admin.upload(`/api/b/${S.A}/batches/${batch.id}/spreadsheet`, [{ name: 'c.csv', data: Buffer.from('nombre,precio\n[PRUEBA] C1,10\n[PRUEBA] C2,10\n') }]);
    const [a, b] = await Promise.all([admin.post(`/api/b/${S.A}/batches/${batch.id}/commit`, {}), admin.post(`/api/b/${S.A}/batches/${batch.id}/commit`, {})]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await admin.get(`/api/b/${S.A}/products?q=${encodeURIComponent('[PRUEBA] C')}&pageSize=50`)).body.items.filter((p: any) => /^\[PRUEBA\] C\d$/.test(p.name))).toHaveLength(2);
  });
});

describe('Duplicados de fotografías', () => {
  it('detecta fotos idénticas y casi idénticas (recomprimidas) dentro del negocio, no en otros negocios', async () => {
    const original = await testImage(777);
    const recompressed = await sharp(original).resize(1100).jpeg({ quality: 60 }).toBuffer();
    await admin.upload(`/api/b/${S.A}/media`, [{ name: 'orig.jpg', data: original }]);
    const same = await admin.upload(`/api/b/${S.A}/media`, [{ name: 'copia.jpg', data: original }]);
    expect(same.body.results[0].duplicates[0].kind).toBe('exact');
    const similar = await admin.upload(`/api/b/${S.A}/media`, [{ name: 'whatsapp.jpg', data: recompressed }]);
    expect(similar.body.results[0].duplicates.some((d: any) => d.kind === 'similar')).toBe(true);
    const otherBiz = await admin.upload(`/api/b/${S.B}/media`, [{ name: 'orig.jpg', data: original }]);
    expect(otherBiz.body.results[0].duplicates).toEqual([]);
  });
});

describe('Validaciones de Mercado Libre (datos oficiales de la categoría MLM194132)', () => {
  it('detecta título largo, precio bajo el mínimo, foto pequeña y exceso de variaciones', async () => {
    const p = (
      await admin.post(`/api/b/${S.A}/products`, {
        name: '[PRUEBA] Pijama térmica de dos piezas con pantalón largo y blusa manga larga',
        brand: 'Genérica',
        model: 'X',
        price: 20,
        variants: [{ color: 'Rosa', size: 'M', stock: 1 }],
      })
    ).body;
    await admin.upload(`/api/b/${S.A}/media`, [{ name: 'chica.jpg', data: await testImage(5, 400) }], { productId: p.id });
    await admin.put(`/api/b/${S.A}/products/${p.id}/channels/mercadolibre`, { externalCategoryId: 'MLM194132', attributes: { GENDER: 'Mujer', SEASON: 'Invierno' } });
    const v = (await admin.post(`/api/b/${S.A}/channels/mercadolibre/validate`, { productIds: [p.id] })).body;
    const msgs = v.reports[0].issues.filter((i: any) => i.level === 'error').map((i: any) => i.message).join('\n');
    expect(msgs).toMatch(/máximo de la categoría es 60/);
    expect(msgs).toMatch(/mínimo de la categoría \(35 MXN\)/);
    expect(msgs).toMatch(/400×400 px: el mínimo oficial es 500×500/);
    expect(v.reports[0].ok).toBe(false);
    // Corrección: título específico para ML, precio y foto adecuada
    await admin.put(`/api/b/${S.A}/products/${p.id}/channels/mercadolibre`, { attributes: { GENDER: 'Mujer', SEASON: 'Invierno', __title: '[PRUEBA] Pijama térmica dos piezas' } });
    const prod = (await admin.get(`/api/b/${S.A}/products/${p.id}`)).body;
    await admin.post(`/api/b/${S.A}/media/delete`, { ids: [prod.media[0].id] });
    await admin.upload(`/api/b/${S.A}/media`, [{ name: 'buena.jpg', data: await testImage(6, 1200) }], { productId: p.id });
    await admin.put(`/api/b/${S.A}/products/${p.id}`, { name: prod.name, price: 349 });
    const v2 = (await admin.post(`/api/b/${S.A}/channels/mercadolibre/validate`, { productIds: [p.id] })).body;
    expect(v2.reports[0].issues.filter((i: any) => i.level === 'error')).toEqual([]);
    const exp = await admin.post(`/api/b/${S.A}/channels/mercadolibre/exports`, { productIds: [p.id] });
    expect(exp.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await admin.get(`/api/b/${S.A}/exports/${exp.body.export.id}/download`)).raw as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    const headers = (ws.getRow(3).values as any[]).slice(1).map(String);
    const row = ws.getRow(4);
    const col = (h: string) => headers.findIndex((x) => x.startsWith(h)) + 1;
    expect(String(row.getCell(col('Título')).value)).toBe('[PRUEBA] Pijama térmica dos piezas');
    expect(Number(row.getCell(col('Precio')).value)).toBe(349);
    expect(String(row.getCell(col('ID categoría ML')).value)).toBe('MLM194132');
    expect(String(row.getCell(col('Foto 1')).value)).toMatch(/^http.*\/public\/m\/[0-9a-f-]{36}\/[\w-]+\.jpg$/);
    // La URL firmada de la foto funciona sin sesión; con firma alterada, no
    const url = new URL(String(row.getCell(col('Foto 1')).value));
    const anon = client(() => env.app);
    const ok = await anon.get(url.pathname);
    expect(ok.status).toBe(200);
    expect(String(ok.headers['content-type'])).toMatch(/image\/jpeg/);
    expect((await anon.get(url.pathname.replace(/\/[\w-]+\.jpg$/, '/AAAAAAAAAAAAAAAAAAAAAA.jpg'))).status).toBe(404);
  });
});

describe('Plantilla con varias filas de encabezado (estructura tipo marketplace, sintética)', () => {
  it('elige la fila de nombres legibles, detecta obligatorios arriba/abajo y llena una fila por variante', async () => {
    // Estructura frecuente en plantillas de carga masiva: claves internas, nombres visibles,
    // fila Obligatorio/Opcional y fila de instrucciones. NO es una plantilla oficial.
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Template');
    const keys = ['category', 'brand', 'product_name', 'product_description', 'main_image', 'image_2', 'seller_sku', 'price', 'quantity', 'variation_1_value', 'variation_2_value', 'package_weight'];
    const names = ['Category*', 'Brand', 'Product Name*', 'Product Description*', 'Main Product Image*', 'Product Image 2', 'Seller SKU', 'Retail Price (Local Currency)*', 'Quantity*', 'Variation 1 value', 'Variation 2 value', 'Package Weight(kg)*'];
    ws.getRow(1).values = keys;
    ws.getRow(2).values = names;
    ws.getRow(3).values = names.map((n) => (n.endsWith('*') ? 'Mandatory' : 'Optional'));
    ws.getRow(4).values = names.map((n) => `Instrucciones para ${n}: escribe el valor según el formato indicado por la plataforma en esta columna.`);
    const hidden = wb.addWorksheet('Valores');
    hidden.state = 'hidden';
    hidden.getCell('A1').value = 'Lista';
    const up = await admin.upload(`/api/b/${S.A}/channels/tiktok/templates`, [{ name: 'tiktok-ropa.xlsx', data: Buffer.from(await wb.xlsx.writeBuffer()) }]);
    expect(up.status).toBe(200);
    const t = up.body.template;
    expect(t.headerRow).toBe(2);
    expect(t.dataStartRow).toBe(5);
    expect(t.columns.filter((c: any) => c.required).map((c: any) => c.header)).toEqual(names.filter((n) => n.endsWith('*')));
    expect(t.mapping).toMatchObject({ '2': 'product.brand', '3': 'product.title', '4': 'product.description', '5': 'image:1', '6': 'image:2', '7': 'variant.sku', '8': 'variant.price', '9': 'variant.stock', '10': 'variant.color', '11': 'variant.size', '12': 'product.weightKg' });

    const p = (
      await admin.post(`/api/b/${S.A}/products`, {
        name: '[PRUEBA] Blusa satinada',
        price: 259,
        shortDescription: 'Blusa satinada.',
        weightGrams: 250,
        variants: [
          { color: 'Rojo', size: 'M', stock: 2 },
          { color: 'Rojo', size: 'G', stock: 1 },
        ],
      })
    ).body;
    await admin.upload(`/api/b/${S.A}/media`, [{ name: 'b1.jpg', data: await testImage(31) }, { name: 'b2.jpg', data: await testImage(32) }], { productId: p.id });
    await admin.put(`/api/b/${S.A}/products/${p.id}/channels/tiktok`, { externalCategoryName: 'Ropa de mujer/Blusas' });
    // Category* tiene asignado el ID de categoría (vacío) → error por columna obligatoria sin valor
    const v1 = (await admin.post(`/api/b/${S.A}/channels/tiktok/validate`, { productIds: [p.id], templateId: t.id })).body;
    expect(v1.reports[0].issues.some((i: any) => /Category\*/.test(i.message))).toBe(true);
    await admin.patch(`/api/b/${S.A}/channels/tiktok/templates/${t.id}`, { mapping: { ...t.mapping, '1': 'product.externalCategoryName' } });
    const exp = await admin.post(`/api/b/${S.A}/channels/tiktok/exports`, { productIds: [p.id], templateId: t.id });
    expect(exp.status).toBe(200);
    const out = new ExcelJS.Workbook();
    await out.xlsx.load((await admin.get(`/api/b/${S.A}/exports/${exp.body.export.id}/download`)).raw as unknown as ArrayBuffer);
    const sheet = out.getWorksheet('Template')!;
    expect(out.getWorksheet('Valores')?.state).toBe('hidden'); // se conservan hojas auxiliares
    expect(String(sheet.getRow(1).getCell(3).value)).toBe('product_name'); // filas de encabezado intactas
    const r5 = sheet.getRow(5);
    const r6 = sheet.getRow(6);
    expect([r5.getCell(1).value, r5.getCell(3).value, r5.getCell(10).value, r5.getCell(11).value, r5.getCell(9).value, r5.getCell(12).value]).toEqual(['Ropa de mujer/Blusas', '[PRUEBA] Blusa satinada', 'Rojo', 'M', 2, 0.25]);
    expect(r6.getCell(11).value).toBe('G');
    expect(String(r5.getCell(5).value)).toMatch(/\/public\/m\//);
    expect(String(r5.getCell(6).value)).toMatch(/\/public\/m\//);
  });
});

describe('Seguridad', () => {
  it('no expone secretos en la interfaz compilada ni errores internos', async () => {
    const dist = path.resolve(import.meta.dirname, '../web/dist/assets');
    if (fs.existsSync(dist)) {
      const js = fs.readdirSync(dist).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(dist, f), 'utf8')).join('');
      // Se buscan VALORES secretos (la interfaz sí menciona el nombre de la variable para orientar al usuario)
      expect(js).not.toMatch(/sk-ant-[A-Za-z0-9]/);
      for (const v of [process.env.APP_SECRET, process.env.ANTHROPIC_API_KEY, process.env.DEMO_ADMIN_PASSWORD]) {
        if (v && v.length >= 8) expect(js.includes(v)).toBe(false);
      }
    }
    const r = await admin.get(`/api/b/${S.A}/products/00000000-0000-0000-0000-000000000000`);
    expect(r.status).toBe(404);
    const bad = await admin.post(`/api/b/${S.A}/products`, { name: 'x', price: 'abc' });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toMatch(/stack|node_modules|SELECT/i);
  });

  it('limita el tamaño de las importaciones', async () => {
    const batch = (await admin.post(`/api/b/${S.A}/batches`, { name: '[PRUEBA] Límite' })).body;
    const lines = ['nombre,precio', ...Array.from({ length: 5001 }, (_, i) => `P${i},1`)].join('\n');
    const r = await admin.upload(`/api/b/${S.A}/batches/${batch.id}/spreadsheet`, [{ name: 'enorme.csv', data: Buffer.from(lines) }]);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/5000/);
  });

  it('el CSV exportado neutraliza fórmulas (inyección en Excel)', async () => {
    const p = (await admin.post(`/api/b/${S.B}/products`, { name: '=HYPERLINK("http://malo")', price: 1 })).body;
    const csv = (await admin.get(`/api/b/${S.B}/products-export?format=csv&ids=${p.id}`)).body as string;
    expect(csv).toContain("'=HYPERLINK");
  });

  it('inicio de sesión: credenciales erróneas y bloqueo temporal tras intentos', async () => {
    const anon = client(() => env.app);
    for (let i = 0; i < 5; i++) expect((await anon.post('/api/auth/login', { email: 'admin@prueba.mx', password: 'mal' })).status).toBe(401);
    expect((await anon.post('/api/auth/login', { email: 'admin@prueba.mx', password: 'mal' })).status).toBe(429);
  });
});

describe('Respaldo y restauración', () => {
  it('restaura base de datos y fotos en un entorno de prueba, conservando la versión anterior', async () => {
    const before = (await admin.get(`/api/b/${S.A}/products?status=all&pageSize=1`)).body.total;
    const withPhoto = (await admin.get(`/api/b/${S.A}/products?status=all&pageSize=500`)).body.items.find((p: any) => p.thumbId);
    await env.pause();
    const backupsDir = path.join(env.root, 'backups');
    const b = createBackup({ pgDir: env.pgDir, storageDir: env.storageDir, backupsDir });
    expect(b.dbFiles).toBeGreaterThan(100);
    expect(b.storageFiles).toBeGreaterThan(100);
    await env.resume();
    // Cambios posteriores al respaldo
    await admin.post(`/api/b/${S.A}/products`, { name: '[PRUEBA] Creado después del respaldo', price: 1 });
    expect((await admin.get(`/api/b/${S.A}/products?status=all&pageSize=1`)).body.total).toBe(before + 1);
    await env.pause();
    const r = restoreBackup({ pgDir: env.pgDir, storageDir: env.storageDir, backupsDir }, path.basename(b.dest));
    expect(fs.existsSync(path.join(r.previousSavedIn, 'pgdata', 'PG_VERSION'))).toBe(true);
    await env.resume();
    expect((await admin.get(`/api/b/${S.A}/products?status=all&pageSize=1`)).body.total).toBe(before);
    const img = await admin.get(`/api/b/${S.A}/media/${withPhoto.thumbId}/full`);
    expect(img.status).toBe(200);
  }, 180_000);
});
