const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

export function slugify(s: string) {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Código en mayúsculas sin acentos ni espacios: code("Rosa", 3) → "ROS". */
export function code(s: string, len: number) {
  return stripAccents(s)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, len);
}

export const normalizeKey = (s: string) =>
  stripAccents(s)
    .toLowerCase()
    .replace(/[*()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

export const splitList = (v: unknown): string[] =>
  v === null || v === undefined
    ? []
    : (Array.isArray(v) ? v : String(v).split(/[,;|]/))
        .map((x) => String(x).trim())
        .filter(Boolean);
