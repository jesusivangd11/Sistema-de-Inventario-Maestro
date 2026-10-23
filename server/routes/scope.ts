import type { FastifyInstance } from 'fastify';
import { resolveBusiness } from '../lib/auth';

/** Registra rutas bajo /api/b/:businessId con verificación de acceso al negocio en cada petición. */
export function bizScope(app: FastifyInstance, register: (scoped: FastifyInstance) => void | Promise<void>) {
  return app.register(
    async (scoped) => {
      scoped.addHook('preHandler', resolveBusiness);
      await register(scoped);
    },
    { prefix: '/api/b/:businessId' },
  );
}

export const idParam = (req: { params: unknown }, key = 'id') => {
  const v = (req.params as Record<string, string>)[key];
  if (!/^[0-9a-f-]{36}$/i.test(v ?? '')) {
    const e = new Error('Identificador inválido') as Error & { statusCode: number };
    e.statusCode = 404;
    throw e;
  }
  return v;
};
