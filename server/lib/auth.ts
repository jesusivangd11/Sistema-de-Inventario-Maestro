import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb } from '../db/client';
import { businesses, memberships, sessions, users } from '../db/schema';
import { config } from '../config';
import { randomToken, sha256 } from './crypto';
import { forbidden, HttpError, notFound } from './errors';

export type AuthUser = { id: string; email: string; name: string; role: 'superadmin' | 'member' };
export type BizRole = 'superadmin' | 'admin' | 'operator';
export type BizContext = {
  id: string;
  name: string;
  slug: string;
  currency: string;
  role: BizRole;
};

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
    biz?: BizContext;
  }
}

export const SESSION_COOKIE = 'cm_session';

export async function createSession(reply: FastifyReply, userId: string, secure = false) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + config.sessionDays * 86400_000);
  await getDb().insert(sessions).values({ id: sha256(token), userId, expiresAt });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    expires: expiresAt,
  });
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await getDb().delete(sessions).where(eq(sessions.id, sha256(token)));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Carga el usuario de la sesión (si existe) en cada solicitud. */
export async function loadUser(req: FastifyRequest) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return;
  const rows = await getDb()
    .select({ id: users.id, email: users.email, name: users.name, role: users.role, active: users.active })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const u = rows[0];
  if (u && u.active) req.user = { id: u.id, email: u.email, name: u.name, role: u.role };
}

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw new HttpError(401, 'Inicia sesión para continuar');
  return req.user;
}

export function requireSuperadmin(req: FastifyRequest) {
  const u = requireUser(req);
  if (u.role !== 'superadmin') throw forbidden('Solo el administrador general puede realizar esta acción');
  return u;
}

/**
 * Resuelve el negocio de la ruta /api/b/:businessId y verifica que el usuario tenga acceso.
 * Es la barrera principal de aislamiento: todas las consultas posteriores filtran por req.biz.id.
 */
export async function resolveBusiness(req: FastifyRequest) {
  const user = requireUser(req);
  const { businessId } = req.params as { businessId?: string };
  if (!businessId || !/^[0-9a-f-]{36}$/i.test(businessId)) throw notFound('Negocio no encontrado');
  const db = getDb();
  const [b] = await db
    .select({ id: businesses.id, name: businesses.name, slug: businesses.slug, currency: businesses.currency })
    .from(businesses)
    .where(and(eq(businesses.id, businessId), isNull(businesses.archivedAt)))
    .limit(1);
  if (!b) throw notFound('Negocio no encontrado');
  let role: BizRole;
  if (user.role === 'superadmin') {
    role = 'superadmin';
  } else {
    const [m] = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, user.id), eq(memberships.businessId, businessId)))
      .limit(1);
    // 404 en lugar de 403: no se revela la existencia de negocios ajenos.
    if (!m) throw notFound('Negocio no encontrado');
    role = m.role;
  }
  req.biz = { ...b, role };
}

export function biz(req: FastifyRequest): BizContext {
  if (!req.biz) throw new Error('Contexto de negocio no resuelto');
  return req.biz;
}

export function requireBizAdmin(req: FastifyRequest) {
  const b = biz(req);
  if (b.role === 'operator') throw forbidden('Esta acción requiere rol de administrador del negocio');
  return b;
}

/** IDs de negocios a los que el usuario tiene acceso (null = todos, administrador general). */
export async function accessibleBusinessIds(user: AuthUser): Promise<string[] | null> {
  if (user.role === 'superadmin') return null;
  const rows = await getDb()
    .select({ id: memberships.businessId })
    .from(memberships)
    .where(eq(memberships.userId, user.id));
  return rows.map((r) => r.id);
}
