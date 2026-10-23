import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowDown, ArrowLeft, ArrowUp, BookOpen, Copy, Download, ExternalLink, Link2, Plus, Search, Trash2, X } from 'lucide-react';
import { api, dateTime, money } from '../api';
import { Badge, Button, Checkbox, EmptyState, Field, Modal, Notice, PageHeader, PageLoader, useConfirm, useToast } from '../ui';
import { useBiz, useCategories, useCollections } from '../session';

export function CatalogsPage() {
  const { base, bid } = useBiz();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ['catalogs', bid], queryFn: () => api.get<any[]>(`${base}/catalogs`) });
  const [title, setTitle] = useState('');
  const create = async () => {
    try {
      const c = await api.post(`${base}/catalogs`, { title });
      navigate(`/b/${bid}/catalogos/${c.id}`);
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <>
      <PageHeader
        title="Catálogos comerciales"
        subtitle="Catálogos visuales en PDF o enlace público, con el logotipo y colores del negocio. Nunca muestran costos."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setParams({ nuevo: '1' })}>
            Nuevo catálogo
          </Button>
        }
      />
      {q.isLoading ? (
        <PageLoader />
      ) : !q.data?.length ? (
        <EmptyState
          icon={<BookOpen className="size-6" />}
          title="Sin catálogos"
          text="Elige productos, ordénalos y genera un PDF descargable o un enlace para compartir por WhatsApp o redes."
          action={
            <Button variant="primary" onClick={() => setParams({ nuevo: '1' })}>
              Crear catálogo
            </Button>
          }
        />
      ) : (
        <div className="card divide-y divide-zinc-100">
          {q.data.map((c) => (
            <button key={c.id} onClick={() => navigate(`/b/${bid}/catalogos/${c.id}`)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50">
              <div className="min-w-48 flex-1">
                <p className="font-medium">{c.title}</p>
                <p className="text-xs text-zinc-500">Actualizado {dateTime(c.updatedAt)}</p>
              </div>
              <span className="text-sm text-zinc-600">{c.items.length} productos</span>
              <Badge>{{ grid2: '2 columnas', grid3: '3 columnas', list: 'Lista' }[c.layout as string]}</Badge>
              {c.showPrices ? <Badge tone="green">Con precios</Badge> : <Badge>Sin precios</Badge>}
              {c.publicToken && <Badge tone="blue">Enlace público</Badge>}
            </button>
          ))}
        </div>
      )}
      <Modal
        open={params.get('nuevo') === '1'}
        onClose={() => setParams({})}
        title="Nuevo catálogo"
        footer={
          <Button variant="primary" disabled={!title.trim()} onClick={create}>
            Crear y elegir productos
          </Button>
        }
      >
        <Field label="Título">
          <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Catálogo Otoño-Invierno 2026" onKeyDown={(e) => e.key === 'Enter' && title.trim() && create()} />
        </Field>
      </Modal>
    </>
  );
}

export function CatalogEditor() {
  const { catalogId } = useParams();
  const { base, bid, biz } = useBiz();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['catalog', bid, catalogId], queryFn: () => api.get(`${base}/catalogs/${catalogId}`) });
  const [form, setForm] = useState<any>(null);
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mediaPick, setMediaPick] = useState<string | null>(null);

  useEffect(() => {
    if (q.data) setForm({ ...q.data, items: q.data.items });
  }, [q.data]);

  if (q.isLoading || !form) return <PageLoader />;
  const entries = new Map<string, any>(q.data.entries.map((e: any) => [e.productId, e]));

  const save = async (patch: Record<string, unknown> = {}) => {
    setSaving(true);
    try {
      const next = { ...form, ...patch };
      await api.put(`${base}/catalogs/${catalogId}`, {
        title: next.title,
        subtitle: next.subtitle,
        layout: next.layout,
        showPrices: next.showPrices,
        showVariants: next.showVariants,
        showDescription: next.showDescription,
        showSku: next.showSku,
        items: next.items,
      });
      await qc.invalidateQueries({ queryKey: ['catalog', bid, catalogId] });
      qc.invalidateQueries({ queryKey: ['catalogs', bid] });
      toast.success('Catálogo guardado');
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };
  const move = (i: number, d: number) => {
    const items = [...form.items];
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    setForm({ ...form, items });
  };
  const share = async (enabled: boolean) => {
    try {
      await api.post(`${base}/catalogs/${catalogId}/share`, { enabled });
      qc.invalidateQueries({ queryKey: ['catalog', bid, catalogId] });
      toast.success(enabled ? 'Enlace público creado' : 'Enlace público desactivado');
    } catch (e) {
      toast.error(e);
    }
  };
  const del = async () => {
    if (!(await confirm({ title: 'Eliminar catálogo', text: 'Se elimina el catálogo (no los productos). Si tenía enlace público, dejará de funcionar.', confirmLabel: 'Eliminar', danger: true }))) return;
    await api.del(`${base}/catalogs/${catalogId}`);
    qc.invalidateQueries({ queryKey: ['catalogs', bid] });
    navigate(`/b/${bid}/catalogos`);
  };
  const publicUrl = q.data.publicToken ? `${window.location.origin}/public/c/${q.data.publicToken}` : null;

  return (
    <>
      <button onClick={() => navigate(`/b/${bid}/catalogos`)} className="mb-3 flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800">
        <ArrowLeft className="size-4" /> Catálogos
      </button>
      <PageHeader
        title={form.title}
        subtitle={`${form.items.length} producto(s)`}
        actions={
          <>
            <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={del}>
              Eliminar
            </Button>
            <a href={`${base}/catalogs/${catalogId}/pdf`}>
              <Button icon={<Download className="size-4" />}>Descargar PDF</Button>
            </a>
            <Button variant="primary" loading={saving} onClick={() => save()}>
              Guardar
            </Button>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <section className="card space-y-3 p-4">
            <Field label="Título">
              <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="Subtítulo">
              <input className="input" value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} placeholder="Ej. Precios válidos hasta agotar existencias" />
            </Field>
            <div>
              <span className="label">Diseño</span>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ['grid2', '2 columnas'],
                    ['grid3', '3 columnas'],
                    ['list', 'Lista'],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} onClick={() => setForm({ ...form, layout: v })} className={clsx('rounded-lg border px-2 py-2 text-xs font-medium', form.layout === v ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-zinc-300')}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2 pt-1">
              {(
                [
                  ['showPrices', 'Mostrar precios'],
                  ['showVariants', 'Mostrar colores y tallas'],
                  ['showDescription', 'Mostrar descripción'],
                  ['showSku', 'Mostrar SKU (uso interno)'],
                ] as const
              ).map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form[k]} onChange={(v) => setForm({ ...form, [k]: v })} label={l} /> {l}
                </label>
              ))}
              <p className="text-xs text-zinc-500">Los costos nunca se incluyen. Usa el logotipo y colores configurados en el negocio.</p>
            </div>
          </section>
          <section className="card space-y-3 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Link2 className="size-4" /> Enlace público
            </h3>
            {publicUrl ? (
              <>
                <div className="flex gap-1">
                  <input className="input text-xs" readOnly value={publicUrl} />
                  <Button size="sm" onClick={() => (navigator.clipboard.writeText(publicUrl), toast.success('Enlace copiado'))} aria-label="Copiar enlace">
                    <Copy className="size-3.5" />
                  </Button>
                </div>
                <div className="flex gap-2">
                  <a href={publicUrl} target="_blank" rel="noreferrer">
                    <Button size="sm" icon={<ExternalLink className="size-3.5" />}>
                      Abrir
                    </Button>
                  </a>
                  <Button size="sm" variant="ghost" onClick={() => share(false)}>
                    Desactivar enlace
                  </Button>
                </div>
                <p className="text-xs text-zinc-500">Guarda los cambios para que se reflejen en el enlace. Para compartirlo fuera de tu red, el servidor debe estar publicado en internet.</p>
              </>
            ) : (
              <>
                <p className="text-sm text-zinc-500">Opcional. Crea un enlace que cualquiera con la dirección puede ver.</p>
                <Button size="sm" onClick={() => share(true)}>
                  Crear enlace público
                </Button>
              </>
            )}
          </section>
        </div>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Productos del catálogo (en orden)</h3>
            <Button icon={<Plus className="size-4" />} onClick={() => setPicker(true)}>
              Agregar productos
            </Button>
          </div>
          {form.items.length === 0 ? (
            <EmptyState icon={<BookOpen className="size-6" />} title="Catálogo vacío" text="Agrega productos manualmente o filtrando por categoría o colección." action={<Button onClick={() => setPicker(true)}>Agregar productos</Button>} />
          ) : (
            <div className={clsx('grid gap-3', form.layout === 'grid3' ? 'grid-cols-2 sm:grid-cols-3' : form.layout === 'grid2' ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1')}>
              {form.items.map((it: any, i: number) => {
                const e = entries.get(it.productId);
                const mediaId = it.mediaId ?? e?.mediaId;
                return (
                  <div key={it.productId} className={clsx('card overflow-hidden', form.layout === 'list' && 'flex')} style={{ borderTop: `3px solid ${biz?.primaryColor}` }}>
                    <button onClick={() => setMediaPick(it.productId)} className={clsx('relative block bg-zinc-100', form.layout === 'list' ? 'size-28 shrink-0' : 'aspect-square w-full')} title="Elegir foto">
                      {mediaId ? <img src={`${base}/media/${mediaId}/thumb`} alt="" className="size-full object-contain" /> : <span className="text-xs text-zinc-400">Sin foto</span>}
                    </button>
                    <div className="min-w-0 flex-1 p-3">
                      <p className="truncate text-sm font-medium">{e?.name ?? 'Producto no disponible (archivado)'}</p>
                      {form.showPrices && e?.price !== null && e && (
                        <p className="text-sm font-semibold" style={{ color: biz?.primaryColor }}>
                          {money(e.promoPrice ?? e.price, biz?.currency)}
                        </p>
                      )}
                      {form.showVariants && e && (e.colors.length > 0 || e.sizes.length > 0) && <p className="truncate text-xs text-zinc-500">{[e.colors.join(', '), e.sizes.join(', ')].filter(Boolean).join(' · ')}</p>}
                      {e && !e.inStock && <Badge tone="red">Agotado</Badge>}
                      <div className="mt-2 flex items-center gap-1">
                        <button className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">
                          <ArrowUp className="size-4" />
                        </button>
                        <button className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30" disabled={i === form.items.length - 1} onClick={() => move(i, 1)} aria-label="Bajar">
                          <ArrowDown className="size-4" />
                        </button>
                        <span className="flex-1" />
                        <button className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600" onClick={() => setForm({ ...form, items: form.items.filter((x: any) => x.productId !== it.productId) })} aria-label="Quitar">
                          <X className="size-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {form.items.length > 0 && JSON.stringify(form.items) !== JSON.stringify(q.data.items) && (
            <div className="mt-3">
              <Notice tone="blue">Hay cambios sin guardar en la selección u orden de productos.</Notice>
            </div>
          )}
        </section>
      </div>

      <ProductPicker
        open={picker}
        onClose={() => setPicker(false)}
        exclude={form.items.map((i: any) => i.productId)}
        onPick={(ids) => {
          setForm({ ...form, items: [...form.items, ...ids.map((productId) => ({ productId, mediaId: null }))] });
          setPicker(false);
        }}
      />
      {mediaPick && (
        <MediaPicker
          productId={mediaPick}
          current={form.items.find((i: any) => i.productId === mediaPick)?.mediaId}
          onClose={() => setMediaPick(null)}
          onPick={(mediaId) => {
            setForm({ ...form, items: form.items.map((i: any) => (i.productId === mediaPick ? { ...i, mediaId } : i)) });
            setMediaPick(null);
          }}
        />
      )}
    </>
  );
}

/** Selector de productos con filtros por categoría, colección y búsqueda (reutilizado en canales). */
export function ProductPicker({ open, onClose, onPick, exclude = [], title = 'Agregar productos' }: { open: boolean; onClose: () => void; onPick: (ids: string[]) => void; exclude?: string[]; title?: string }) {
  const { base, bid } = useBiz();
  const cats = useCategories().data ?? [];
  const cols = useCollections().data ?? [];
  const [f, setF] = useState({ q: '', categoryId: '', collectionId: '', status: 'current' });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const qs = new URLSearchParams({ pageSize: '200', ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) }).toString();
  const list = useQuery({ queryKey: ['products', bid, 'picker', qs], queryFn: () => api.get(`${base}/products?${qs}`), enabled: open });
  const items = (list.data?.items ?? []).filter((p: any) => !exclude.includes(p.id));
  useEffect(() => {
    if (open) setSel(new Set());
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!sel.size} onClick={() => onPick([...sel])}>
            Agregar {sel.size || ''}
          </Button>
        </>
      }
    >
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <div className="relative">
          <Search className="absolute top-2.5 left-3 size-4 text-zinc-400" />
          <input className="input pl-9" placeholder="Buscar…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        </div>
        <select className="input" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
          <option value="">Todas las categorías</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="input" value={f.collectionId} onChange={(e) => setF({ ...f, collectionId: e.target.value })}>
          <option value="">Todas las colecciones</option>
          {cols.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <label className="flex items-center gap-2">
          <Checkbox checked={items.length > 0 && items.every((p: any) => sel.has(p.id))} onChange={(v) => setSel(v ? new Set(items.map((p: any) => p.id)) : new Set())} label="Todos" />
          Seleccionar los {items.length} resultados
        </label>
      </div>
      <div className="max-h-[45vh] divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-200">
        {items.map((p: any) => (
          <label key={p.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-zinc-50">
            <Checkbox
              checked={sel.has(p.id)}
              onChange={(v) => setSel((s) => {
                const n = new Set(s);
                if (v) n.add(p.id);
                else n.delete(p.id);
                return n;
              })}
              label={p.name}
            />
            {p.thumbId ? <img src={`${base}/media/${p.thumbId}/thumb`} className="size-9 rounded object-cover" alt="" /> : <span className="size-9 rounded bg-zinc-100" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{p.name}</span>
              <span className="text-xs text-zinc-500">
                {p.sku} · {p.categoryName ?? 'Sin categoría'}
              </span>
            </span>
            {p.totalStock === 0 && <Badge tone="red">Agotado</Badge>}
          </label>
        ))}
        {!items.length && <p className="px-3 py-6 text-center text-sm text-zinc-500">Sin productos</p>}
      </div>
    </Modal>
  );
}

function MediaPicker({ productId, current, onClose, onPick }: { productId: string; current?: string | null; onClose: () => void; onPick: (id: string | null) => void }) {
  const { base, bid } = useBiz();
  const q = useQuery({ queryKey: ['product', bid, productId], queryFn: () => api.get(`${base}/products/${productId}`) });
  return (
    <Modal open onClose={onClose} title="Foto para el catálogo">
      {!q.data ? (
        <PageLoader />
      ) : q.data.media.length === 0 ? (
        <p className="text-sm text-zinc-500">El producto no tiene fotos.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {q.data.media.map((m: any) => (
            <button key={m.id} onClick={() => onPick(m.id)} className={clsx('aspect-square overflow-hidden rounded-lg border-2', current === m.id ? 'border-brand-500' : 'border-transparent')}>
              <img src={`${base}/media/${m.id}/thumb`} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <div className="mt-3">
        <Button size="sm" variant="ghost" onClick={() => onPick(null)}>
          Usar la foto principal
        </Button>
      </div>
    </Modal>
  );
}
