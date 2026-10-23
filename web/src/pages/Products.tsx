import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { Archive, Copy, Download, FileSpreadsheet, ImageOff, Package, Plus, RotateCcw, Search, ShoppingBag, SlidersHorizontal, Upload } from 'lucide-react';
import { api, money } from '../api';
import { Badge, Button, Checkbox, EmptyState, Field, Modal, PageHeader, Spinner, useConfirm, useToast } from '../ui';
import { ISSUE_LABELS, useBiz, useCategories, useCollections } from '../session';

type Row = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  categoryName: string | null;
  price: string | null;
  promoPrice: string | null;
  cost: string | null;
  status: 'draft' | 'active' | 'archived';
  totalStock: number;
  mediaCount: number;
  issues: string[];
  variantCount: number;
  thumbId: string | null;
  collectionNames: string[];
  isDemo: boolean;
};

export const STATUS_LABEL = { draft: 'Borrador', active: 'Activo', archived: 'Archivado' } as const;

export function ProductsPage() {
  const { base, bid, biz } = useBiz();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const cats = useCategories().data ?? [];
  const cols = useCollections().data ?? [];
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(Boolean(params.get('createdFrom') || params.get('channel')));
  const [bulk, setBulk] = useState<null | 'category' | 'collection' | 'price'>(null);

  useEffect(() => {
    const t = setTimeout(() => setParam('q', search), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    if (k !== 'page') p.delete('page');
    setParams(p, { replace: true });
  };

  const query = params.toString();
  const list = useQuery({
    queryKey: ['products', bid, query],
    queryFn: () => api.get<{ items: Row[]; total: number; page: number; pageSize: number }>(`${base}/products?${query}`),
    placeholderData: keepPreviousData,
  });
  const items = list.data?.items ?? [];
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));

  const bulkMut = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.post(`${base}/products/bulk`, { ids: [...selected], patch }),
    onSuccess: (r: any) => {
      toast.success(`${r.updated} producto(s) actualizados`);
      qc.invalidateQueries({ queryKey: ['products', bid] });
      qc.invalidateQueries({ queryKey: ['collections', bid] });
      setBulk(null);
    },
    onError: (e) => toast.error(e),
  });

  const savePrice = async (row: Row, value: string) => {
    const n = value.trim() === '' ? null : Number(value.replace(/[$,\s]/g, ''));
    if (n !== null && (!Number.isFinite(n) || n < 0)) return toast.error('Precio inválido');
    try {
      await api.post(`${base}/products/bulk`, { ids: [row.id], patch: { price: { mode: 'set', value: n ?? 0 } } });
      qc.invalidateQueries({ queryKey: ['products', bid] });
    } catch (e) {
      toast.error(e);
    }
  };

  const archive = async () => {
    const ok = await confirm({
      title: 'Archivar productos',
      text: `Se archivarán ${selected.size} producto(s). No se eliminan: conservan fotos, variantes e historial y puedes reactivarlos cuando quieras.`,
      confirmLabel: 'Archivar',
    });
    if (ok) bulkMut.mutate({ status: 'archived' });
  };

  const duplicate = async (id: string) => {
    try {
      const p = await api.post(`${base}/products/${id}/duplicate`);
      toast.success('Ficha duplicada como borrador');
      navigate(`/b/${bid}/productos/${p.id}`);
    } catch (e) {
      toast.error(e);
    }
  };

  const filtersActive = ['categoryId', 'collectionId', 'status', 'stock', 'issue', 'channel', 'createdFrom', 'createdTo'].some((k) => params.get(k));
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  const page = Number(params.get('page') ?? 1);
  const selection = [...selected].join(',');

  const exportUrl = useMemo(() => (fmt: string) => `${base}/products-export?format=${fmt}${selected.size ? `&ids=${selection}` : ''}`, [base, selected.size, selection]);

  return (
    <>
      <PageHeader
        title="Productos"
        subtitle={list.data ? `${list.data.total.toLocaleString('es-MX')} producto(s) en ${biz?.name}` : undefined}
        actions={
          <>
            <a href={exportUrl('xlsx')}>
              <Button icon={<FileSpreadsheet className="size-4" />}>Exportar Excel</Button>
            </a>
            <Button icon={<Upload className="size-4" />} onClick={() => navigate(`/b/${bid}/alta-masiva?nuevo=1`)}>
              Alta masiva
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate(`/b/${bid}/productos/nuevo`)}>
              Nuevo producto
            </Button>
          </>
        }
      />

      <div className="card mb-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute top-2.5 left-3 size-4 text-zinc-400" />
            <input className="input pl-9" placeholder="Buscar por nombre, SKU, marca, código de barras o palabra clave…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input w-auto" value={params.get('categoryId') ?? ''} onChange={(e) => setParam('categoryId', e.target.value)}>
            <option value="">Todas las categorías</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.parentId ? '— ' : ''}
                {c.name}
              </option>
            ))}
          </select>
          <select className="input w-auto" value={params.get('status') ?? ''} onChange={(e) => setParam('status', e.target.value)}>
            <option value="">Vigentes (sin archivados)</option>
            <option value="active">Activos</option>
            <option value="draft">Borradores</option>
            <option value="archived">Archivados</option>
            <option value="all">Todos</option>
          </select>
          <Button variant={showFilters || filtersActive ? 'secondary' : 'ghost'} icon={<SlidersHorizontal className="size-4" />} onClick={() => setShowFilters((v) => !v)}>
            Filtros{filtersActive ? ' •' : ''}
          </Button>
        </div>
        {showFilters && (
          <div className="mt-3 grid gap-2 border-t border-zinc-100 pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <select className="input" value={params.get('collectionId') ?? ''} onChange={(e) => setParam('collectionId', e.target.value)}>
              <option value="">Cualquier colección o temporada</option>
              {cols.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.kind === 'season' ? 'Temporada: ' : ''}
                  {c.name}
                  {c.archivedAt ? ' (archivada)' : ''}
                </option>
              ))}
            </select>
            <select className="input" value={params.get('stock') ?? ''} onChange={(e) => setParam('stock', e.target.value)}>
              <option value="">Cualquier existencia</option>
              <option value="in">Con existencias</option>
              <option value="out">Agotados</option>
            </select>
            <select className="input" value={params.get('issue') ?? ''} onChange={(e) => setParam('issue', e.target.value)}>
              <option value="">Cualquier completitud</option>
              <option value="incomplete">Incompletos (cualquier problema)</option>
              {Object.entries(ISSUE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={params.get('channel') ? `${params.get('channel')}:${params.get('channelStatus') ?? 'none'}` : ''}
              onChange={(e) => {
                const p = new URLSearchParams(params);
                const [ch, st] = e.target.value.split(':');
                if (ch) (p.set('channel', ch), p.set('channelStatus', st));
                else (p.delete('channel'), p.delete('channelStatus'));
                setParams(p, { replace: true });
              }}
            >
              <option value="">Cualquier canal</option>
              <option value="mercadolibre:none">Mercado Libre · sin exportar</option>
              <option value="mercadolibre:file_generated">Mercado Libre · archivo generado</option>
              <option value="mercadolibre:linked">Mercado Libre · vinculado</option>
              <option value="tiktok:none">TikTok Shop · sin exportar</option>
              <option value="tiktok:file_generated">TikTok Shop · archivo generado</option>
              <option value="tiktok:linked">TikTok Shop · vinculado</option>
            </select>
            <Field label="Alta desde">
              <input type="date" className="input" value={params.get('createdFrom') ?? ''} onChange={(e) => setParam('createdFrom', e.target.value)} />
            </Field>
            <Field label="Alta hasta">
              <input type="date" className="input" value={params.get('createdTo') ?? ''} onChange={(e) => setParam('createdTo', e.target.value)} />
            </Field>
            <Field label="Ordenar por">
              <select className="input" value={params.get('sort') ?? 'created_desc'} onChange={(e) => setParam('sort', e.target.value)}>
                <option value="created_desc">Más recientes</option>
                <option value="created_asc">Más antiguos</option>
                <option value="updated_desc">Modificados recientemente</option>
                <option value="name_asc">Nombre (A-Z)</option>
                <option value="price_desc">Precio (mayor a menor)</option>
                <option value="price_asc">Precio (menor a mayor)</option>
                <option value="stock_asc">Menos existencias</option>
              </select>
            </Field>
            <div className="flex items-end">
              <Button variant="ghost" onClick={() => (setSearch(''), setParams(new URLSearchParams(), { replace: true }))}>
                Limpiar filtros
              </Button>
            </div>
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="sticky top-14 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 shadow-sm lg:top-2">
          <span className="mr-1 text-sm font-medium text-brand-800">{selected.size} seleccionado(s)</span>
          <Button size="sm" onClick={() => bulkMut.mutate({ status: 'active' })}>
            Activar
          </Button>
          <Button size="sm" onClick={() => bulkMut.mutate({ status: 'draft' })}>
            Pasar a borrador
          </Button>
          <Button size="sm" onClick={() => setBulk('category')}>
            Categoría
          </Button>
          <Button size="sm" onClick={() => setBulk('collection')}>
            Colecciones
          </Button>
          <Button size="sm" onClick={() => setBulk('price')}>
            Precio
          </Button>
          <Button size="sm" icon={<ShoppingBag className="size-3.5" />} onClick={() => navigate(`/b/${bid}/canales/mercadolibre`, { state: { productIds: [...selected] } })}>
            Exportar a canal
          </Button>
          <a href={exportUrl('xlsx')}>
            <Button size="sm" icon={<Download className="size-3.5" />}>
              Excel
            </Button>
          </a>
          <a href={exportUrl('csv')}>
            <Button size="sm">CSV</Button>
          </a>
          {params.get('status') === 'archived' ? (
            <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => bulkMut.mutate({ status: 'active' })}>
              Reactivar
            </Button>
          ) : (
            <Button size="sm" icon={<Archive className="size-3.5" />} onClick={archive}>
              Archivar
            </Button>
          )}
          <button className="ml-auto text-sm text-brand-700 hover:underline" onClick={() => setSelected(new Set())}>
            Quitar selección
          </button>
        </div>
      )}

      {list.isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        filtersActive || params.get('q') ? (
          <EmptyState icon={<Search className="size-6" />} title="Sin resultados" text="Ningún producto coincide con la búsqueda o los filtros." />
        ) : (
          <EmptyState
            icon={<Package className="size-6" />}
            title="Este negocio todavía no tiene productos"
            text="Da de alta productos uno por uno, o carga decenas a la vez con fotos y Excel desde Alta masiva."
            action={
              <div className="flex gap-2">
                <Button icon={<Upload className="size-4" />} onClick={() => navigate(`/b/${bid}/alta-masiva?nuevo=1`)}>
                  Alta masiva
                </Button>
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate(`/b/${bid}/productos/nuevo`)}>
                  Nuevo producto
                </Button>
              </div>
            }
          />
        )
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50/80 text-left text-xs font-medium text-zinc-500">
                <th className="w-10 px-3 py-2.5">
                  <Checkbox
                    label="Seleccionar todos"
                    checked={allSelected}
                    indeterminate={!allSelected && items.some((i) => selected.has(i.id))}
                    onChange={(v) => setSelected((s) => {
                      const n = new Set(s);
                      items.forEach((i) => (v ? n.add(i.id) : n.delete(i.id)));
                      return n;
                    })}
                  />
                </th>
                <th className="px-2 py-2.5">Producto</th>
                <th className="px-2 py-2.5">Categoría</th>
                <th className="px-2 py-2.5 text-right">Precio</th>
                <th className="px-2 py-2.5 text-right">Existencias</th>
                <th className="px-2 py-2.5">Estado</th>
                <th className="px-2 py-2.5">Pendientes</th>
                <th className="w-10 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody className={clsx(list.isFetching && 'opacity-70')}>
              {items.map((p) => (
                <tr key={p.id} className={clsx('border-b border-zinc-100 last:border-0 hover:bg-zinc-50/70', selected.has(p.id) && 'bg-brand-50/50')}>
                  <td className="px-3 py-2">
                    <Checkbox
                      label={`Seleccionar ${p.name}`}
                      checked={selected.has(p.id)}
                      onChange={(v) => setSelected((s) => {
                        const n = new Set(s);
                        if (v) n.add(p.id);
                        else n.delete(p.id);
                        return n;
                      })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Link to={`/b/${bid}/productos/${p.id}`} className="flex items-center gap-3">
                      {p.thumbId ? (
                        <img src={`${base}/media/${p.thumbId}/thumb`} alt="" loading="lazy" className="size-11 shrink-0 rounded-md border border-zinc-200 bg-zinc-50 object-cover" />
                      ) : (
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-md border border-dashed border-zinc-300 text-zinc-400">
                          <ImageOff className="size-4" />
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-zinc-900 hover:underline">{p.name}</span>
                        <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                          <span className="font-mono">{p.sku}</span>· {p.variantCount} variante(s)
                          {p.collectionNames.length > 0 && <span className="truncate">· {p.collectionNames.join(', ')}</span>}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-zinc-600">{p.categoryName ?? <span className="text-zinc-400">—</span>}</td>
                  <td className="px-2 py-2 text-right">
                    <InlinePrice value={p.price} currency={biz?.currency} onSave={(v) => savePrice(p, v)} />
                    {p.promoPrice && <span className="block text-xs text-emerald-700">Promo {money(p.promoPrice, biz?.currency)}</span>}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {p.totalStock === 0 ? <Badge tone="red">Agotado</Badge> : p.totalStock}
                  </td>
                  <td className="px-2 py-2">
                    <Badge tone={p.status === 'active' ? 'green' : p.status === 'draft' ? 'zinc' : 'amber'}>{STATUS_LABEL[p.status]}</Badge>
                    {p.isDemo && <Badge tone="violet" className="ml-1">Demo</Badge>}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      {p.issues.slice(0, 3).map((i) => (
                        <Badge key={i} tone="amber">
                          {ISSUE_LABELS[i] ?? i}
                        </Badge>
                      ))}
                      {p.issues.length > 3 && <Badge tone="amber">+{p.issues.length - 3}</Badge>}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <button onClick={() => duplicate(p.id)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" title="Duplicar como punto de partida" aria-label="Duplicar">
                      <Copy className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 && (
            <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-2.5 text-sm">
              <span className="text-zinc-500">
                Página {page} de {pages}
              </span>
              <div className="flex gap-2">
                <Button size="sm" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>
                  Anterior
                </Button>
                <Button size="sm" disabled={page >= pages} onClick={() => setParam('page', String(page + 1))}>
                  Siguiente
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <BulkModal kind={bulk} onClose={() => setBulk(null)} onApply={(patch) => bulkMut.mutate(patch)} loading={bulkMut.isPending} count={selected.size} />
    </>
  );
}

function InlinePrice({ value, currency, onSave }: { value: string | null; currency?: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value ?? '');
  if (!editing) {
    return (
      <button className="rounded px-1 py-0.5 tabular-nums hover:bg-zinc-100" title="Clic para editar el precio" onClick={() => (setV(value ?? ''), setEditing(true))}>
        {value ? money(value, currency) : <span className="text-amber-600">Sin precio</span>}
      </button>
    );
  }
  return (
    <input
      autoFocus
      className="input w-24 py-1 text-right"
      value={v}
      inputMode="decimal"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (v !== (value ?? '')) onSave(v);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}

function BulkModal({ kind, onClose, onApply, loading, count }: { kind: null | 'category' | 'collection' | 'price'; onClose: () => void; onApply: (p: Record<string, unknown>) => void; loading: boolean; count: number }) {
  const cats = useCategories().data ?? [];
  const cols = useCollections().data ?? [];
  const [categoryId, setCategoryId] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const [mode, setMode] = useState<'set' | 'percent' | 'add'>('percent');
  const [value, setValue] = useState('');
  const titles = { category: 'Asignar categoría', collection: 'Colecciones y temporadas', price: 'Ajustar precio' };
  return (
    <Modal open={Boolean(kind)} onClose={onClose} title={kind ? `${titles[kind]} · ${count} producto(s)` : ''}>
      {kind === 'category' && (
        <div className="space-y-4">
          <Field label="Categoría">
            <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sin categoría</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex justify-end">
            <Button variant="primary" loading={loading} onClick={() => onApply({ categoryId: categoryId || null })}>
              Aplicar
            </Button>
          </div>
        </div>
      )}
      {kind === 'collection' && (
        <div className="space-y-4">
          <p className="text-sm text-zinc-600">Un producto puede pertenecer a varias colecciones sin duplicar su ficha.</p>
          <Field label="Colección o temporada">
            <select className="input" value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
              <option value="">Elige…</option>
              {cols.filter((c) => !c.archivedAt).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button disabled={!collectionId} loading={loading} onClick={() => onApply({ removeCollectionIds: [collectionId] })}>
              Quitar de la colección
            </Button>
            <Button variant="primary" disabled={!collectionId} loading={loading} onClick={() => onApply({ addCollectionIds: [collectionId] })}>
              Agregar a la colección
            </Button>
          </div>
        </div>
      )}
      {kind === 'price' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['percent', 'Porcentaje'],
                ['add', 'Sumar / restar'],
                ['set', 'Precio fijo'],
              ] as const
            ).map(([m, l]) => (
              <button key={m} onClick={() => setMode(m)} className={clsx('rounded-lg border px-2 py-2 text-sm', mode === m ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-zinc-300')}>
                {l}
              </button>
            ))}
          </div>
          <Field label={mode === 'percent' ? 'Porcentaje (ej. 10 o -15)' : mode === 'add' ? 'Monto a sumar (negativo para restar)' : 'Nuevo precio'}>
            <input className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <div className="flex justify-end">
            <Button variant="primary" loading={loading} disabled={value === '' || !Number.isFinite(Number(value))} onClick={() => onApply({ price: { mode, value: Number(value) } })}>
              Aplicar a {count} producto(s)
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
