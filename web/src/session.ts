import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api } from './api';

export type Me = {
  user: { id: string; name: string; email: string; role: 'superadmin' | 'member' };
  businesses: { id: string; name: string; slug: string; primaryColor: string; hasLogo: boolean; currency: string; role: 'superadmin' | 'admin' | 'operator'; isDemo: boolean }[];
};

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/api/me') });
}

export function useStatus() {
  return useQuery({
    queryKey: ['status'],
    queryFn: () => api.get<{ needsSetup: boolean; user: Me['user'] | null; ai: { configured: boolean; model: string | null }; publicBaseUrl: string | null }>('/api/auth/status'),
  });
}

/** Negocio activo según la URL (/b/:bid/...). */
export function useBiz() {
  const { bid } = useParams();
  const me = useMe();
  const b = me.data?.businesses.find((x) => x.id === bid);
  return { bid: bid!, biz: b, isAdmin: b?.role === 'superadmin' || b?.role === 'admin', base: `/api/b/${bid}` };
}

export type Category = { id: string; parentId: string | null; name: string; code: string; fields: FieldDef[]; productCount: number };
export type FieldDef = { key: string; label: string; type: 'text' | 'number' | 'select'; options?: string[]; required?: boolean; unit?: string };
export type Collection = { id: string; name: string; kind: 'season' | 'collection'; description: string; archivedAt: string | null; productCount: number; createdAt: string };

export function useCategories() {
  const { base, bid } = useBiz();
  return useQuery({ queryKey: ['categories', bid], queryFn: () => api.get<Category[]>(`${base}/categories`) });
}

export function useCollections() {
  const { base, bid } = useBiz();
  return useQuery({ queryKey: ['collections', bid], queryFn: () => api.get<Collection[]>(`${base}/collections`) });
}

export const ISSUE_LABELS: Record<string, string> = {
  sin_categoria: 'Sin categoría',
  sin_precio: 'Sin precio',
  sin_fotos: 'Sin fotos',
  sin_descripcion: 'Sin descripción',
  por_revisar: 'Por revisar',
  atributos_faltantes: 'Faltan atributos',
  promo_mayor: 'Promoción ≥ precio',
};
