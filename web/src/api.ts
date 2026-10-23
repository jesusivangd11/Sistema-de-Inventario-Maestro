export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: any,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown, isForm = false): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'catalogo-maestro' };
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && !url.includes('/auth/')) window.dispatchEvent(new Event('cm:unauthorized'));
    throw new ApiError(res.status, (data as any)?.error ?? `Error ${res.status}`, (data as any)?.details);
  }
  return data as T;
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  put: <T = any>(url: string, body: unknown) => request<T>('PUT', url, body),
  patch: <T = any>(url: string, body: unknown) => request<T>('PATCH', url, body),
  del: <T = any>(url: string) => request<T>('DELETE', url),
  upload: <T = any>(url: string, files: File[] | FileList, fields: Record<string, string> = {}) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    for (const f of Array.from(files)) fd.append('files', f, f.name);
    return request<T>('POST', url, fd, true);
  },
};

/** Sube archivos en tandas para mostrar progreso y no saturar una sola petición. */
export async function uploadInChunks<T>(url: string, files: File[], onProgress: (done: number, total: number) => void, chunk = 6, fields: Record<string, string> = {}) {
  const results: T[] = [];
  for (let i = 0; i < files.length; i += chunk) {
    const r = await api.upload<{ results: T[] }>(url, files.slice(i, i + chunk), fields);
    results.push(...r.results);
    onProgress(Math.min(files.length, i + chunk), files.length);
  }
  return results;
}

export const money = (v: number | string | null | undefined, currency = 'MXN') =>
  v === null || v === undefined || v === ''
    ? '—'
    : new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(Number(v));

export const dateTime = (v: string | Date) =>
  new Date(v).toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const date = (v: string | Date) => new Date(v).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
