/**
 * Escenario obligatorio de extremo a extremo (sección 17 del requerimiento).
 * Usa PostgreSQL real (embebido, en carpeta temporal) y la API HTTP completa.
 * Datos de demostración identificados con el prefijo "[PRUEBA]".
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { sql } from 'drizzle-orm';
import { client, fixture, startTestEnv, testImage } from './helpers';
import { getDb } from '../server/db/client';
import { setMlFetcher } from '../server/channels/mercadolibre';

let env: Awaited<ReturnType<typeof startTestEnv>>;
const admin = client(() => env.app);
const operatorA = client(() => env.app);

// Respuestas reales de la API pública oficial de Mercado Libre (guardadas el 2026-10-20 en tests/fixtures)
setMlFetcher(async (url) => {
  if (url.includes('/categories/MLM194132/attributes')) return fixture('ml-MLM194132-attributes.json');
  if (url.includes('/categories/MLM194132')) return fixture('ml-MLM194132-category.json');
  if (url.includes('domain_discovery')) return fixture('ml-domain-discovery-pijama.json');
  throw new Error(`URL no esperada en prueba: ${url}`);
});

const S: Record<string, any> = {};

beforeAll(async () => {
  env = await startTestEnv(54391);
});
afterAll(async () => {
  await env?.stop();
});

describe('Escenario completo multinegocio', () => {
  it('configura el administrador general (primer arranque)', async () => {
    expect((await admin.get('/api/auth/status')).body.needsSetup).toBe(true);
    const r = await admin.post('/api/auth/setup', { name: 'Admin Prueba', email: 'admin@prueba.mx', password: 'contrasena-segura' });
    expect(r.status).toBe(200);
    // Una segunda configuración debe rechazarse
    const again = await client(() => env.app).post('/api/auth/setup', { name: 'X', email: 'x@x.mx', password: 'contrasena-segura' });
    expect(again.status).toBe(409);
  });

  it('1. crea dos negocios con identidad propia', async () => {
    const a = await admin.post('/api/businesses', { name: '[PRUEBA] Ropa de Temporada', primaryColor: '#be185d', description: 'Pijamas, chamarras y leggings' });
    const b = await admin.post('/api/businesses', { name: '[PRUEBA] Fajas Colombianas', primaryColor: '#0f766e' });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    S.A = a.body.id;
    S.B = b.body.id;
    expect(a.body.currency).toBe('MXN');
    const logo = await admin.upload(`/api/b/${S.A}/logo`, [{ name: 'logo.png', data: await testImage(99, 400, 'png') }]);
    expect(logo.status).toBe(200);
  });

  it('2. registra productos diferentes en cada negocio (con categorías propias)', async () => {
    const catA = await admin.post(`/api/b/${S.A}/categories`, {
      name: 'Pijamas',
      fields: [{ key: 'composicion', label: 'Composición', type: 'text', required: true }],
    });
    expect(catA.status).toBe(200);
    S.catPij = catA.body.id;
    expect(catA.body.code).toBe('PIJ');
    const catB = await admin.post(`/api/b/${S.B}/categories`, {
      name: 'Fajas',
      fields: [
        { key: 'compresion', label: 'Tipo de compresión', type: 'select', options: ['Media', 'Alta'], required: true },
        { key: 'guia_tallas', label: 'Guía de tallas', type: 'text' },
      ],
    });
    S.catFaj = catB.body.id;

    const pa = await admin.post(`/api/b/${S.A}/products`, { name: '[PRUEBA] Leggings térmicos', categoryId: S.catPij, price: 249, cost: 110, stock: 12 });
    expect(pa.status).toBe(200);
    expect(pa.body.sku).toBe('PIJ-001');
    expect(pa.body.variants).toHaveLength(1);
    expect(pa.body.variants[0].sku).toBe('PIJ-001');
    expect(pa.body.issues).toContain('sin_fotos');
    expect(pa.body.issues).toContain('atributos_faltantes');
    S.leggings = pa.body.id;

    const pb = await admin.post(`/api/b/${S.B}/products`, {
      name: '[PRUEBA] Faja reductora postparto',
      categoryId: S.catFaj,
      price: 899,
      cost: 420,
      attributes: { compresion: 'Alta' },
      stock: 5,
    });
    expect(pb.status).toBe(200);
    expect(pb.body.sku).toBe('FAJ-001');
    S.faja = pb.body.id;
  });

  it('3. sube múltiples fotografías y detecta duplicados', async () => {
    const files = await Promise.all([1, 2, 3].map(async (i) => ({ name: `leggings_${i}.jpg`, data: await testImage(i) })));
    const r = await admin.upload(`/api/b/${S.A}/media`, files, { productId: S.leggings });
    expect(r.status).toBe(200);
    expect(r.body.results.filter((x: any) => x.media)).toHaveLength(3);
    // Misma foto otra vez → duplicado exacto detectado
    const dup = await admin.upload(`/api/b/${S.A}/media`, [{ name: 'otra.jpg', data: files[0].data }]);
    expect(dup.body.results[0].duplicates[0].kind).toBe('exact');
    // Un archivo que no es imagen se rechaza
    const bad = await admin.upload(`/api/b/${S.A}/media`, [{ name: 'virus.jpg', data: Buffer.from('no soy una imagen') }]);
    expect(bad.body.results[0].error).toMatch(/no es una imagen/);
    const p = await admin.get(`/api/b/${S.A}/products/${S.leggings}`);
    expect(p.body.media).toHaveLength(3);
    expect(p.body.mediaCount).toBe(3);
    expect(p.body.issues).not.toContain('sin_fotos');
  });

  it('4. crea un producto con variantes de talla y color y SKU automáticos', async () => {
    const combos = await admin.post(`/api/b/${S.A}/variants/combine`, { colors: ['Rosa', 'Negra'], sizes: ['Chica', 'Mediana'], stock: 3 });
    expect(combos.body).toHaveLength(4);
    const r = await admin.post(`/api/b/${S.A}/products`, {
      name: '[PRUEBA] Pijama térmica de dos piezas',
      categoryId: S.catPij,
      price: 399,
      cost: 180,
      attributes: { composicion: '100% poliéster' },
      shortDescription: 'Pijama térmica afelpada.',
      variants: combos.body,
    });
    expect(r.status).toBe(200);
    const skus = r.body.variants.map((v: any) => v.sku).sort();
    expect(skus).toEqual(['PIJ-002-NEG-CH', 'PIJ-002-NEG-ME', 'PIJ-002-ROS-CH', 'PIJ-002-ROS-ME']);
    expect(r.body.totalStock).toBe(12);
    S.pijama = r.body.id;
    S.pijamaVariants = r.body.variants;
    // SKU manual duplicado → rechazado
    const dup = await admin.post(`/api/b/${S.A}/products`, { name: 'X', sku: 'PIJ-002-ROS-CH', price: 1 });
    expect(dup.status).toBe(409);
    // Variante repetida → rechazada
    const rep = await admin.post(`/api/b/${S.A}/products`, { name: 'Y', price: 1, variants: [{ color: 'Rosa', size: 'CH' }, { color: 'rosa', size: 'ch' }] });
    expect(rep.status).toBe(400);
    // Existencias negativas → rechazadas
    const neg = await admin.patch(`/api/b/${S.A}/variants`, { items: [{ id: S.pijamaVariants[0].id, stock: -1 }] });
    expect(neg.status).toBe(400);
    // Fotos del producto con variantes
    const files = await Promise.all([10, 11].map(async (i) => ({ name: `pijama_${i}.jpg`, data: await testImage(i) })));
    await admin.upload(`/api/b/${S.A}/media`, files, { productId: S.pijama });
  });

  it('5. importa un lote (fotos + Excel), detecta errores, corrige y confirma', async () => {
    const batch = await admin.post(`/api/b/${S.A}/batches`, { name: '[PRUEBA] Lote otoño', newCollection: { name: 'Otoño-invierno 2026', kind: 'season' } });
    expect(batch.status).toBe(200);
    S.batch = batch.body.id;
    S.season = batch.body.collectionId;
    const photos = await Promise.all(
      [
        ['chamarra_negra_1.jpg', 20],
        ['chamarra_negra_2.jpg', 21],
        ['conjunto_gris_1.jpg', 22],
        ['IMG_0001.jpg', 23],
      ].map(async ([name, seed]) => ({ name: String(name), data: await testImage(Number(seed)) })),
    );
    const up = await admin.upload(`/api/b/${S.A}/batches/${S.batch}/photos`, photos);
    expect(up.body.uploaded).toBe(4);
    const grouped = await admin.post(`/api/b/${S.A}/batches/${S.batch}/group`);
    expect(grouped.body.created).toBe(3); // chamarra_negra (2 fotos), conjunto_gris, IMG_0001

    // Hoja de cálculo: una fila por variante; filas con el mismo grupo → un solo producto
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Productos');
    ws.addRow(['grupo', 'nombre', 'categoria', 'color', 'talla', 'existencias', 'precio', 'costo', 'fotos', 'Temporada']);
    ws.addRow(['CHA-01', '[PRUEBA] Chamarra acolchada', 'Chamarras', 'Negro', 'M', 4, 899, 420, 'chamarra_negra_1.jpg, chamarra_negra_2.jpg', 'Invierno']);
    ws.addRow(['CHA-01', '[PRUEBA] Chamarra acolchada', 'Chamarras', 'Negro', 'G', 2, 899, 420, '', 'Invierno']);
    ws.addRow(['CON-01', '[PRUEBA] Conjunto deportivo', 'Conjuntos', 'Gris', 'CH', 6, '', 200, 'conjunto_gris_1.jpg', '']); // falta precio
    ws.addRow(['LEG-02', '', 'Pijamas', '', '', 10, 199, 90, '', '']); // falta nombre
    const xlsx = Buffer.from(await wb.xlsx.writeBuffer());

    const preview = await admin.upload(`/api/b/${S.A}/batches/${S.batch}/spreadsheet/preview`, [{ name: 'lote.xlsx', data: xlsx }]);
    expect(preview.body.mapping.nombre).toBe('name');
    expect(preview.body.mapping.Temporada).toBe('attr:Temporada');
    const imp = await admin.upload(`/api/b/${S.A}/batches/${S.batch}/spreadsheet`, [{ name: 'lote.xlsx', data: xlsx }]);
    expect(imp.status).toBe(200);
    expect(imp.body.products).toBe(3);
    expect(imp.body.linkedPhotos).toBe(3);

    let detail = (await admin.get(`/api/b/${S.A}/batches/${S.batch}`)).body;
    // Las fotos enlazadas por nombre salieron de las filas "solo fotos"; queda la fila de IMG_0001
    expect(detail.rows).toHaveLength(4);
    const chamarra = detail.rows.find((r: any) => r.data.name === '[PRUEBA] Chamarra acolchada');
    expect(chamarra.mediaIds).toHaveLength(2);
    expect(chamarra.data.variants).toHaveLength(2);

    const v1 = (await admin.post(`/api/b/${S.A}/batches/${S.batch}/validate`)).body;
    expect(v1.errors).toBe(3); // conjunto sin precio, fila sin nombre, fila de foto sin datos
    // Confirmar con errores sin "solo válidas" → bloqueado, no se crea nada (protección de importación parcial)
    const blocked = await admin.post(`/api/b/${S.A}/batches/${S.batch}/commit`, {});
    expect(blocked.status).toBe(400);

    // Corrección sin reiniciar el lote: edición masiva de varias filas a la vez
    detail = (await admin.get(`/api/b/${S.A}/batches/${S.batch}`)).body;
    const conjunto = detail.rows.find((r: any) => r.data.name === '[PRUEBA] Conjunto deportivo');
    const sinNombre = detail.rows.find((r: any) => r.source === 'spreadsheet' && !r.data.name);
    const soloFoto = detail.rows.find((r: any) => r.source === 'photos');
    const fix = await admin.patch(`/api/b/${S.A}/batches/${S.batch}/rows`, {
      rows: [
        { id: conjunto.id, data: { price: 549 } },
        { id: sinNombre.id, data: { name: '[PRUEBA] Leggings básicos' } },
        { id: soloFoto.id, data: { name: '[PRUEBA] Gorro tejido', price: 149, categoryName: 'Accesorios', colors: ['Beige', 'Gris'], stockPerVariant: 2 } },
      ],
    });
    expect(fix.status).toBe(200);
    const v2 = (await admin.post(`/api/b/${S.A}/batches/${S.batch}/validate`)).body;
    expect(v2.errors).toBe(0);
    expect(v2.valid).toBe(4);

    const commit = await admin.post(`/api/b/${S.A}/batches/${S.batch}/commit`, {});
    expect(commit.status).toBe(200);
    expect(commit.body.createdNow).toBe(4);
    // Reintento seguro: no duplica
    const again = await admin.post(`/api/b/${S.A}/batches/${S.batch}/commit`, {});
    expect(again.status).toBe(409);

    const list = await admin.get(`/api/b/${S.A}/products?collectionId=${S.season}`);
    expect(list.body.total).toBe(4);
    const cham = list.body.items.find((p: any) => p.name === '[PRUEBA] Chamarra acolchada');
    expect(cham.variantCount).toBe(2);
    expect(cham.mediaCount).toBe(2);
    expect(cham.categoryName).toBe('Chamarras');
    const gorro = (await admin.get(`/api/b/${S.A}/products/${list.body.items.find((p: any) => p.name === '[PRUEBA] Gorro tejido').id}`)).body;
    expect(gorro.variants.map((v: any) => v.color).sort()).toEqual(['Beige', 'Gris']);
    expect(gorro.fieldMeta.name.source).toBe('user');
    S.chamarra = cham.id;
  });

  it('6. edita múltiples registros a la vez', async () => {
    const ids = [S.leggings, S.pijama, S.chamarra];
    const r = await admin.post(`/api/b/${S.A}/products/bulk`, {
      ids,
      patch: { status: 'active', price: { mode: 'percent', value: 10 }, addCollectionIds: [S.season], addKeywords: ['invierno'] },
    });
    expect(r.status).toBe(200);
    const p = (await admin.get(`/api/b/${S.A}/products/${S.leggings}`)).body;
    expect(Number(p.price)).toBeCloseTo(273.9);
    expect(p.status).toBe('active');
    expect(p.keywords).toContain('invierno');
    expect(p.collections.map((c: any) => c.id)).toContain(S.season);
    // Producto de otro negocio en edición masiva → rechazado
    const cross = await admin.post(`/api/b/${S.A}/products/bulk`, { ids: [S.leggings, S.faja], patch: { status: 'archived' } });
    expect(cross.status).toBe(400);
  });

  it('7-9. guarda, cierra y vuelve a abrir la aplicación: los datos persisten', async () => {
    const before = (await admin.get(`/api/b/${S.A}/products?status=all`)).body.total;
    await env.restart(); // cierra Fastify, el pool y el servidor PostgreSQL; vuelve a iniciar desde disco
    // La sesión se guarda en base de datos, así que sigue siendo válida
    const after = await admin.get(`/api/b/${S.A}/products?status=all`);
    expect(after.status).toBe(200);
    expect(after.body.total).toBe(before);
    const pij = (await admin.get(`/api/b/${S.A}/products/${S.pijama}`)).body;
    expect(pij.variants).toHaveLength(4);
    expect(pij.media).toHaveLength(2);
    const img = await admin.get(`/api/b/${S.A}/media/${pij.media[0].id}/thumb`);
    expect(img.status).toBe(200);
    expect(img.raw.length).toBeGreaterThan(500);
  });

  it('10. un negocio no puede acceder a los datos privados del otro', async () => {
    await admin.post('/api/users', { name: 'Operador A', email: 'op@ropa.mx', password: 'contrasena-op-1', memberships: [{ businessId: S.A, role: 'operator' }] });
    const login = await operatorA.post('/api/auth/login', { email: 'op@ropa.mx', password: 'contrasena-op-1' });
    expect(login.status).toBe(200);
    const me = (await operatorA.get('/api/me')).body;
    expect(me.businesses.map((b: any) => b.id)).toEqual([S.A]);

    expect((await operatorA.get(`/api/b/${S.A}/products`)).status).toBe(200);
    expect((await operatorA.get(`/api/b/${S.B}/products`)).status).toBe(404);
    expect((await operatorA.get(`/api/b/${S.B}/products/${S.faja}`)).status).toBe(404);
    expect((await operatorA.get(`/api/dashboard?businessId=${S.B}`)).status).toBe(404);
    // Pedir un producto de B a través de la ruta de A
    expect((await operatorA.get(`/api/b/${S.A}/products/${S.faja}`)).status).toBe(404);
    // Usar una categoría de B en un producto de A
    const crossCat = await operatorA.post(`/api/b/${S.A}/products`, { name: 'Intruso', categoryId: S.catFaj, price: 1 });
    expect(crossCat.status).toBe(400);
    // Foto de B vía ruta de A
    const fajaMedia = await admin.upload(`/api/b/${S.B}/media`, [{ name: 'faja.jpg', data: await testImage(50) }], { productId: S.faja });
    const mid = fajaMedia.body.results[0].media.id;
    expect((await operatorA.get(`/api/b/${S.A}/media/${mid}/full`)).status).toBe(404);
    // Asignar foto de B a producto de A
    const steal = await operatorA.put(`/api/b/${S.A}/products/${S.leggings}`, { name: '[PRUEBA] Leggings térmicos', mediaIds: [mid] });
    expect(steal.status).toBe(400);
    // Operador no puede modificar la configuración del negocio
    expect((await operatorA.patch(`/api/b/${S.A}`, { name: 'Hackeado' })).status).toBe(403);
    // Sin sesión → 401
    expect((await client(() => env.app).get(`/api/b/${S.A}/products`)).status).toBe(401);
    // Petición que modifica datos sin encabezado de seguridad (CSRF) → 403
    const noCsrf = await env.app.inject({ method: 'POST', url: `/api/b/${S.A}/products`, payload: { name: 'x' } });
    expect(noCsrf.statusCode).toBe(403);

    // Aislamiento a nivel base de datos: una variante de A no puede apuntar a un producto de B
    const fkErr = await getDb()
      .execute(sql`INSERT INTO variants (business_id, product_id, sku) VALUES (${S.A}::uuid, ${S.faja}::uuid, 'X-CROSS')`)
      .catch((e) => e);
    expect(fkErr.cause?.code).toBe('23503'); // foreign_key_violation
    expect(fkErr.cause?.constraint).toBe('variants_product_fk');
    // …ni una colección de A contener un producto de B
    const colRes = await admin.post(`/api/b/${S.A}/collections/${S.season}/products`, { add: [S.faja] });
    expect(colRes.status).toBe(400);
    // El tablero consolidado del operador solo cuenta su negocio
    const dash = (await operatorA.get('/api/dashboard')).body;
    expect(dash.counts.businesses).toBe(1);
  });

  it('11. genera un catálogo comercial (PDF y enlace público sin datos privados)', async () => {
    const c = await admin.post(`/api/b/${S.A}/catalogs`, {
      title: '[PRUEBA] Catálogo Otoño-Invierno',
      layout: 'grid2',
      showPrices: true,
      items: [{ productId: S.pijama }, { productId: S.chamarra }, { productId: S.leggings }],
    });
    expect(c.status).toBe(200);
    S.catalog = c.body.id;
    // Reordenar
    const re = await admin.put(`/api/b/${S.A}/catalogs/${S.catalog}`, { items: [{ productId: S.chamarra }, { productId: S.pijama }, { productId: S.leggings }] });
    expect(re.body.items[0].productId).toBe(S.chamarra);
    // Producto de otro negocio en el catálogo → rechazado
    expect((await admin.put(`/api/b/${S.A}/catalogs/${S.catalog}`, { items: [{ productId: S.faja }] })).status).toBe(400);

    const pdf = await admin.get(`/api/b/${S.A}/catalogs/${S.catalog}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.raw.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.raw.length).toBeGreaterThan(20_000); // incluye fotografías

    const share = await admin.post(`/api/b/${S.A}/catalogs/${S.catalog}/share`, { enabled: true });
    const token = share.body.publicToken;
    const pub = await client(() => env.app).get(`/public/c/${token}`);
    expect(pub.status).toBe(200);
    expect(pub.body).toContain('Pijama térmica de dos piezas');
    expect(pub.body).not.toMatch(/costo|PIJ-00/i); // sin costos ni SKU internos
    expect(pub.body).not.toContain('180'); // costo de la pijama
    // Versión sin precios
    await admin.put(`/api/b/${S.A}/catalogs/${S.catalog}`, { showPrices: false });
    expect((await client(() => env.app).get(`/public/c/${token}`)).body).not.toMatch(/\$\s?4\d\d/);
    // Revocar enlace
    await admin.post(`/api/b/${S.A}/catalogs/${S.catalog}/share`, { enabled: false });
    expect((await client(() => env.app).get(`/public/c/${token}`)).status).toBe(404);
  });

  it('12-14. exporta a Mercado Libre y TikTok Shop, valida requeridos, corrige y reexporta', async () => {
    const ids = [S.pijama, S.chamarra];
    // Categoría sugerida por el servicio oficial domain_discovery (respuesta real guardada)
    const sug = await admin.get('/api/channels/mercadolibre/suggest?q=pijama%20termica');
    expect(sug.body[0].categoryId).toBe('MLM194132');
    await admin.put(`/api/b/${S.A}/products/${S.pijama}/channels/mercadolibre`, { externalCategoryId: 'MLM194132', externalCategoryName: 'Pijamas' });

    // 12a. Validación ML contra atributos oficiales de la categoría
    const v1 = (await admin.post(`/api/b/${S.A}/channels/mercadolibre/validate`, { productIds: ids })).body;
    const pij = v1.reports.find((r: any) => r.productId === S.pijama);
    const msgs = pij.issues.map((i: any) => i.message).join('\n');
    expect(msgs).toMatch(/Marca/); // BRAND obligatorio (API oficial)
    expect(msgs).toMatch(/Género/); // GENDER obligatorio
    expect(msgs).toMatch(/Temporada/); // SEASON obligatorio
    const cham = v1.reports.find((r: any) => r.productId === S.chamarra);
    expect(cham.issues.some((i: any) => /categoría de Mercado Libre/.test(i.message))).toBe(true);
    expect(v1.validCount).toBe(0);

    // Sin productos válidos no se genera archivo
    expect((await admin.post(`/api/b/${S.A}/channels/mercadolibre/exports`, { productIds: ids })).status).toBe(400);

    // 14. Corrección: atributos del canal para la pijama
    await admin.put(`/api/b/${S.A}/products/${S.pijama}`, { name: '[PRUEBA] Pijama térmica de dos piezas', brand: 'Sin marca', model: 'PT-2P' });
    await admin.put(`/api/b/${S.A}/products/${S.pijama}/channels/mercadolibre`, { attributes: { GENDER: 'Mujer', SEASON: 'Invierno' } });
    const v2 = (await admin.post(`/api/b/${S.A}/channels/mercadolibre/validate`, { productIds: ids })).body;
    const pij2 = v2.reports.find((r: any) => r.productId === S.pijama);
    expect(pij2.issues.filter((i: any) => i.level === 'error')).toEqual([]);

    // Exporta: solo la pijama (válida); la chamarra queda excluida con sus errores
    const exp1 = await admin.post(`/api/b/${S.A}/channels/mercadolibre/exports`, { productIds: ids });
    expect(exp1.status).toBe(200);
    expect(exp1.body.export.format).toBe('internal_prep');
    expect(exp1.body.export.rowCount).toBe(4); // una fila por variante
    expect(exp1.body.excluded.map((e: any) => e.productId)).toEqual([S.chamarra]);
    const file = await admin.get(`/api/b/${S.A}/exports/${exp1.body.export.id}/download`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.raw as unknown as ArrayBuffer);
    expect(String(wb.worksheets[0].getCell(1, 1).value)).toMatch(/NO es la plantilla oficial/);

    // No se marca como publicado: solo "archivo generado"
    let p = (await admin.get(`/api/b/${S.A}/products/${S.pijama}`)).body;
    expect(p.channels.find((c: any) => c.channel === 'mercadolibre').status).toBe('file_generated');

    // 13. Plantilla con estructura de carga masiva (sintética, creada para probar el motor; NO es una plantilla oficial)
    const t = new ExcelJS.Workbook();
    t.addWorksheet('Instrucciones').getCell('A1').value = 'Llena la hoja Publicaciones';
    const sh = t.addWorksheet('Publicaciones');
    sh.getCell('A1').value = 'Datos de la publicación';
    const headers = ['Título *', 'SKU', 'Precio *', 'Cantidad *', 'Color *', 'Talla *', 'Marca *', 'Modelo *', 'Género *', 'Temporada *', 'Foto 1 *', 'Foto 2', 'Descripción'];
    sh.getRow(2).values = headers;
    sh.getRow(3).values = headers.map((h) => (h.includes('*') ? 'Obligatorio' : 'Opcional'));
    sh.getRow(4).values = ['Blusa manga larga', 'SKU-VIEJO', 199]; // datos viejos que deben limpiarse
    const tplBuf = Buffer.from(await t.xlsx.writeBuffer());
    const up = await admin.upload(`/api/b/${S.A}/channels/mercadolibre/templates`, [{ name: 'plantilla-pijamas.xlsx', data: tplBuf }]);
    expect(up.status).toBe(200);
    const tpl = up.body.template;
    expect(tpl.sheetName).toBe('Publicaciones');
    expect(tpl.headerRow).toBe(2);
    expect(tpl.dataStartRow).toBe(4);
    expect(tpl.columns.filter((c: any) => c.required)).toHaveLength(10);
    expect(tpl.mapping['1']).toBe('product.title');
    expect(tpl.mapping['5']).toBe('variant.color');
    expect(tpl.mapping['11']).toBe('image:1');

    // Columnas obligatorias sin asignar (Género, Temporada) → bloquea
    const v3 = (await admin.post(`/api/b/${S.A}/channels/mercadolibre/validate`, { productIds: [S.pijama], templateId: tpl.id })).body;
    expect(v3.blocking).toBe(true);
    expect(v3.globalIssues.map((i: any) => i.field)).toEqual(expect.arrayContaining(['Género *', 'Temporada *']));
    expect((await admin.post(`/api/b/${S.A}/channels/mercadolibre/exports`, { productIds: [S.pijama], templateId: tpl.id })).status).toBe(400);

    // Corrige el mapeo y reexporta con la plantilla
    await admin.patch(`/api/b/${S.A}/channels/mercadolibre/templates/${tpl.id}`, { mapping: { ...tpl.mapping, '9': 'attr:GENDER', '10': 'attr:SEASON' } });
    const exp2 = await admin.post(`/api/b/${S.A}/channels/mercadolibre/exports`, { productIds: [S.pijama], templateId: tpl.id });
    expect(exp2.status).toBe(200);
    expect(exp2.body.export.format).toBe('official_template');
    const out = new ExcelJS.Workbook();
    await out.xlsx.load((await admin.get(`/api/b/${S.A}/exports/${exp2.body.export.id}/download`)).raw as unknown as ArrayBuffer);
    const ws = out.getWorksheet('Publicaciones')!;
    expect(out.getWorksheet('Instrucciones')).toBeTruthy(); // se conservan las demás hojas
    const firstData = ws.getRow(4);
    expect(String(firstData.getCell(1).value)).toContain('Pijama térmica');
    expect(String(firstData.getCell(9).value)).toBe('Mujer');
    expect(String(firstData.getCell(11).value)).toMatch(/\/public\/m\/.+\.jpg$/);
    const skus = [4, 5, 6, 7].map((r) => String(ws.getRow(r).getCell(2).value)).sort();
    expect(skus).toEqual(['PIJ-002-NEG-CH', 'PIJ-002-NEG-ME', 'PIJ-002-ROS-CH', 'PIJ-002-ROS-ME']);
    expect(ws.getRow(8).getCell(1).value).toBeNull(); // la fila de ejemplo se limpió

    // 12b. TikTok Shop: adaptador independiente con sus propias reglas
    const tk1 = (await admin.post(`/api/b/${S.A}/channels/tiktok/validate`, { productIds: [S.chamarra, S.pijama] })).body;
    const tkCham = tk1.reports.find((r: any) => r.productId === S.chamarra);
    expect(tkCham.issues.some((i: any) => /descripción/i.test(i.message))).toBe(true);
    await admin.put(`/api/b/${S.A}/products/${S.chamarra}`, { name: '[PRUEBA] Chamarra acolchada', shortDescription: 'Chamarra acolchada con capucha.', weightGrams: 800 });
    const tkExp = await admin.post(`/api/b/${S.A}/channels/tiktok/exports`, { productIds: [S.chamarra, S.pijama] });
    expect(tkExp.status).toBe(200);
    expect(tkExp.body.export.productCount).toBe(2);
    expect(tkExp.body.export.fileName).toMatch(/^tiktok-PREPARACION/);
    const hist = (await admin.get(`/api/b/${S.A}/channels/tiktok`)).body;
    expect(hist.exports).toHaveLength(1);

    // Asociación SKU interno ↔ ID externo tras publicar en el marketplace
    const link = await admin.post(`/api/b/${S.A}/channels/mercadolibre/links`, {
      rows: [
        { sku: 'PIJ-002', externalId: 'MLM1234567890' },
        { sku: 'PIJ-002-ROS-CH', externalId: '987654321' },
        { sku: 'NO-EXISTE', externalId: '1' },
      ],
    });
    expect(link.body).toMatchObject({ linkedProducts: 1, linkedVariants: 1, notFound: ['NO-EXISTE'] });
    p = (await admin.get(`/api/b/${S.A}/products/${S.pijama}`)).body;
    const ml = p.channels.find((c: any) => c.channel === 'mercadolibre');
    expect(ml.status).toBe('linked');
    expect(ml.externalId).toBe('MLM1234567890');
    // Filtro de productos pendientes de exportar a ML
    const pending = (await admin.get(`/api/b/${S.A}/products?channel=mercadolibre&channelStatus=none`)).body;
    expect(pending.items.map((x: any) => x.id)).not.toContain(S.pijama);
  });

  it('15. las funciones no implementadas se identifican como pendientes', async () => {
    const chans = (await admin.get('/api/channels')).body;
    for (const c of chans) {
      const api = c.capabilities.find((x: any) => x.key === 'api_publish');
      expect(api.status).toBe('pending');
      expect(c.verification.unverified.length).toBeGreaterThan(0);
    }
    const op = await admin.post(`/api/b/${S.A}/channels/mercadolibre/operations`, { operation: 'sync_stock', productIds: [S.pijama] });
    expect(op.body.executed).toBe(false);
    expect(op.body.operation.status).toBe('pending_integration');
    // IA sin API key: no se simula, se informa claramente
    const ai = await admin.get('/api/ai/status');
    expect(ai.body.configured).toBe(false);
    const q = await admin.post(`/api/b/${S.A}/batches/${S.batch}/ai`, {});
    expect(q.status).toBe(400);
    expect(q.body.error).toMatch(/IA no está configurada/);
  });

  it('el tablero muestra cifras reales y operaciones destructivas requieren confirmación', async () => {
    const d = (await admin.get('/api/dashboard')).body;
    expect(d.counts.businesses).toBe(2);
    expect(d.counts.products).toBe(7); // 6 de Ropa + 1 de Fajas
    expect(d.recentExports.length).toBe(3);
    expect(d.activity.length).toBeGreaterThan(0);
    // Archivar negocio sin el nombre exacto → rechazado
    expect((await admin.post(`/api/b/${S.B}/archive`, { confirmName: 'otro' })).status).toBe(400);
    // Archivar producto y reactivarlo: conserva fotos e historial
    await admin.post(`/api/b/${S.A}/products/bulk`, { ids: [S.pijama], patch: { status: 'archived' } });
    expect((await admin.get(`/api/b/${S.A}/products`)).body.items.map((p: any) => p.id)).not.toContain(S.pijama);
    await admin.post(`/api/b/${S.A}/products/bulk`, { ids: [S.pijama], patch: { status: 'active' } });
    const back = (await admin.get(`/api/b/${S.A}/products/${S.pijama}`)).body;
    expect(back.media).toHaveLength(2);
    expect(back.variants).toHaveLength(4);
    // Foto eliminada → recuperable
    await admin.post(`/api/b/${S.A}/media/delete`, { ids: [back.media[0].id] });
    expect((await admin.get(`/api/b/${S.A}/products/${S.pijama}`)).body.media).toHaveLength(1);
    await admin.post(`/api/b/${S.A}/media/restore`, { ids: [back.media[0].id] });
    expect((await admin.get(`/api/b/${S.A}/products/${S.pijama}`)).body.media).toHaveLength(2);
  });
});
