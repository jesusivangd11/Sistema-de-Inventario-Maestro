import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  primaryKey,
  unique,
  index,
  foreignKey,
  check,
  bigserial,
} from 'drizzle-orm/pg-core';

/*
 * Aislamiento multinegocio:
 * Toda tabla con datos de un negocio lleva `business_id`. Las relaciones internas usan
 * llaves foráneas compuestas (business_id, id), de modo que PostgreSQL rechaza, por ejemplo,
 * una variante o fotografía que apunte a un producto de otro negocio.
 */

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export type FieldDef = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select';
  options?: string[];
  required?: boolean;
  unit?: string;
};

/** Origen de un dato de la ficha: lo capturó el usuario, se importó, lo leyó la IA en la foto, o la IA lo infirió. */
export type FieldSource = 'user' | 'import' | 'ai_detected' | 'ai_inferred';
export type FieldMeta = Record<string, { source: FieldSource; review?: boolean; note?: string }>;

// ───────────────────────── Usuarios y sesiones ─────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  /** superadmin = administrador general (todos los negocios). member = acceso según membresías. */
  role: text('role', { enum: ['superadmin', 'member'] }).notNull().default('member'),
  active: boolean('active').notNull().default(true),
  ...timestamps,
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(), // hash SHA-256 del token; el token en claro solo vive en la cookie
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

// ───────────────────────── Negocios ─────────────────────────

export const businesses = pgTable(
  'businesses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    logoKey: text('logo_key'),
    primaryColor: text('primary_color').notNull().default('#4f46e5'),
    secondaryColor: text('secondary_color').notNull().default('#0f172a'),
    currency: text('currency').notNull().default('MXN'),
    locale: text('locale').notNull().default('es-MX'),
    /** Patrón de SKU de producto. Tokens: {CAT} {SEQ} {YY} {PREFIX} */
    skuPattern: text('sku_pattern').notNull().default('{CAT}-{SEQ}'),
    /** Patrón de SKU de variante. Tokens: {SKU} {COLOR} {SIZE} {OPT} */
    variantSkuPattern: text('variant_sku_pattern').notNull().default('{SKU}-{COLOR}-{SIZE}'),
    skuPrefix: text('sku_prefix').notNull().default(''),
    skuSeqDigits: integer('sku_seq_digits').notNull().default(3),
    isDemo: boolean('is_demo').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [check('businesses_currency_chk', sql`char_length(${t.currency}) = 3`)],
);

export const memberships = pgTable(
  'memberships',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['admin', 'operator'] }).notNull().default('operator'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.businessId] })],
);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    /** Código corto usado en el SKU ({CAT}). */
    code: text('code').notNull(),
    fields: jsonb('fields').$type<FieldDef[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [
    unique('categories_business_id_uq').on(t.businessId, t.id),
    unique('categories_name_uq').on(t.businessId, t.parentId, t.name).nullsNotDistinct(),
    foreignKey({ name: 'categories_parent_fk', columns: [t.businessId, t.parentId], foreignColumns: [t.businessId, t.id] }),
  ],
);

export const collections = pgTable(
  'collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['season', 'collection'] }).notNull().default('collection'),
    description: text('description').notNull().default(''),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique('collections_business_id_uq').on(t.businessId, t.id),
    unique('collections_name_uq').on(t.businessId, t.name),
  ],
);

export const skuCounters = pgTable(
  'sku_counters',
  {
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    prefix: text('prefix').notNull(),
    value: integer('value').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.prefix] })],
);

// ───────────────────────── Catálogo maestro ─────────────────────────

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    brand: text('brand'),
    model: text('model'),
    categoryId: uuid('category_id'),
    shortDescription: text('short_description').notNull().default(''),
    longDescription: text('long_description').notNull().default(''),
    cost: numeric('cost', { precision: 12, scale: 2 }),
    price: numeric('price', { precision: 12, scale: 2 }),
    promoPrice: numeric('promo_price', { precision: 12, scale: 2 }),
    currency: text('currency').notNull().default('MXN'),
    material: text('material'),
    /** Medidas del producto en cm: { length, width, height } */
    dimensions: jsonb('dimensions').$type<{ length?: number; width?: number; height?: number }>(),
    weightGrams: integer('weight_grams'),
    keywords: text('keywords').array().notNull().default(sql`'{}'::text[]`),
    attributes: jsonb('attributes').$type<Record<string, string | number>>().notNull().default({}),
    fieldMeta: jsonb('field_meta').$type<FieldMeta>().notNull().default({}),
    status: text('status', { enum: ['draft', 'active', 'archived'] }).notNull().default('draft'),
    /** Problemas de completitud calculados al guardar (para filtros y tablero). */
    issues: text('issues').array().notNull().default(sql`'{}'::text[]`),
    totalStock: integer('total_stock').notNull().default(0),
    mediaCount: integer('media_count').notNull().default(0),
    isDemo: boolean('is_demo').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique('products_business_id_uq').on(t.businessId, t.id),
    unique('products_sku_uq').on(t.businessId, t.sku),
    foreignKey({ name: 'products_category_fk', columns: [t.businessId, t.categoryId], foreignColumns: [categories.businessId, categories.id] }),
    index('products_business_status_idx').on(t.businessId, t.status),
    index('products_business_created_idx').on(t.businessId, t.createdAt),
    check('products_price_chk', sql`${t.price} IS NULL OR ${t.price} >= 0`),
    check('products_cost_chk', sql`${t.cost} IS NULL OR ${t.cost} >= 0`),
    check('products_promo_chk', sql`${t.promoPrice} IS NULL OR ${t.promoPrice} >= 0`),
  ],
);

export const variants = pgTable(
  'variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id').notNull(),
    productId: uuid('product_id').notNull(),
    sku: text('sku').notNull(),
    barcode: text('barcode'),
    color: text('color'),
    size: text('size'),
    /** Otras opciones (presentación, modelo, etc.) */
    options: jsonb('options').$type<Record<string, string>>().notNull().default({}),
    stock: integer('stock').notNull().default(0),
    cost: numeric('cost', { precision: 12, scale: 2 }),
    price: numeric('price', { precision: 12, scale: 2 }),
    weightGrams: integer('weight_grams'),
    dimensions: jsonb('dimensions').$type<{ length?: number; width?: number; height?: number }>(),
    status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique('variants_business_id_uq').on(t.businessId, t.id),
    unique('variants_sku_uq').on(t.businessId, t.sku),
    foreignKey({ name: 'variants_product_fk', columns: [t.businessId, t.productId], foreignColumns: [products.businessId, products.id] }).onDelete('cascade'),
    index('variants_product_idx').on(t.productId),
    check('variants_stock_chk', sql`${t.stock} >= 0`),
  ],
);

export const productCollections = pgTable(
  'product_collections',
  {
    businessId: uuid('business_id').notNull(),
    productId: uuid('product_id').notNull(),
    collectionId: uuid('collection_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.collectionId] }),
    foreignKey({ name: 'pc_product_fk', columns: [t.businessId, t.productId], foreignColumns: [products.businessId, products.id] }).onDelete('cascade'),
    foreignKey({ name: 'pc_collection_fk', columns: [t.businessId, t.collectionId], foreignColumns: [collections.businessId, collections.id] }).onDelete('cascade'),
    index('pc_collection_idx').on(t.collectionId),
  ],
);

export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    collectionId: uuid('collection_id'),
    status: text('status', { enum: ['draft', 'committed', 'partially_committed', 'cancelled'] })
      .notNull()
      .default('draft'),
    summary: jsonb('summary').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique('batches_business_id_uq').on(t.businessId, t.id),
    foreignKey({ name: 'batches_collection_fk', columns: [t.businessId, t.collectionId], foreignColumns: [collections.businessId, collections.id] }),
  ],
);

export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    productId: uuid('product_id'),
    variantId: uuid('variant_id'),
    batchId: uuid('batch_id'),
    storageKey: text('storage_key').notNull(),
    thumbKey: text('thumb_key').notNull(),
    originalName: text('original_name').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    sha256: text('sha256').notNull(),
    /** Hash perceptual (dHash 64 bits en hex) para detectar fotos casi idénticas. */
    phash: text('phash').notNull(),
    position: integer('position').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('media_business_id_uq').on(t.businessId, t.id),
    foreignKey({ name: 'media_product_fk', columns: [t.businessId, t.productId], foreignColumns: [products.businessId, products.id] }).onDelete('set null'),
    foreignKey({ name: 'media_variant_fk', columns: [t.businessId, t.variantId], foreignColumns: [variants.businessId, variants.id] }).onDelete('set null'),
    foreignKey({ name: 'media_batch_fk', columns: [t.businessId, t.batchId], foreignColumns: [importBatches.businessId, importBatches.id] }).onDelete('set null'),
    index('media_product_idx').on(t.productId),
    index('media_business_sha_idx').on(t.businessId, t.sha256),
  ],
);

export type ImportRowData = {
  name?: string;
  sku?: string;
  brand?: string;
  model?: string;
  categoryName?: string;
  shortDescription?: string;
  longDescription?: string;
  cost?: number | null;
  price?: number | null;
  promoPrice?: number | null;
  material?: string;
  weightGrams?: number | null;
  keywords?: string[];
  colors?: string[];
  sizes?: string[];
  stockPerVariant?: number | null;
  barcode?: string;
  attributes?: Record<string, string>;
  /** Variantes explícitas (p. ej. una fila de Excel por talla/color con su propio stock). */
  variants?: { color?: string; size?: string; stock?: number | null; sku?: string; barcode?: string; price?: number | null }[];
  /** Nombres de archivo de fotos indicados en la hoja de cálculo. */
  imageNames?: string[];
};

export type AiSuggestion = {
  name?: string;
  title?: string;
  categoryName?: string;
  shortDescription?: string;
  longDescription?: string;
  keywords?: string[];
  colors?: string[];
  visibleText?: string;
  brandVisible?: string | null;
  materialOnLabel?: string | null;
  sizeOnLabel?: string | null;
  attributes?: { key: string; value: string; basis: 'visible' | 'inferred' }[];
  uncertain?: string[];
  differentProductsWarning?: string | null;
  /** Consumo real reportado por la API (para estimar costos). */
  usage?: { model: string; inputTokens: number; outputTokens: number };
};

export const importRows = pgTable(
  'import_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id').notNull(),
    batchId: uuid('batch_id').notNull(),
    position: integer('position').notNull().default(0),
    data: jsonb('data').$type<ImportRowData>().notNull().default({}),
    fieldMeta: jsonb('field_meta').$type<FieldMeta>().notNull().default({}),
    mediaIds: uuid('media_ids').array().notNull().default(sql`'{}'::uuid[]`),
    status: text('status', { enum: ['pending', 'valid', 'error', 'committed', 'skipped'] })
      .notNull()
      .default('pending'),
    errors: jsonb('errors').$type<string[]>().notNull().default([]),
    warnings: jsonb('warnings').$type<string[]>().notNull().default([]),
    aiStatus: text('ai_status', { enum: ['none', 'queued', 'processing', 'done', 'failed'] })
      .notNull()
      .default('none'),
    aiError: text('ai_error'),
    aiAttempts: integer('ai_attempts').notNull().default(0),
    aiSuggestion: jsonb('ai_suggestion').$type<AiSuggestion>(),
    productId: uuid('product_id'),
    source: text('source', { enum: ['photos', 'spreadsheet', 'manual'] }).notNull().default('manual'),
    ...timestamps,
  },
  (t) => [
    foreignKey({ name: 'rows_batch_fk', columns: [t.businessId, t.batchId], foreignColumns: [importBatches.businessId, importBatches.id] }).onDelete('cascade'),
    foreignKey({ name: 'rows_product_fk', columns: [t.businessId, t.productId], foreignColumns: [products.businessId, products.id] }).onDelete('set null'),
    index('rows_batch_idx').on(t.batchId, t.position),
    index('rows_ai_idx').on(t.aiStatus),
  ],
);

// ───────────────────────── Catálogos comerciales ─────────────────────────

export type CatalogItem = { productId: string; mediaId?: string | null };

export const catalogs = pgTable(
  'catalogs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    subtitle: text('subtitle').notNull().default(''),
    layout: text('layout', { enum: ['grid2', 'grid3', 'list'] }).notNull().default('grid2'),
    showPrices: boolean('show_prices').notNull().default(true),
    showVariants: boolean('show_variants').notNull().default(true),
    showDescription: boolean('show_description').notNull().default(true),
    showSku: boolean('show_sku').notNull().default(false),
    items: jsonb('items').$type<CatalogItem[]>().notNull().default([]),
    publicToken: text('public_token').unique(),
    ...timestamps,
  },
  (t) => [unique('catalogs_business_id_uq').on(t.businessId, t.id)],
);

// ───────────────────────── Canales de venta ─────────────────────────

export const channelSettings = pgTable(
  'channel_settings',
  {
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    /** Credenciales API cifradas (AES-256-GCM). Nunca se devuelven al navegador. */
    credentialsEnc: text('credentials_enc'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.channel] })],
);

export type TemplateColumn = {
  index: number; // columna (1 = A)
  header: string;
  required: boolean;
  hint?: string;
};

export const channelTemplates = pgTable(
  'channel_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    name: text('name').notNull(),
    originalName: text('original_name').notNull(),
    storageKey: text('storage_key').notNull(),
    sheetName: text('sheet_name').notNull(),
    headerRow: integer('header_row').notNull(),
    dataStartRow: integer('data_start_row').notNull(),
    columns: jsonb('columns').$type<TemplateColumn[]>().notNull(),
    /** índice de columna → expresión de campo (p. ej. "product.name", "variant.sku", "image:1", "attr:BRAND", "const:Nuevo") */
    mapping: jsonb('mapping').$type<Record<string, string>>().notNull().default({}),
    externalCategoryId: text('external_category_id'),
    ...timestamps,
  },
  (t) => [unique('templates_business_id_uq').on(t.businessId, t.id)],
);

export const productChannels = pgTable(
  'product_channels',
  {
    businessId: uuid('business_id').notNull(),
    productId: uuid('product_id').notNull(),
    channel: text('channel').notNull(),
    externalCategoryId: text('external_category_id'),
    externalCategoryName: text('external_category_name'),
    /** Atributos específicos del canal (p. ej. GENDER, SEASON de Mercado Libre) */
    attributes: jsonb('attributes').$type<Record<string, string>>().notNull().default({}),
    externalId: text('external_id'),
    /**
     * none            → nunca exportado
     * file_generated  → incluido en un archivo generado (NO significa publicado)
     * linked          → el usuario vinculó un identificador externo tras publicar en el marketplace
     */
    status: text('status', { enum: ['none', 'file_generated', 'linked'] }).notNull().default('none'),
    lastExportId: uuid('last_export_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.channel] }),
    foreignKey({ name: 'pch_product_fk', columns: [t.businessId, t.productId], foreignColumns: [products.businessId, products.id] }).onDelete('cascade'),
    index('pch_business_channel_idx').on(t.businessId, t.channel),
  ],
);

export const variantChannelLinks = pgTable(
  'variant_channel_links',
  {
    businessId: uuid('business_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    channel: text('channel').notNull(),
    externalId: text('external_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.variantId, t.channel] }),
    foreignKey({ name: 'vcl_variant_fk', columns: [t.businessId, t.variantId], foreignColumns: [variants.businessId, variants.id] }).onDelete('cascade'),
  ],
);

export type ExportIssue = { level: 'error' | 'warning'; message: string; field?: string };

export const exportsTable = pgTable(
  'exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    templateId: uuid('template_id'),
    format: text('format', { enum: ['official_template', 'internal_prep'] }).notNull(),
    fileKey: text('file_key').notNull(),
    fileName: text('file_name').notNull(),
    productCount: integer('product_count').notNull(),
    rowCount: integer('row_count').notNull(),
    warningCount: integer('warning_count').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('exports_business_id_uq').on(t.businessId, t.id),
    index('exports_business_idx').on(t.businessId, t.createdAt),
  ],
);

export const exportItems = pgTable(
  'export_items',
  {
    businessId: uuid('business_id').notNull(),
    exportId: uuid('export_id').notNull(),
    productId: uuid('product_id').notNull(),
    issues: jsonb('issues').$type<ExportIssue[]>().notNull().default([]),
  },
  (t) => [
    primaryKey({ columns: [t.exportId, t.productId] }),
    foreignKey({ name: 'ei_export_fk', columns: [t.businessId, t.exportId], foreignColumns: [exportsTable.businessId, exportsTable.id] }).onDelete('cascade'),
    foreignKey({ name: 'ei_product_fk', columns: [t.businessId, t.productId], foreignColumns: [products.businessId, products.id] }).onDelete('cascade'),
  ],
);

/** Caché de metadatos oficiales de categorías externas (p. ej. API pública de Mercado Libre). */
export const externalCategoryCache = pgTable(
  'external_category_cache',
  {
    channel: text('channel').notNull(),
    categoryId: text('category_id').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.channel, t.categoryId] })],
);

/**
 * Cola de operaciones de sincronización por API (Etapa 3).
 * Se registra la intención; mientras no exista integración, el estado es "pending_integration".
 */
export const channelOperations = pgTable(
  'channel_operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    operation: text('operation').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status', { enum: ['pending_integration', 'queued', 'running', 'succeeded', 'failed'] })
      .notNull()
      .default('pending_integration'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    ...timestamps,
  },
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_business_idx').on(t.businessId, t.createdAt)],
);
