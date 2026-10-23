/**
 * Datos de demostración (opcional): `npm run seed`
 * Crea dos negocios marcados como [DEMO] con categorías, colección, productos con variantes y fotos generadas.
 * Si no existe ningún usuario, crea un administrador de demostración con DEMO_ADMIN_EMAIL / DEMO_ADMIN_PASSWORD.
 * Los datos demo se identifican con is_demo = true y el prefijo [DEMO]; no se mezclan con negocios reales.
 */
import sharp from 'sharp';
import { eq, sql } from 'drizzle-orm';
import { assertSecret, config } from '../server/config';
import { connect, disconnect, getDb } from '../server/db/client';
import { startEmbeddedPostgres } from '../server/db/embedded';
import { runMigrations } from '../server/db/migrate';
import { businesses, categories, collections, users } from '../server/db/schema';
import { hashPassword, sha256 } from '../server/lib/crypto';
import { saveProduct } from '../server/services/products';
import { storeImage } from '../server/services/media';

async function demoPhoto(seed: number, hue: number) {
  const size = 1200;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="100%" height="100%" fill="hsl(${hue},35%,92%)"/>
    <circle cx="${300 + (seed % 5) * 120}" cy="${400 + (seed % 3) * 100}" r="${260 + (seed % 4) * 30}" fill="hsl(${hue},55%,${45 + (seed % 3) * 8}%)"/>
    <rect x="${500 - (seed % 4) * 60}" y="650" width="420" height="300" rx="40" fill="hsl(${(hue + 40) % 360},45%,55%)"/>
    <text x="50%" y="1120" font-family="Arial" font-size="56" text-anchor="middle" fill="#334155">FOTO DEMO ${seed}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

async function main() {
  assertSecret();
  let stop: (() => Promise<void>) | null = null;
  let url = config.databaseUrl;
  if (!url) {
    const pg = await startEmbeddedPostgres({ dir: config.pgDir, port: config.pgPort, database: 'catalogo', password: sha256(`pg:${config.appSecret}`).slice(0, 32) });
    url = pg.url;
    stop = pg.stop;
  }
  const db = connect(url);
  await runMigrations(db);

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  let adminId: string;
  if (n === 0) {
    const email = process.env.DEMO_ADMIN_EMAIL || 'demo@catalogo.local';
    const password = process.env.DEMO_ADMIN_PASSWORD;
    if (!password || password.length < 8) throw new Error('Define DEMO_ADMIN_PASSWORD (mín. 8 caracteres) en .env para crear el administrador de demostración.');
    const [u] = await db.insert(users).values({ email, name: 'Administrador demo', passwordHash: await hashPassword(password), role: 'superadmin' }).returning();
    adminId = u.id;
    console.log(`Administrador demo creado: ${email} (contraseña en DEMO_ADMIN_PASSWORD)`);
  } else {
    adminId = (await db.select({ id: users.id }).from(users).where(eq(users.role, 'superadmin')).limit(1))[0].id;
  }

  const exists = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.isDemo, true));
  if (exists.length) {
    console.log('Los negocios demo ya existen; no se duplican.');
  } else {
    const specs = [
      {
        name: '[DEMO] Ropa de Temporada',
        color: '#be185d',
        cats: [
          { name: 'Pijamas', fields: [{ key: 'composicion', label: 'Composición', type: 'text' as const }] },
          { name: 'Chamarras', fields: [] },
        ],
        products: [
          { name: '[DEMO] Pijama térmica de dos piezas', cat: 0, price: 399, cost: 180, colors: ['Rosa', 'Negra'], sizes: ['Chica', 'Mediana', 'Grande'], hue: 330 },
          { name: '[DEMO] Chamarra acolchada con capucha', cat: 1, price: 899, cost: 420, colors: ['Negro', 'Verde olivo'], sizes: ['M', 'G'], hue: 140 },
        ],
      },
      {
        name: '[DEMO] Fajas Colombianas',
        color: '#0f766e',
        cats: [{ name: 'Fajas', fields: [{ key: 'compresion', label: 'Tipo de compresión', type: 'select' as const, options: ['Media', 'Alta'], required: true }] }],
        products: [{ name: '[DEMO] Faja reductora postparto', cat: 0, price: 1099, cost: 520, colors: ['Beige', 'Negro'], sizes: ['XS', 'S', 'M', 'L'], hue: 30, attributes: { compresion: 'Alta' } }],
      },
    ];
    let seed = 1;
    for (const s of specs) {
      const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const [b] = await db.insert(businesses).values({ name: s.name, slug, primaryColor: s.color, isDemo: true, description: 'Negocio de demostración' }).returning();
      const catIds: string[] = [];
      for (const c of s.cats) {
        const [row] = await db.insert(categories).values({ businessId: b.id, name: c.name, code: c.name.slice(0, 3).toUpperCase(), fields: c.fields }).returning();
        catIds.push(row.id);
      }
      const [col] = await db.insert(collections).values({ businessId: b.id, name: 'Otoño-invierno 2026', kind: 'season' }).returning();
      for (const p of s.products) {
        const id = await db.transaction((tx) =>
          saveProduct(tx, { businessId: b.id, userId: adminId, isDemo: true }, {
            name: p.name,
            categoryId: catIds[p.cat],
            price: p.price,
            cost: p.cost,
            status: 'active',
            shortDescription: 'Producto de demostración.',
            attributes: (p as { attributes?: Record<string, string> }).attributes ?? {},
            collectionIds: [col.id],
            variants: p.colors.flatMap((color) => p.sizes.map((size) => ({ color, size, stock: 3 }))),
          }),
        );
        for (let i = 0; i < 2; i++) await storeImage(getDb(), { businessId: b.id, productId: id, fileName: `demo_${seed}.jpg`, data: await demoPhoto(seed++, p.hue + i * 20) });
      }
      console.log(`Negocio demo creado: ${s.name}`);
    }
  }
  await disconnect();
  if (stop) await stop();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
