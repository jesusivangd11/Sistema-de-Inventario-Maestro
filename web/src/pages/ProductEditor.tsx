import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowLeft, ArrowLeftRight, ChevronLeft, ChevronRight, Copy, ImagePlus, Search, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { api, uploadInChunks } from '../api';
import { Badge, Button, DropZone, Field, Notice, PageHeader, PageLoader, Progress, SourceBadge, Tabs, useConfirm, useToast } from '../ui';
import { ISSUE_LABELS, useBiz, useCategories, useCollections, type FieldDef } from '../session';
import { STATUS_LABEL } from './Products';

type Variant = { id?: string; sku: string; color: string; size: string; barcode: string; stock: number; price: string; status: 'active' | 'inactive' };
type Media = { id: string; originalName: string; width: number; height: number; variantId: string | null };

const emptyForm = {
  name: '',
  sku: '',
  brand: '',
  model: '',
  categoryId: '',
  shortDescription: '',
  longDescription: '',
  cost: '',
  price: '',
  promoPrice: '',
  material: '',
  weightGrams: '',
  length: '',
  width: '',
  height: '',
  keywords: '',
  status: 'draft' as 'draft' | 'active' | 'archived',
  attributes: {} as Record<string, string>,
  collectionIds: [] as string[],
  fieldMeta: {} as Record<string, { source: string; review?: boolean; note?: string }>,
};

const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

export function ProductEditor() {
  const { pid } = useParams();
  const isNew = !pid;
  const { base, bid, biz } = useBiz();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const cats = useCategories().data ?? [];
  const cols = useCollections().data ?? [];
  const [tab, setTab] = useState<'general' | 'variants' | 'photos' | 'channels'>('general');
  const [form, setForm] = useState(emptyForm);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [single, setSingle] = useState({ stock: '0', barcode: '' });
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const q = useQuery({ queryKey: ['product', bid, pid], queryFn: () => api.get(`${base}/products/${pid}`), enabled: !isNew });
  const p = q.data;

  useEffect(() => {
    if (!p) return;
    setForm({
      name: p.name,
      sku: p.sku,
      brand: p.brand ?? '',
      model: p.model ?? '',
      categoryId: p.categoryId ?? '',
      shortDescription: p.shortDescription,
      longDescription: p.longDescription,
      cost: p.cost ?? '',
      price: p.price ?? '',
      promoPrice: p.promoPrice ?? '',
      material: p.material ?? '',
      weightGrams: p.weightGrams?.toString() ?? '',
      length: p.dimensions?.length?.toString() ?? '',
      width: p.dimensions?.width?.toString() ?? '',
      height: p.dimensions?.height?.toString() ?? '',
      keywords: p.keywords.join(', '),
      status: p.status,
      attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, String(v)])),
      collectionIds: p.collections.map((c: any) => c.id),
      fieldMeta: p.fieldMeta,
    });
    const hasOptions = p.variants.length > 1 || p.variants.some((v: any) => v.color || v.size);
    setVariants(
      hasOptions
        ? p.variants.map((v: any) => ({ id: v.id, sku: v.sku, color: v.color ?? '', size: v.size ?? '', barcode: v.barcode ?? '', stock: v.stock, price: v.price ?? '', status: v.status }))
        : [],
    );
    if (!hasOptions && p.variants[0]) setSingle({ stock: String(p.variants[0].stock), barcode: p.variants[0].barcode ?? '' });
    setMediaIds(p.media.map((m: Media) => m.id));
    setDirty(false);
  }, [p]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => {
      // Al editar un campo sugerido, pasa a ser dato del usuario y deja de requerir revisión
      const meta = { ...f.fieldMeta };
      if (meta[k as string]) meta[k as string] = { source: 'user' };
      return { ...f, [k]: v, fieldMeta: meta };
    });
    setDirty(true);
  };

  const category = cats.find((c) => c.id === form.categoryId);
  const fields: FieldDef[] = useMemo(() => {
    const out: FieldDef[] = [];
    let c = category;
    for (let i = 0; c && i < 5; i++) {
      for (const f of c.fields) if (!out.some((o) => o.key === f.key)) out.push(f);
      c = cats.find((x) => x.id === c!.parentId);
    }
    return out;
  }, [category, cats]);

  const save = async () => {
    if (!form.name.trim()) return toast.error('El nombre es obligatorio');
    setSaving(true);
    try {
      const dims = { length: numOrNull(form.length), width: numOrNull(form.width), height: numOrNull(form.height) };
      const body: Record<string, unknown> = {
        name: form.name,
        sku: form.sku || null,
        brand: form.brand || null,
        model: form.model || null,
        categoryId: form.categoryId || null,
        shortDescription: form.shortDescription,
        longDescription: form.longDescription,
        cost: form.cost === '' ? null : form.cost,
        price: form.price === '' ? null : form.price,
        promoPrice: form.promoPrice === '' ? null : form.promoPrice,
        material: form.material || null,
        weightGrams: numOrNull(form.weightGrams),
        dimensions: Object.values(dims).some((x) => x !== null) ? Object.fromEntries(Object.entries(dims).filter(([, v]) => v !== null)) : null,
        keywords: form.keywords.split(',').map((s) => s.trim()).filter(Boolean),
        status: form.status,
        attributes: Object.fromEntries(Object.entries(form.attributes).filter(([, v]) => v !== '')),
        fieldMeta: form.fieldMeta,
        collectionIds: form.collectionIds,
        mediaIds,
      };
      if (variants.length) {
        body.variants = variants.map((v) => ({
          id: v.id,
          sku: v.sku || null,
          color: v.color || null,
          size: v.size || null,
          barcode: v.barcode || null,
          stock: Number(v.stock) || 0,
          price: v.price === '' ? null : v.price,
          status: v.status,
        }));
      } else {
        // Producto sin opciones: una sola variante. Si ya existía así, se conserva su id y SKU.
        const prev = p?.variants.length === 1 && !p.variants[0].color && !p.variants[0].size ? p.variants[0] : null;
        body.variants = [{ id: prev?.id, sku: prev?.sku ?? null, stock: Number(single.stock) || 0, barcode: single.barcode || null }];
      }
      const saved = isNew ? await api.post(`${base}/products`, body) : await api.put(`${base}/products/${pid}`, body);
      toast.success(isNew ? `Producto creado con SKU ${saved.sku}` : 'Cambios guardados');
      qc.invalidateQueries({ queryKey: ['products', bid] });
      qc.setQueryData(['product', bid, saved.id], saved);
      setDirty(false);
      if (isNew) navigate(`/b/${bid}/productos/${saved.id}`, { replace: true });
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  const duplicate = async () => {
    try {
      const d = await api.post(`${base}/products/${pid}/duplicate`);
      toast.success('Ficha duplicada como borrador');
      navigate(`/b/${bid}/productos/${d.id}`);
    } catch (e) {
      toast.error(e);
    }
  };

  const toggleArchive = async () => {
    const archiving = form.status !== 'archived';
    if (archiving && !(await confirm({ title: 'Archivar producto', text: 'El producto deja de aparecer en el catálogo vigente, pero conserva fotos, variantes e historial. Puedes reactivarlo cuando quieras.', confirmLabel: 'Archivar' }))) return;
    try {
      await api.post(`${base}/products/bulk`, { ids: [pid], patch: { status: archiving ? 'archived' : 'active' } });
      toast.success(archiving ? 'Producto archivado' : 'Producto reactivado');
      qc.invalidateQueries({ queryKey: ['product', bid, pid] });
      qc.invalidateQueries({ queryKey: ['products', bid] });
    } catch (e) {
      toast.error(e);
    }
  };

  if (!isNew && q.isLoading) return <PageLoader />;
  if (!isNew && q.isError) return <Notice tone="red">No se encontró el producto en este negocio.</Notice>;

  const reviewCount = Object.values(form.fieldMeta).filter((m) => m.review).length;

  return (
    <>
      <button onClick={() => navigate(`/b/${bid}/productos`)} className="mb-3 flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800">
        <ArrowLeft className="size-4" /> Productos
      </button>
      <PageHeader
        title={isNew ? 'Nuevo producto' : form.name || 'Producto'}
        subtitle={
          !isNew && (
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{p.sku}</span>
              <Badge tone={form.status === 'active' ? 'green' : form.status === 'draft' ? 'zinc' : 'amber'}>{STATUS_LABEL[form.status]}</Badge>
              {p.totalStock === 0 && <Badge tone="red">Agotado</Badge>}
              {p.issues.map((i: string) => (
                <Badge key={i} tone="amber">
                  {ISSUE_LABELS[i] ?? i}
                </Badge>
              ))}
            </span>
          )
        }
        actions={
          <>
            {!isNew && (
              <>
                <Button icon={<Copy className="size-4" />} onClick={duplicate}>
                  Duplicar
                </Button>
                <Button onClick={toggleArchive}>{form.status === 'archived' ? 'Reactivar' : 'Archivar'}</Button>
              </>
            )}
            <Button variant="primary" loading={saving} onClick={save}>
              {isNew ? 'Crear producto' : dirty ? 'Guardar cambios' : 'Guardado'}
            </Button>
          </>
        }
      />

      {reviewCount > 0 && (
        <div className="mb-4">
          <Notice tone="amber" title={`${reviewCount} dato(s) sugeridos por IA pendientes de revisión`}>
            Revisa los campos marcados. Al editarlos o confirmarlos quedan como dato del usuario.{' '}
            <button
              className="font-medium underline"
              onClick={() => {
                setForm((f) => ({ ...f, fieldMeta: Object.fromEntries(Object.entries(f.fieldMeta).map(([k, m]) => [k, { ...m, review: false }])) }));
                setDirty(true);
              }}
            >
              Confirmar todos
            </button>
          </Notice>
        </div>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'general', label: 'Datos generales' },
          { value: 'variants', label: `Variantes e inventario${variants.length ? ` (${variants.length})` : ''}` },
          { value: 'photos', label: `Fotografías (${mediaIds.length})` },
          { value: 'channels', label: 'Canales de venta' },
        ]}
      />

      <div className="mt-5">
        {tab === 'general' && (
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
              <section className="card space-y-4 p-5">
                <MetaField label="Nombre comercial" meta={form.fieldMeta.name}>
                  <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ej. Pijama térmica de dos piezas" />
                </MetaField>
                <div className="grid gap-4 sm:grid-cols-3">
                  <MetaField label="Marca" meta={form.fieldMeta.brand} hint="Déjalo vacío si no la conoces">
                    <input className="input" value={form.brand} onChange={(e) => set('brand', e.target.value)} />
                  </MetaField>
                  <Field label="Modelo / referencia">
                    <input className="input" value={form.model} onChange={(e) => set('model', e.target.value)} />
                  </Field>
                  <Field label="SKU interno" hint={isNew ? 'Vacío = automático según la regla del negocio' : undefined}>
                    <input className="input font-mono" value={form.sku} onChange={(e) => set('sku', e.target.value.toUpperCase())} placeholder="Automático" />
                  </Field>
                </div>
                <MetaField label="Descripción corta" meta={form.fieldMeta.shortDescription}>
                  <textarea className="input min-h-16" maxLength={500} value={form.shortDescription} onChange={(e) => set('shortDescription', e.target.value)} />
                </MetaField>
                <MetaField label="Descripción larga" meta={form.fieldMeta.longDescription}>
                  <textarea className="input min-h-32" value={form.longDescription} onChange={(e) => set('longDescription', e.target.value)} />
                </MetaField>
                <MetaField label="Palabras clave" meta={form.fieldMeta.keywords} hint="Separadas por comas">
                  <input className="input" value={form.keywords} onChange={(e) => set('keywords', e.target.value)} />
                </MetaField>
              </section>

              <section className="card space-y-4 p-5">
                <h3 className="text-sm font-semibold">Material, medidas y peso</h3>
                <MetaField label="Material o composición" meta={form.fieldMeta.material} hint="Solo si está confirmado (etiqueta o proveedor)">
                  <input className="input" value={form.material} onChange={(e) => set('material', e.target.value)} />
                </MetaField>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field label="Largo (cm)">
                    <input className="input" inputMode="decimal" value={form.length} onChange={(e) => set('length', e.target.value)} />
                  </Field>
                  <Field label="Ancho (cm)">
                    <input className="input" inputMode="decimal" value={form.width} onChange={(e) => set('width', e.target.value)} />
                  </Field>
                  <Field label="Alto (cm)">
                    <input className="input" inputMode="decimal" value={form.height} onChange={(e) => set('height', e.target.value)} />
                  </Field>
                  <Field label="Peso (g)">
                    <input className="input" inputMode="numeric" value={form.weightGrams} onChange={(e) => set('weightGrams', e.target.value)} />
                  </Field>
                </div>
              </section>

              {(fields.length > 0 || Object.keys(form.attributes).length > 0) && (
                <section className="card space-y-4 p-5">
                  <h3 className="text-sm font-semibold">Atributos {category ? `de ${category.name}` : ''}</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {fields.map((f) => (
                      <MetaField key={f.key} label={`${f.label}${f.required ? ' *' : ''}${f.unit ? ` (${f.unit})` : ''}`} meta={form.fieldMeta[`attr:${f.key}`]}>
                        {f.type === 'select' ? (
                          <select className="input" value={form.attributes[f.key] ?? ''} onChange={(e) => set('attributes', { ...form.attributes, [f.key]: e.target.value })}>
                            <option value="">Pendiente</option>
                            {f.options?.map((o) => (
                              <option key={o}>{o}</option>
                            ))}
                          </select>
                        ) : (
                          <input className="input" inputMode={f.type === 'number' ? 'decimal' : undefined} value={form.attributes[f.key] ?? ''} onChange={(e) => set('attributes', { ...form.attributes, [f.key]: e.target.value })} />
                        )}
                      </MetaField>
                    ))}
                    {Object.keys(form.attributes)
                      .filter((k) => !fields.some((f) => f.key === k))
                      .map((k) => (
                        <MetaField key={k} label={k} meta={form.fieldMeta[`attr:${k}`]}>
                          <div className="flex gap-1">
                            <input className="input" value={form.attributes[k]} onChange={(e) => set('attributes', { ...form.attributes, [k]: e.target.value })} />
                            <Button variant="ghost" onClick={() => set('attributes', Object.fromEntries(Object.entries(form.attributes).filter(([x]) => x !== k)))} aria-label="Quitar atributo">
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </MetaField>
                      ))}
                  </div>
                  <AddAttribute onAdd={(k) => set('attributes', { ...form.attributes, [k]: '' })} />
                </section>
              )}
              {fields.length === 0 && Object.keys(form.attributes).length === 0 && (
                <div className="card p-5">
                  <h3 className="mb-2 text-sm font-semibold">Atributos personalizados</h3>
                  <p className="mb-3 text-sm text-zinc-500">Define atributos por categoría en Configuración, o agrega uno libre aquí.</p>
                  <AddAttribute onAdd={(k) => set('attributes', { ...form.attributes, [k]: '' })} />
                </div>
              )}
            </div>

            <div className="space-y-5">
              <section className="card space-y-4 p-5">
                <Field label="Estado">
                  <select className="input" value={form.status} onChange={(e) => set('status', e.target.value as typeof form.status)}>
                    <option value="draft">Borrador</option>
                    <option value="active">Activo</option>
                    <option value="archived">Archivado</option>
                  </select>
                </Field>
                <MetaField label="Categoría" meta={form.fieldMeta.categoryId}>
                  <select className="input" value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                    <option value="">Sin categoría</option>
                    {cats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.parentId ? `${cats.find((x) => x.id === c.parentId)?.name} › ` : ''}
                        {c.name}
                      </option>
                    ))}
                  </select>
                </MetaField>
              </section>
              <section className="card space-y-4 p-5">
                <h3 className="text-sm font-semibold">Precios ({biz?.currency})</h3>
                <Field label="Costo unitario" hint="Privado: nunca aparece en catálogos ni exportaciones">
                  <input className="input" inputMode="decimal" value={form.cost} onChange={(e) => set('cost', e.target.value)} />
                </Field>
                <Field label="Precio de venta">
                  <input className="input" inputMode="decimal" value={form.price} onChange={(e) => set('price', e.target.value)} />
                </Field>
                <Field label="Precio promocional (opcional)">
                  <input className="input" inputMode="decimal" value={form.promoPrice} onChange={(e) => set('promoPrice', e.target.value)} />
                </Field>
                {form.cost && form.price && Number(form.price) > 0 && (
                  <p className="text-xs text-zinc-500">Margen: {Math.round(((Number(form.price) - Number(form.cost)) / Number(form.price)) * 100)}%</p>
                )}
              </section>
              <section className="card p-5">
                <h3 className="mb-3 text-sm font-semibold">Colecciones y temporadas</h3>
                {cols.length === 0 ? (
                  <p className="text-sm text-zinc-500">Aún no hay colecciones. Créalas en la sección Colecciones.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {cols.filter((c) => !c.archivedAt || form.collectionIds.includes(c.id)).map((c) => {
                      const on = form.collectionIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          onClick={() => set('collectionIds', on ? form.collectionIds.filter((x) => x !== c.id) : [...form.collectionIds, c.id])}
                          className={clsx('rounded-full border px-2.5 py-1 text-xs font-medium transition', on ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-zinc-300 text-zinc-600 hover:border-zinc-400')}
                        >
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
              {!isNew && (
                <p className="px-1 text-xs text-zinc-500">
                  Creado {new Date(p.createdAt).toLocaleString('es-MX')} · Modificado {new Date(p.updatedAt).toLocaleString('es-MX')}
                </p>
              )}
            </div>
          </div>
        )}

        {tab === 'variants' && (
          <VariantsEditor
            variants={variants}
            setVariants={(v) => (setVariants(v), setDirty(true))}
            single={single}
            setSingle={(s) => (setSingle(s), setDirty(true))}
            currency={biz?.currency}
          />
        )}

        {tab === 'photos' &&
          (isNew ? (
            <Notice tone="blue">Crea el producto primero para poder subir fotografías. Para cargar muchas fotos de varios productos a la vez, usa Alta masiva.</Notice>
          ) : (
            <PhotosEditor
              productId={pid!}
              media={p.media}
              order={mediaIds}
              setOrder={(o) => (setMediaIds(o), setDirty(true))}
              variants={p.variants}
              onChanged={() => qc.invalidateQueries({ queryKey: ['product', bid, pid] })}
            />
          ))}

        {tab === 'channels' &&
          (isNew ? <Notice tone="blue">Guarda el producto para configurar sus datos por canal.</Notice> : <ChannelData product={p} onSaved={() => qc.invalidateQueries({ queryKey: ['product', bid, pid] })} />)}
      </div>
    </>
  );
}

function MetaField({ label, meta, hint, children }: { label: string; meta?: { source: string; review?: boolean; note?: string }; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-sm font-medium text-zinc-700">{label}</span>
        <SourceBadge meta={meta} />
      </div>
      <div className={clsx(meta?.review && 'rounded-lg ring-2 ring-amber-300')}>{children}</div>
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </div>
  );
}

function AddAttribute({ onAdd }: { onAdd: (k: string) => void }) {
  const [k, setK] = useState('');
  return (
    <div className="flex gap-2">
      <input className="input max-w-60" placeholder="Nuevo atributo (ej. Tipo de cierre)" value={k} onChange={(e) => setK(e.target.value)} />
      <Button disabled={!k.trim()} onClick={() => (onAdd(k.trim()), setK(''))}>
        Agregar
      </Button>
    </div>
  );
}

function ChipsInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [t, setT] = useState('');
  const add = () => {
    const parts = t.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
    setT('');
  };
  return (
    <div className="input flex min-h-10 flex-wrap items-center gap-1.5 py-1.5">
      {value.map((v) => (
        <span key={v} className="flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-sm">
          {v}
          <button className="text-zinc-400 hover:text-zinc-700" onClick={() => onChange(value.filter((x) => x !== v))} aria-label={`Quitar ${v}`}>
            ×
          </button>
        </span>
      ))}
      <input
        className="min-w-24 flex-1 outline-none"
        placeholder={value.length ? '' : placeholder}
        value={t}
        onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') (e.preventDefault(), add());
          if (e.key === 'Backspace' && !t && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={add}
      />
    </div>
  );
}

function VariantsEditor({ variants, setVariants, single, setSingle, currency }: { variants: Variant[]; setVariants: (v: Variant[]) => void; single: { stock: string; barcode: string }; setSingle: (s: { stock: string; barcode: string }) => void; currency?: string }) {
  const [colors, setColors] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [stock, setStock] = useState('0');
  const toast = useToast();
  const generate = () => {
    const cs = colors.length ? colors : [''];
    const ss = sizes.length ? sizes : [''];
    const existing = new Set(variants.map((v) => `${v.color.toLowerCase()}|${v.size.toLowerCase()}`));
    const add: Variant[] = [];
    for (const c of cs) for (const s of ss) if (!existing.has(`${c.toLowerCase()}|${s.toLowerCase()}`) && (c || s)) add.push({ sku: '', color: c, size: s, barcode: '', stock: Number(stock) || 0, price: '', status: 'active' });
    if (!add.length) return toast.info('Esas combinaciones ya existen');
    setVariants([...variants, ...add]);
    setColors([]);
    setSizes([]);
  };
  const upd = (i: number, patch: Partial<Variant>) => setVariants(variants.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const total = variants.length ? variants.filter((v) => v.status === 'active').reduce((s, v) => s + (Number(v.stock) || 0), 0) : Number(single.stock) || 0;

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <h3 className="text-sm font-semibold">Generar variantes por combinación</h3>
        <p className="mt-1 mb-4 text-sm text-zinc-500">Elige colores y tallas; se crean todas las combinaciones dentro de esta misma ficha. El SKU se genera automáticamente (ej. PIJ-001-ROS-CH) y puedes editarlo.</p>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_120px_auto]">
          <Field label="Colores">
            <ChipsInput value={colors} onChange={setColors} placeholder="Rosa, Negro… (Enter)" />
          </Field>
          <Field label="Tallas">
            <ChipsInput value={sizes} onChange={setSizes} placeholder="CH, M, G… (Enter)" />
          </Field>
          <Field label="Existencias c/u">
            <input className="input" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button variant="primary" icon={<Wand2 className="size-4" />} disabled={!colors.length && !sizes.length} onClick={generate}>
              Generar
            </Button>
          </div>
        </div>
      </section>

      {variants.length === 0 ? (
        <section className="card p-5">
          <h3 className="mb-1 text-sm font-semibold">Producto sin variantes</h3>
          <p className="mb-4 text-sm text-zinc-500">Se maneja con un solo SKU. Genera variantes arriba si tiene tallas o colores.</p>
          <div className="grid max-w-md grid-cols-2 gap-3">
            <Field label="Existencias">
              <input className="input" inputMode="numeric" value={single.stock} onChange={(e) => setSingle({ ...single, stock: e.target.value })} />
            </Field>
            <Field label="Código de barras">
              <input className="input" value={single.barcode} onChange={(e) => setSingle({ ...single, barcode: e.target.value })} />
            </Field>
          </div>
        </section>
      ) : (
        <section className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50/80 text-left text-xs font-medium text-zinc-500">
                <th className="px-3 py-2">Color</th>
                <th className="px-2 py-2">Talla</th>
                <th className="px-2 py-2">SKU</th>
                <th className="px-2 py-2">Código de barras</th>
                <th className="px-2 py-2 text-right">Existencias</th>
                <th className="px-2 py-2 text-right">Precio propio ({currency})</th>
                <th className="px-2 py-2">Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {variants.map((v, i) => (
                <tr key={v.id ?? `new-${i}`} className="border-b border-zinc-100 last:border-0">
                  <td className="px-3 py-1.5">
                    <input className="input py-1" value={v.color} onChange={(e) => upd(i, { color: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input className="input w-24 py-1" value={v.size} onChange={(e) => upd(i, { size: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input className="input py-1 font-mono text-xs" placeholder="Automático" value={v.sku} onChange={(e) => upd(i, { sku: e.target.value.toUpperCase() })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input className="input py-1" value={v.barcode} onChange={(e) => upd(i, { barcode: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input className="input w-20 py-1 text-right" inputMode="numeric" value={v.stock} onChange={(e) => upd(i, { stock: Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0) })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input className="input w-28 py-1 text-right" inputMode="decimal" placeholder="Del producto" value={v.price} onChange={(e) => upd(i, { price: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <select className="input py-1" value={v.status} onChange={(e) => upd(i, { status: e.target.value as Variant['status'] })}>
                      <option value="active">Activa</option>
                      <option value="inactive">Inactiva</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <button className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600" onClick={() => setVariants(variants.filter((_, j) => j !== i))} aria-label="Quitar variante">
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <p className="text-sm text-zinc-600">
        Existencias totales: <strong>{total}</strong> {total === 0 && <Badge tone="red">Agotado (el producto se conserva en el catálogo)</Badge>}
      </p>
    </div>
  );
}

function PhotosEditor({ productId, media, order, setOrder, variants, onChanged }: { productId: string; media: Media[]; order: string[]; setOrder: (o: string[]) => void; variants: any[]; onChanged: () => void }) {
  const { base } = useBiz();
  const toast = useToast();
  const confirm = useConfirm();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const byId = new Map(media.map((m) => [m.id, m]));
  const ordered = order.map((id) => byId.get(id)).filter(Boolean) as Media[];
  const upload = async (files: File[]) => {
    setProgress({ done: 0, total: files.length });
    try {
      const res: any[] = await uploadInChunks(`${base}/media`, files, (done, total) => setProgress({ done, total }), 4, { productId });
      const errs = res.filter((r) => r.error);
      const dups = res.filter((r) => r.duplicates?.length);
      if (errs.length) toast.error(`${errs.length} archivo(s) rechazados: ${errs[0].error}`);
      if (dups.length) toast.info(`${dups.length} foto(s) parecen repetidas de otras ya registradas`);
      toast.success(`${res.length - errs.length} foto(s) subidas`);
      onChanged();
    } catch (e) {
      toast.error(e);
    } finally {
      setProgress(null);
    }
  };
  const move = (i: number, d: number) => {
    const n = [...order];
    const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]];
    setOrder(n);
  };
  const remove = async (id: string) => {
    if (!(await confirm({ title: 'Quitar fotografía', text: 'La foto se mueve a la papelera del negocio y se puede restaurar.', confirmLabel: 'Quitar', danger: true }))) return;
    try {
      await api.post(`${base}/media/delete`, { ids: [id] });
      setOrder(order.filter((x) => x !== id));
      onChanged();
    } catch (e) {
      toast.error(e);
    }
  };
  const assignVariant = async (id: string, variantId: string) => {
    try {
      await api.patch(`${base}/media/${id}`, { variantId: variantId || null });
      onChanged();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="space-y-4">
      <DropZone accept="image/*" onFiles={upload} disabled={Boolean(progress)}>
        <ImagePlus className="mb-2 size-7 text-zinc-400" />
        <p className="text-sm font-medium">Arrastra fotos aquí o haz clic para elegirlas</p>
        <p className="text-xs text-zinc-500">JPG, PNG, WEBP o HEIC · hasta 15 MB c/u · en el celular puedes usar la cámara</p>
      </DropZone>
      {progress && <Progress value={progress.done} total={progress.total} label="Subiendo fotografías…" />}
      {ordered.length > 0 && <p className="text-xs text-zinc-500">La primera foto es la principal. Usa las flechas para reordenar y guarda los cambios.</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {ordered.map((m, i) => (
          <div key={m.id} className="card overflow-hidden">
            <div className="relative aspect-square bg-zinc-100">
              <img src={`${base}/media/${m.id}/thumb`} alt={m.originalName} className="size-full object-contain" />
              {i === 0 && <Badge tone="brand" className="absolute top-2 left-2">Principal</Badge>}
              {(m.width < 500 || m.height < 500) && (
                <Badge tone="red" className="absolute top-2 right-2" title="Menor a 500×500 px: Mercado Libre la rechaza">
                  {m.width}×{m.height}
                </Badge>
              )}
            </div>
            <div className="space-y-1.5 p-2">
              <p className="truncate text-xs text-zinc-500" title={m.originalName}>
                {m.originalName}
              </p>
              {variants.length > 1 && (
                <select className="input py-1 text-xs" value={m.variantId ?? ''} onChange={(e) => assignVariant(m.id, e.target.value)}>
                  <option value="">Todas las variantes</option>
                  {variants.map((v: any) => (
                    <option key={v.id} value={v.id}>
                      {[v.color, v.size].filter(Boolean).join(' / ') || v.sku}
                    </option>
                  ))}
                </select>
              )}
              <div className="flex items-center justify-between">
                <div className="flex">
                  <button className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Mover a la izquierda">
                    <ChevronLeft className="size-4" />
                  </button>
                  <button className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30" disabled={i === ordered.length - 1} onClick={() => move(i, 1)} aria-label="Mover a la derecha">
                    <ChevronRight className="size-4" />
                  </button>
                </div>
                <a href={`${base}/media/${m.id}/download`} className="text-xs text-zinc-500 hover:underline">
                  Original
                </a>
                <button className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600" onClick={() => remove(m.id)} aria-label="Quitar foto">
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChannelData({ product, onSaved }: { product: any; onSaved: () => void }) {
  const { base } = useBiz();
  const toast = useToast();
  const ml = product.channels.find((c: any) => c.channel === 'mercadolibre');
  const tk = product.channels.find((c: any) => c.channel === 'tiktok');
  const [mlCat, setMlCat] = useState<{ id: string; name: string } | null>(ml?.externalCategoryId ? { id: ml.externalCategoryId, name: ml.externalCategoryName ?? '' } : null);
  const [mlAttrs, setMlAttrs] = useState<Record<string, string>>(ml?.attributes ?? {});
  const [query, setQuery] = useState(product.name);
  const [suggestions, setSuggestions] = useState<any[] | null>(null);
  const [tkCat, setTkCat] = useState(tk?.externalCategoryName ?? '');
  const [saving, setSaving] = useState(false);
  const catInfo = useQuery({ queryKey: ['ml-cat', mlCat?.id], queryFn: () => api.get(`/api/channels/mercadolibre/categories/${mlCat!.id}`), enabled: Boolean(mlCat?.id) });

  const suggest = async () => {
    try {
      setSuggestions(await api.get(`/api/channels/mercadolibre/suggest?q=${encodeURIComponent(query)}`));
    } catch (e) {
      toast.error(e);
    }
  };
  const saveMl = async () => {
    setSaving(true);
    try {
      await api.put(`${base}/products/${product.id}/channels/mercadolibre`, { externalCategoryId: mlCat?.id ?? null, externalCategoryName: mlCat?.name ?? null, attributes: mlAttrs });
      toast.success('Datos de Mercado Libre guardados');
      onSaved();
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };
  const saveTk = async () => {
    try {
      await api.put(`${base}/products/${product.id}/channels/tiktok`, { externalCategoryName: tkCat || null });
      toast.success('Datos de TikTok Shop guardados');
      onSaved();
    } catch (e) {
      toast.error(e);
    }
  };
  const statusBadge = (c: any) =>
    !c || c.status === 'none' ? <Badge>Sin exportar</Badge> : c.status === 'file_generated' ? <Badge tone="blue">Archivo generado (no publicado)</Badge> : <Badge tone="green">Vinculado · {c.externalId}</Badge>;
  const autoValue = (id: string) =>
    ({ BRAND: product.brand, MODEL: product.model, SELLER_SKU: 'SKU de cada variante', COLOR: 'Color de cada variante', SIZE: 'Talla de cada variante', GTIN: 'Código de barras de cada variante' })[id];

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="card space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Mercado Libre</h3>
          {statusBadge(ml)}
        </div>
        <Field label="Buscar categoría (servicio oficial de predicción de Mercado Libre)">
          <div className="flex gap-2">
            <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && suggest()} />
            <Button icon={<Search className="size-4" />} onClick={suggest}>
              Sugerir
            </Button>
          </div>
        </Field>
        {suggestions && (
          <div className="space-y-1">
            {suggestions.length === 0 && <p className="text-sm text-zinc-500">Sin sugerencias; prueba con otras palabras.</p>}
            {suggestions.map((s) => (
              <button
                key={s.categoryId}
                onClick={() => (setMlCat({ id: s.categoryId, name: s.categoryName }), setSuggestions(null))}
                className="flex w-full items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-left text-sm hover:bg-zinc-50"
              >
                <span>
                  {s.categoryName} <span className="text-zinc-500">· {s.domainName}</span>
                </span>
                <span className="font-mono text-xs text-zinc-500">{s.categoryId}</span>
              </button>
            ))}
          </div>
        )}
        {mlCat && (
          <div className="rounded-lg bg-zinc-50 px-3 py-2 text-sm">
            Categoría: <strong>{catInfo.data?.path?.join(' › ') || mlCat.name}</strong> <span className="font-mono text-xs text-zinc-500">({mlCat.id})</span>
            {catInfo.data?.settings?.max_title_length && (
              <p className="mt-1 text-xs text-zinc-500">
                Título máx. {catInfo.data.settings.max_title_length} caracteres (actual: {product.name.length}) · máx. {catInfo.data.settings.max_pictures_per_item} fotos · precio mínimo ${catInfo.data.settings.minimum_price}
              </p>
            )}
          </div>
        )}
        {catInfo.isError && <Notice tone="red">No se pudo consultar la categoría en Mercado Libre: {(catInfo.error as Error).message}</Notice>}
        {catInfo.data && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Atributos de la categoría (fuente: API oficial)</p>
            {catInfo.data.relevant.map((a: any) => {
              const auto = autoValue(a.id);
              return (
                <div key={a.id}>
                  <span className="mb-1 flex items-center gap-1.5 text-sm text-zinc-700">
                    {a.name}
                    {a.tags.required && <Badge tone="red">Obligatorio</Badge>}
                    {a.tags.conditional_required && <Badge tone="amber">Condicional</Badge>}
                    {a.tags.allow_variations && <Badge tone="blue">Por variante</Badge>}
                  </span>
                  {auto && !mlAttrs[a.id] ? (
                    <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-1.5 text-sm text-zinc-500">
                      Se toma automáticamente: {auto || <span className="text-amber-700">vacío en la ficha</span>}
                    </p>
                  ) : a.values?.length && a.value_type === 'list' ? (
                    <select className="input" value={mlAttrs[a.id] ?? ''} onChange={(e) => setMlAttrs({ ...mlAttrs, [a.id]: e.target.value })}>
                      <option value="">Pendiente</option>
                      {a.values.map((v: any) => (
                        <option key={v.id} value={v.name}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input className="input" list={`ml-${a.id}`} value={mlAttrs[a.id] ?? ''} onChange={(e) => setMlAttrs({ ...mlAttrs, [a.id]: e.target.value })} />
                  )}
                  {a.values?.length > 0 && a.value_type !== 'list' && (
                    <datalist id={`ml-${a.id}`}>
                      {a.values.map((v: any) => (
                        <option key={v.id} value={v.name} />
                      ))}
                    </datalist>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <Field label="Título específico para Mercado Libre (opcional)" hint="Si lo dejas vacío se usa el nombre comercial">
          <input className="input" value={mlAttrs.__title ?? ''} onChange={(e) => setMlAttrs({ ...mlAttrs, __title: e.target.value })} />
        </Field>
        <Button variant="primary" loading={saving} onClick={saveMl}>
          Guardar datos de Mercado Libre
        </Button>
      </section>

      <section className="card space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">TikTok Shop</h3>
          {statusBadge(tk)}
        </div>
        <p className="text-sm text-zinc-600">
          TikTok Shop define columnas por categoría en su plantilla oficial. Las columnas se llenan desde el catálogo maestro al exportar; aquí puedes guardar la categoría de TikTok para referencia.
        </p>
        <Field label="Categoría en TikTok Shop">
          <input className="input" value={tkCat} onChange={(e) => setTkCat(e.target.value)} placeholder="Ej. Ropa de mujer > Pijamas" />
        </Field>
        <Button onClick={saveTk}>Guardar datos de TikTok Shop</Button>
        <div className="flex items-start gap-2 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600">
          <ArrowLeftRight className="mt-0.5 size-3.5 shrink-0" />
          Los identificadores externos se vinculan desde la sección del canal (después de publicar en el marketplace).
        </div>
        <div className="flex items-start gap-2 rounded-lg bg-violet-50 p-3 text-xs text-violet-800">
          <Sparkles className="mt-0.5 size-3.5 shrink-0" />
          Publicación directa por API: pendiente de credenciales del marketplace.
        </div>
      </section>
    </div>
  );
}
