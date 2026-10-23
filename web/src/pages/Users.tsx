import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../api';
import { Badge, Button, Field, Modal, Notice, PageHeader, PageLoader, useToast } from '../ui';
import { useMe } from '../session';
import { roleLabel } from '../App';

type U = { id: string; name: string; email: string; role: 'superadmin' | 'member'; active: boolean; memberships: { businessId: string; role: 'admin' | 'operator'; businessName: string }[] };

export function UsersPage() {
  const me = useMe().data!;
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<U[]>('/api/users'), enabled: me.user.role === 'superadmin' });
  const [editing, setEditing] = useState<(Partial<U> & { password?: string }) | null>(null);
  if (me.user.role !== 'superadmin') return <Notice tone="red">Solo el administrador general puede administrar usuarios.</Notice>;

  const save = async () => {
    if (!editing) return;
    try {
      const memberships = (editing.memberships ?? []).map((m) => ({ businessId: m.businessId, role: m.role }));
      if (editing.id) {
        await api.patch(`/api/users/${editing.id}`, { name: editing.name, role: editing.role, active: editing.active, memberships, ...(editing.password ? { password: editing.password } : {}) });
      } else {
        await api.post('/api/users', { name: editing.name, email: editing.email, password: editing.password, role: editing.role ?? 'member', memberships });
      }
      qc.invalidateQueries({ queryKey: ['users'] });
      setEditing(null);
      toast.success('Usuario guardado');
    } catch (e) {
      toast.error(e);
    }
  };
  const toggleBiz = (businessId: string, role: 'admin' | 'operator' | '') => {
    const rest = (editing!.memberships ?? []).filter((m) => m.businessId !== businessId);
    setEditing({ ...editing!, memberships: role ? [...rest, { businessId, role, businessName: '' }] : rest });
  };

  return (
    <>
      <PageHeader
        title="Usuarios y accesos"
        subtitle="Asigna a cada usuario los negocios que puede ver. Los datos de un negocio nunca son visibles para usuarios sin acceso a él."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing({ role: 'member', memberships: [], active: true })}>
            Nuevo usuario
          </Button>
        }
      />
      {q.isLoading ? (
        <PageLoader />
      ) : (
        <div className="card divide-y divide-zinc-100">
          {q.data!.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-48 flex-1">
                <p className="font-medium">
                  {u.name} {!u.active && <Badge tone="red">Inactivo</Badge>}
                </p>
                <p className="text-xs text-zinc-500">{u.email}</p>
              </div>
              {u.role === 'superadmin' ? (
                <Badge tone="brand">Administrador general</Badge>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {u.memberships.length === 0 && <Badge tone="amber">Sin negocios</Badge>}
                  {u.memberships.map((m) => (
                    <Badge key={m.businessId}>
                      {m.businessName} · {m.role === 'admin' ? 'Admin' : 'Operador'}
                    </Badge>
                  ))}
                </div>
              )}
              <Button size="sm" onClick={() => setEditing({ ...u })}>
                Editar
              </Button>
            </div>
          ))}
        </div>
      )}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Editar usuario' : 'Nuevo usuario'}
        footer={
          <Button variant="primary" onClick={save} disabled={!editing?.name || (!editing?.id && (!editing?.email || (editing?.password ?? '').length < 8))}>
            Guardar
          </Button>
        }
      >
        {editing && (
          <div className="space-y-4">
            <Field label="Nombre">
              <input className="input" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            {!editing.id && (
              <Field label="Correo">
                <input className="input" type="email" value={editing.email ?? ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
              </Field>
            )}
            <Field label={editing.id ? 'Nueva contraseña (opcional)' : 'Contraseña'} hint="Mínimo 8 caracteres">
              <input className="input" type="password" autoComplete="new-password" value={editing.password ?? ''} onChange={(e) => setEditing({ ...editing, password: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Rol en la plataforma">
                <select className="input" value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value as U['role'] })}>
                  <option value="member">Usuario (según negocios asignados)</option>
                  <option value="superadmin">Administrador general</option>
                </select>
              </Field>
              {editing.id && (
                <Field label="Estado">
                  <select className="input" value={editing.active ? '1' : '0'} onChange={(e) => setEditing({ ...editing, active: e.target.value === '1' })}>
                    <option value="1">Activo</option>
                    <option value="0">Inactivo</option>
                  </select>
                </Field>
              )}
            </div>
            {editing.role === 'member' && (
              <div>
                <span className="label">Acceso por negocio</span>
                <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                  {me.businesses.map((b) => {
                    const m = editing.memberships?.find((x) => x.businessId === b.id);
                    return (
                      <div key={b.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                        <span>{b.name}</span>
                        <select className="input w-auto py-1" value={m?.role ?? ''} onChange={(e) => toggleBiz(b.id, e.target.value as 'admin' | 'operator' | '')}>
                          <option value="">Sin acceso</option>
                          <option value="operator">{roleLabel('operator')}</option>
                          <option value="admin">{roleLabel('admin')}</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
