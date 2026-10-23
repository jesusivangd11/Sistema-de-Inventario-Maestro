import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { CheckCircle2, CircleDashed, Download, ExternalLink, FileSpreadsheet, Link2, ListChecks, Plus, ShieldCheck, Trash2, Upload, XCircle } from 'lucide-react';
import { api, dateTime } from '../api';
import { Badge, Button, DropZone, EmptyState, Field, Modal, Notice, PageHeader, PageLoader, Tabs, useConfirm, useToast } from '../ui';
import { useBiz, useStatus } from '../session';
import { ProductPicker } from './Catalogs';

type Issue = { level: 'error' | 'warning'; message: string; field?: string };
type Report = { productId: string; sku: string; name: string; issues: Issue[]; ok: boolean; rows: number; channelStatus: string };

export function ChannelPage() {
  const { channel } = useParams();
  const { base, bid } = useBiz();
  const loc = useLocation();
  const channels = useQuery({ queryKey: ['channels'], queryFn: () => api.get<any[]>('/api/channels') });
  const data = useQuery({ queryKey: ['channel', bid, channel], queryFn: () => api.get(`${base}/channels/${channel}`) });
  const [tab, setTab] = useState<'export' | 'templates' | 'history' | 'links' | 'api'>('export');
  const info = channels.data?.find((c) => c.id === channel);
  const initial = (loc.state as { productIds?: string[] } | null)?.productIds;

  if (!info || data.isLoading || !data.data) return <PageLoader />;
  const ov = data.data.overview;
  return (
    <>
      <PageHeader
        title={`${info.name} · ${info.market}`}
        subtitle={
          <span className="flex flex-wrap gap-3">
            <span>{ov.totalProducts} productos vigentes</span>
            <span>· {ov.fileGenerated} con archivo generado</span>
            <span>· {ov.linked} vinculados a publicaciones</span>
          </span>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'export', label: 'Preparar exportación' },
          { value: 'templates', label: `Plantillas oficiales (${data.data.templates.length})` },
          { value: 'history', label: `Historial (${data.data.exports.length})` },
          { value: 'links', label: 'Vincular IDs' },
          { value: 'api', label: 'Integración y verificación' },
        ]}
      />
      <div className="mt-5" key={channel}>
        {tab === 'export' && <ExportTab channel={channel!} templates={data.data.templates} initial={initial} goTemplates={() => setTab('templates')} />}
        {tab === 'templates' && <TemplatesTab channel={channel!} templates={data.data.templates} />}
        {tab === 'history' && <HistoryTab exports={data.data.exports} />}
        {tab === 'links' && <LinksTab channel={channel!} />}
        {tab === 'api' && <ApiTab info={info} operations={data.data.operations} />}
      </div>
    </>
  );
}

function ExportTab({ channel, templates, initial, goTemplates }: { channel: string; templates: any[]; initial?: string[]; goTemplates: () => void }) {
  const { base, bid } = useBiz();
  const toast = useToast();
  const qc = useQueryClient();
  const status = useStatus().data;
  const [ids, setIds] = useState<string[]>(initial ?? []);
  const [templateId, setTemplateId] = useState<string>(templates[0]?.id ?? '');
  const [picker, setPicker] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState<'validate' | 'generate' | null>(null);

  const validate = async () => {
    setLoading('validate');
    setResult(null);
    try {
      setReport(await api.post(`${base}/channels/${channel}/validate`, { productIds: ids, templateId: templateId || null }));
    } catch (e) {
      toast.error(e);
    } finally {
      setLoading(null);
    }
  };
  useEffect(() => {
    if (ids.length) validate();
    else setReport(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, templateId]);

  const generate = async () => {
    setLoading('generate');
    try {
      const r = await api.post(`${base}/channels/${channel}/exports`, { productIds: ids, templateId: templateId || null });
      setResult(r);
      toast.success(`Archivo generado con ${r.export.productCount} producto(s)`);
      qc.invalidateQueries({ queryKey: ['channel', bid, channel] });
    } catch (e: any) {
      toast.error(e);
      if (e.details?.reports) setReport(e.details);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-4">
      <section className="card grid gap-4 p-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <div>
          <span className="label">Productos</span>
          <div className="flex items-center gap-2">
            <Button icon={<Plus className="size-4" />} onClick={() => setPicker(true)}>
              Elegir productos
            </Button>
            <span className="text-sm text-zinc-600">{ids.length} seleccionado(s)</span>
            {ids.length > 0 && (
              <button className="text-sm text-zinc-500 hover:underline" onClick={() => setIds([])}>
                Limpiar
              </button>
            )}
          </div>
        </div>
        <Field label="Formato de salida">
          <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">Archivo de preparación (no oficial)</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                Plantilla oficial: {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Button variant="primary" icon={<Download className="size-4" />} loading={loading === 'generate'} disabled={!ids.length || !report || report.validCount === 0 || report.blocking} onClick={generate}>
          Generar archivo{report ? ` (${report.validCount})` : ''}
        </Button>
      </section>

      {!templates.length && (
        <Notice tone="blue" title="Sube la plantilla oficial de tu categoría">
          {channel === 'mercadolibre'
            ? 'Descárgala en Mercado Libre → Publicaciones → Publicar varios productos (carga masiva), eligiendo la categoría. '
            : 'Descárgala en TikTok Shop Seller Center → Productos → Herramientas por lote → Carga masiva, eligiendo la categoría. '}
          Al subirla, el sistema detecta sus columnas y obligatorios y la llena con tu catálogo.{' '}
          <button className="font-medium underline" onClick={goTemplates}>
            Subir plantilla
          </button>
        </Notice>
      )}
      {!status?.publicBaseUrl && (
        <Notice tone="amber" title="Las URLs de las fotos no serán públicas">
          Los marketplaces descargan las fotos desde una URL pública. Configura <code>PUBLIC_BASE_URL</code> en el servidor con un dominio accesible desde internet antes de subir el archivo al marketplace.
        </Notice>
      )}

      {ids.length === 0 ? (
        <EmptyState icon={<ListChecks className="size-6" />} title="Elige los productos a exportar" text="Se validan contra los requisitos del canal antes de generar el archivo. Solo se incluyen los productos sin errores." action={<Button onClick={() => setPicker(true)}>Elegir productos</Button>} />
      ) : loading === 'validate' && !report ? (
        <PageLoader />
      ) : report ? (
        <div className="space-y-3">
          {report.globalIssues
            .filter((i: Issue) => status?.publicBaseUrl || !/PUBLIC_BASE_URL/.test(i.message)) // ya se muestra el aviso general arriba
            .map((i: Issue, k: number) => (
            <Notice key={k} tone={i.level === 'error' ? 'red' : 'amber'}>
              {i.message}
            </Notice>
          ))}
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge tone="green">{report.validCount} listos</Badge>
            <Badge tone={report.errorCount ? 'red' : 'zinc'}>{report.errorCount} con errores (se excluyen)</Badge>
            <Button size="sm" variant="ghost" loading={loading === 'validate'} onClick={validate}>
              Volver a validar
            </Button>
          </div>
          <div className="card divide-y divide-zinc-100">
            {report.reports.map((r: Report) => (
              <div key={r.productId} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  {r.ok ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-red-500" />}
                  <Link to={`/b/${bid}/productos/${r.productId}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  <span className="font-mono text-xs text-zinc-500">{r.sku}</span>
                  <span className="text-xs text-zinc-500">· {r.rows} fila(s)</span>
                  {r.channelStatus === 'file_generated' && <Badge tone="blue">Ya exportado antes</Badge>}
                  {r.channelStatus === 'linked' && <Badge tone="green">Vinculado</Badge>}
                  {!r.ok && (
                    <Link to={`/b/${bid}/productos/${r.productId}`} className="ml-auto text-xs text-brand-700 hover:underline">
                      Corregir en la ficha →
                    </Link>
                  )}
                </div>
                {r.issues.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 pl-6 text-sm">
                    {r.issues.map((i, k) => (
                      <li key={k} className={i.level === 'error' ? 'text-red-700' : 'text-amber-700'}>
                        {i.level === 'error' ? '✖' : '⚠'} {i.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {result && (
        <Notice tone="green" title="Archivo generado">
          {result.export.productCount} producto(s), {result.export.rowCount} fila(s) ({result.export.format === 'official_template' ? 'plantilla oficial' : 'archivo de preparación'}).{' '}
          <a className="font-medium underline" href={`${base}/exports/${result.export.id}/download`}>
            Descargar {result.export.fileName}
          </a>
          <p className="mt-1">Los productos quedan como «archivo generado», no como publicados. Después de subirlo al marketplace, vincula los IDs de publicación en la pestaña «Vincular IDs».</p>
          {result.excluded.length > 0 && <p className="mt-1">{result.excluded.length} producto(s) excluidos por errores.</p>}
        </Notice>
      )}

      <ProductPicker open={picker} onClose={() => setPicker(false)} exclude={ids} title="Productos a exportar" onPick={(p) => (setIds([...ids, ...p]), setPicker(false))} />
    </div>
  );
}

function TemplatesTab({ channel, templates }: { channel: string; templates: any[] }) {
  const { base, bid } = useBiz();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any>(null);
  const upload = async (files: File[]) => {
    try {
      const r = await api.upload(`${base}/channels/${channel}/templates`, files.slice(0, 1));
      toast.success(`Plantilla leída: ${r.template.columns.length} columnas, ${r.template.columns.filter((c: any) => c.required).length} obligatorias`);
      qc.invalidateQueries({ queryKey: ['channel', bid, channel] });
      setEditing(r.template);
    } catch (e) {
      toast.error(e);
    }
  };
  const remove = async (t: any) => {
    if (!(await confirm({ title: 'Eliminar plantilla', text: `Se elimina la plantilla «${t.name}» y su mapeo. El historial de exportaciones se conserva.`, confirmLabel: 'Eliminar', danger: true }))) return;
    try {
      await api.del(`${base}/channels/${channel}/templates/${t.id}`);
      qc.invalidateQueries({ queryKey: ['channel', bid, channel] });
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="space-y-4">
      <DropZone accept=".xlsx" multiple={false} onFiles={upload}>
        <FileSpreadsheet className="mb-2 size-7 text-zinc-400" />
        <p className="text-sm font-medium">Sube la plantilla oficial (.xlsx) descargada del marketplace</p>
        <p className="text-xs text-zinc-500">Cada categoría puede tener columnas distintas; sube una plantilla por categoría.</p>
      </DropZone>
      {templates.map((t) => {
        const req = t.columns.filter((c: any) => c.required);
        const unmapped = req.filter((c: any) => !t.mapping[String(c.index)]);
        return (
          <div key={t.id} className="card flex flex-wrap items-center gap-3 px-4 py-3">
            <FileSpreadsheet className="size-5 text-emerald-600" />
            <div className="min-w-48 flex-1">
              <p className="font-medium">{t.name}</p>
              <p className="text-xs text-zinc-500">
                Hoja «{t.sheetName}» · {t.columns.length} columnas · {req.length} obligatorias · subida {dateTime(t.createdAt)}
              </p>
            </div>
            {unmapped.length ? <Badge tone="red">{unmapped.length} obligatoria(s) sin asignar</Badge> : <Badge tone="green">Mapeo completo</Badge>}
            <Button size="sm" onClick={() => setEditing(t)}>
              Editar mapeo
            </Button>
            <button className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600" onClick={() => remove(t)} aria-label="Eliminar plantilla">
              <Trash2 className="size-4" />
            </button>
          </div>
        );
      })}
      {editing && <MappingEditor channel={channel} template={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function MappingEditor({ channel, template, onClose }: { channel: string; template: any; onClose: () => void }) {
  const { base, bid } = useBiz();
  const toast = useToast();
  const qc = useQueryClient();
  const fields = useQuery({ queryKey: ['channel-fields'], queryFn: () => api.get<{ value: string; label: string }[]>('/api/channels/fields') });
  const [t, setT] = useState(template);
  const [mapping, setMapping] = useState<Record<string, string>>(template.mapping);
  const [rows, setRows] = useState({ headerRow: template.headerRow, dataStartRow: template.dataStartRow });
  const [saving, setSaving] = useState(false);
  const save = async (extra: Record<string, unknown> = {}) => {
    setSaving(true);
    try {
      const r = await api.patch(`${base}/channels/${channel}/templates/${t.id}`, Object.keys(extra).length ? extra : { mapping });
      setT(r);
      setMapping(r.mapping);
      setRows({ headerRow: r.headerRow, dataStartRow: r.dataStartRow });
      qc.invalidateQueries({ queryKey: ['channel', bid, channel] });
      toast.success('Plantilla actualizada');
      if (!Object.keys(extra).length) onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };
  const valueOf = (idx: number) => mapping[String(idx)] ?? '';
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`Mapeo · ${t.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cerrar</Button>
          <Button variant="primary" loading={saving} onClick={() => save()}>
            Guardar mapeo
          </Button>
        </>
      }
    >
      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Fila de encabezados">
          <input className="input" type="number" min={1} value={rows.headerRow} onChange={(e) => setRows({ ...rows, headerRow: Number(e.target.value) })} />
        </Field>
        <Field label="Primera fila de datos">
          <input className="input" type="number" min={2} value={rows.dataStartRow} onChange={(e) => setRows({ ...rows, dataStartRow: Number(e.target.value) })} />
        </Field>
        <Button onClick={() => save({ headerRow: rows.headerRow, dataStartRow: rows.dataStartRow })}>Releer plantilla</Button>
      </div>
      <p className="mb-2 text-xs text-zinc-500">Una fila por variante. Elige de qué campo del catálogo se llena cada columna, o escribe un valor fijo. Las columnas marcadas como obligatorias deben tener un campo asignado.</p>
      <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-zinc-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-zinc-50 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2">Columna de la plantilla</th>
              <th className="px-3 py-2">Se llena con</th>
            </tr>
          </thead>
          <tbody>
            {t.columns.map((c: any) => {
              const v = valueOf(c.index);
              const isConst = v.startsWith('const:');
              const isAttr = v.startsWith('attr:');
              return (
                <tr key={c.index} className={clsx('border-t border-zinc-100', c.required && !v && 'bg-red-50/60')}>
                  <td className="px-3 py-1.5 align-top">
                    <span className="font-medium">{c.header}</span> {c.required && <Badge tone="red">Obligatoria</Badge>}
                    {c.hint && <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500" title={c.hint}>{c.hint}</p>}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex gap-1">
                      <select
                        className="input py-1"
                        value={isConst ? '__const' : isAttr ? '__attr' : v}
                        onChange={(e) => {
                          const val = e.target.value;
                          setMapping({ ...mapping, [String(c.index)]: val === '__const' ? 'const:' : val === '__attr' ? 'attr:' : val });
                        }}
                      >
                        <option value="">— Dejar vacía —</option>
                        {fields.data?.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                        <option value="__attr">Atributo (ID o nombre)…</option>
                        <option value="__const">Valor fijo…</option>
                      </select>
                      {(isConst || isAttr) && (
                        <input
                          className="input w-40 py-1"
                          placeholder={isConst ? 'Valor fijo' : channel === 'mercadolibre' ? 'Ej. GENDER' : 'Atributo'}
                          value={v.slice(isConst ? 6 : 5)}
                          onChange={(e) => setMapping({ ...mapping, [String(c.index)]: `${isConst ? 'const:' : 'attr:'}${e.target.value}` })}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function HistoryTab({ exports }: { exports: any[] }) {
  const { base } = useBiz();
  if (!exports.length) return <EmptyState icon={<Download className="size-6" />} title="Sin exportaciones" text="Aquí quedará el registro de cada archivo generado." />;
  return (
    <div className="card divide-y divide-zinc-100">
      {exports.map((e) => (
        <div key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <div className="min-w-48 flex-1">
            <p className="font-medium">{e.fileName}</p>
            <p className="text-xs text-zinc-500">{dateTime(e.createdAt)}</p>
          </div>
          <Badge tone={e.format === 'official_template' ? 'green' : 'zinc'}>{e.format === 'official_template' ? 'Plantilla oficial' : 'Preparación (no oficial)'}</Badge>
          <span className="text-zinc-600">
            {e.productCount} productos · {e.rowCount} filas
          </span>
          {e.warningCount > 0 && <Badge tone="amber">{e.warningCount} advertencias</Badge>}
          <a href={`${base}/exports/${e.id}/download`}>
            <Button size="sm" icon={<Download className="size-3.5" />}>
              Descargar
            </Button>
          </a>
        </div>
      ))}
    </div>
  );
}

function LinksTab({ channel }: { channel: string }) {
  const { base, bid } = useBiz();
  const toast = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [result, setResult] = useState<any>(null);
  const submit = async () => {
    const rows = text
      .split(/\r?\n/)
      .map((l) => l.split(/\t|,|;/).map((s) => s.trim()))
      .filter((p) => p.length >= 2 && p[0] && p[1] && !/^sku$/i.test(p[0]))
      .map(([sku, externalId]) => ({ sku, externalId }));
    if (!rows.length) return toast.error('Pega al menos una línea con «SKU, ID»');
    try {
      const r = await api.post(`${base}/channels/${channel}/links`, { rows });
      setResult(r);
      qc.invalidateQueries({ queryKey: ['channel', bid, channel] });
    } catch (e) {
      toast.error(e);
    }
  };
  const uploadFile = async (files: File[]) => {
    try {
      const r = await api.upload(`${base}/channels/${channel}/links`, files.slice(0, 1));
      setResult(r);
      qc.invalidateQueries({ queryKey: ['channel', bid, channel] });
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="card space-y-3 p-5">
        <h3 className="flex items-center gap-2 font-semibold">
          <Link2 className="size-4" /> Asociar SKU internos con IDs del marketplace
        </h3>
        <p className="text-sm text-zinc-600">
          Después de publicar en el marketplace, pega aquí el SKU y el ID de publicación ({channel === 'mercadolibre' ? 'p. ej. MLM1234567890' : 'ID de producto de TikTok'}). Acepta SKU de producto o de variante. Esto marca el producto como «vinculado».
        </p>
        <textarea className="input min-h-40 font-mono text-xs" placeholder={'PIJ-001, MLM1234567890\nPIJ-001-ROS-CH, 98765432100'} value={text} onChange={(e) => setText(e.target.value)} />
        <Button variant="primary" onClick={submit}>
          Vincular
        </Button>
      </section>
      <section className="card space-y-3 p-5">
        <h3 className="font-semibold">O sube un archivo</h3>
        <p className="text-sm text-zinc-600">CSV o Excel con una columna «sku» y otra con el ID (por ejemplo, el reporte de publicaciones descargado del marketplace).</p>
        <DropZone accept=".csv,.xlsx" multiple={false} onFiles={uploadFile}>
          <Upload className="mb-2 size-6 text-zinc-400" />
          <p className="text-sm">Elegir archivo</p>
        </DropZone>
        {result && (
          <Notice tone={result.notFound.length ? 'amber' : 'green'} title="Resultado">
            {result.linkedProducts} producto(s) y {result.linkedVariants} variante(s) vinculados.
            {result.notFound.length > 0 && <p>SKU no encontrados: {result.notFound.slice(0, 15).join(', ')}</p>}
          </Notice>
        )}
      </section>
    </div>
  );
}

function ApiTab({ info, operations }: { info: any; operations: any[] }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="card p-5">
        <h3 className="mb-3 font-semibold">Funciones del canal</h3>
        <ul className="space-y-2.5">
          {info.capabilities.map((c: any) => (
            <li key={c.key} className="flex items-start gap-2.5 text-sm">
              {c.status === 'available' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-zinc-400" />}
              <div>
                <p className="font-medium">
                  {c.label} {c.status === 'pending' && <Badge tone="zinc">Pendiente</Badge>}
                </p>
                {c.note && <p className="text-xs text-zinc-500">{c.note}</p>}
              </div>
            </li>
          ))}
        </ul>
        {operations.length > 0 && (
          <div className="mt-5 border-t border-zinc-100 pt-4">
            <p className="mb-2 text-sm font-medium">Operaciones registradas (no ejecutadas)</p>
            <ul className="space-y-1 text-xs text-zinc-600">
              {operations.map((o) => (
                <li key={o.id}>
                  {dateTime(o.createdAt)} · {o.operation} · <Badge>Pendiente de integración</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      <section className="card space-y-4 p-5">
        <h3 className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-4" /> Qué está verificado
        </h3>
        <div>
          <p className="mb-1 text-sm font-medium text-emerald-700">Contrastado con fuentes oficiales</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700">
            {info.verification.verified.map((v: string) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1 text-sm font-medium text-amber-700">No verificado / pendiente</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700">
            {info.verification.unverified.map((v: string) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1 text-sm font-medium">Fuentes</p>
          <ul className="space-y-1 text-sm">
            {info.verification.sources.map((s: any) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                  {s.label} <ExternalLink className="size-3" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
