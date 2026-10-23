CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" uuid,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"logo_key" text,
	"primary_color" text DEFAULT '#4f46e5' NOT NULL,
	"secondary_color" text DEFAULT '#0f172a' NOT NULL,
	"currency" text DEFAULT 'MXN' NOT NULL,
	"locale" text DEFAULT 'es-MX' NOT NULL,
	"sku_pattern" text DEFAULT '{CAT}-{SEQ}' NOT NULL,
	"variant_sku_pattern" text DEFAULT '{SKU}-{COLOR}-{SIZE}' NOT NULL,
	"sku_prefix" text DEFAULT '' NOT NULL,
	"sku_seq_digits" integer DEFAULT 3 NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "businesses_slug_unique" UNIQUE("slug"),
	CONSTRAINT "businesses_currency_chk" CHECK (char_length("businesses"."currency") = 3)
);
--> statement-breakpoint
CREATE TABLE "catalogs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"title" text NOT NULL,
	"subtitle" text DEFAULT '' NOT NULL,
	"layout" text DEFAULT 'grid2' NOT NULL,
	"show_prices" boolean DEFAULT true NOT NULL,
	"show_variants" boolean DEFAULT true NOT NULL,
	"show_description" boolean DEFAULT true NOT NULL,
	"show_sku" boolean DEFAULT false NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"public_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogs_public_token_unique" UNIQUE("public_token"),
	CONSTRAINT "catalogs_business_id_uq" UNIQUE("business_id","id")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_business_id_uq" UNIQUE("business_id","id"),
	CONSTRAINT "categories_name_uq" UNIQUE NULLS NOT DISTINCT("business_id","parent_id","name")
);
--> statement-breakpoint
CREATE TABLE "channel_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"operation" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending_integration' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_settings" (
	"business_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credentials_enc" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_settings_business_id_channel_pk" PRIMARY KEY("business_id","channel")
);
--> statement-breakpoint
CREATE TABLE "channel_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"name" text NOT NULL,
	"original_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"sheet_name" text NOT NULL,
	"header_row" integer NOT NULL,
	"data_start_row" integer NOT NULL,
	"columns" jsonb NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_category_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "templates_business_id_uq" UNIQUE("business_id","id")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'collection' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_business_id_uq" UNIQUE("business_id","id"),
	CONSTRAINT "collections_name_uq" UNIQUE("business_id","name")
);
--> statement-breakpoint
CREATE TABLE "export_items" (
	"business_id" uuid NOT NULL,
	"export_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "export_items_export_id_product_id_pk" PRIMARY KEY("export_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"template_id" uuid,
	"format" text NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"product_count" integer NOT NULL,
	"row_count" integer NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exports_business_id_uq" UNIQUE("business_id","id")
);
--> statement-breakpoint
CREATE TABLE "external_category_cache" (
	"channel" text NOT NULL,
	"category_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_category_cache_channel_category_id_pk" PRIMARY KEY("channel","category_id")
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"collection_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batches_business_id_uq" UNIQUE("business_id","id")
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"field_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_status" text DEFAULT 'none' NOT NULL,
	"ai_error" text,
	"ai_attempts" integer DEFAULT 0 NOT NULL,
	"ai_suggestion" jsonb,
	"product_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"batch_id" uuid,
	"storage_key" text NOT NULL,
	"thumb_key" text NOT NULL,
	"original_name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sha256" text NOT NULL,
	"phash" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_business_id_uq" UNIQUE("business_id","id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"user_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"role" text DEFAULT 'operator' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_id_business_id_pk" PRIMARY KEY("user_id","business_id")
);
--> statement-breakpoint
CREATE TABLE "product_channels" (
	"business_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"external_category_id" text,
	"external_category_name" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_id" text,
	"status" text DEFAULT 'none' NOT NULL,
	"last_export_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_channels_product_id_channel_pk" PRIMARY KEY("product_id","channel")
);
--> statement-breakpoint
CREATE TABLE "product_collections" (
	"business_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	CONSTRAINT "product_collections_product_id_collection_id_pk" PRIMARY KEY("product_id","collection_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"model" text,
	"category_id" uuid,
	"short_description" text DEFAULT '' NOT NULL,
	"long_description" text DEFAULT '' NOT NULL,
	"cost" numeric(12, 2),
	"price" numeric(12, 2),
	"promo_price" numeric(12, 2),
	"currency" text DEFAULT 'MXN' NOT NULL,
	"material" text,
	"dimensions" jsonb,
	"weight_grams" integer,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"field_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"issues" text[] DEFAULT '{}'::text[] NOT NULL,
	"total_stock" integer DEFAULT 0 NOT NULL,
	"media_count" integer DEFAULT 0 NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_business_id_uq" UNIQUE("business_id","id"),
	CONSTRAINT "products_sku_uq" UNIQUE("business_id","sku"),
	CONSTRAINT "products_price_chk" CHECK ("products"."price" IS NULL OR "products"."price" >= 0),
	CONSTRAINT "products_cost_chk" CHECK ("products"."cost" IS NULL OR "products"."cost" >= 0),
	CONSTRAINT "products_promo_chk" CHECK ("products"."promo_price" IS NULL OR "products"."promo_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sku_counters" (
	"business_id" uuid NOT NULL,
	"prefix" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sku_counters_business_id_prefix_pk" PRIMARY KEY("business_id","prefix")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "variant_channel_links" (
	"business_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"external_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variant_channel_links_variant_id_channel_pk" PRIMARY KEY("variant_id","channel")
);
--> statement-breakpoint
CREATE TABLE "variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"barcode" text,
	"color" text,
	"size" text,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"cost" numeric(12, 2),
	"price" numeric(12, 2),
	"weight_grams" integer,
	"dimensions" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variants_business_id_uq" UNIQUE("business_id","id"),
	CONSTRAINT "variants_sku_uq" UNIQUE("business_id","sku"),
	CONSTRAINT "variants_stock_chk" CHECK ("variants"."stock" >= 0)
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_fk" FOREIGN KEY ("business_id","parent_id") REFERENCES "public"."categories"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_operations" ADD CONSTRAINT "channel_operations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_settings" ADD CONSTRAINT "channel_settings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_templates" ADD CONSTRAINT "channel_templates_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_items" ADD CONSTRAINT "ei_export_fk" FOREIGN KEY ("business_id","export_id") REFERENCES "public"."exports"("business_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_items" ADD CONSTRAINT "ei_product_fk" FOREIGN KEY ("business_id","product_id") REFERENCES "public"."products"("business_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "batches_collection_fk" FOREIGN KEY ("business_id","collection_id") REFERENCES "public"."collections"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "rows_batch_fk" FOREIGN KEY ("business_id","batch_id") REFERENCES "public"."import_batches"("business_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "rows_product_fk" FOREIGN KEY ("business_id","product_id") REFERENCES "public"."products"("business_id","id") ON DELETE set null ("product_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_product_fk" FOREIGN KEY ("business_id","product_id") REFERENCES "public"."products"("business_id","id") ON DELETE set null ("product_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_variant_fk" FOREIGN KEY ("business_id","variant_id") REFERENCES "public"."variants"("business_id","id") ON DELETE set null ("variant_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_batch_fk" FOREIGN KEY ("business_id","batch_id") REFERENCES "public"."import_batches"("business_id","id") ON DELETE set null ("batch_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_channels" ADD CONSTRAINT "pch_product_fk" FOREIGN KEY ("business_id","product_id") REFERENCES "public"."products"("business_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_collections" ADD CONSTRAINT "pc_product_fk" FOREIGN KEY ("business_id","product_id") REFERENCES "public"."products"("business_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_collections" ADD CONSTRAINT "pc_collection_fk" FOREIGN KEY ("business_id","collection_id") REFERENCES "public"."collections"("business_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_fk" FOREIGN KEY ("business_id","category_id") REFERENCES "public"."categories"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_counters" ADD CONSTRAINT "sku_counters_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_channel_links" ADD CONSTRAINT "vcl_variant_fk" FOREIGN KEY ("business_id","variant_id") REFERENCES "public"."variants"("business_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_product_fk" FOREIGN KEY ("business_id","product_id") REFERENCES "public"."products"("business_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_business_idx" ON "audit_log" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "exports_business_idx" ON "exports" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "rows_batch_idx" ON "import_rows" USING btree ("batch_id","position");--> statement-breakpoint
CREATE INDEX "rows_ai_idx" ON "import_rows" USING btree ("ai_status");--> statement-breakpoint
CREATE INDEX "media_product_idx" ON "media" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "media_business_sha_idx" ON "media" USING btree ("business_id","sha256");--> statement-breakpoint
CREATE INDEX "pch_business_channel_idx" ON "product_channels" USING btree ("business_id","channel");--> statement-breakpoint
CREATE INDEX "pc_collection_idx" ON "product_collections" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "products_business_status_idx" ON "products" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "products_business_created_idx" ON "products" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "variants_product_idx" ON "variants" USING btree ("product_id");