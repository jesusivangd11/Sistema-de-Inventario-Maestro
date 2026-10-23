import ExcelJS from 'exceljs';
import Papa from 'papaparse';

export type Table = { headers: string[]; rows: Record<string, string>[] };

/** Máximo de filas por archivo importado (protege memoria y evita lotes inmanejables). */
export const MAX_IMPORT_ROWS = 5000;

function limitRows(t: Table): Table {
  if (t.rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`El archivo tiene ${t.rows.length} filas; el máximo por importación es ${MAX_IMPORT_ROWS}. Divídelo en varios archivos.`);
  }
  return t;
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return v.result === undefined || v.result === null ? '' : String(v.result);
    if ('hyperlink' in v) return String((v as { hyperlink: string }).hyperlink);
    return '';
  }
  return String(v);
}

/** Lee CSV o XLSX (primera hoja con datos). La primera fila no vacía se usa como encabezados. */
export async function parseSpreadsheet(data: Buffer, fileName: string): Promise<Table> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt') || lower.endsWith('.tsv')) {
    let text = data.toString('utf8');
    if (text.includes('�')) text = data.toString('latin1'); // archivos guardados por Excel en Windows-1252
    text = text.replace(/^﻿/, '');
    const res = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
    const [head, ...body] = res.data;
    if (!head) return { headers: [], rows: [] };
    const headers = uniqueHeaders(head);
    return limitRows({ headers, rows: body.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))) });
  }
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(data as unknown as ArrayBuffer);
    } catch {
      throw new Error('No se pudo leer el archivo .xlsx (¿está dañado o protegido con contraseña?)');
    }
    const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
    if (ws && ws.actualRowCount > MAX_IMPORT_ROWS + 50) {
      throw new Error(`El archivo tiene más de ${MAX_IMPORT_ROWS} filas; divídelo en varios archivos.`);
    }
    if (!ws) return { headers: [], rows: [] };
    let headerRow = 1;
    while (headerRow < ws.rowCount && !ws.getRow(headerRow).hasValues) headerRow++;
    const hr = ws.getRow(headerRow);
    const raw: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) raw.push(cellText(hr.getCell(c).value).trim());
    const headers = uniqueHeaders(raw);
    const rows: Record<string, string>[] = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (!row.hasValues) continue;
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => (obj[h] = cellText(row.getCell(i + 1).value).trim()));
      if (Object.values(obj).some(Boolean)) rows.push(obj);
    }
    return limitRows({ headers, rows });
  }
  throw new Error('Formato no soportado. Usa .csv o .xlsx');
}

function uniqueHeaders(raw: string[]) {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    const base = h.trim() || `Columna ${i + 1}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base} (${n + 1})` : base;
  });
}

export async function writeXlsx(sheets: { name: string; headers: string[]; rows: (string | number | null)[][]; note?: string }[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Catálogo Maestro';
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    let start = 1;
    if (s.note) {
      ws.getCell(1, 1).value = s.note;
      ws.getCell(1, 1).font = { bold: true, color: { argb: 'FFB45309' } };
      start = 3;
    }
    const hr = ws.getRow(start);
    s.headers.forEach((h, i) => {
      const c = hr.getCell(i + 1);
      c.value = h;
      c.font = { bold: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    });
    s.rows.forEach((r, ri) => {
      const row = ws.getRow(start + 1 + ri);
      r.forEach((v, ci) => (row.getCell(ci + 1).value = v));
    });
    s.headers.forEach((h, i) => (ws.getColumn(i + 1).width = Math.min(48, Math.max(12, h.length + 4))));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toCsv(headers: string[], rows: (string | number | null)[][]) {
  // Valores que Excel interpretaría como fórmula (=, +, @, -texto) se prefijan con apóstrofo.
  const safe = (v: string | number | null) => (v === null ? '' : typeof v === 'string' && /^[=+@\t\r]|^-[^\d]/.test(v) ? `'${v}` : v);
  return '﻿' + Papa.unparse({ fields: headers, data: rows.map((r) => r.map(safe)) });
}
