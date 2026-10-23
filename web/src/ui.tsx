import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Loader2, X, XCircle } from 'lucide-react';

// ───────── Botones y campos ─────────

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap',
        size === 'sm' ? 'px-2.5 py-1.5 text-[0.85rem]' : 'px-3.5 py-2 text-sm',
        variant === 'primary' && 'bg-brand-600 text-white shadow-xs hover:bg-brand-700',
        variant === 'secondary' && 'border border-zinc-300 bg-white text-zinc-800 shadow-xs hover:bg-zinc-50',
        variant === 'ghost' && 'text-zinc-700 hover:bg-zinc-100',
        variant === 'danger' && 'bg-red-600 text-white shadow-xs hover:bg-red-700',
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function Badge({ children, tone = 'zinc', className, title }: { children: ReactNode; tone?: 'zinc' | 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'brand'; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap',
        {
          zinc: 'bg-zinc-100 text-zinc-700',
          green: 'bg-emerald-50 text-emerald-700',
          amber: 'bg-amber-50 text-amber-800',
          red: 'bg-red-50 text-red-700',
          blue: 'bg-sky-50 text-sky-700',
          violet: 'bg-violet-50 text-violet-700',
          brand: 'bg-brand-50 text-brand-700',
        }[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-5 animate-spin text-zinc-400', className)} />;
}

export function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">{icon}</div>
      <h3 className="font-semibold text-zinc-900">{title}</h3>
      {text && <p className="mt-1 max-w-md text-sm text-zinc-500">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Notice({ tone = 'amber', title, children }: { tone?: 'amber' | 'red' | 'blue' | 'green'; title?: string; children: ReactNode }) {
  const Icon = tone === 'red' ? XCircle : tone === 'green' ? CheckCircle2 : AlertTriangle;
  return (
    <div
      className={clsx(
        'flex gap-2.5 rounded-lg border px-3.5 py-3 text-sm',
        tone === 'amber' && 'border-amber-200 bg-amber-50 text-amber-900',
        tone === 'red' && 'border-red-200 bg-red-50 text-red-800',
        tone === 'blue' && 'border-sky-200 bg-sky-50 text-sky-900',
        tone === 'green' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        <div className={clsx(title && 'mt-0.5')}>{children}</div>
      </div>
    </div>
  );
}

// ───────── Modal y confirmación ─────────

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-900/40 p-4 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={clsx('card w-full shadow-xl', wide ? 'max-w-3xl' : 'max-w-lg')} role="dialog" aria-modal>
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" aria-label="Cerrar">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-zinc-200 bg-zinc-50/60 px-5 py-3 rounded-b-xl">{footer}</div>}
      </div>
    </div>
  );
}

type ConfirmOpts = { title: string; text: ReactNode; confirmLabel?: string; danger?: boolean; requireText?: string };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

// ───────── Avisos (toasts) ─────────

type Toast = { id: number; tone: 'success' | 'error' | 'info'; text: string };
const ToastCtx = createContext<(tone: Toast['tone'], text: string) => void>(() => {});
export const useToast = () => {
  const push = useContext(ToastCtx);
  return {
    success: (t: string) => push('success', t),
    error: (t: string | unknown) => push('error', typeof t === 'string' ? t : t instanceof Error ? t.message : 'Ocurrió un error'),
    info: (t: string) => push('info', t),
  };
};

export function Providers({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);

  const [confirm, setConfirm] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [typed, setTyped] = useState('');
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => (setTyped(''), setConfirm({ ...o, resolve }))), []);
  const close = (v: boolean) => {
    confirm?.resolve(v);
    setConfirm(null);
  };

  return (
    <ToastCtx.Provider value={push}>
      <ConfirmCtx.Provider value={ask}>
        {children}
        <Modal
          open={Boolean(confirm)}
          onClose={() => close(false)}
          title={confirm?.title ?? ''}
          footer={
            <>
              <Button onClick={() => close(false)}>Cancelar</Button>
              <Button variant={confirm?.danger ? 'danger' : 'primary'} disabled={Boolean(confirm?.requireText) && typed.trim() !== confirm?.requireText} onClick={() => close(true)}>
                {confirm?.confirmLabel ?? 'Confirmar'}
              </Button>
            </>
          }
        >
          <div className="text-sm text-zinc-600">{confirm?.text}</div>
          {confirm?.requireText && (
            <div className="mt-4">
              <span className="label">
                Escribe <strong>{confirm.requireText}</strong> para confirmar
              </span>
              <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
            </div>
          )}
        </Modal>
        <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={clsx(
                'pointer-events-auto flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-sm shadow-lg',
                t.tone === 'success' && 'border-emerald-200 bg-white text-emerald-800',
                t.tone === 'error' && 'border-red-200 bg-white text-red-700',
                t.tone === 'info' && 'border-zinc-200 bg-white text-zinc-800',
              )}
            >
              {t.tone === 'success' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : t.tone === 'error' ? <XCircle className="mt-0.5 size-4 shrink-0" /> : null}
              <span>{t.text}</span>
            </div>
          ))}
        </div>
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}

// ───────── Origen de los datos (usuario / importación / IA) ─────────

export const SOURCE_LABEL: Record<string, { label: string; tone: 'zinc' | 'blue' | 'violet' | 'amber'; title: string }> = {
  user: { label: 'Usuario', tone: 'zinc', title: 'Capturado o confirmado por una persona' },
  import: { label: 'Importado', tone: 'blue', title: 'Proviene de la hoja de cálculo importada' },
  ai_detected: { label: 'IA · visto', tone: 'violet', title: 'La IA lo leyó o lo observó directamente en la foto' },
  ai_inferred: { label: 'IA · inferido', tone: 'amber', title: 'La IA lo dedujo; no se observa directamente' },
};

export function SourceBadge({ meta }: { meta?: { source: string; review?: boolean; note?: string } }) {
  if (!meta) return null;
  const s = SOURCE_LABEL[meta.source];
  if (!s) return null;
  return (
    <Badge tone={s.tone} title={`${s.title}${meta.note ? ` — ${meta.note}` : ''}`}>
      {s.label}
      {meta.review && <span className="font-semibold">· revisar</span>}
    </Badge>
  );
}

export function Checkbox({ checked, onChange, indeterminate, label }: { checked: boolean; onChange: (v: boolean) => void; indeterminate?: boolean; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      className="size-4 cursor-pointer rounded border-zinc-300 accent-brand-600"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[] }) {
  return (
    <div className="flex gap-1 border-b border-zinc-200">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={clsx('-mb-px border-b-2 px-3 py-2 text-sm font-medium transition', value === t.value ? 'border-brand-600 text-brand-700' : 'border-transparent text-zinc-500 hover:text-zinc-800')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, total, label }: { value: number; total: number; label?: string }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-zinc-600">
        <span>{label}</span>
        <span>
          {value} / {total}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-200">
        <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Zona para arrastrar archivos o elegirlos (en celular abre cámara/galería). */
export function DropZone({ accept, multiple = true, onFiles, children, disabled }: { accept: string; multiple?: boolean; onFiles: (f: File[]) => void; children: ReactNode; disabled?: boolean }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) onFiles(Array.from(e.dataTransfer.files));
      }}
      onClick={() => !disabled && input.current?.click()}
      className={clsx(
        'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition',
        over ? 'border-brand-500 bg-brand-50' : 'border-zinc-300 bg-white hover:border-zinc-400',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      {children}
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          if (e.target.files?.length) onFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
    </div>
  );
}
