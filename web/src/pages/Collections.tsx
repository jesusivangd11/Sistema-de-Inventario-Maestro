import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Archive, FolderKanban, Plus, RotateCcw } from 'lucide-react';
import { api, date } from '../api';
import { Badge, Button, EmptyState, Field, Modal, PageHeader, PageLoader, useToast } from '../ui';
import { useBiz, useCollections } from '../session';

export function CollectionsPage() {
  const { base, bid } = useBiz();
  const q = useCollections();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState({ name: '', kind: 'collection' as 'season' | 'collection', description: '' });
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const open = params.get('nueva') === '1';

  const create = async () => {
    setSaving(true);
    try {
      await api.post(`${base}/collections`, form);
      toast.success('Colección creada');
      qc.invalidateQueries({ queryKey: ['collections', bid] });
      setParams({});
      setForm({ name: '', kind: 'collection', description: '' });
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };
  const archive = async (id: string, archived: boolean) => {
    try {
      await api.patch(`${base}/collections/${id}`, { archived });
      toast.success(archived ? 'Colección archivada (sus productos no se modifican)' : 'Colección reactivada');
      qc.invalidateQueries({ queryKey: ['collections', bid] });
    } catch (e) {
      toast.error(e);
    }
  };

  const list = (q.data ?? []).filter((c) => showArchived || !c.archivedAt);
  return (
    <>
      <PageHeader
        title="Temporadas y colecciones"
        subtitle="Un producto puede estar en varias colecciones sin duplicar su ficha. Archivar una temporada no borra ni oculta sus productos."
        actions={
          <>
            <Button variant="ghost" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? 'Ocultar archivadas' : 'Ver archivadas'}
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setParams({ nueva: '1' })}>
              Nueva colección
            </Button>
          </>
        }
      />
      {q.isLoading ? (
        <PageLoader />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<FolderKanban className="size-6" />}
          title="Sin colecciones"
          text="Crea temporadas (Otoño-invierno 2026, Navidad) o colecciones (Pijamas nuevas, Liquidación, Permanentes) para organizar la mercancía."
          action={
            <Button variant="primary" onClick={() => setParams({ nueva: '1' })}>
              Crear colección
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((c) => (
            <div key={c.id} className="card flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{c.name}</p>
                  <p className="text-xs text-zinc-500">Creada {date(c.createdAt)}</p>
                </div>
                <div className="flex gap-1">
                  <Badge tone={c.kind === 'season' ? 'blue' : 'zinc'}>{c.kind === 'season' ? 'Temporada' : 'Colección'}</Badge>
                  {c.archivedAt && <Badge tone="amber">Archivada</Badge>}
                </div>
              </div>
              {c.description && <p className="mt-2 text-sm text-zinc-600">{c.description}</p>}
              <div className="mt-auto flex items-center justify-between pt-4">
                <Link to={`/b/${bid}/productos?collectionId=${c.id}&status=all`} className="text-sm text-brand-700 hover:underline">
                  {c.productCount} producto(s)
                </Link>
                {c.archivedAt ? (
                  <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => archive(c.id, false)}>
                    Reactivar
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" icon={<Archive className="size-3.5" />} onClick={() => archive(c.id, true)}>
                    Archivar
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal
        open={open}
        onClose={() => setParams({})}
        title="Nueva colección o temporada"
        footer={
          <Button variant="primary" loading={saving} disabled={!form.name.trim()} onClick={create}>
            Crear
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="Nombre">
            <input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. Navidad 2026" />
          </Field>
          <Field label="Tipo">
            <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'season' })}>
              <option value="collection">Colección</option>
              <option value="season">Temporada</option>
            </select>
          </Field>
          <Field label="Descripción (opcional)">
            <textarea className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <p className="text-xs text-zinc-500">Para agregar productos: selecciónalos en la lista de productos → «Colecciones», o desde la ficha de cada producto.</p>
        </div>
      </Modal>
    </>
  );
}
