import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { AiSuggestion } from '../db/schema';
import { AiPermanentError, type AiImage, type AiProvider, type AnalyzeContext, type GroupingResult } from './provider';

const SuggestionSchema = z.object({
  name: z.string().describe('Nombre comercial corto del producto, en español'),
  title: z.string().describe('Título comercial para marketplace (máx. ~60 caracteres), sin inventar marca'),
  categoryName: z.string().describe('Categoría propuesta; usa una de las existentes si aplica'),
  shortDescription: z.string(),
  longDescription: z.string(),
  keywords: z.array(z.string()),
  colors: z.array(z.string()).describe('Colores visibles en las fotos'),
  visibleText: z.string().describe('Texto legible en etiquetas o empaques, transcrito literalmente; vacío si no hay'),
  brandVisible: z.string().nullable().describe('Marca SOLO si se lee claramente en la foto; si no, null'),
  materialOnLabel: z.string().nullable().describe('Material/composición SOLO si aparece en una etiqueta legible; si no, null'),
  sizeOnLabel: z.string().nullable().describe('Talla SOLO si aparece legible en una etiqueta; si no, null'),
  attributes: z
    .array(
      z.object({
        key: z.string(),
        value: z.string(),
        basis: z.enum(['visible', 'inferred']).describe('visible = se observa directamente; inferred = deducción'),
      }),
    )
    .describe('Características visuales (corte, estampado, tipo de manga, cierre, etc.)'),
  uncertain: z.array(z.string()).describe('Campos o datos sobre los que no hay certeza y deben revisarse'),
  differentProductsWarning: z
    .string()
    .nullable()
    .describe('Si las fotos parecen mostrar productos DISTINTOS (no variantes), explícalo; si no, null'),
});

const GroupSchema = z.object({
  groups: z.array(z.array(z.number().int())).describe('Grupos de índices de imagen que muestran el mismo modelo de producto'),
  notes: z.string(),
});

const SYSTEM = `Eres un asistente de catalogación para tiendas en México. Analizas fotografías de productos y propones datos para una ficha.
Reglas estrictas:
- Escribe en español de México, tono comercial claro, sin exageraciones.
- NO inventes marcas, materiales, composiciones, medidas, certificaciones ni beneficios médicos. Solo repórtalos si se leen en una etiqueta visible.
- Distingue lo que se ve directamente (visible) de lo que deduces (inferred).
- Si algo es incierto, déjalo vacío o en null y agrégalo a "uncertain".
- Las descripciones deben basarse solo en lo observable y en los datos conocidos proporcionados.`;

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private client: Anthropic;
  constructor(
    apiKey: string,
    readonly model: string,
    private effort: 'low' | 'medium' | 'high',
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2 });
  }

  private async run<T extends z.ZodType>(schema: T, content: Anthropic.Beta.BetaContentBlockParam[]): Promise<z.infer<T> & { usage: { model: string; inputTokens: number; outputTokens: number } }> {
    try {
      const res = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        system: SYSTEM,
        // Si el modelo principal rechaza la solicitud, la API la reintenta en un modelo alterno.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: this.effort, format: betaZodOutputFormat(schema) },
        messages: [{ role: 'user', content }],
      });
      if (res.stop_reason === 'refusal') throw new AiPermanentError('El modelo rechazó analizar estas imágenes');
      if (res.stop_reason === 'max_tokens') throw new Error('Respuesta de IA incompleta (límite de tokens)');
      if (!res.parsed_output) throw new Error('La IA no devolvió datos en el formato esperado');
      const u = res.usage;
      const usage = {
        model: res.model,
        inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        outputTokens: u.output_tokens ?? 0,
      };
      return { ...(res.parsed_output as object), usage } as z.infer<T> & { usage: typeof usage };
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
        throw new AiPermanentError('API key de IA inválida o sin permisos');
      }
      if (e instanceof Anthropic.BadRequestError) throw new AiPermanentError(`Solicitud rechazada por la API de IA: ${e.message}`);
      throw e; // 429/5xx/red: reintentable
    }
  }

  async analyzeProduct(images: AiImage[], ctx: AnalyzeContext): Promise<AiSuggestion> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mime, data: img.data.toString('base64') },
    }));
    content.push({
      type: 'text',
      text: [
        `Negocio: ${ctx.businessName}${ctx.businessDescription ? ` — ${ctx.businessDescription}` : ''}`,
        `Categorías existentes: ${ctx.categories.length ? ctx.categories.join(', ') : '(ninguna todavía)'}`,
        `Datos ya conocidos (no los contradigas): ${JSON.stringify(ctx.known)}`,
        `Las ${images.length} imágenes deberían corresponder a un mismo producto (posiblemente en varios colores). Propón la ficha.`,
      ].join('\n'),
    });
    return this.run(SuggestionSchema, content);
  }

  async suggestGroups(thumbs: AiImage[]): Promise<GroupingResult> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    thumbs.forEach((t, i) => {
      content.push({ type: 'text', text: `Imagen ${i}:` });
      content.push({ type: 'image', source: { type: 'base64', media_type: t.mime, data: t.data.toString('base64') } });
    });
    content.push({
      type: 'text',
      text: 'Agrupa los índices de imagen que muestran el MISMO modelo de producto (los colores distintos del mismo modelo van juntos). Cada índice debe aparecer exactamente una vez.',
    });
    return this.run(GroupSchema, content);
  }
}
