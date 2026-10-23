import type { AiSuggestion } from '../db/schema';

export type AiImage = { data: Buffer; mime: 'image/jpeg' | 'image/png' | 'image/webp' };

export type AnalyzeContext = {
  businessName: string;
  businessDescription: string;
  categories: string[];
  /** Datos que el usuario o la hoja de cálculo ya proporcionaron (la IA no debe contradecirlos). */
  known: Record<string, unknown>;
};

export type GroupingResult = { groups: number[][]; notes?: string };

/**
 * Contrato de un proveedor de IA con visión. Para añadir otro proveedor basta con implementar
 * esta interfaz y registrarlo en getAiProvider().
 */
export interface AiProvider {
  readonly name: string;
  readonly model: string;
  analyzeProduct(images: AiImage[], ctx: AnalyzeContext): Promise<AiSuggestion>;
  suggestGroups(thumbs: AiImage[]): Promise<GroupingResult>;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super('La IA no está configurada: define ANTHROPIC_API_KEY en el servidor para habilitarla.');
  }
}

/** Errores que no tiene sentido reintentar (solicitud inválida, rechazo, credenciales). */
export class AiPermanentError extends Error {}
