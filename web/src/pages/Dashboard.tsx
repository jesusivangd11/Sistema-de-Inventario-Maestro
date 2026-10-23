import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { AlertTriangle, BookOpen, Download, FileSpreadsheet, FolderPlus, ImagePlus, PackagePlus, Plus, Store } from 'lucide-react';
import { api, dateTime } from '../api';
import { Badge, Button, EmptyState, PageHeader, PageLoader } from '../ui';
import { useMe } from '../session';
import { BizAvatar } from '../App';

type Dash = {
  counts: Record<string, number>;
  recentExports: any[];
  openBatches: any[];
  activity: any[];
  perBusiness: any[];
};

const ACTION_LABEL: Record<string, string> = {
  'product.create': 'creó un producto',
  'product.update': 'editó un producto',
  'product.bulk_update': 'editó productos en bloque',
  'variant.bulk_update': 'actualizó variantes',
  'batch.create': 'creó un lote de alta masiva',
  'batch.import_spreadsheet': 'importó una hoja de cálculo',
  'batch.commit': 'confirmó un lote',
  'business.create': 'creó el negocio',
  'business.update': 'actualizó el negocio',
  'business.archive': 'archivó el negocio',
  'catalog.create': 'creó un catálogo',
  'catalog.share': 'compartió un catálogo',
  'catalog.unshare': 'desactivó el enlace de un catálogo',
  'catalog.delete': 'eliminó un catálogo',
  'export.generate': 'generó un archivo de exportación',
  'template.upload': 'subió una plantilla de marketplace',
  'template.delete': 'eliminó una plantilla',
  'channel.link_ids': 'vinculó IDs externos',
  'collection.create': 'creó una colección',
  'media.delete': 'eliminó fotografías',
  'member.upsert': 'asignó acceso a un usuario',
  'member.remove': 'quitó acceso a un usuario',
  'user.create': 'creó un usuario',
  'user.update': 'actualizó un usuario',
  'auth.setup': 'configuró la plataforma',
};

export function DashboardPage() {
  const { bid } = useParams();
  const me = useMe().data!;
  const navigate = useNavigate();
  const biz = me.businesses.find((b) => b.id === bid);
  const q = useQuery({ queryKey: ['dashboard', bid ?? 'all'], queryFn: () => api.get<Dash>(`/api/dashboard${bid ? `?businessId=${bid}` : ''}`) });

  if (!bid && me.businesses.length === 0) {
    return (
      <>
        <PageHeader title="Bienvenido" subtitle="La plataforma está vacía. Empieza creando tu primer negocio." />
        <EmptyState
          icon={<Store className="size-6" />}
          title={me.user.role === 'superadmin' ? 'Crea tu primer negocio' : 'Aún no tienes negocios asignados'}
          text={
            me.user.role === 'superadmin'
              ? 'Cada negocio tiene su propio catálogo, categorías, precios, fotos, colecciones y canales de venta, completamente separados.'
              : 'Pide al administrador general que te dé acceso a un negocio.'
          }
          action={
            me.user.role === 'superadmin' && (
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate('/negocios/nuevo')}>
                Crear negocio
              </Button>
            )
          }
        />
      </>
    );
  }
  if (q.isLoading || !q.data) return <PageLoader />;
  const c = q.data.counts;
  const go = (path: string) => navigate(bid ? `/b/${bid}/${path}` : '#');

  const stat = (label: string, value: number, to?: string, tone?: 'amber' | 'red') => {
    const body = (
      <div className={clsx('card h-full px-4 py-3.5 transition', to && 'hover:border-zinc-300 hover:shadow-sm')}>
        <p className="text-[0.85rem] text-zinc-500">{label}</p>
        <p className={clsx('mt-1 text-2xl font-semibold tabular-nums', tone === 'amber' && value > 0 && 'text-amber-600', tone === 'red' && value > 0 && 'text-red-600')}>
          {value.toLocaleString('es-MX')}
        </p>
      </div>
    );
    return to && bid ? <Link to={`/b/${bid}/${to}`}>{body}</Link> : body;
  };

  return (
    <>
      <PageHeader
        title={biz ? biz.name : 'Panel general'}
        subtitle={biz ? 'Resumen del negocio con datos reales del catálogo.' : `Vista consolidada de ${c.businesses} negocio(s) autorizado(s).`}
      />

      {bid && (
        <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { icon: PackagePlus, label: 'Alta de producto', to: 'productos/nuevo' },
            { icon: ImagePlus, label: 'Procesar lote de fotos', to: 'alta-masiva?nuevo=1' },
            { icon: FileSpreadsheet, label: 'Importar Excel / CSV', to: 'alta-masiva?nuevo=1' },
            { icon: FolderPlus, label: 'Crear colección', to: 'colecciones?nueva=1' },
            { icon: BookOpen, label: 'Generar catálogo', to: 'catalogos?nuevo=1' },
            { icon: Download, label: 'Preparar exportación', to: 'canales/mercadolibre' },
          ].map((a) => (
            <button key={a.label} onClick={() => go(a.to)} className="card flex items-center gap-2.5 px-3 py-3 text-left text-sm font-medium transition hover:border-brand-200 hover:bg-brand-50/40">
              <a.icon className="size-4 shrink-0 text-brand-600" />
              {a.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {!bid && stat('Negocios', c.businesses)}
        {stat('Productos', c.products, 'productos')}
        {stat('Variantes (SKU)', c.variants, 'productos')}
        {stat('Activos', c.active, 'productos?status=active')}
        {stat('Agotados', c.out_of_stock, 'productos?stock=out', 'amber')}
        {stat('Incompletos', c.incomplete, 'productos?issue=incomplete', 'amber')}
        {stat('Sin fotografías', c.no_photos, 'productos?issue=sin_fotos', 'amber')}
        {stat('Activos sin exportar', c.pending_export, 'productos?status=active&channel=mercadolibre&channelStatus=none')}
        {stat('Lotes abiertos', c.open_batches, 'alta-masiva')}
        {stat('Borradores', c.drafts, 'productos?status=draft')}
      </div>

      {(c.row_errors > 0 || c.ai_failed > 0) && (
        <div className="mt-4 card border-amber-200 bg-amber-50/60 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
            <AlertTriangle className="size-4" /> Requiere atención
          </p>
          <ul className="mt-1 ml-6 list-disc text-sm text-amber-900">
            {c.row_errors > 0 && <li>{c.row_errors} fila(s) con errores en lotes de alta masiva sin confirmar.</li>}
            {c.ai_failed > 0 && <li>{c.ai_failed} análisis de IA fallido(s) que puedes reintentar.</li>}
          </ul>
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {!bid && q.data.perBusiness.length > 0 && (
          <section className="card lg:col-span-3">
            <h2 className="border-b border-zinc-100 px-4 py-3 text-sm font-semibold">Negocios</h2>
            <div className="divide-y divide-zinc-100">
              {q.data.perBusiness.map((b) => {
                const mb = me.businesses.find((x) => x.id === b.id);
                return (
                  <Link key={b.id} to={`/b/${b.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm hover:bg-zinc-50">
                    {mb && <BizAvatar b={mb} />}
                    <span className="min-w-40 flex-1 font-medium">{b.name}</span>
                    <span className="text-zinc-600">{b.products} productos</span>
                    {b.incomplete > 0 && <Badge tone="amber">{b.incomplete} incompletos</Badge>}
                    {b.out_of_stock > 0 && <Badge tone="red">{b.out_of_stock} agotados</Badge>}
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        <section className="card">
          <h2 className="border-b border-zinc-100 px-4 py-3 text-sm font-semibold">Lotes de importación en proceso</h2>
          {q.data.openBatches.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-500">No hay lotes abiertos.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {q.data.openBatches.map((b) => (
                <li key={b.id}>
                  <Link to={`/b/${b.business_id}/alta-masiva/${b.id}`} className="block px-4 py-2.5 text-sm hover:bg-zinc-50">
                    <span className="font-medium">{b.name}</span>
                    <span className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                      {!bid && <span>{b.business_name} ·</span>}
                      {b.rows} filas {b.errors > 0 && <Badge tone="red">{b.errors} con error</Badge>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2 className="border-b border-zinc-100 px-4 py-3 text-sm font-semibold">Exportaciones recientes</h2>
          {q.data.recentExports.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-500">Todavía no se han generado archivos.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {q.data.recentExports.map((e) => (
                <li key={e.id} className="px-4 py-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Link to={`/b/${e.business_id}/canales/${e.channel}`} className="font-medium hover:underline">
                      {e.channel === 'mercadolibre' ? 'Mercado Libre' : 'TikTok Shop'}
                    </Link>
                    <Badge tone={e.format === 'official_template' ? 'green' : 'zinc'}>{e.format === 'official_template' ? 'Plantilla oficial' : 'Preparación'}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {!bid && `${e.business_name} · `}
                    {e.product_count} productos · {dateTime(e.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2 className="border-b border-zinc-100 px-4 py-3 text-sm font-semibold">Actividad reciente</h2>
          {q.data.activity.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-500">Sin actividad.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-zinc-100 overflow-y-auto">
              {q.data.activity.map((a) => (
                <li key={a.id} className="px-4 py-2 text-sm">
                  <span className="font-medium">{a.user_name ?? 'Sistema'}</span> {ACTION_LABEL[a.action] ?? a.action}
                  {a.details?.name && <span className="text-zinc-600"> · {String(a.details.name)}</span>}
                  <p className="text-xs text-zinc-500">
                    {!bid && a.business_name && `${a.business_name} · `}
                    {dateTime(a.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
