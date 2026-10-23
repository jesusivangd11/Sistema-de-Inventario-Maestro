import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  BookOpen,
  Boxes,
  ChevronDown,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Plus,
  Settings,
  ShoppingBag,
  Sparkles,
  Store,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { api } from './api';
import { Button, Field, PageLoader, useToast } from './ui';
import { useMe, useStatus } from './session';
import { DashboardPage } from './pages/Dashboard';
import { ProductsPage } from './pages/Products';
import { ProductEditor } from './pages/ProductEditor';
import { BatchesPage, BatchPage } from './pages/Batches';
import { CollectionsPage } from './pages/Collections';
import { CatalogsPage, CatalogEditor } from './pages/Catalogs';
import { ChannelPage } from './pages/Channels';
import { BusinessSettings, NewBusinessPage } from './pages/BusinessSettings';
import { UsersPage } from './pages/Users';

export function App() {
  const status = useStatus();
  const qc = useQueryClient();
  const navigate = useNavigate();
  useEffect(() => {
    const h = () => {
      qc.invalidateQueries({ queryKey: ['status'] });
      navigate('/');
    };
    window.addEventListener('cm:unauthorized', h);
    return () => window.removeEventListener('cm:unauthorized', h);
  }, [qc, navigate]);

  if (status.isLoading) return <PageLoader />;
  if (status.isError) return <div className="p-8 text-red-700">No se pudo conectar con el servidor. Verifica que esté en ejecución.</div>;
  if (status.data?.needsSetup) return <AuthScreen mode="setup" />;
  if (!status.data?.user) return <AuthScreen mode="login" />;
  return <Shell />;
}

function AuthScreen({ mode }: { mode: 'setup' | 'login' }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post(mode === 'setup' ? '/api/auth/setup' : '/api/auth/login', form);
      await qc.invalidateQueries();
    } catch (err) {
      toast.error(err);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-7">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Boxes className="size-5" />
          </div>
          <div>
            <p className="font-semibold">Catálogo Maestro</p>
            <p className="text-xs text-zinc-500">{mode === 'setup' ? 'Configuración inicial' : 'Inicia sesión'}</p>
          </div>
        </div>
        {mode === 'setup' && (
          <p className="mb-4 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
            Crea la cuenta del <strong>administrador general</strong>. Tendrá acceso a todos los negocios.
          </p>
        )}
        <div className="space-y-3.5">
          {mode === 'setup' && (
            <Field label="Nombre">
              <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
          )}
          <Field label="Correo electrónico">
            <input className="input" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Contraseña" hint={mode === 'setup' ? 'Mínimo 8 caracteres' : undefined}>
            <input
              className="input"
              type="password"
              required
              minLength={mode === 'setup' ? 8 : undefined}
              autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
        </div>
        <Button variant="primary" className="mt-6 w-full" loading={loading} type="submit">
          {mode === 'setup' ? 'Crear cuenta y entrar' : 'Entrar'}
        </Button>
      </form>
    </div>
  );
}

function Shell() {
  const me = useMe();
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setMobileOpen(false), [loc.pathname]);
  if (me.isLoading || !me.data) return <PageLoader />;
  return (
    <div className="flex min-h-screen">
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 w-64 shrink-0 border-r border-zinc-200 bg-white transition-transform lg:static lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <Sidebar onClose={() => setMobileOpen(false)} />
      </aside>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-zinc-900/30 lg:hidden" onClick={() => setMobileOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 backdrop-blur lg:hidden">
          <button onClick={() => setMobileOpen(true)} className="rounded p-1.5 hover:bg-zinc-100" aria-label="Abrir menú">
            <Menu className="size-5" />
          </button>
          <span className="font-semibold">Catálogo Maestro</span>
        </header>
        <main className="mx-auto w-full max-w-[96rem] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/negocios/nuevo" element={<NewBusinessPage />} />
            <Route path="/usuarios" element={<UsersPage />} />
            <Route path="/b/:bid" element={<BizGuard />} />
            <Route path="/b/:bid/*" element={<BizRoutes />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function BizGuard() {
  const { bid } = useParams();
  const me = useMe();
  if (!me.data?.businesses.some((b) => b.id === bid)) return <Navigate to="/" replace />;
  return <DashboardPage />;
}

function BizRoutes() {
  const { bid } = useParams();
  const me = useMe();
  if (!me.data?.businesses.some((b) => b.id === bid)) return <Navigate to="/" replace />;
  return (
    <Routes>
      <Route path="productos" element={<ProductsPage />} />
      <Route path="productos/nuevo" element={<ProductEditor />} />
      <Route path="productos/:pid" element={<ProductEditor />} />
      <Route path="alta-masiva" element={<BatchesPage />} />
      <Route path="alta-masiva/:batchId" element={<BatchPage />} />
      <Route path="colecciones" element={<CollectionsPage />} />
      <Route path="catalogos" element={<CatalogsPage />} />
      <Route path="catalogos/:catalogId" element={<CatalogEditor />} />
      <Route path="canales/:channel" element={<ChannelPage />} />
      <Route path="ajustes" element={<BusinessSettings />} />
      <Route path="*" element={<Navigate to={`/b/${bid}/productos`} replace />} />
    </Routes>
  );
}

function Sidebar({ onClose }: { onClose: () => void }) {
  const me = useMe().data!;
  const status = useStatus().data;
  const loc = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const bid = loc.pathname.match(/^\/b\/([0-9a-f-]{36})/)?.[1];
  const current = me.businesses.find((b) => b.id === bid);
  const [pickerOpen, setPickerOpen] = useState(false);

  const logout = async () => {
    await api.post('/api/auth/logout');
    qc.clear();
    navigate('/');
    window.location.reload();
  };

  const nav = (to: string, icon: ReactNode, label: string, end = false) => (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        clsx('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition', isActive ? 'bg-brand-50 text-brand-700' : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900')
      }
    >
      {icon}
      {label}
    </NavLink>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="flex size-7 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Boxes className="size-4" />
          </span>
          Catálogo Maestro
        </Link>
        <button onClick={onClose} className="rounded p-1 hover:bg-zinc-100 lg:hidden" aria-label="Cerrar menú">
          <X className="size-4" />
        </button>
      </div>

      {/* Selector global de negocio */}
      <div className="relative px-3 pb-3">
        <button
          onClick={() => setPickerOpen((v) => !v)}
          className="flex w-full items-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-left text-sm shadow-xs hover:bg-zinc-50"
        >
          {current ? (
            <BizAvatar b={current} />
          ) : (
            <span className="flex size-7 items-center justify-center rounded-md bg-zinc-100 text-zinc-500">
              <Store className="size-4" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{current?.name ?? 'Todos los negocios'}</span>
            <span className="block text-xs text-zinc-500">{current ? roleLabel(current.role) : `${me.businesses.length} negocio(s)`}</span>
          </span>
          <ChevronDown className="size-4 text-zinc-400" />
        </button>
        {pickerOpen && (
          <div className="absolute inset-x-3 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
            <button
              onClick={() => (setPickerOpen(false), navigate('/'))}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-100"
            >
              <Store className="size-4 text-zinc-500" /> Vista consolidada
            </button>
            <div className="my-1 border-t border-zinc-100" />
            {me.businesses.map((b) => (
              <button
                key={b.id}
                onClick={() => (setPickerOpen(false), navigate(`/b/${b.id}/productos`))}
                className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-100', b.id === bid && 'bg-zinc-100')}
              >
                <BizAvatar b={b} small />
                <span className="truncate">{b.name}</span>
              </button>
            ))}
            {me.user.role === 'superadmin' && (
              <>
                <div className="my-1 border-t border-zinc-100" />
                <button onClick={() => (setPickerOpen(false), navigate('/negocios/nuevo'))} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-brand-700 hover:bg-brand-50">
                  <Plus className="size-4" /> Nuevo negocio
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {nav(bid ? `/b/${bid}` : '/', <LayoutDashboard className="size-4" />, 'Panel', true)}
        {bid ? (
          <>
            <p className="px-2.5 pt-4 pb-1 text-[0.72rem] font-semibold tracking-wide text-zinc-400 uppercase">Catálogo</p>
            {nav(`/b/${bid}/productos`, <Package className="size-4" />, 'Productos')}
            {nav(`/b/${bid}/alta-masiva`, <Upload className="size-4" />, 'Alta masiva')}
            {nav(`/b/${bid}/colecciones`, <FolderKanban className="size-4" />, 'Colecciones')}
            {nav(`/b/${bid}/catalogos`, <BookOpen className="size-4" />, 'Catálogos PDF')}
            <p className="px-2.5 pt-4 pb-1 text-[0.72rem] font-semibold tracking-wide text-zinc-400 uppercase">Canales de venta</p>
            {nav(`/b/${bid}/canales/mercadolibre`, <ShoppingBag className="size-4" />, 'Mercado Libre')}
            {nav(`/b/${bid}/canales/tiktok`, <ShoppingBag className="size-4" />, 'TikTok Shop')}
            <p className="px-2.5 pt-4 pb-1 text-[0.72rem] font-semibold tracking-wide text-zinc-400 uppercase">Negocio</p>
            {nav(`/b/${bid}/ajustes`, <Settings className="size-4" />, 'Configuración')}
          </>
        ) : (
          <p className="px-2.5 pt-4 text-xs text-zinc-500">Elige un negocio en el selector para trabajar su catálogo.</p>
        )}
        {me.user.role === 'superadmin' && (
          <>
            <p className="px-2.5 pt-4 pb-1 text-[0.72rem] font-semibold tracking-wide text-zinc-400 uppercase">Plataforma</p>
            {nav('/usuarios', <Users className="size-4" />, 'Usuarios y accesos')}
          </>
        )}
      </nav>

      <div className="border-t border-zinc-200 p-3">
        <div className={clsx('mb-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs', status?.ai.configured ? 'text-violet-700' : 'text-zinc-500')}>
          <Sparkles className="size-3.5" />
          {status?.ai.configured ? `IA activa · ${status.ai.model}` : 'IA no configurada'}
        </div>
        <div className="flex items-center gap-2 px-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{me.user.name}</p>
            <p className="truncate text-xs text-zinc-500">{me.user.email}</p>
          </div>
          <button onClick={logout} className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800" title="Cerrar sesión" aria-label="Cerrar sesión">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function BizAvatar({ b, small }: { b: { id: string; name: string; primaryColor: string; hasLogo: boolean }; small?: boolean }) {
  const size = small ? 'size-5 text-[0.65rem]' : 'size-7 text-xs';
  if (b.hasLogo) return <img src={`/api/b/${b.id}/logo`} alt="" className={clsx(size, 'shrink-0 rounded-md border border-zinc-200 bg-white object-contain')} />;
  return (
    <span className={clsx(size, 'flex shrink-0 items-center justify-center rounded-md font-semibold text-white')} style={{ background: b.primaryColor }}>
      {b.name.replace(/\[.*?\]\s*/, '').slice(0, 1).toUpperCase()}
    </span>
  );
}

export const roleLabel = (r: string) => ({ superadmin: 'Administrador general', admin: 'Administrador del negocio', operator: 'Operador' })[r] ?? r;
