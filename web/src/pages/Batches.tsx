import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  ArrowLeft,
  CheckCircle2,
  Combine,
  Download,
  FileSpreadsheet,
  ImagePlus,
  Layers,
  Plus,
  Search,
  Sparkles,
  Split,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import { api, dateTime, uploadInChunks } from '../api';
import { Badge, Button, Checkbox, DropZone, EmptyState, Field, Modal, Notice, PageHeader, PageLoader, Progress, SourceBadge, Tabs, useConfirm, useToast } from '../ui';
import { useBiz, useCollections, useStatus } from '../session';
import { BatchGrid, GRID_COLS, type BatchRow } from '../components/BatchGrid';

const BATCH_STATUS: Record<string, { label: string; tone: 'zinc' | 'green' | 'amber' | 'red' }> = {
  draft: { label: 'En proceso', tone: 'amber' },
  partially_committed: { label: 'Confirmado parcialmente', tone: 'amber' },
  committed: { label: 'Confirmado', tone: 'green' },
  cancelled: { label: 'Cancelado', tone: 'zinc' },
};

export function BatchesPage() {
  const { base, bid } = useBiz();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['batches', bid], queryFn: () => api.get<any[]>(`${base}/batches`) });
  const open = params.get('nuevo') === '1';
  return (
    <>
      <PageHeader
        title="Alta masiva de mercancía"
        subtitle="Registra decenas o cientos de productos en una sesión: fotos, Excel/CSV, agrupación, revisión en tabla y confirmación."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setParams({ nuevo: '1' })}>
            Nuevo lote
          </Button>
        }
      />
      {q.isLoading ? (
        <PageLoader />
      ) : !q.data?.length ? (
        <EmptyState
          icon={<Layers className="size-6" />}
          title="Sin lotes todavía"
          text="Un lote agrupa la mercancía que llega en una sesión. Conserva su estado, fecha y errores para que puedas retomarlo cuando quieras."
          action={
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setParams({ nuevo: '1' })}>
              Crear el primer lote
            </Button>
          }
        />
      ) : (
        <div className="card divide-y divide-zinc-100">
          {q.data.map((b) => (
            <Link key={b.id} to={`/b/${bid}/alta-masiva/${b.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-zinc-50">
              <div className="min-w-48 flex-1">
                <p className="font-medium">{b.name}</p>
                <p className="text-xs text-zinc-500">Creado {dateTime(b.createdAt)}</p>
              </div>
              <span className="text-sm text-zinc-600">{b.photoCount} fotos</span>
              <span className="text-sm text-zinc-600">{b.rowCount} filas</span>
              {b.errorCount > 0 && <Badge tone="red">{b.errorCount} con error</Badge>}
              {b.aiPending > 0 && <Badge tone="violet">IA: {b.aiPending} en proceso</Badge>}
              {b.summary?.committed > 0 && <Badge tone="green">{b.summary.committed} importados</Badge>}
              <Badge tone={BATCH_STATUS[b.status].tone}>{BATCH_STATUS[b.status].label}</Badge>
            </Link>
          ))}
        </div>
      )}
      <NewBatchModal open={open} onClose={() => setParams({})} onCreated={(id) => navigate(`/b/${bid}/alta-masiva/${id}`)} />
    </>
  );
}

function NewBatchModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { base, bid } = useBiz();
  const cols = useCollections().data ?? [];
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(`Lote ${new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}`);
  const [mode, setMode] = useState<'none' | 'existing' | 'new'>('none');
  const [collectionId, setCollectionId] = useState('');
  const [newCol, setNewCol] = useState({ name: '', kind: 'season' as 'season' | 'collection' });
  const [loading, setLoading] = useState(false);
  const create = async () => {
    setLoading(true);
    try {
      const b = await api.post(`${base}/batches`, {
        name,
        collectionId: mode === 'existing' ? collectionId || null : null,
        newCollection: mode === 'new' ? newCol : undefined,
      });
      qc.invalidateQueries({ queryKey: ['batches', bid] });
      qc.invalidateQueries({ queryKey: ['collections', bid] });
      onCreated(b.id);
    } catch (e) {
      toast.error(e);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo lote de alta masiva"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={loading} disabled={!name.trim() || (mode === 'new' && !newCol.name.trim()) || (mode === 'existing' && !collectionId)} onClick={create}>
            Crear lote
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nombre del lote">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div>
          <span className="label">Temporada o colección de esta mercancía</span>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['none', 'Ninguna'],
                ['existing', 'Existente'],
                ['new', 'Crear nueva'],
              ] as const
            ).map(([m, l]) => (
              <button key={m} onClick={() => setMode(m)} className={clsx('rounded-lg border px-2 py-2 text-sm', mode === m ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-zinc-300')}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {mode === 'existing' && (
          <select className="input" value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
            <option value="">Elige…</option>
            {cols.filter((c) => !c.archivedAt).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {mode === 'new' && (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input className="input" placeholder="Ej. Otoño-invierno 2026" value={newCol.name} onChange={(e) => setNewCol({ ...newCol, name: e.target.value })} />
            <select className="input w-auto" value={newCol.kind} onChange={(e) => setNewCol({ ...newCol, kind: e.target.value as 'season' })}>
              <option value="season">Temporada</option>
              <option value="collection">Colección</option>
            </select>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ───────────────────────── Detalle del lote ─────────────────────────

type Detail = {
  batch: { id: string; name: string; status: string; collectionId: string | null; summary: any; createdAt: string };
  rows: BatchRow[];
  photos: { id: string; originalName: string; width: number; height: number; productId: string | null }[];
  unassignedPhotoIds: string[];
  aiUsage: { calls: number; inputTokens: number; outputTokens: number; model: string };
};

export function BatchPage() {
  const { batchId } = useParams();
  const { base, bid } = useBiz();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const ai = useStatus().data?.ai;
  const key = ['batch', bid, batchId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.get<Detail>(`${base}/batches/${batchId}`),
    refetchInterval: (query) => (query.state.data?.rows.some((r) => r.aiStatus === 'queued' || r.aiStatus === 'processing') ? 2000 : false),
  });
  const [step, setStep] = useState<'load' | 'review' | 'confirm'>('load');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'error' | 'warning' | 'review' | 'valid'>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<string>('position');
  const [openRow, setOpenRow] = useState<BatchRow | null>(null);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const pending = useRef(new Map<string, Record<string, any>>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saving, setSaving] = useState(false);
  const initialStepSet = useRef(false);

  useEffect(() => {
    if (!q.data) return;
    // Conserva ediciones locales todavía no enviadas
    setRows(q.data.rows.map((r) => (pending.current.has(r.id) ? { ...r, data: { ...r.data, ...pending.current.get(r.id) } } : r)));
    if (!initialStepSet.current) {
      initialStepSet.current = true;
      if (q.data.rows.length) setStep('review');
    }
  }, [q.data]);

  const flush = useCallback(async () => {
    if (!pending.current.size) return;
    const batch = [...pending.current.entries()].map(([id, data]) => ({ id, data }));
    pending.current.clear();
    setSaving(true);
    try {
      await api.patch(`${base}/batches/${batchId}/rows`, { rows: batch });
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast.error(e);
      qc.invalidateQueries({ queryKey: key });
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, batchId]);

  const onEdit = useCallback(
    (changes: { rowId: string; key: string; value: any }[]) => {
      setRows((rs) =>
        rs.map((r) => {
          const mine = changes.filter((c) => c.rowId === r.id);
          if (!mine.length) return r;
          const data = { ...r.data };
          const meta = { ...r.fieldMeta };
          for (const c of mine) {
            data[c.key] = c.value;
            meta[c.key] = { source: 'user' };
          }
          return { ...r, data, fieldMeta: meta, status: r.status === 'skipped' ? r.status : 'pending' };
        }),
      );
      for (const c of changes) pending.current.set(c.rowId, { ...(pending.current.get(c.rowId) ?? {}), [c.key]: c.value });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 700);
    },
    [flush],
  );

  useEffect(() => () => void flush(), [flush]);

  const visible = useMemo(() => {
    let out = rows;
    if (filter === 'error') out = out.filter((r) => r.status === 'error');
    if (filter === 'warning') out = out.filter((r) => r.warnings.length > 0 && r.status !== 'committed');
    if (filter === 'review') out = out.filter((r) => Object.values(r.fieldMeta).some((m) => m.review));
    if (filter === 'valid') out = out.filter((r) => r.status === 'valid');
    if (search.trim()) {
      const s = search.toLowerCase();
      out = out.filter((r) => JSON.stringify(r.data).toLowerCase().includes(s));
    }
    if (sort !== 'position') {
      const [k, dir] = sort.split(':');
      out = [...out].sort((a, b) => {
        const av = a.data[k] ?? '';
        const bv = b.data[k] ?? '';
        const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'es');
        return dir === 'desc' ? -cmp : cmp;
      });
    }
    return out;
  }, [rows, filter, search, sort]);

  const run = async (fn: () => Promise<any>, ok?: (r: any) => string) => {
    try {
      await flush();
      const r = await fn();
      if (ok) toast.success(ok(r));
      await qc.invalidateQueries({ queryKey: key });
      return r;
    } catch (e) {
      toast.error(e);
    }
  };

  if (q.isLoading || !q.data) return <PageLoader />;
  const d = q.data;
  const closed = d.batch.status === 'committed' || d.batch.status === 'cancelled';
  const sel = [...selected].filter((id) => rows.some((r) => r.id === id));
  const counts = {
    error: rows.filter((r) => r.status === 'error').length,
    warning: rows.filter((r) => r.warnings.length > 0 && r.status !== 'committed').length,
    review: rows.filter((r) => Object.values(r.fieldMeta).some((m) => m.review)).length,
    valid: rows.filter((r) => r.status === 'valid').length,
    committed: rows.filter((r) => r.status === 'committed').length,
  };
  const aiBusy = rows.filter((r) => r.aiStatus === 'queued' || r.aiStatus === 'processing').length;
  const aiDone = rows.filter((r) => r.aiStatus === 'done' || r.aiStatus === 'failed').length;
  const aiTotal = rows.filter((r) => r.aiStatus !== 'none').length;

  return (
    <>
      <button onClick={() => navigate(`/b/${bid}/alta-masiva`)} className="mb-3 flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800">
        <ArrowLeft className="size-4" /> Lotes
      </button>
      <PageHeader
        title={d.batch.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={BATCH_STATUS[d.batch.status].tone}>{BATCH_STATUS[d.batch.status].label}</Badge>
            {d.photos.length} fotos · {rows.length} filas · creado {dateTime(d.batch.createdAt)}
            {saving && <span className="text-xs text-zinc-400">Guardando…</span>}
          </span>
        }
        actions={
          d.batch.status === 'draft' && (
            <Button
              variant="ghost"
              onClick={async () => {
                if (await confirm({ title: 'Cancelar lote', text: 'El lote se marca como cancelado. Las fotos subidas se conservan en el negocio. No se crea ningún producto.', confirmLabel: 'Cancelar lote', danger: true }))
                  run(() => api.post(`${base}/batches/${batchId}/cancel`), () => 'Lote cancelado');
              }}
            >
              Cancelar lote
            </Button>
          )
        }
      />

      <Tabs
        value={step}
        onChange={setStep}
        tabs={[
          { value: 'load', label: '1. Cargar fotos y datos' },
          { value: 'review', label: `2. Revisar y corregir (${rows.length})` },
          { value: 'confirm', label: '3. Validar y confirmar' },
        ]}
      />

      <div className="mt-5">
        {step === 'load' && <LoadStep detail={d} closed={closed} onDone={() => (qc.invalidateQueries({ queryKey: key }), setStep('review'))} refresh={() => qc.invalidateQueries({ queryKey: key })} />}

        {step === 'review' && (
          <div className="space-y-3">
            {!ai?.configured && rows.some((r) => r.mediaIds.length) && (
              <Notice tone="blue" title="Asistencia con IA no configurada">
                Puedes capturar los datos manualmente o con Excel. Para que la IA proponga nombres, categorías y descripciones a partir de las fotos, define <code>ANTHROPIC_API_KEY</code> en el archivo <code>.env</code> del servidor.
              </Notice>
            )}
            {aiTotal > 0 && aiBusy > 0 && <Progress value={aiDone} total={aiTotal} label="Analizando fotografías con IA…" />}
            {d.aiUsage.calls > 0 && (
              <p className="text-xs text-zinc-500">
                IA en este lote: {d.aiUsage.calls} análisis · {d.aiUsage.inputTokens.toLocaleString('es-MX')} tokens de entrada y {d.aiUsage.outputTokens.toLocaleString('es-MX')} de salida ({d.aiUsage.model}). El costo se cobra en tu cuenta de Anthropic según esos tokens.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-48 flex-1">
                <Search className="absolute top-2.5 left-3 size-4 text-zinc-400" />
                <input className="input pl-9" placeholder="Buscar en el lote…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className="input w-auto" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                <option value="all">Todas las filas</option>
                <option value="error">Con errores ({counts.error})</option>
                <option value="warning">Con advertencias ({counts.warning})</option>
                <option value="review">Sugerencias IA por revisar ({counts.review})</option>
                <option value="valid">Válidas ({counts.valid})</option>
              </select>
              <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="position">Orden de carga</option>
                <option value="name:asc">Nombre A-Z</option>
                <option value="categoryName:asc">Categoría</option>
                <option value="price:desc">Precio mayor</option>
                <option value="price:asc">Precio menor</option>
              </select>
              {!closed && (
                <Button icon={<Plus className="size-4" />} onClick={() => run(() => api.post(`${base}/batches/${batchId}/rows`, {}), () => 'Fila agregada')}>
                  Fila
                </Button>
              )}
              <Button variant="primary" icon={<CheckCircle2 className="size-4" />} onClick={() => run(() => api.post(`${base}/batches/${batchId}/validate`), (r) => `Validación: ${r.valid} válidas, ${r.errors} con errores`)}>
                Validar
              </Button>
            </div>

            {sel.length > 0 && !closed && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2">
                <span className="text-sm font-medium text-brand-800">{sel.length} fila(s)</span>
                <BulkSet rows={rows.filter((r) => sel.includes(r.id))} onApply={onEdit} />
                {ai?.configured && (
                  <Button size="sm" icon={<Sparkles className="size-3.5" />} onClick={() => run(() => api.post(`${base}/batches/${batchId}/ai`, { rowIds: sel }), (r) => `${r.queued} fila(s) en cola de IA`)}>
                    Analizar con IA
                  </Button>
                )}
                <Button size="sm" onClick={() => run(() => api.patch(`${base}/batches/${batchId}/rows`, { rows: sel.map((id) => ({ id, confirmFields: Object.keys(rows.find((r) => r.id === id)!.fieldMeta) })) }), () => 'Sugerencias confirmadas')}>
                  Confirmar sugerencias
                </Button>
                {sel.length >= 2 && (
                  <Button size="sm" icon={<Combine className="size-3.5" />} onClick={() => run(() => api.post(`${base}/batches/${batchId}/rows/merge`, { ids: sel }), () => 'Filas combinadas en un producto').then(() => setSelected(new Set()))}>
                    Combinar en un producto
                  </Button>
                )}
                <Button size="sm" onClick={() => run(() => api.patch(`${base}/batches/${batchId}/rows`, { rows: sel.map((id) => ({ id, status: 'skipped' })) }), () => 'Filas omitidas')}>
                  Omitir
                </Button>
                <Button
                  size="sm"
                  icon={<Trash2 className="size-3.5" />}
                  onClick={async () => {
                    if (await confirm({ title: 'Descartar filas', text: `Se descartarán ${sel.length} propuesta(s) del lote. Las fotos se conservan como fotos sin asignar.`, confirmLabel: 'Descartar', danger: true }))
                      run(() => api.post(`${base}/batches/${batchId}/rows/delete`, { ids: sel }), (r) => `${r.deleted} fila(s) descartadas`).then(() => setSelected(new Set()));
                  }}
                >
                  Descartar
                </Button>
              </div>
            )}

            {rows.length === 0 ? (
              <EmptyState icon={<Upload className="size-6" />} title="El lote está vacío" text="Sube fotos o un Excel en el paso 1." action={<Button onClick={() => setStep('load')}>Ir a cargar</Button>} />
            ) : (
              <>
                <BatchGrid rows={visible} thumbUrl={(id) => `${base}/media/${id}/thumb`} selected={selected} setSelected={setSelected} onEdit={onEdit} onOpenRow={setOpenRow} onError={toast.error} />
                <p className="text-xs text-zinc-500">
                  Atajos: flechas para moverte · Enter o escribir para editar · Ctrl+C / Ctrl+V copia y pega celdas (también desde Excel) · Shift+flechas selecciona un rango · Ctrl+D rellena hacia abajo · Supr borra. Las celdas con <Sparkles className="inline size-3 text-violet-500" /> fueron sugeridas por IA; en amarillo, pendientes de revisión.
                </p>
              </>
            )}
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => (flush(), setStep('confirm'))}>
                Continuar a validar y confirmar
              </Button>
            </div>
          </div>
        )}

        {step === 'confirm' && <ConfirmStep detail={d} rows={rows} flush={flush} onRefresh={() => qc.invalidateQueries({ queryKey: key })} />}
      </div>

      {openRow && (
        <RowModal
          row={rows.find((r) => r.id === openRow.id) ?? openRow}
          rows={rows}
          closed={closed}
          onClose={() => setOpenRow(null)}
          onChanged={() => qc.invalidateQueries({ queryKey: key })}
          onEdit={onEdit}
        />
      )}
    </>
  );
}

function BulkSet({ rows, onApply }: { rows: BatchRow[]; onApply: (c: { rowId: string; key: string; value: any }[]) => void }) {
  const [open, setOpen] = useState(false);
  const [col, setCol] = useState(GRID_COLS[1].key);
  const [value, setValue] = useState('');
  const def = GRID_COLS.find((c) => c.key === col)!;
  const apply = () => {
    let v: any = value.trim();
    if (def.type === 'list') v = v ? v.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
    if (def.type === 'number' || def.type === 'int') {
      v = v === '' ? null : Number(v);
      if (v !== null && (!Number.isFinite(v) || v < 0)) return;
    }
    onApply(rows.map((r) => ({ rowId: r.id, key: col, value: v })));
    setOpen(false);
    setValue('');
  };
  return (
    <>
      <Button size="sm" icon={<Wand2 className="size-3.5" />} onClick={() => setOpen(true)}>
        Asignar valor
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Asignar un valor a ${rows.length} fila(s)`}
        footer={
          <Button variant="primary" onClick={apply}>
            Aplicar
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Columna">
            <select className="input" value={col} onChange={(e) => setCol(e.target.value)}>
              {GRID_COLS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label.replace(' *', '')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Valor" hint={def.type === 'list' ? 'Separados por comas' : undefined}>
            <input className="input" value={value} onChange={(e) => setValue(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && apply()} />
          </Field>
        </div>
      </Modal>
    </>
  );
}

function LoadStep({ detail, closed, onDone, refresh }: { detail: Detail; closed: boolean; onDone: () => void; refresh: () => void }) {
  const { base } = useBiz();
  const toast = useToast();
  const ai = useStatus().data?.ai;
  const batchId = detail.batch.id;
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<{ fileName: string; error?: string; duplicates?: any[] }[]>([]);
  const [preview, setPreview] = useState<{ file: File; headers: string[]; mapping: Record<string, string>; sample: any[]; total: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [trayPick, setTrayPick] = useState<Set<string>>(new Set());

  const uploadPhotos = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|avif)$/i.test(f.name));
    if (!imgs.length) return toast.error('Selecciona archivos de imagen');
    setProgress({ done: 0, total: imgs.length });
    try {
      const res: any[] = await uploadInChunks(`${base}/batches/${batchId}/photos`, imgs, (done, total) => setProgress({ done, total }), 6);
      setResults((r) => [...res, ...r]);
      const failed = res.filter((x) => x.error).length;
      toast.success(`${res.length - failed} foto(s) subidas${failed ? `, ${failed} rechazadas` : ''}`);
      refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setProgress(null);
    }
  };

  const pickSheet = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    try {
      const fd = await api.upload(`${base}/batches/${batchId}/spreadsheet/preview`, [f]);
      setPreview({ file: f, ...fd });
    } catch (e) {
      toast.error(e);
    }
  };

  const doImport = async () => {
    if (!preview) return;
    setImporting(true);
    try {
      const r = await api.upload(`${base}/batches/${batchId}/spreadsheet`, [preview.file], { mapping: JSON.stringify(preview.mapping) });
      toast.success(`${r.sheetRows} filas leídas → ${r.products} producto(s); ${r.linkedPhotos} foto(s) asociadas por nombre`);
      setPreview(null);
      onDone();
    } catch (e) {
      toast.error(e);
    } finally {
      setImporting(false);
    }
  };

  const group = async () => {
    try {
      const r = await api.post(`${base}/batches/${batchId}/group`);
      toast.success(r.created ? `${r.created} producto(s) propuestos a partir de las fotos` : 'No hay fotos sin agrupar');
      onDone();
    } catch (e) {
      toast.error(e);
    }
  };

  const aiGroup = async () => {
    try {
      const r = await api.post(`${base}/batches/${batchId}/ai-group`, { mediaIds: [...trayPick].slice(0, 24) });
      for (const g of r.groups as string[][]) await api.post(`${base}/batches/${batchId}/rows`, { mediaIds: g });
      toast.success(`IA propuso ${r.groups.length} grupo(s)${r.notes ? `: ${r.notes}` : ''}`);
      setTrayPick(new Set());
      onDone();
    } catch (e) {
      toast.error(e);
    }
  };

  const unassigned = detail.photos.filter((p) => detail.unassignedPhotoIds.includes(p.id));
  const dupCount = results.filter((r) => r.duplicates?.length).length;
  const FIELD_LABELS: Record<string, string> = {
    group: 'Grupo (agrupa variantes)',
    name: 'Nombre',
    sku: 'SKU',
    brand: 'Marca',
    model: 'Modelo',
    categoryName: 'Categoría',
    shortDescription: 'Descripción corta',
    longDescription: 'Descripción larga',
    cost: 'Costo',
    price: 'Precio',
    promoPrice: 'Precio promocional',
    material: 'Material',
    weightGrams: 'Peso (g)',
    keywords: 'Palabras clave',
    colors: 'Color',
    sizes: 'Talla',
    stock: 'Existencias',
    barcode: 'Código de barras',
    images: 'Nombres de fotos',
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="card space-y-4 p-5">
        <div>
          <h3 className="font-semibold">Fotografías</h3>
          <p className="text-sm text-zinc-500">Desde la computadora o el celular. Se validan, se corrige la orientación y se detectan fotos repetidas.</p>
        </div>
        <DropZone accept="image/*" onFiles={uploadPhotos} disabled={closed || Boolean(progress)}>
          <ImagePlus className="mb-2 size-7 text-zinc-400" />
          <p className="text-sm font-medium">Arrastra aquí muchas fotos a la vez</p>
          <p className="text-xs text-zinc-500">Tip: nombra los archivos por modelo (blusa-roja_1.jpg, blusa-roja_2.jpg) para agruparlas automáticamente</p>
        </DropZone>
        {progress && <Progress value={progress.done} total={progress.total} label="Subiendo…" />}
        {results.some((r) => r.error) && (
          <Notice tone="red" title="Archivos rechazados">
            <ul className="list-disc pl-4">
              {results.filter((r) => r.error).slice(0, 6).map((r, i) => (
                <li key={i}>
                  {r.fileName}: {r.error}
                </li>
              ))}
            </ul>
          </Notice>
        )}
        {dupCount > 0 && (
          <Notice tone="amber" title={`${dupCount} foto(s) parecen repetidas`}>
            Coinciden con fotos ya registradas en este negocio. Revisa que no estés dando de alta un producto existente.
          </Notice>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-2.5 text-sm">
          <span>
            <strong>{detail.photos.length}</strong> fotos en el lote · <strong>{unassigned.length}</strong> sin agrupar
          </span>
          <Button variant="primary" size="sm" icon={<Layers className="size-3.5" />} disabled={!unassigned.length || closed} onClick={group}>
            Agrupar fotos en productos
          </Button>
        </div>
        {unassigned.length > 0 && (
          <div>
            <p className="mb-2 text-xs text-zinc-500">Fotos sin agrupar (selecciona para crear un producto manualmente o pedir agrupación a la IA):</p>
            <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6">
              {unassigned.slice(0, 60).map((p) => (
                <button
                  key={p.id}
                  onClick={() => setTrayPick((s) => {
                    const n = new Set(s);
                    if (n.has(p.id)) n.delete(p.id);
                    else n.add(p.id);
                    return n;
                  })}
                  className={clsx('relative aspect-square overflow-hidden rounded-md border-2', trayPick.has(p.id) ? 'border-brand-500' : 'border-transparent')}
                  title={p.originalName}
                >
                  <img src={`${base}/media/${p.id}/thumb`} alt={p.originalName} className="size-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
            {trayPick.size > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" onClick={async () => (await api.post(`${base}/batches/${batchId}/rows`, { mediaIds: [...trayPick] }), setTrayPick(new Set()), onDone())}>
                  Crear un producto con {trayPick.size} foto(s)
                </Button>
                {ai?.configured && trayPick.size >= 2 && (
                  <Button size="sm" icon={<Sparkles className="size-3.5" />} onClick={aiGroup}>
                    Agrupar con IA ({Math.min(24, trayPick.size)})
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card space-y-4 p-5">
        <div>
          <h3 className="font-semibold">Datos desde Excel o CSV (opcional)</h3>
          <p className="text-sm text-zinc-500">Una fila por variante. Filas con el mismo «grupo» se combinan en un producto con variantes. La columna «fotos» asocia los archivos por nombre.</p>
        </div>
        <DropZone accept=".xlsx,.csv" multiple={false} onFiles={pickSheet} disabled={closed}>
          <FileSpreadsheet className="mb-2 size-7 text-zinc-400" />
          <p className="text-sm font-medium">Elige un archivo .xlsx o .csv</p>
        </DropZone>
        <a href={`${base}/import-template`} className="inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline">
          <Download className="size-4" /> Descargar plantilla de importación de ejemplo
        </a>
        <div className="flex justify-end border-t border-zinc-100 pt-4">
          <Button variant="primary" onClick={onDone}>
            Ir a revisar
          </Button>
        </div>
      </section>

      <Modal
        open={Boolean(preview)}
        wide
        onClose={() => setPreview(null)}
        title={`Mapeo de columnas · ${preview?.total ?? 0} filas`}
        footer={
          <>
            <Button onClick={() => setPreview(null)}>Cancelar</Button>
            <Button variant="primary" loading={importing} disabled={!preview || !Object.values(preview.mapping).includes('name')} onClick={doImport}>
              Importar al lote
            </Button>
          </>
        }
      >
        {preview && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-600">Revisa a qué campo corresponde cada columna. Las columnas no reconocidas se guardan como atributos personalizados. Se requiere la columna de nombre.</p>
            <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-zinc-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-zinc-50 text-left text-xs text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">Columna del archivo</th>
                    <th className="px-3 py-2">Ejemplo</th>
                    <th className="px-3 py-2">Campo del catálogo</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.headers.map((h) => (
                    <tr key={h} className="border-t border-zinc-100">
                      <td className="px-3 py-1.5 font-medium">{h}</td>
                      <td className="max-w-48 truncate px-3 py-1.5 text-zinc-500">{preview.sample[0]?.[h]}</td>
                      <td className="px-3 py-1.5">
                        <select className="input py-1" value={preview.mapping[h]} onChange={(e) => setPreview({ ...preview, mapping: { ...preview.mapping, [h]: e.target.value } })}>
                          <option value={`attr:${h}`}>Atributo personalizado «{h}»</option>
                          <option value="ignore">Ignorar</option>
                          {Object.entries(FIELD_LABELS).map(([k, l]) => (
                            <option key={k} value={k}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function RowModal({ row, rows, closed, onClose, onChanged, onEdit }: { row: BatchRow; rows: BatchRow[]; closed: boolean; onClose: () => void; onChanged: () => void; onEdit: (c: { rowId: string; key: string; value: any }[]) => void }) {
  const { base, bid } = useBiz();
  const toast = useToast();
  const batchId = useParams().batchId!;
  const [target, setTarget] = useState('');
  const locked = closed || row.status === 'committed';
  const d = row.data;
  const set = (key: string, value: any) => onEdit([{ rowId: row.id, key, value }]);
  const moveMedia = async (mediaId: string) => {
    if (!target) return toast.info('Elige la fila destino');
    const dest = rows.find((r) => r.id === target)!;
    try {
      await api.patch(`${base}/batches/${batchId}/rows`, {
        rows: [
          { id: row.id, mediaIds: row.mediaIds.filter((m) => m !== mediaId) },
          { id: dest.id, mediaIds: [...dest.mediaIds, mediaId] },
        ],
      });
      onChanged();
    } catch (e) {
      toast.error(e);
    }
  };
  const updVariant = (i: number, patch: Record<string, any>) => set('variants', d.variants.map((v: any, j: number) => (j === i ? { ...v, ...patch } : v)));

  return (
    <Modal open onClose={onClose} wide title={d.name || `Fila ${row.position + 1}`}>
      <div className="space-y-4">
        {row.status === 'committed' && row.productId && (
          <Notice tone="green">
            Importado.{' '}
            <Link className="font-medium underline" to={`/b/${bid}/productos/${row.productId}`}>
              Abrir producto
            </Link>
          </Notice>
        )}
        {row.errors.length > 0 && (
          <Notice tone="red" title="Errores">
            <ul className="list-disc pl-4">{row.errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </Notice>
        )}
        {row.warnings.length > 0 && (
          <Notice tone="amber" title="Advertencias">
            <ul className="list-disc pl-4">{row.warnings.map((e) => <li key={e}>{e}</li>)}</ul>
          </Notice>
        )}
        {row.aiStatus === 'failed' && <Notice tone="red">La IA no pudo analizar esta fila: {row.aiError}</Notice>}

        <div>
          <p className="mb-2 text-sm font-medium">Fotografías ({row.mediaIds.length})</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {row.mediaIds.map((m) => (
              <div key={m} className="space-y-1">
                <img src={`${base}/media/${m}/thumb`} alt="" className="aspect-square w-full rounded-md border border-zinc-200 object-cover" />
                {!locked && (
                  <button className="w-full text-xs text-brand-700 hover:underline" onClick={() => moveMedia(m)}>
                    Mover a otra fila
                  </button>
                )}
              </div>
            ))}
          </div>
          {!locked && row.mediaIds.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select className="input w-auto py-1 text-sm" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Fila destino para mover fotos…</option>
                {rows.filter((r) => r.id !== row.id && r.status !== 'committed').map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.position + 1}. {r.data.name || '(sin nombre)'}
                  </option>
                ))}
              </select>
              {row.mediaIds.length > 1 && (
                <Button size="sm" icon={<Split className="size-3.5" />} onClick={async () => (await api.post(`${base}/batches/${batchId}/rows/${row.id}/split`), onChanged(), onClose())}>
                  Separar cada foto en su propia fila
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ['name', 'Nombre'],
            ['categoryName', 'Categoría'],
            ['brand', 'Marca'],
            ['model', 'Modelo'],
            ['material', 'Material'],
            ['sku', 'SKU (vacío = automático)'],
          ].map(([k, l]) => (
            <div key={k}>
              <div className="mb-1 flex items-center gap-2">
                <span className="text-sm font-medium text-zinc-700">{l}</span>
                <SourceBadge meta={row.fieldMeta[k]} />
              </div>
              <input className="input" disabled={locked} defaultValue={d[k] ?? ''} onBlur={(e) => e.target.value !== (d[k] ?? '') && set(k, e.target.value)} />
            </div>
          ))}
        </div>
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-700">Descripción larga</span>
            <SourceBadge meta={row.fieldMeta.longDescription} />
          </div>
          <textarea className="input min-h-24" disabled={locked} defaultValue={d.longDescription ?? ''} onBlur={(e) => e.target.value !== (d.longDescription ?? '') && set('longDescription', e.target.value)} />
        </div>
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-700">Palabras clave</span>
            <SourceBadge meta={row.fieldMeta.keywords} />
          </div>
          <input className="input" disabled={locked} defaultValue={(d.keywords ?? []).join(', ')} onBlur={(e) => set('keywords', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
        </div>

        {d.attributes && Object.keys(d.attributes).length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium">Atributos</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(d.attributes).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm">
                  <span className="text-zinc-500">{k}:</span>
                  <span className="flex-1">{String(v)}</span>
                  <SourceBadge meta={row.fieldMeta[`attr:${k}`]} />
                </div>
              ))}
            </div>
          </div>
        )}

        {d.variants?.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium">Variantes ({d.variants.length})</p>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-zinc-500">
                <tr>
                  <th className="py-1">Color</th>
                  <th>Talla</th>
                  <th>Existencias</th>
                  <th>SKU</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.variants.map((v: any, i: number) => (
                  <tr key={i}>
                    <td className="py-0.5 pr-1">
                      <input className="input py-1" disabled={locked} defaultValue={v.color ?? ''} onBlur={(e) => updVariant(i, { color: e.target.value })} />
                    </td>
                    <td className="pr-1">
                      <input className="input py-1" disabled={locked} defaultValue={v.size ?? ''} onBlur={(e) => updVariant(i, { size: e.target.value })} />
                    </td>
                    <td className="pr-1">
                      <input className="input w-20 py-1" disabled={locked} inputMode="numeric" defaultValue={v.stock ?? 0} onBlur={(e) => updVariant(i, { stock: Math.max(0, Number(e.target.value) || 0) })} />
                    </td>
                    <td className="pr-1">
                      <input className="input py-1 font-mono text-xs" disabled={locked} placeholder="Automático" defaultValue={v.sku ?? ''} onBlur={(e) => updVariant(i, { sku: e.target.value })} />
                    </td>
                    <td>
                      {!locked && (
                        <button className="p-1 text-zinc-400 hover:text-red-600" onClick={() => set('variants', d.variants.filter((_: any, j: number) => j !== i))} aria-label="Quitar variante">
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ConfirmStep({ detail, rows, flush, onRefresh }: { detail: Detail; rows: BatchRow[]; flush: () => Promise<void>; onRefresh: () => void }) {
  const { base, bid } = useBiz();
  const toast = useToast();
  const confirm = useConfirm();
  const batchId = detail.batch.id;
  const [validation, setValidation] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const validate = useMutation({
    mutationFn: async () => (await flush(), api.post(`${base}/batches/${batchId}/validate`)),
    onSuccess: (r) => (setValidation(r), onRefresh()),
    onError: (e) => toast.error(e),
  });
  const commit = useMutation({
    mutationFn: (onlyValid: boolean) => api.post(`${base}/batches/${batchId}/commit`, { onlyValid }),
    onSuccess: (r) => {
      setResult(r);
      toast.success(`${r.createdNow} producto(s) creados`);
      onRefresh();
    },
    onError: (e) => toast.error(e),
  });
  useEffect(() => {
    validate.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const closed = detail.batch.status === 'committed' || detail.batch.status === 'cancelled';
  const errorRows = rows.filter((r) => r.status === 'error');
  const warnRows = rows.filter((r) => r.status === 'valid' && r.warnings.length);

  return (
    <div className="space-y-4">
      {validation && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Listas para importar" value={validation.valid} tone="green" />
          <Stat label="Con errores" value={validation.errors} tone={validation.errors ? 'red' : undefined} />
          <Stat label="Ya importadas" value={validation.committed} />
          <Stat label="Omitidas" value={validation.skipped} />
        </div>
      )}
      {errorRows.length > 0 && (
        <div className="card p-4">
          <p className="mb-2 text-sm font-semibold text-red-700">Filas con errores (se pueden corregir en el paso 2 sin reiniciar el lote)</p>
          <ul className="space-y-1 text-sm">
            {errorRows.slice(0, 30).map((r) => (
              <li key={r.id}>
                <span className="font-medium">
                  {r.position + 1}. {r.data.name || '(sin nombre)'}:
                </span>{' '}
                <span className="text-red-700">{r.errors.join('; ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {warnRows.length > 0 && (
        <div className="card p-4">
          <p className="mb-2 text-sm font-semibold text-amber-700">Advertencias (no bloquean la importación)</p>
          <ul className="space-y-1 text-sm">
            {warnRows.slice(0, 30).map((r) => (
              <li key={r.id}>
                <span className="font-medium">{r.data.name}:</span> <span className="text-amber-800">{r.warnings.join('; ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result && (
        <Notice tone="green" title={`Importación completada: ${result.createdNow} producto(s) creados como borrador`}>
          <ul className="mt-1 list-disc pl-4">
            {result.created.slice(0, 20).map((c: any) => (
              <li key={c.productId}>
                <Link className="underline" to={`/b/${bid}/productos/${c.productId}`}>
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
          {result.withErrors > 0 && <p className="mt-2">{result.withErrors} fila(s) siguen con errores; el lote queda abierto para corregirlas.</p>}
        </Notice>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button loading={validate.isPending} onClick={() => validate.mutate()}>
          Volver a validar
        </Button>
        {!closed && validation && validation.errors > 0 && validation.valid > 0 && (
          <Button
            loading={commit.isPending}
            onClick={async () => {
              if (await confirm({ title: 'Importar solo las filas válidas', text: `Se crearán ${validation.valid} producto(s). Las ${validation.errors} filas con errores quedan en el lote para corregirlas después.`, confirmLabel: 'Importar válidas' }))
                commit.mutate(true);
            }}
          >
            Importar solo las válidas ({validation.valid})
          </Button>
        )}
        {!closed && (
          <Button variant="primary" loading={commit.isPending} disabled={!validation || validation.errors > 0 || validation.valid === 0} onClick={() => commit.mutate(false)}>
            Confirmar importación ({validation?.valid ?? 0})
          </Button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'red' }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={clsx('text-2xl font-semibold', tone === 'green' && 'text-emerald-600', tone === 'red' && 'text-red-600')}>{value}</p>
    </div>
  );
}

