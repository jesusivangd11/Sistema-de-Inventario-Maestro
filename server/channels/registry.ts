import { mercadolibre } from './mercadolibre';
import { tiktok } from './tiktok';
import type { ChannelAdapter } from './types';
import { notFound } from '../lib/errors';

/**
 * Registro de canales. Para añadir un marketplace nuevo: crear su adaptador (validaciones,
 * sinónimos de plantilla, columnas de preparación) y agregarlo aquí. El catálogo maestro no cambia.
 */
export const CHANNELS: Record<string, ChannelAdapter> = {
  [mercadolibre.id]: mercadolibre,
  [tiktok.id]: tiktok,
};

export function getChannel(id: string): ChannelAdapter {
  const c = CHANNELS[id];
  if (!c) throw notFound(`Canal no soportado: ${id}`);
  return c;
}
