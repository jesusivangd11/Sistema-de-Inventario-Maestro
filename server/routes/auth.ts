import type { FastifyInstance } from 'fastify';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { businesses, memberships, users } from '../db/schema';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { createSession, destroySession, requireSuperadmin, requireUser } from '../lib/auth';
import { badRequest, conflict, HttpError, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { aiStatus } from '../ai/worker';
import { config } from '../config';

const attempts = new Map<string, { n: number; until: number }>();

const passwordSchema = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200);

export async function authRoutes(app: FastifyInstance) {
  /** Para el proveedor de hosting / monitoreo: confirma que la app y la base responden. */
  app.get('/api/health', async () => {
    await getDb().execute(sql`SELECT 1`);
    return { ok: true };
  });

  app.get('/api/auth/status', async (req) => {
    const db = getDb();
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
    return {
      needsSetup: n === 0,
      user: req.user ?? null,
      ai: aiStatus(),
      publicBaseUrl: config.publicBaseUrl || null,
    };
  });

  /** Primer arranque: crea el administrador general. Solo funciona si no existe ningún usuario. */
  app.post('/api/auth/setup', async (req, reply) => {
    const input = z.object({ name: z.string().trim().min(1).max(120), email: z.string().trim().toLowerCase().email(), password: passwordSchema }).parse(req.body);
    const db = getDb();
    const user = await db.transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE users IN EXCLUSIVE MODE`);
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(users);
      if (n > 0) throw conflict('La plataforma ya fue configurada');
      const [u] = await tx
        .insert(users)
        .values({ name: input.name, email: input.email, passwordHash: await hashPassword(input.password), role: 'superadmin' })
        .returning({ id: users.id, email: users.email, name: users.name, role: users.role });
      await audit(tx, { userId: u.id, action: 'auth.setup', entity: 'user', entityId: u.id });
      return u;
    });
    await createSession(reply, user.id, req.protocol === 'https');
    return { user };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const input = z.object({ email: z.string().trim().toLowerCase(), password: z.string() }).parse(req.body);
    const key = `${req.ip}|${input.email}`;
    const a = attempts.get(key);
    if (a && a.n >= 5 && a.until > Date.now()) throw new HttpError(429, 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.');
    const [u] = await getDb().select().from(users).where(eq(users.email, input.email));
    if (!u || !u.active || !(await verifyPassword(input.password, u.passwordHash))) {
      attempts.set(key, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 60_000 });
      throw new HttpError(401, 'Correo o contraseña incorrectos');
    }
    attempts.delete(key);
    await createSession(reply, u.id, req.protocol === 'https');
    return { user: { id: u.id, email: u.email, name: u.name, role: u.role } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(req, reply);
    return { ok: true };
  });

  app.get('/api/me', async (req) => {
    const user = requireUser(req);
    const db = getDb();
    const list =
      user.role === 'superadmin'
        ? (
            await db
              .select({ id: businesses.id, name: businesses.name, slug: businesses.slug, primaryColor: businesses.primaryColor, logoKey: businesses.logoKey, currency: businesses.currency, isDemo: businesses.isDemo })
              .from(businesses)
              .where(isNull(businesses.archivedAt))
              .orderBy(asc(businesses.name))
          ).map((b) => ({ ...b, role: 'superadmin' as const }))
        : await db
            .select({ id: businesses.id, name: businesses.name, slug: businesses.slug, primaryColor: businesses.primaryColor, logoKey: businesses.logoKey, currency: businesses.currency, isDemo: businesses.isDemo, role: memberships.role })
            .from(memberships)
            .innerJoin(businesses, eq(businesses.id, memberships.businessId))
            .where(and(eq(memberships.userId, user.id), isNull(businesses.archivedAt)))
            .orderBy(asc(businesses.name));
    return { user, businesses: list.map(({ logoKey, ...b }) => ({ ...b, hasLogo: Boolean(logoKey) })) };
  });

  app.post('/api/me/password', async (req) => {
    const user = requireUser(req);
    const input = z.object({ current: z.string(), next: passwordSchema }).parse(req.body);
    const db = getDb();
    const [u] = await db.select().from(users).where(eq(users.id, user.id));
    if (!(await verifyPassword(input.current, u.passwordHash))) throw badRequest('La contraseña actual no es correcta');
    await db.update(users).set({ passwordHash: await hashPassword(input.next), updatedAt: new Date() }).where(eq(users.id, user.id));
    return { ok: true };
  });

  // ───────────── Administración de usuarios (administrador general) ─────────────

  app.get('/api/users', async (req) => {
    requireSuperadmin(req);
    const db = getDb();
    const us = await db.select({ id: users.id, email: users.email, name: users.name, role: users.role, active: users.active, createdAt: users.createdAt }).from(users).orderBy(asc(users.name));
    const ms = await db.select({ userId: memberships.userId, businessId: memberships.businessId, role: memberships.role, businessName: businesses.name }).from(memberships).innerJoin(businesses, eq(businesses.id, memberships.businessId));
    return us.map((u) => ({ ...u, memberships: ms.filter((m) => m.userId === u.id) }));
  });

  const membershipList = z.array(z.object({ businessId: z.string().uuid(), role: z.enum(['admin', 'operator']) }));

  app.post('/api/users', async (req) => {
    const admin = requireSuperadmin(req);
    const input = z
      .object({
        name: z.string().trim().min(1).max(120),
        email: z.string().trim().toLowerCase().email(),
        password: passwordSchema,
        role: z.enum(['superadmin', 'member']).default('member'),
        memberships: membershipList.default([]),
      })
      .parse(req.body);
    const db = getDb();
    return db.transaction(async (tx) => {
      const exists = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email));
      if (exists.length) throw conflict('Ya existe un usuario con ese correo');
      const [u] = await tx
        .insert(users)
        .values({ name: input.name, email: input.email, passwordHash: await hashPassword(input.password), role: input.role })
        .returning({ id: users.id, email: users.email, name: users.name, role: users.role });
      if (input.memberships.length) await tx.insert(memberships).values(input.memberships.map((m) => ({ ...m, userId: u.id })));
      await audit(tx, { userId: admin.id, action: 'user.create', entity: 'user', entityId: u.id, details: { email: u.email, role: u.role } });
      return u;
    });
  });

  app.patch('/api/users/:id', async (req) => {
    const admin = requireSuperadmin(req);
    const { id } = req.params as { id: string };
    const input = z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        role: z.enum(['superadmin', 'member']).optional(),
        active: z.boolean().optional(),
        password: passwordSchema.optional(),
        memberships: membershipList.optional(),
      })
      .parse(req.body);
    if (id === admin.id && (input.active === false || input.role === 'member')) throw badRequest('No puedes desactivarte ni quitarte el rol de administrador general a ti mismo');
    const db = getDb();
    return db.transaction(async (tx) => {
      const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, id));
      if (!u) throw notFound('Usuario no encontrado');
      const set: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
      if (input.name) set.name = input.name;
      if (input.role) set.role = input.role;
      if (input.active !== undefined) set.active = input.active;
      if (input.password) set.passwordHash = await hashPassword(input.password);
      await tx.update(users).set(set).where(eq(users.id, id));
      if (input.memberships) {
        await tx.delete(memberships).where(eq(memberships.userId, id));
        if (input.memberships.length) await tx.insert(memberships).values(input.memberships.map((m) => ({ ...m, userId: id })));
      }
      await audit(tx, { userId: admin.id, action: 'user.update', entity: 'user', entityId: id, details: { ...input, password: input.password ? '***' : undefined } });
      return { ok: true };
    });
  });
}
