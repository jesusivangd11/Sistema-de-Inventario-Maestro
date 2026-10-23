import type { ExportIssue } from '../db/schema';

export type ExportVariant = {
  id: string;
  sku: string;
  color: string | null;
  size: string | null;
  stock: number;
  price: number | null;
  barcode: string | null;
  status: string;
};

export type ExportImage = { id: string; url: string; width: number; height: number; publicReady: boolean };

/** Vista normalizada de un producto del catálogo maestro, independiente del canal. */
export type ExportProduct = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  model: string | null;
  categoryName: string | null;
  shortDescription: string;
  longDescription: string;
  price: number | null;
  promoPrice: number | null;
  currency: string;
  material: string | null;
  weightGrams: number | null;
  dimensions: { length?: number; width?: number; height?: number } | null;
  keywords: string[];
  attributes: Record<string, string | number>;
  status: string;
  totalStock: number;
  variants: ExportVariant[];
  images: ExportImage[];
  channel: {
    externalCategoryId: string | null;
    externalCategoryName: string | null;
    attributes: Record<string, string>;
    externalId: string | null;
    status: string;
  };
};

export type ChannelCapability = { key: string; label: string; status: 'available' | 'pending'; note?: string };

export type FieldOption = { value: string; label: string };

export interface ChannelAdapter {
  id: string;
  name: string;
  market: string;
  /** Qué se contrastó con fuentes oficiales y qué no (se muestra en la interfaz). */
  verification: { verified: string[]; unverified: string[]; sources: { label: string; url: string }[] };
  capabilities: ChannelCapability[];
  /** Sinónimos de encabezados de plantilla → expresión de campo, para el mapeo automático. */
  headerSynonyms: Record<string, string[]>;
  /** Validaciones propias del canal (además de las columnas obligatorias de la plantilla). */
  validate(p: ExportProduct): Promise<ExportIssue[]>;
  /** Archivo de preparación cuando no se ha cargado plantilla oficial. */
  prepColumns(products: ExportProduct[]): Promise<{ headers: string[]; exprs: string[] }>;
  prepNote: string;
  titleMax?: number;
}
