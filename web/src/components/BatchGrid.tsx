import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, ImageOff, Loader2, Sparkles, XCircle } from 'lucide-react';
import { Checkbox } from '../ui';

export type BatchRow = {
  id: string;
  position: number;
  source: 'photos' | 'spreadsheet' | 'manual';
  data: Record<string, any>;
  fieldMeta: Record<string, { source: string; review?: boolean; note?: string }>;
  mediaIds: string[];
  status: 'pending' | 'valid' | 'error' | 'committed' | 'skipped';
  errors: string[];
  warnings: string[];
  aiStatus: 'none' | 'queued' | 'processing' | 'done' | 'failed';
  aiError: string | null;
  productId: string | null;
};

type ColType = 'text' | 'number' | 'list' | 'int';
export type Col = { key: string; label: string; type: ColType; width: number };

export const GRID_COLS: Col[] = [
  { key: 'name', label: 'Nombre *', type: 'text', width: 220 },
  { key: 'categoryName', label: 'Categoría', type: 'text', width: 130 },
  { key: 'price', label: 'Precio *', type: 'number', width: 90 },
  { key: 'cost', label: 'Costo', type: 'number', width: 80 },
  { key: 'colors', label: 'Colores', type: 'list', width: 130 },
  { key: 'sizes', label: 'Tallas', type: 'list', width: 120 },
  { key: 'stockPerVariant', label: 'Existencias c/u', type: 'int', width: 100 },
  { key: 'brand', label: 'Marca', type: 'text', width: 110 },
  { key: 'material', label: 'Material', type: 'text', width: 130 },
  { key: 'shortDescription', label: 'Descripción corta', type: 'text', width: 220 },
  { key: 'sku', label: 'SKU', type: 'text', width: 110 },
  { key: 'promoPrice', label: 'Precio promo', type: 'number', width: 95 },
];

export function displayValue(row: BatchRow, col: Col): string {
  if ((col.key === 'colors' || col.key === 'sizes' || col.key === 'stockPerVariant') && row.data.variants?.length) {
    if (col.key === 'stockPerVariant') return `${row.data.variants.length} variantes`;
    const vals = [...new Set(row.data.variants.map((v: any) => v[col.key === 'colors' ? 'color' : 'size']).filter(Boolean))];
    return vals.join(', ');
  }
  const v = row.data[col.key];
  if (v === undefined || v === null) return '';
  return Array.isArray(v) ? v.join(', ') : String(v);
}

export function parseValue(col: Col, raw: string): { ok: true; value: any } | { ok: false; error: string } {
  const t = raw.trim();
  if (col.type === 'list') return { ok: true, value: t ? t.split(/[,;|]/).map((s) => s.trim()).filter(Boolean) : [] };
  if (col.type === 'number' || col.type === 'int') {
    if (!t) return { ok: true, value: null };
    const n = Number(t.replace(/[$,\s]/g, ''));
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: `"${raw}" no es un número válido` };
    return { ok: true, value: col.type === 'int' ? Math.round(n) : Math.round(n * 100) / 100 };
  }
  return { ok: true, value: t };
}

const isLocked = (row: BatchRow, col: Col) => row.status === 'committed' || (Boolean(row.data.variants?.length) && ['colors', 'sizes', 'stockPerVariant'].includes(col.key));

type Pos = { r: number; c: number };

export function BatchGrid({
  rows,
  thumbUrl,
  selected,
  setSelected,
  onEdit,
  onOpenRow,
  onError,
}: {
  rows: BatchRow[];
  thumbUrl: (mediaId: string) => string;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  onEdit: (changes: { rowId: string; key: string; value: any }[]) => void;
  onOpenRow: (row: BatchRow) => void;
  onError: (msg: string) => void;
}) {
  const [active, setActive] = useState<Pos | null>(null);
  const [anchor, setAnchor] = useState<Pos | null>(null);
  const [editing, setEditing] = useState<{ pos: Pos; value: string } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const cols = GRID_COLS;

  const range = useMemo(() => {
    if (!active) return null;
    const a = anchor ?? active;
    return { r0: Math.min(a.r, active.r), r1: Math.max(a.r, active.r), c0: Math.min(a.c, active.c), c1: Math.max(a.c, active.c) };
  }, [active, anchor]);

  const inRange = (r: number, c: number) => range && r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1;

  const commitEdit = useCallback(
    (pos: Pos, raw: string) => {
      const row = rows[pos.r];
      const col = cols[pos.c];
      if (!row || isLocked(row, col)) return;
      const parsed = parseValue(col, raw);
      if (!parsed.ok) return onError(parsed.error);
      onEdit([{ rowId: row.id, key: col.key, value: parsed.value }]);
    },
    [rows, cols, onEdit, onError],
  );

  const move = (dr: number, dc: number, extend = false) => {
    setActive((p) => {
      const cur = p ?? { r: 0, c: 0 };
      const next = { r: Math.max(0, Math.min(rows.length - 1, cur.r + dr)), c: Math.max(0, Math.min(cols.length - 1, cur.c + dc)) };
      if (extend) setAnchor((a) => a ?? cur);
      else setAnchor(null);
      return next;
    });
  };

  const applyToRange = (fn: (r: number, c: number) => any) => {
    if (!range) return;
    const changes: { rowId: string; key: string; value: any }[] = [];
    for (let r = range.r0; r <= range.r1; r++) {
      for (let c = range.c0; c <= range.c1; c++) {
        const row = rows[r];
        if (!row || isLocked(row, cols[c])) continue;
        changes.push({ rowId: row.id, key: cols[c].key, value: fn(r, c) });
      }
    }
    if (changes.length) onEdit(changes);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing || !active) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'ArrowDown') (e.preventDefault(), move(1, 0, e.shiftKey));
    else if (e.key === 'ArrowUp') (e.preventDefault(), move(-1, 0, e.shiftKey));
    else if (e.key === 'ArrowRight') (e.preventDefault(), move(0, 1, e.shiftKey));
    else if (e.key === 'ArrowLeft') (e.preventDefault(), move(0, -1, e.shiftKey));
    else if (e.key === 'Tab') (e.preventDefault(), move(0, e.shiftKey ? -1 : 1));
    else if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      const row = rows[active.r];
      if (row && !isLocked(row, cols[active.c])) setEditing({ pos: active, value: displayValue(row, cols[active.c]) });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      applyToRange((_r, c) => (cols[c].type === 'list' ? [] : cols[c].type === 'text' ? '' : null));
    } else if (mod && e.key.toLowerCase() === 'd') {
      // Rellenar hacia abajo con el valor de la primera fila del rango
      e.preventDefault();
      if (!range) return;
      applyToRange((_r, c) => {
        const parsed = parseValue(cols[c], displayValue(rows[range.r0], cols[c]));
        return parsed.ok ? parsed.value : null;
      });
    } else if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setAnchor({ r: 0, c: 0 });
      setActive({ r: rows.length - 1, c: cols.length - 1 });
    } else if (e.key.length === 1 && !mod && !e.altKey) {
      const row = rows[active.r];
      if (row && !isLocked(row, cols[active.c])) setEditing({ pos: active, value: e.key });
      e.preventDefault();
    }
  };

  const onCopy = (e: React.ClipboardEvent) => {
    if (editing || !range) return;
    e.preventDefault();
    const lines: string[] = [];
    for (let r = range.r0; r <= range.r1; r++) {
      const cells: string[] = [];
      for (let c = range.c0; c <= range.c1; c++) cells.push(displayValue(rows[r], cols[c]).replace(/[\t\n]/g, ' '));
      lines.push(cells.join('\t'));
    }
    e.clipboardData.setData('text/plain', lines.join('\n'));
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (editing || !active) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain').replace(/\r/g, '').replace(/\n$/, '');
    if (!text) return;
    const matrix = text.split('\n').map((l) => l.split('\t'));
    const changes: { rowId: string; key: string; value: any }[] = [];
    const errors: string[] = [];
    // Un solo valor pegado sobre un rango → se repite en todo el rango
    if (matrix.length === 1 && matrix[0].length === 1 && range && (range.r1 > range.r0 || range.c1 > range.c0)) {
      for (let r = range.r0; r <= range.r1; r++)
        for (let c = range.c0; c <= range.c1; c++) {
          if (isLocked(rows[r], cols[c])) continue;
          const p = parseValue(cols[c], matrix[0][0]);
          if (p.ok) changes.push({ rowId: rows[r].id, key: cols[c].key, value: p.value });
          else errors.push(p.error);
        }
    } else {
      matrix.forEach((line, i) =>
        line.forEach((cell, j) => {
          const r = active.r + i;
          const c = active.c + j;
          if (r >= rows.length || c >= cols.length || isLocked(rows[r], cols[c])) return;
          const p = parseValue(cols[c], cell);
          if (p.ok) changes.push({ rowId: rows[r].id, key: cols[c].key, value: p.value });
          else errors.push(p.error);
        }),
      );
      setAnchor(active);
      setActive({ r: Math.min(rows.length - 1, active.r + matrix.length - 1), c: Math.min(cols.length - 1, active.c + matrix[0].length - 1) });
    }
    if (errors.length) onError(`${errors.length} celda(s) no se pegaron: ${errors[0]}`);
    if (changes.length) onEdit(changes);
  };

  useEffect(() => {
    if (!editing) wrap.current?.focus({ preventScroll: true });
  }, [editing]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div
      ref={wrap}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onPaste={onPaste}
      className="overflow-auto rounded-xl border border-zinc-200 bg-white outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
      style={{ maxHeight: '68vh' }}
    >
      <table className="border-separate border-spacing-0 text-sm" style={{ minWidth: 'max-content' }}>
        <thead className="sticky top-0 z-10">
          <tr className="bg-zinc-50 text-left text-xs font-medium text-zinc-500">
            <th className="sticky left-0 z-20 w-9 border-r border-b border-zinc-200 bg-zinc-50 px-2.5">
              <Checkbox label="Seleccionar todas" checked={allSelected} indeterminate={!allSelected && rows.some((r) => selected.has(r.id))} onChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())} />
            </th>
            <th className="w-10 border-r border-b border-zinc-200 px-2 py-2">#</th>
            <th className="w-[92px] border-r border-b border-zinc-200 px-2 py-2">Fotos</th>
            <th className="w-[76px] border-r border-b border-zinc-200 px-2 py-2">Estado</th>
            {cols.map((c) => (
              <th key={c.key} className="border-r border-b border-zinc-200 px-2 py-2 whitespace-nowrap" style={{ width: c.width, minWidth: c.width }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={row.id} className={clsx(row.status === 'committed' && 'bg-emerald-50/40 text-zinc-500', row.status === 'skipped' && 'opacity-50', selected.has(row.id) && 'bg-brand-50/40')}>
              <td className="sticky left-0 z-[5] border-r border-b border-zinc-200 bg-white px-2.5">
                <div>
                  <Checkbox
                    label={`Seleccionar fila ${r + 1}`}
                    checked={selected.has(row.id)}
                    onChange={(v) => {
                      const n = new Set(selected);
                      if (v) n.add(row.id);
                      else n.delete(row.id);
                      setSelected(n);
                    }}
                  />
                </div>
              </td>
              <td className="border-r border-b border-zinc-200 px-2 text-xs text-zinc-400">{r + 1}</td>
              <td className="border-r border-b border-zinc-200 px-1.5 py-1">
                <button onClick={() => onOpenRow(row)} className="flex items-center gap-0.5" title="Ver detalle y fotos">
                  {row.mediaIds.length === 0 ? (
                    <span className="flex size-8 items-center justify-center rounded border border-dashed border-zinc-300 text-zinc-400">
                      <ImageOff className="size-3.5" />
                    </span>
                  ) : (
                    <>
                      <img src={thumbUrl(row.mediaIds[0])} alt="" className="size-8 rounded border border-zinc-200 object-cover" loading="lazy" />
                      {row.mediaIds.length > 1 && <span className="ml-1 text-xs text-zinc-500">+{row.mediaIds.length - 1}</span>}
                    </>
                  )}
                </button>
              </td>
              <td className="border-r border-b border-zinc-200 px-2">
                <RowStatus row={row} onClick={() => onOpenRow(row)} />
              </td>
              {cols.map((col, c) => {
                const isActive = active?.r === r && active?.c === c;
                const isEditing = editing?.pos.r === r && editing?.pos.c === c;
                const meta = row.fieldMeta[col.key];
                const locked = isLocked(row, col);
                return (
                  <td
                    key={col.key}
                    className={clsx('grid-cell relative', isActive && 'active', !isActive && inRange(r, c) && 'in-range', locked && 'bg-zinc-50 text-zinc-500', meta?.review && 'bg-amber-50')}
                    style={{ width: col.width, minWidth: col.width, maxWidth: col.width }}
                    title={meta ? `${meta.source === 'ai_inferred' ? 'Inferido por IA' : meta.source === 'ai_detected' ? 'Detectado por IA en la foto' : meta.source === 'import' ? 'Importado' : 'Usuario'}${meta.review ? ' · pendiente de revisión' : ''}` : undefined}
                    onMouseDown={(e) => {
                      if (isEditing) return;
                      if (e.shiftKey && active) setAnchor((a) => a ?? active);
                      else setAnchor(null);
                      setActive({ r, c });
                    }}
                    onDoubleClick={() => !locked && setEditing({ pos: { r, c }, value: displayValue(row, col) })}
                  >
                    {isEditing ? (
                      <input
                        autoFocus
                        className="absolute inset-0 z-10 w-full border-2 border-brand-500 bg-white px-2 text-sm outline-none"
                        value={editing.value}
                        onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                        onBlur={() => {
                          commitEdit(editing.pos, editing.value);
                          setEditing(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === 'Tab') {
                            e.preventDefault();
                            commitEdit(editing.pos, editing.value);
                            setEditing(null);
                            if (e.key === 'Enter') move(1, 0);
                            else move(0, e.shiftKey ? -1 : 1);
                          } else if (e.key === 'Escape') {
                            setEditing(null);
                          }
                        }}
                      />
                    ) : (
                      <>
                        {meta && (meta.source === 'ai_inferred' || meta.source === 'ai_detected') && <Sparkles className="mr-1 inline size-3 text-violet-500" />}
                        {displayValue(row, col)}
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowStatus({ row, onClick }: { row: BatchRow; onClick: () => void }) {
  const ai =
    row.aiStatus === 'queued' ? (
      <Clock className="size-3.5 text-violet-500" aria-label="En cola de IA" />
    ) : row.aiStatus === 'processing' ? (
      <Loader2 className="size-3.5 animate-spin text-violet-600" aria-label="Analizando" />
    ) : row.aiStatus === 'failed' ? (
      <span title={`IA falló: ${row.aiError}`}>
        <AlertCircle className="size-3.5 text-red-500" />
      </span>
    ) : row.aiStatus === 'done' ? (
      <Sparkles className="size-3.5 text-violet-500" aria-label="Analizado por IA" />
    ) : null;
  const title = [...row.errors.map((e) => `✖ ${e}`), ...row.warnings.map((w) => `⚠ ${w}`)].join('\n');
  return (
    <button onClick={onClick} title={title || undefined} className="flex items-center gap-1">
      {row.status === 'committed' ? (
        <CheckCircle2 className="size-4 text-emerald-600" />
      ) : row.status === 'error' ? (
        <XCircle className="size-4 text-red-500" />
      ) : row.status === 'valid' ? (
        row.warnings.length ? <AlertTriangle className="size-4 text-amber-500" /> : <CheckCircle2 className="size-4 text-emerald-500" />
      ) : row.status === 'skipped' ? (
        <span className="text-xs">Omitida</span>
      ) : (
        <span className="size-2 rounded-full bg-zinc-300" title="Sin validar" />
      )}
      {ai}
    </button>
  );
}
