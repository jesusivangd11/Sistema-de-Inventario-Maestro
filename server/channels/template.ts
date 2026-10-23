import ExcelJS from 'exceljs';
import type { TemplateColumn } from '../db/schema';
import { normalizeKey } from '../lib/text';
import type { ExportProduct, ExportVariant } from './types';

/*
 * Motor de plantillas oficiales.
 * Mercado Libre y TikTok Shop entregan plantillas de carga masiva distintas por categoría, que se
 * descargan desde la cuenta del vendedor. En lugar de suponer columnas, el sistema lee la plantilla
 * que sube el usuario, detecta encabezados y columnas obligatorias, y la llena con el catálogo maestro.
 */

const REQ_WORDS = /\b(obligatorio|obligatoria|requerido|required|mandatory)\b/i;
const DESC_WORDS = /\b(obligatorio|opcional|optional|mandatory|required|ejemplo|example|instrucci|descripci[oó]n del campo|formato)\b/i;
const SKIP_SHEETS = /instruc|ayuda|help|lista|valores|values|guide|gu[ií]a|ejemplo|example|dropdown|hidden|config/i;

function text(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return v.result == null ? '' : String(v.result);
    return '';
  }
  return String(v);
}

function noteText(cell: ExcelJS.Cell): string | undefined {
  const n = cell.note;
  if (!n) return undefined;
  if (typeof n === 'string') return n;
  return n.texts?.map((t) => t.text).join('') || undefined;
}

export type SheetAnalysis = {
  sheetName: string;
  headerRow: number;
  dataStartRow: number;
  columns: TemplateColumn[];
};

/** Normaliza un encabezado: sin acentos, sin *, paréntesis ni guiones bajos ("Package Weight(kg)*" → "package weight kg"). */
export function headerKey(h: string) {
  return normalizeKey(h.replace(/[()[\]_/]/g, ' '))
    .replace(/[:.*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function analyzeTemplate(data: Buffer, synonyms: Record<string, string[]> = {}): Promise<{ sheets: SheetAnalysis[]; best: SheetAnalysis }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    throw new Error('No se pudo leer la plantilla. Debe ser un archivo .xlsx descargado del marketplace (si es .xls o .xlsm, ábrelo y guárdalo como .xlsx).');
  }
  const sheets: (SheetAnalysis & { score: number })[] = [];
  for (const ws of wb.worksheets) {
    if (ws.state && ws.state !== 'visible') continue;
    const a = analyzeSheet(ws, undefined, undefined, synonyms);
    if (a && a.columns.length >= 3) sheets.push({ ...a, score: Object.keys(autoMap(a.columns, synonyms)).length });
  }
  if (!sheets.length) throw new Error('No se encontró una hoja con encabezados en la plantilla');
  const rank = (list: typeof sheets) => [...list].sort((a, b) => b.score - a.score || b.columns.length - a.columns.length)[0];
  const best = rank(sheets.filter((s) => !SKIP_SHEETS.test(s.sheetName))) ?? rank(sheets);
  return { sheets, best };
}

function textCells(ws: ExcelJS.Worksheet, r: number, maxCol: number) {
  const row = ws.getRow(r);
  const out: { c: number; t: string }[] = [];
  for (let c = 1; c <= maxCol; c++) {
    const t = text(row.getCell(c).value).replace(/\s+/g, ' ').trim();
    if (t) out.push({ c, t });
  }
  return out;
}

/**
 * Elige la fila de encabezados: entre las filas con más celdas de texto corto, la que más columnas
 * reconoce el canal; se penalizan filas de claves internas (snake_case), frecuentes en plantillas
 * que tienen una fila técnica y otra legible.
 */
function analyzeSheet(ws: ExcelJS.Worksheet, forcedHeaderRow?: number, forcedDataStart?: number, synonyms: Record<string, string[]> = {}): SheetAnalysis | null {
  const maxCol = Math.min(ws.columnCount, 300);
  const scanRows = Math.min(ws.rowCount, 20);
  let headerRow = forcedHeaderRow ?? 0;
  if (!headerRow) {
    const counts: { r: number; n: number; cells: { c: number; t: string }[] }[] = [];
    for (let r = 1; r <= scanRows; r++) {
      const cells = textCells(ws, r, maxCol).filter((x) => x.t.length <= 80 && !/^\d+([.,]\d+)?$/.test(x.t));
      counts.push({ r, n: cells.length, cells });
    }
    const max = Math.max(0, ...counts.map((x) => x.n));
    if (!max) return null;
    let bestScore = -Infinity;
    for (const x of counts.filter((x) => x.n >= max * 0.6)) {
      const cols = x.cells.map((cell) => ({ index: cell.c, header: cell.t, required: false }));
      const recognized = Object.keys(autoMap(cols, synonyms)).length;
      const technical = x.cells.filter((cell) => /^[a-z0-9]+(_[a-z0-9]+)+$/.test(cell.t)).length;
      const score = recognized * 3 + x.n - technical * 4;
      if (score > bestScore) {
        bestScore = score;
        headerRow = x.r;
      }
    }
  }
  if (!headerRow) return null;
  const hr = ws.getRow(headerRow);
  const columns: TemplateColumn[] = [];
  for (let c = 1; c <= maxCol; c++) {
    const cell = hr.getCell(c);
    const header = text(cell.value).replace(/\s+/g, ' ').trim();
    if (!header) continue;
    columns.push({ index: c, header, required: /\*/.test(header) || REQ_WORDS.test(header), hint: noteText(cell) });
  }
  const markRequired = (r: number) => {
    const row = ws.getRow(r);
    for (const col of columns) {
      const t = text(row.getCell(col.index).value).trim();
      if (t.length <= 40 && REQ_WORDS.test(t) && !/opcional|optional/i.test(t)) col.required = true;
    }
  };
  // Indicadores Obligatorio/Mandatory en filas cortas sobre el encabezado
  for (let r = Math.max(1, headerRow - 3); r < headerRow; r++) markRequired(r);
  // Filas descriptivas bajo el encabezado (Obligatorio/Opcional, instrucciones, ejemplos…)
  let dataStartRow = forcedDataStart ?? headerRow + 1;
  for (let r = headerRow + 1; r <= Math.min(ws.rowCount, headerRow + 6); r++) {
    const row = ws.getRow(r);
    const cells = columns.map((col) => text(row.getCell(col.index).value).trim());
    const filled = cells.filter(Boolean);
    if (!filled.length) break;
    const descriptive = filled.filter((t) => DESC_WORDS.test(t) || t.length > 60).length >= Math.max(1, filled.length / 3);
    if (!descriptive) break;
    markRequired(r);
    cells.forEach((t, i) => {
      if (t && !columns[i].hint && t.length > 12) columns[i].hint = t.slice(0, 300);
    });
    if (!forcedDataStart) dataStartRow = r + 1;
  }
  return { sheetName: ws.name, headerRow, dataStartRow, columns };
}

export async function reanalyze(data: Buffer, sheetName: string, headerRow: number, dataStartRow?: number, synonyms: Record<string, string[]> = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error(`La hoja "${sheetName}" no existe en la plantilla`);
  const a = analyzeSheet(ws, headerRow, dataStartRow, synonyms);
  if (!a) throw new Error('No se encontraron encabezados en esa fila');
  return a;
}

/** Campos disponibles para mapear columnas de plantillas. */
export const FIELD_EXPRESSIONS: { value: string; label: string }[] = [
  { value: 'product.title', label: 'Título (nombre, recortado al máximo del canal)' },
  { value: 'product.name', label: 'Nombre comercial' },
  { value: 'product.description', label: 'Descripción (larga o corta)' },
  { value: 'product.shortDescription', label: 'Descripción corta' },
  { value: 'product.sku', label: 'SKU del producto (padre)' },
  { value: 'product.brand', label: 'Marca' },
  { value: 'product.model', label: 'Modelo / referencia' },
  { value: 'product.material', label: 'Material / composición' },
  { value: 'product.category', label: 'Categoría interna' },
  { value: 'product.externalCategoryId', label: 'ID de categoría del canal' },
  { value: 'product.externalCategoryName', label: 'Nombre de categoría del canal' },
  { value: 'product.keywords', label: 'Palabras clave' },
  { value: 'product.weightGrams', label: 'Peso (g)' },
  { value: 'product.weightKg', label: 'Peso (kg)' },
  { value: 'dim.length', label: 'Largo (cm)' },
  { value: 'dim.width', label: 'Ancho (cm)' },
  { value: 'dim.height', label: 'Alto (cm)' },
  { value: 'variant.sku', label: 'SKU de la variante' },
  { value: 'variant.color', label: 'Color de la variante' },
  { value: 'variant.size', label: 'Talla de la variante' },
  { value: 'variant.stock', label: 'Existencias de la variante' },
  { value: 'variant.price', label: 'Precio (variante o producto)' },
  { value: 'variant.salePrice', label: 'Precio promocional' },
  { value: 'variant.barcode', label: 'Código de barras / GTIN' },
  { value: 'product.currency', label: 'Moneda' },
  ...Array.from({ length: 9 }, (_, i) => ({ value: `image:${i + 1}`, label: `URL de imagen ${i + 1}` })),
  { value: 'images:all', label: 'URLs de todas las imágenes (separadas por coma)' },
];

/**
 * Sugerencia automática de mapeo: coincidencia exacta con los sinónimos del canal; si no hay,
 * el sinónimo más largo con el que empieza el encabezado ("Retail Price (Local Currency)" → precio).
 */
export function autoMap(columns: TemplateColumn[], synonyms: Record<string, string[]>, attributeNames: { id: string; name: string }[] = []) {
  const mapping: Record<string, string> = {};
  const imageCounter = { n: 0 };
  const exact = new Map<string, string>();
  const prefixes: { key: string; expr: string; open: boolean }[] = [];
  for (const [expr, syns] of Object.entries(synonyms)) {
    for (const s of syns) {
      const open = s.endsWith('…');
      const key = headerKey(open ? s.slice(0, -1) : s);
      if (!open && !exact.has(key)) exact.set(key, expr);
      if (open || key.length >= 5) prefixes.push({ key, expr, open });
    }
  }
  prefixes.sort((a, b) => b.key.length - a.key.length);
  const used = new Set<string>();
  for (const col of columns) {
    const h = headerKey(col.header);
    let expr = exact.get(h) ?? '';
    if (!expr) expr = prefixes.find((p) => (p.open ? h.startsWith(p.key) : h.startsWith(`${p.key} `)))?.expr ?? '';
    if (expr === 'image:auto') {
      const m = h.match(/(\d+)/);
      expr = `image:${m ? Number(m[1]) : ++imageCounter.n}`;
    }
    if (!expr) {
      const attr = attributeNames.find((a) => headerKey(a.name) === h);
      if (attr) expr = `attr:${attr.id}`;
    }
    // Una misma imagen no se asigna a dos columnas
    if (expr.startsWith('image:') && used.has(expr)) expr = '';
    if (expr) {
      mapping[String(col.index)] = expr;
      used.add(expr);
    }
  }
  return mapping;
}

export function resolveExpr(expr: string, p: ExportProduct, v: ExportVariant, opts: { titleMax?: number; attrResolver?: (id: string, p: ExportProduct, v: ExportVariant) => string | null }) {
  if (!expr) return null;
  if (expr.startsWith('const:')) return expr.slice(6);
  if (expr.startsWith('image:')) return p.images[Number(expr.slice(6)) - 1]?.url ?? null;
  if (expr === 'images:all') return p.images.map((i) => i.url).join(',') || null;
  if (expr.startsWith('attr:')) {
    const id = expr.slice(5);
    return opts.attrResolver?.(id, p, v) ?? p.channel.attributes[id] ?? (p.attributes[id] !== undefined ? String(p.attributes[id]) : null);
  }
  switch (expr) {
    case 'product.title': {
      const t = p.channel.attributes.__title || p.name;
      return opts.titleMax ? t.slice(0, opts.titleMax) : t;
    }
    case 'product.name':
      return p.name;
    case 'product.description':
      return p.longDescription || p.shortDescription || null;
    case 'product.shortDescription':
      return p.shortDescription || null;
    case 'product.sku':
      return p.sku;
    case 'product.brand':
      return p.brand;
    case 'product.model':
      return p.model;
    case 'product.material':
      return p.material;
    case 'product.category':
      return p.categoryName;
    case 'product.externalCategoryId':
      return p.channel.externalCategoryId;
    case 'product.externalCategoryName':
      return p.channel.externalCategoryName;
    case 'product.keywords':
      return p.keywords.join(', ') || null;
    case 'product.weightGrams':
      return p.weightGrams !== null ? String(p.weightGrams) : null;
    case 'product.weightKg':
      return p.weightGrams !== null ? String(Math.round(p.weightGrams) / 1000) : null;
    case 'product.currency':
      return p.currency;
    case 'dim.length':
    case 'dim.width':
    case 'dim.height': {
      const d = p.dimensions?.[expr.slice(4) as 'length' | 'width' | 'height'];
      return d !== undefined ? String(d) : null;
    }
    case 'variant.sku':
      return v.sku;
    case 'variant.color':
      return v.color;
    case 'variant.size':
      return v.size;
    case 'variant.stock':
      return String(v.stock);
    case 'variant.price': {
      const price = v.price ?? p.price;
      return price !== null ? price.toFixed(2) : null;
    }
    case 'variant.salePrice':
      return p.promoPrice !== null ? p.promoPrice.toFixed(2) : null;
    case 'variant.barcode':
      return v.barcode;
    default:
      return null;
  }
}

/** Llena la plantilla oficial (conservando sus demás hojas) con una fila por variante. */
export async function fillTemplate(
  data: Buffer,
  tpl: { sheetName: string; dataStartRow: number; columns: TemplateColumn[]; mapping: Record<string, string> },
  rows: { p: ExportProduct; v: ExportVariant }[],
  opts: Parameters<typeof resolveExpr>[3],
) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const ws = wb.getWorksheet(tpl.sheetName);
  if (!ws) throw new Error(`La hoja "${tpl.sheetName}" no existe en la plantilla`);
  // Se limpian filas de ejemplo que pudieran existir en la zona de datos.
  for (let r = tpl.dataStartRow; r <= ws.rowCount; r++) for (const col of tpl.columns) ws.getRow(r).getCell(col.index).value = null;
  rows.forEach(({ p, v }, i) => {
    const row = ws.getRow(tpl.dataStartRow + i);
    for (const col of tpl.columns) {
      const expr = tpl.mapping[String(col.index)];
      if (!expr) continue;
      const val = resolveExpr(expr, p, v, opts);
      if (val !== null && val !== '') row.getCell(col.index).value = /^(variant\.(stock|price|salePrice)|product\.weight|dim\.)/.test(expr) && !Number.isNaN(Number(val)) ? Number(val) : val;
    }
    row.commit();
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
