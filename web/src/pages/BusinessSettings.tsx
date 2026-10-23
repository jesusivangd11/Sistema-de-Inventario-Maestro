import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ImagePlus, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import { Badge, Button, Field, Modal, Notice, PageHeader, PageLoader, Tabs, useConfirm, useToast } from '../ui';
import { useBiz, useCategories, useMe, type Category, type FieldDef } from '../session';
import { roleLabel } from '../App';

const COLORS = ['#4f46e5', '#be185d', '#0f766e', '#b45309', '#7c3aed', '#0369a1', '#15803d', '#dc2626', '#0f172a'];

export function NewBusinessPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe().data;
  const [form, setForm] = useState({ name: '', description: '', primaryColor: '#4f46e5', currency: 'MXN' });
  const [saving, setSaving] = useState(false);
  if (me && me.user.role !== 'superadmin') return <Notice tone="red">Solo el administrador general puede crear negocios.</Notice>;
  const create = async () => {
    setSaving(true);
    try {
      const b = await api.post('/api/businesses', form);
      await qc.invalidateQueries({ queryKey: ['me'] });
      toast.success('Negocio creado');
      navigate(`/b/${b.id}/ajustes`);
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Nuevo negocio" subtitle="Cada negocio tiene su propio catálogo, categorías, inventario, fotos y canales, aislados de los demás." />
      <div className="card space-y-4 p-6">
        <Field label="Nombre comercial">
          <input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. Fajas Colombianas Bella" />
        </Field>
        <Field label="Descripción" hint="Ayuda a la IA a entender qué vende el negocio">
          <textarea className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div>
          <span className="label">Color principal</span>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button key={c} onClick={() => setForm({ ...form, primaryColor: c })} className="size-8 rounded-full ring-offset-2" style={{ background: c, boxShadow: form.primaryColor === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : undefined }} aria-label={c} />
            ))}
            <input type="color" className="h-8 w-10 cursor-pointer rounded border border-zinc-300" value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} />
          </div>
        </div>
        <Field label="Moneda">
          <select className="input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            <option value="MXN">MXN · Peso mexicano</option>
            <option value="USD">USD · Dólar estadounidense</option>
            <option value="COP">COP · Peso colombiano</option>
          </select>
        </Field>
        <div className="flex justify-end">
          <Button variant="primary" loading={saving} disabled={!form.name.trim()} onClick={create}>
            Crear negocio
          </Button>
        </div>
      </div>
    </div>
  );
}

export function BusinessSettings() {
  const { base, bid, isAdmin } = useBiz();
  const [tab, setTab] = useState<'general' | 'categories' | 'members'>('general');
  return (
    <>
      <PageHeader title="Configuración del negocio" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'general', label: 'Identidad y SKU' },
          { value: 'categories', label: 'Categorías y atributos' },
          ...(isAdmin ? [{ value: 'members' as const, label: 'Usuarios con acceso' }] : []),
        ]}
      />
      <div className="mt-5">
        {tab === 'general' && <GeneralTab key={bid} base={base} />}
        {tab === 'categories' && <CategoriesTab />}
        {tab === 'members' && <MembersTab />}
      </div>
    </>
  );
}

function GeneralTab({ base }: { base: string }) {
  const { bid, isAdmin } = useBiz();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const me = useMe().data!;
  const q = useQuery({ queryKey: ['business', bid], queryFn: () => api.get(base) });
  const [form, setForm] = useState<any>(null);
  const [logoV, setLogoV] = useState(0);
  useEffect(() => {
    if (q.data) setForm(q.data);
  }, [q.data]);
  if (!form) return <PageLoader />;
  const save = async () => {
    try {
      await api.patch(base, {
        name: form.name,
        description: form.description,
        primaryColor: form.primaryColor,
        secondaryColor: form.secondaryColor,
        currency: form.currency,
        skuPattern: form.skuPattern,
        variantSkuPattern: form.variantSkuPattern,
        skuPrefix: form.skuPrefix,
        skuSeqDigits: Number(form.skuSeqDigits),
      });
      toast.success('Configuración guardada');
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['business', bid] });
    } catch (e) {
      toast.error(e);
    }
  };
  const uploadLogo = async (f: File) => {
    try {
      await api.upload(`${base}/logo`, [f]);
      setLogoV((v) => v + 1);
      qc.invalidateQueries({ queryKey: ['me'] });
      toast.success('Logotipo actualizado');
    } catch (e) {
      toast.error(e);
    }
  };
  const archive = async () => {
    if (!(await confirm({ title: 'Archivar negocio', text: 'El negocio deja de mostrarse para todos los usuarios. Sus datos NO se eliminan y pueden recuperarse desde la base de datos.', confirmLabel: 'Archivar negocio', danger: true, requireText: form.name }))) return;
    try {
      await api.post(`${base}/archive`, { confirmName: form.name });
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate('/');
    } catch (e) {
      toast.error(e);
    }
  };
  const example = form.skuPattern.replace('{CAT}', 'PIJ').replace('{PREFIX}', form.skuPrefix).replace('{YY}', String(new Date().getFullYear()).slice(2)).replace('{SEQ}', '1'.padStart(Number(form.skuSeqDigits) || 3, '0'));
  const vexample = form.variantSkuPattern.replace('{SKU}', example).replace('{COLOR}', 'ROS').replace('{SIZE}', 'CH').replace('{OPT}', '');
  const ro = !isAdmin;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="card space-y-4 p-5">
        <h3 className="font-semibold">Identidad</h3>
        {ro && <Notice tone="blue">Solo los administradores del negocio pueden modificar esta configuración.</Notice>}
        <div className="flex items-center gap-4">
          {form.logoKey ? (
            <img src={`${base}/logo?v=${logoV}`} alt="Logotipo" className="size-20 rounded-lg border border-zinc-200 bg-white object-contain p-1" />
          ) : (
            <div className="flex size-20 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-xs text-zinc-400">Sin logo</div>
          )}
          {!ro && (
            <label className="cursor-pointer">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium shadow-xs hover:bg-zinc-50">
                <ImagePlus className="size-4" /> Subir logotipo
              </span>
              <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
            </label>
          )}
        </div>
        <Field label="Nombre comercial">
          <input className="input" disabled={ro} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Descripción">
          <textarea className="input" disabled={ro} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Color principal">
            <input type="color" disabled={ro} className="h-10 w-full cursor-pointer rounded-lg border border-zinc-300" value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} />
          </Field>
          <Field label="Color secundario">
            <input type="color" disabled={ro} className="h-10 w-full cursor-pointer rounded-lg border border-zinc-300" value={form.secondaryColor} onChange={(e) => setForm({ ...form, secondaryColor: e.target.value })} />
          </Field>
          <Field label="Moneda">
            <select className="input" disabled={ro} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              <option>MXN</option>
              <option>USD</option>
              <option>COP</option>
            </select>
          </Field>
        </div>
      </section>
      <section className="card space-y-4 p-5">
        <h3 className="font-semibold">Regla de SKU automático</h3>
        <p className="text-sm text-zinc-600">
          Tokens del producto: <code>{'{CAT}'}</code> código de categoría, <code>{'{SEQ}'}</code> consecutivo, <code>{'{PREFIX}'}</code> prefijo, <code>{'{YY}'}</code> año. Variante: <code>{'{SKU}'}</code>, <code>{'{COLOR}'}</code>, <code>{'{SIZE}'}</code>, <code>{'{OPT}'}</code>.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Patrón de producto">
            <input className="input font-mono" disabled={ro} value={form.skuPattern} onChange={(e) => setForm({ ...form, skuPattern: e.target.value })} />
          </Field>
          <Field label="Patrón de variante">
            <input className="input font-mono" disabled={ro} value={form.variantSkuPattern} onChange={(e) => setForm({ ...form, variantSkuPattern: e.target.value })} />
          </Field>
          <Field label="Prefijo">
            <input className="input font-mono" disabled={ro} value={form.skuPrefix} onChange={(e) => setForm({ ...form, skuPrefix: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Dígitos del consecutivo">
            <input className="input" type="number" min={2} max={8} disabled={ro} value={form.skuSeqDigits} onChange={(e) => setForm({ ...form, skuSeqDigits: e.target.value })} />
          </Field>
        </div>
        <p className="rounded-lg bg-zinc-50 px-3 py-2 text-sm">
          Ejemplo: <span className="font-mono">{example}</span> → variante <span className="font-mono">{vexample}</span>
        </p>
        <p className="text-xs text-zinc-500">Los SKU se pueden editar manualmente; el sistema impide duplicados dentro del negocio.</p>
      </section>
      {!ro && (
        <div className="flex flex-wrap justify-between gap-2 lg:col-span-2">
          {me.user.role === 'superadmin' ? (
            <Button variant="ghost" className="text-red-600" onClick={archive}>
              Archivar negocio
            </Button>
          ) : (
            <span />
          )}
          <Button variant="primary" onClick={save}>
            Guardar configuración
          </Button>
        </div>
      )}
    </div>
  );
}

function CategoriesTab() {
  const { base, bid, isAdmin } = useBiz();
  const cats = useCategories();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Partial<Category> | null>(null);
  const save = async () => {
    if (!editing?.name?.trim()) return;
    try {
      const body = { name: editing.name, parentId: editing.parentId || null, code: editing.code || undefined, fields: editing.fields ?? [] };
      if (editing.id) await api.patch(`${base}/categories/${editing.id}`, body);
      else await api.post(`${base}/categories`, body);
      qc.invalidateQueries({ queryKey: ['categories', bid] });
      setEditing(null);
      toast.success('Categoría guardada');
    } catch (e) {
      toast.error(e);
    }
  };
  const del = async (c: Category) => {
    if (!(await confirm({ title: 'Eliminar categoría', text: `¿Eliminar «${c.name}»? Solo es posible si no tiene productos ni subcategorías.`, confirmLabel: 'Eliminar', danger: true }))) return;
    try {
      await api.del(`${base}/categories/${c.id}`);
      qc.invalidateQueries({ queryKey: ['categories', bid] });
    } catch (e) {
      toast.error(e);
    }
  };
  const list = cats.data ?? [];
  const tree = [...list.filter((c) => !c.parentId), ...[]].flatMap((root) => [root, ...list.filter((c) => c.parentId === root.id)]);
  const orphans = list.filter((c) => c.parentId && !list.some((r) => r.id === c.parentId));
  const updField = (i: number, patch: Partial<FieldDef>) => setEditing({ ...editing!, fields: (editing!.fields ?? []).map((f, j) => (j === i ? { ...f, ...patch } : f)) });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-600">Cada categoría puede definir sus propios atributos (por ejemplo, una faja: tipo de compresión y guía de tallas; una pijama: composición).</p>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing({ name: '', fields: [] })}>
          Nueva categoría
        </Button>
      </div>
      {list.length === 0 ? (
        <Notice tone="blue">Aún no hay categorías. También se crean automáticamente al importar un lote con una columna de categoría.</Notice>
      ) : (
        <div className="card divide-y divide-zinc-100">
          {[...tree, ...orphans].map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <div className={c.parentId ? 'min-w-40 flex-1 pl-6' : 'min-w-40 flex-1'}>
                <p className="font-medium">{c.parentId ? '↳ ' : ''}{c.name}</p>
                <p className="text-xs text-zinc-500">
                  Código <span className="font-mono">{c.code}</span> · {c.productCount} productos
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {c.fields.map((f) => (
                  <Badge key={f.key}>
                    {f.label}
                    {f.required ? ' *' : ''}
                  </Badge>
                ))}
              </div>
              <Button size="sm" onClick={() => setEditing(c)}>
                Editar
              </Button>
              {isAdmin && (
                <button className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600" onClick={() => del(c)} aria-label="Eliminar">
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <Modal
        open={Boolean(editing)}
        wide
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Editar categoría' : 'Nueva categoría'}
        footer={
          <Button variant="primary" disabled={!editing?.name?.trim()} onClick={save}>
            Guardar
          </Button>
        }
      >
        {editing && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Nombre">
                <input className="input" autoFocus value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
              <Field label="Categoría padre (opcional)">
                <select className="input" value={editing.parentId ?? ''} onChange={(e) => setEditing({ ...editing, parentId: e.target.value || null })}>
                  <option value="">Ninguna (principal)</option>
                  {list.filter((c) => !c.parentId && c.id !== editing.id).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Código para SKU" hint="Vacío = 3 primeras letras">
                <input className="input font-mono" maxLength={6} value={editing.code ?? ''} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} />
              </Field>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">Atributos de la categoría</span>
                <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing({ ...editing, fields: [...(editing.fields ?? []), { key: '', label: '', type: 'text' }] })}>
                  Atributo
                </Button>
              </div>
              {(editing.fields ?? []).length === 0 && <p className="text-sm text-zinc-500">Sin atributos específicos.</p>}
              <div className="space-y-2">
                {(editing.fields ?? []).map((f, i) => (
                  <div key={i} className="grid items-center gap-2 rounded-lg border border-zinc-200 p-2 sm:grid-cols-[1fr_120px_1fr_auto_auto]">
                    <input
                      className="input py-1"
                      placeholder="Nombre (ej. Tipo de compresión)"
                      value={f.label}
                      onChange={(e) =>
                        updField(i, {
                          label: e.target.value,
                          key: f.key && editing.id ? f.key : e.target.value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
                        })
                      }
                    />
                    <select className="input py-1" value={f.type} onChange={(e) => updField(i, { type: e.target.value as FieldDef['type'] })}>
                      <option value="text">Texto</option>
                      <option value="number">Número</option>
                      <option value="select">Lista</option>
                    </select>
                    {f.type === 'select' ? (
                      <input className="input py-1" placeholder="Opciones separadas por coma" value={(f.options ?? []).join(', ')} onChange={(e) => updField(i, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
                    ) : (
                      <input className="input py-1" placeholder="Unidad (opcional)" value={f.unit ?? ''} onChange={(e) => updField(i, { unit: e.target.value })} />
                    )}
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" className="accent-brand-600" checked={Boolean(f.required)} onChange={(e) => updField(i, { required: e.target.checked })} /> Obligatorio
                    </label>
                    <button className="p-1 text-zinc-400 hover:text-red-600" onClick={() => setEditing({ ...editing, fields: (editing.fields ?? []).filter((_, j) => j !== i) })} aria-label="Quitar atributo">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function MembersTab() {
  const { base, bid } = useBiz();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['members', bid], queryFn: () => api.get<any[]>(`${base}/members`) });
  const [form, setForm] = useState({ email: '', role: 'operator' });
  const add = async () => {
    try {
      await api.put(`${base}/members`, form);
      qc.invalidateQueries({ queryKey: ['members', bid] });
      setForm({ email: '', role: 'operator' });
      toast.success('Acceso asignado');
    } catch (e) {
      toast.error(e);
    }
  };
  const remove = async (userId: string) => {
    try {
      await api.del(`${base}/members/${userId}`);
      qc.invalidateQueries({ queryKey: ['members', bid] });
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-2 p-4">
        <Field label="Correo del usuario" className="min-w-60 flex-1">
          <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Rol">
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="operator">Operador</option>
            <option value="admin">Administrador del negocio</option>
          </select>
        </Field>
        <Button variant="primary" disabled={!form.email} onClick={add}>
          Dar acceso
        </Button>
      </div>
      <p className="text-xs text-zinc-500">El usuario debe existir (lo crea el administrador general). Los operadores gestionan productos, lotes, catálogos y exportaciones; los administradores además configuran el negocio y sus accesos.</p>
      {q.isLoading ? (
        <PageLoader />
      ) : (
        <div className="card divide-y divide-zinc-100">
          {(q.data ?? []).length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">Solo el administrador general tiene acceso por ahora.</p>}
          {(q.data ?? []).map((m) => (
            <div key={m.userId} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1">
                <p className="font-medium">{m.name}</p>
                <p className="text-xs text-zinc-500">{m.email}</p>
              </div>
              <Badge tone={m.role === 'admin' ? 'brand' : 'zinc'}>{roleLabel(m.role)}</Badge>
              <Button size="sm" variant="ghost" onClick={() => remove(m.userId)}>
                Quitar acceso
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
