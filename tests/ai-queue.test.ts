/**
 * Mecánica de la cola de IA (estados, reintentos, errores permanentes) con un proveedor DE PRUEBA.
 * Este doble de prueba existe solo aquí: la aplicación nunca simula resultados de IA.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, startTestEnv, testImage } from './helpers';
import { setAiProviderForTests, startQueue } from '../server/ai/worker';
import { AiPermanentError, type AiProvider } from '../server/ai/provider';

let env: Awaited<ReturnType<typeof startTestEnv>>;
const admin = client(() => env.app);
let calls = 0;

const testProvider: AiProvider = {
  name: 'proveedor-de-prueba',
  model: 'ninguno',
  async analyzeProduct(images, ctx) {
    calls++;
    if (ctx.known.name === 'falla-permanente') throw new AiPermanentError('rechazado');
    if (calls === 1) throw new Error('fallo transitorio (p. ej. 529)');
    return { name: `Producto con ${images.length} fotos`, categoryName: 'Blusas', shortDescription: 'Descripción sugerida', colors: ['Rojo'], uncertain: [] };
  },
  async suggestGroups(thumbs) {
    return { groups: [thumbs.map((_, i) => i)] };
  },
};

beforeAll(async () => {
  env = await startTestEnv(54392);
  setAiProviderForTests(testProvider);
  startQueue();
});
afterAll(async () => {
  setAiProviderForTests(null);
  await env?.stop();
});

async function waitFor(fn: () => Promise<boolean>, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('tiempo agotado');
}

describe('Cola de IA', () => {
  it('procesa en segundo plano, reintenta fallos transitorios y respeta datos del usuario', async () => {
    await admin.post('/api/auth/setup', { name: 'A', email: 'a@a.mx', password: 'contrasena-1' });
    const b = (await admin.post('/api/businesses', { name: '[PRUEBA] IA' })).body;
    const batch = (await admin.post(`/api/b/${b.id}/batches`, { name: 'lote ia' })).body;
    await admin.upload(`/api/b/${b.id}/batches/${batch.id}/photos`, [
      { name: 'blusa_1.jpg', data: await testImage(1) },
      { name: 'blusa_2.jpg', data: await testImage(2) },
      { name: 'otra.jpg', data: await testImage(3) },
    ]);
    await admin.post(`/api/b/${b.id}/batches/${batch.id}/group`);
    let detail = (await admin.get(`/api/b/${b.id}/batches/${batch.id}`)).body;
    const blusa = detail.rows.find((r: any) => r.mediaIds.length === 2);
    const otra = detail.rows.find((r: any) => r.mediaIds.length === 1);
    await admin.patch(`/api/b/${b.id}/batches/${batch.id}/rows`, { rows: [{ id: otra.id, data: { name: 'falla-permanente' } }] });

    const q = await admin.post(`/api/b/${b.id}/batches/${batch.id}/ai`, {});
    expect(q.body.queued).toBe(2);
    await waitFor(async () => {
      detail = (await admin.get(`/api/b/${b.id}/batches/${batch.id}`)).body;
      return detail.rows.every((r: any) => ['done', 'failed'].includes(r.aiStatus));
    });
    const b1 = detail.rows.find((r: any) => r.id === blusa.id);
    const o1 = detail.rows.find((r: any) => r.id === otra.id);
    expect(b1.aiStatus).toBe('done');
    expect(b1.data.name).toBe('Producto con 2 fotos');
    expect(b1.fieldMeta.name).toMatchObject({ source: 'ai_inferred', review: true });
    expect(o1.aiStatus).toBe('failed'); // error permanente: no se reintenta
    expect(o1.aiError).toMatch(/rechazado/);
    expect(o1.data.name).toBe('falla-permanente'); // dato del usuario intacto

    // Reintentar elementos fallidos
    const retry = await admin.post(`/api/b/${b.id}/batches/${batch.id}/ai`, { rowIds: [otra.id] });
    expect(retry.body.queued).toBe(1);

    // Confirmar campos sugeridos los saca de revisión
    await admin.patch(`/api/b/${b.id}/batches/${batch.id}/rows`, { rows: [{ id: blusa.id, confirmFields: ['name', 'categoryName', 'shortDescription', 'colors'] }] });
    detail = (await admin.get(`/api/b/${b.id}/batches/${batch.id}`)).body;
    expect(detail.rows.find((r: any) => r.id === blusa.id).fieldMeta.name.review).toBe(false);
  });
});
