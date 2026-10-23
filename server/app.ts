import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { config } from './config';
import { HttpError, badRequest } from './lib/errors';
import { loadUser } from './lib/auth';
import { authRoutes } from './routes/auth';
import { businessRoutes } from './routes/businesses';
import { productRoutes } from './routes/products';
import { importRoutes } from './routes/imports';
import { catalogRoutes } from './routes/catalogs';
import { channelRoutes } from './routes/channels';
import { publicRoutes } from './routes/public';
import { dashboardRoutes } from './routes/dashboard';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function buildApp(opts: { logger?: boolean; serveWeb?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ? { level: 'info' } : false, bodyLimit: 10 * 1024 * 1024, trustProxy: true });

  await app.register(cookie, { secret: config.appSecret });
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 200, fields: 50 } });

  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    // Protección CSRF: toda petición que modifica datos debe incluir un encabezado personalizado,
    // que un sitio externo no puede enviar sin permiso CORS (no habilitado).
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'catalogo-maestro') {
      throw new HttpError(403, 'Solicitud rechazada (falta encabezado de seguridad)');
    }
    await loadUser(req);
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return reply.status(400).send({ error: `Datos inválidos: ${issues.map((i) => (i.path ? `${i.path}: ` : '') + i.message).join('; ')}`, issues });
    }
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, details: err.details });
    // Los errores de PostgreSQL llegan envueltos por Drizzle (DrizzleQueryError.cause)
    const wrapped = err as { cause?: { code?: string; constraint?: string } };
    const e = { ...(err as object), ...(wrapped.cause?.code ? wrapped.cause : {}) } as { code?: string; statusCode?: number; message: string; constraint?: string };
    e.message = (err as Error).message;
    if (e.code === '23505') return reply.status(409).send({ error: 'Ya existe un registro con esos datos (valor duplicado).', constraint: e.constraint });
    if (e.code === '23503') return reply.status(400).send({ error: 'La referencia no es válida para este negocio.', constraint: e.constraint });
    if (e.code === '23514') return reply.status(400).send({ error: 'Un valor no cumple las reglas de la base de datos.', constraint: e.constraint });
    if (e.code === 'FST_REQ_FILE_TOO_LARGE') return reply.status(413).send({ error: `Archivo demasiado grande (máx. ${config.maxUploadBytes / 1024 / 1024} MB).` });
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: e.message });
    req.log.error(err);
    console.error(err);
    return reply.status(500).send({ error: 'Error interno del servidor. El detalle quedó registrado.' });
  });

  await app.register(authRoutes);
  await app.register(dashboardRoutes);
  await app.register(businessRoutes);
  await app.register(productRoutes);
  await app.register(importRoutes);
  await app.register(catalogRoutes);
  await app.register(channelRoutes);
  await app.register(publicRoutes);

  const webDist = path.resolve(here, '../web/dist');
  if (opts.serveWeb !== false && fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      // Rutas de API y archivos inexistentes (con extensión) → 404; el resto es navegación de la SPA.
      if (req.url.startsWith('/api/') || req.url.startsWith('/public/') || /\.[a-z0-9]{2,5}(\?|$)/i.test(req.url)) {
        return reply.status(404).send({ error: 'No encontrado' });
      }
      return reply.sendFile('index.html');
    });
  }
  return app;
}

export type UploadedFile = { fileName: string; data: Buffer; mime: string };

/** Lee archivos y campos de una petición multipart, con límites de tamaño aplicados por el plugin. */
export async function readMultipart(req: FastifyRequest) {
  if (!req.isMultipart()) throw badRequest('Se esperaba un formulario con archivos');
  const files: UploadedFile[] = [];
  const fields: Record<string, string> = {};
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const data = await part.toBuffer();
      if (part.file.truncated) throw new HttpError(413, `El archivo ${part.filename} supera el tamaño máximo`);
      files.push({ fileName: path.basename(part.filename || 'archivo'), data, mime: part.mimetype });
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }
  return { files, fields };
}
