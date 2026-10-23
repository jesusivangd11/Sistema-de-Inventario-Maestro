# Catálogo Maestro

Plataforma para administrar los catálogos de **múltiples negocios** desde una sola aplicación: productos con variantes y SKU, inventario, fotografías, alta masiva de mercancía (fotos + Excel/CSV + IA opcional), temporadas y colecciones, catálogos comerciales en PDF y preparación de archivos de carga masiva para **Mercado Libre** y **TikTok Shop**.

---

## Inicio rápido (Windows, macOS o Linux)

Requisitos: **Node.js 22 o superior** (probado con Node 24). No necesitas instalar PostgreSQL: si no configuras `DATABASE_URL`, la aplicación inicia un **PostgreSQL 18 real embebido** (binarios oficiales distribuidos por npm).

```bash
npm install
cp .env.example .env          # en Windows: copy .env.example .env
# Edita .env y pon un APP_SECRET aleatorio:
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
npm run build                 # compila la interfaz
npm start                     # abre http://localhost:4000
```

La primera vez, la aplicación pide crear la cuenta del **administrador general**. Desde ahí:

1. Crea un negocio (selector superior izquierdo → *Nuevo negocio*).
2. En *Configuración* sube el logotipo, ajusta colores, moneda y la regla de SKU; define categorías y sus atributos.
3. Carga mercancía en *Alta masiva* o con *Nuevo producto*.
4. Organiza en *Colecciones*, genera *Catálogos PDF* y prepara archivos en *Mercado Libre* / *TikTok Shop*.

Para detener la aplicación usa **Ctrl+C** en la terminal (cierra la base de datos de forma ordenada).

### Modo desarrollo

```bash
npm run dev        # API en :4000 con recarga + interfaz Vite en http://localhost:5173
```

### Datos de demostración (opcional)

```bash
# En .env: DEMO_ADMIN_PASSWORD=<una contraseña de prueba>
npm run seed
```

Crea dos negocios marcados **[DEMO]** (`is_demo = true`) con categorías, una temporada, productos con variantes y fotos generadas. Si la base no tiene usuarios, también crea el administrador de demostración. No ejecutes esto sobre tu base real si quieres empezar en cero.

---

## Configuración (`.env`)

| Variable | Para qué sirve |
|---|---|
| `APP_SECRET` | **Obligatoria** (≥ 32 caracteres). Firma URLs de imágenes y cifra credenciales de canales. |
| `PORT` | Puerto web (por defecto 4000). |
| `DATABASE_URL` | PostgreSQL externo para producción. Vacía = PostgreSQL embebido local. |
| `DATA_DIR` | Carpeta de la base embebida y de los archivos subidos (por defecto `~/.catalogo-maestro`). Mantenla **fuera** de OneDrive/Dropbox. |
| `PUBLIC_BASE_URL` | Dominio público del servidor (p. ej. `https://catalogo.midominio.com`). Los marketplaces descargan las fotos desde aquí; sin él, las URLs de imagen de los archivos exportados no son accesibles. |
| `ANTHROPIC_API_KEY` | Habilita la asistencia con IA. Sin ella todo funciona con captura manual e importación. |
| `AI_MODEL`, `AI_EFFORT`, `AI_CONCURRENCY` | Modelo (por defecto `claude-opus-5-5`), nivel de esfuerzo y análisis simultáneos. |
| `AI_MAX_IMAGES`, `AI_IMAGE_SIDE` | Fotos por producto enviadas a la IA (por defecto 4) y su tamaño máximo en px (por defecto 1024). Controlan el costo. |
| `HOST` | Interfaz de red. Por defecto `127.0.0.1` (solo este equipo). En un servidor/contenedor: `0.0.0.0`. |

Las credenciales viven solo en el servidor; `.env` está en `.gitignore`.

---

## Arquitectura y decisiones

| Capa | Elección | Motivo |
|---|---|---|
| Interfaz | React 19 + TypeScript + Vite + Tailwind CSS 4 + TanStack Query | SPA rápida, sin SSR innecesario para una herramienta interna. |
| API | Fastify 5 + Zod | Validación estricta de cada entrada en el servidor, buen manejo de multipart. |
| Base de datos | PostgreSQL 18 + Drizzle ORM + migraciones SQL versionadas (`/drizzle`) | Integridad referencial real; migraciones controladas que se aplican al iniciar. |
| Archivos | Almacenamiento local detrás de una interfaz (`server/lib/storage.ts`) | Cambiable por S3/R2/GCS sin tocar el resto. |
| Imágenes | sharp | Valida el contenido real, corrige orientación, elimina metadatos (GPS), genera miniaturas y hashes para duplicados. |
| Excel/CSV | ExcelJS + PapaParse | Lee y escribe `.xlsx` conservando las demás hojas de las plantillas oficiales. |
| PDF | PDFKit | Catálogos con logotipo, colores y fotos, sin navegador headless. |
| IA | SDK oficial de Anthropic (Claude, visión + salida estructurada) detrás de una interfaz `AiProvider` | Se puede añadir otro proveedor implementando la interfaz. |
| Autenticación | Sesiones en BD (cookie httpOnly, SameSite), contraseñas con scrypt | Sin dependencias externas; sesiones revocables. |
| Trabajos asíncronos | Cola de IA persistida en PostgreSQL (`import_rows.ai_status`, `FOR UPDATE SKIP LOCKED`) | Reanuda tras reinicios, reintentos con espera creciente, sin Redis. |

```
server/
  index.ts            arranque: BD (embebida o externa), migraciones, servidor, cola de IA
  app.ts              Fastify: seguridad, errores, rutas
  db/                 esquema Drizzle, conexión, PostgreSQL embebido, migraciones
  lib/                auth y permisos, cifrado, almacenamiento, imágenes, Excel/CSV, auditoría
  services/           lógica de negocio: productos/variantes/SKU, fotos, alta masiva, catálogos, exportaciones
  ai/                 interfaz de proveedor, implementación Anthropic, cola de trabajos
  channels/           adaptadores por canal (mercadolibre.ts, tiktok.ts), motor de plantillas, registro
  routes/             endpoints HTTP (todas las rutas de negocio bajo /api/b/:businessId)
web/src/              interfaz (páginas, rejilla editable, componentes)
tests/                pruebas automatizadas (PostgreSQL real en carpeta temporal)
scripts/              datos demo y respaldos
```

### Aislamiento multinegocio

- **Servidor:** toda ruta de negocio pasa por `resolveBusiness`, que verifica la membresía del usuario (404 si no tiene acceso, para no revelar negocios ajenos). Cada consulta filtra por `business_id`, y cada ID recibido (categoría, colección, foto, producto) se valida contra el negocio.
- **Base de datos:** las relaciones usan **llaves foráneas compuestas `(business_id, id)`**: PostgreSQL rechaza, por ejemplo, una variante, foto o colección que apunte a un producto de otro negocio, aunque un error de código lo intentara. Los archivos se guardan en carpetas por negocio.
- **Roles:** administrador general (todos los negocios y usuarios), administrador de negocio (configuración y accesos de su negocio) y operador (productos, lotes, catálogos y exportaciones).

### Integridad y recuperación

- La confirmación de un lote ocurre en **una sola transacción** con bloqueo del lote: si algo falla no queda nada a medias; reintentar no duplica (las filas confirmadas se saltan).
- SKU únicos por negocio (restricción en BD) y detección de duplicados en lotes (SKU, nombre y fotos idénticas o casi idénticas).
- Nada real se borra automáticamente: los productos se **archivan** y reactivan; las fotos van a una papelera recuperable; archivar un negocio requiere escribir su nombre.
- Bitácora de operaciones importantes (`audit_log`), visible como actividad reciente.
- Protección CSRF (encabezado obligatorio), límite de intentos de inicio de sesión, encabezados de seguridad, validación del contenido real de las imágenes.

### Respaldos

```bash
npm run backup     # con la aplicación detenida
```

```bash
npm run restore                     # lista los respaldos disponibles
npm run restore -- 2026-10-21T10-00-00   # restaura uno (con la aplicación detenida)
```

- El respaldo copia la base embebida completa y las fotos a `DATA_DIR/backups/<fecha>` e incluye un `respaldo.json` con la versión de PostgreSQL y el número de archivos.
- Se hace con la aplicación **detenida** (el PostgreSQL embebido no incluye `pg_dump`; copiar la carpeta con la base detenida da una copia consistente).
- La restauración **no borra nada**: la versión actual se mueve a `DATA_DIR/antes-de-restaurar-<fecha>`. Está probada automáticamente (respaldo → cambios → restauración → los datos y fotos vuelven al estado del respaldo).
- Copia periódicamente `DATA_DIR/backups` a otro disco o a la nube.
- Con un PostgreSQL administrado (`DATABASE_URL`), usa los respaldos automáticos del proveedor y respalda el volumen de fotos.

---

## Alta masiva

Flujo: crear lote (con temporada/colección) → subir fotos (computadora o celular) → importar Excel/CSV opcional → agrupar fotos por producto → (IA opcional) → revisar y corregir en una tabla tipo hoja de cálculo → validar → confirmar → resumen.

- **Agrupación sin IA:** por nombre de archivo (`blusa-roja_1.jpg`, `blusa-roja_2.jpg`) y por similitud visual (dHash) para fotos de cámara. Se puede combinar, separar y mover fotos entre filas.
- **Excel/CSV:** una fila por variante; filas con el mismo «grupo» forman un producto con variantes; la columna «fotos» asocia las imágenes por nombre; columnas desconocidas se guardan como atributos. Hay una plantilla de ejemplo descargable.
- **Tabla:** edición con teclado, copiar/pegar rangos (también desde Excel), rellenar hacia abajo (Ctrl+D), filtros, ordenamiento, selección múltiple y asignación masiva de valores. Se guarda automáticamente.
- El lote conserva estado, fecha, errores y advertencias: se puede corregir y confirmar por partes (*importar solo las válidas*).

### IA

Con `ANTHROPIC_API_KEY`, la IA analiza las fotos de cada fila y propone nombre, título, categoría, descripciones, palabras clave, colores, texto legible de etiquetas y atributos visuales. Reglas:

- Solo llena **campos vacíos**; nunca sobrescribe datos del usuario o de la importación.
- Distingue **IA · visto** (observado/leído en la foto) de **IA · inferido**, y todo lo sugerido queda **por revisar** hasta que el usuario lo confirma.
- Registra la marca o el material solo si aparecen legibles en una etiqueta; si duda, deja el campo vacío.
- Errores transitorios se reintentan (hasta 3 veces); los permanentes quedan como fallidos y se pueden reintentar desde la tabla.
- Usa el respaldo de servidor (`fallbacks: "default"`) para que, si el modelo principal rechaza una solicitud, la API la reintente en un modelo alterno.

Sin API key, la interfaz lo indica y no simula resultados.

**Proveedor, modelo y costos.** Proveedor: Anthropic (API de Claude). Modelo por defecto: `claude-opus-5-5` (cámbialo con `AI_MODEL`, p. ej. `claude-sonnet-5-5` o `claude-haiku-5-5`, más económicos). Variable: `ANTHROPIC_API_KEY` (se crea en console.anthropic.com; el cobro es prepago/por uso en esa cuenta). Se cobra por tokens: cada foto de 1024 px son ≈1,400 tokens de entrada; con 4 fotos por producto, el análisis usa ≈6,000–7,000 tokens de entrada y ≈1,000–2,000 de salida. Con las tarifas publicadas de Opus 5.5 ($4 / $20 USD por millón de tokens de entrada/salida, octubre 2026) eso es del orden de **$0.03–0.07 USD por producto** (estimado; verifica la tarifa vigente). La IA **solo se ejecuta cuando presionas «Analizar con IA»** sobre filas seleccionadas; nunca automáticamente. Cada lote muestra los tokens reales consumidos que reporta la API.

---

## Mercado Libre y TikTok Shop

Cada canal es un **adaptador independiente** (`server/channels/`): validaciones propias, sinónimos de columnas, archivo de preparación y capacidades. Para añadir un marketplace se crea un adaptador y se registra en `registry.ts`; el catálogo maestro no cambia.

**Flujo:** elegir productos → validar → generar archivo (solo con los productos sin errores) → historial → subir el archivo al marketplace → **vincular** los IDs de publicación (pegando «SKU, ID» o subiendo un reporte). Generar un archivo marca el producto como *archivo generado*, **nunca** como publicado.

**Plantillas oficiales:** ambos marketplaces entregan plantillas de carga masiva **distintas por categoría** que se descargan desde la cuenta del vendedor. El sistema no supone columnas: lee la plantilla que subes, detecta encabezados, filas descriptivas y columnas obligatorias (`*`, «Obligatorio», «Mandatory»), propone el mapeo y la llena con una fila por variante, conservando las demás hojas. Sin plantilla se genera un **archivo de preparación** claramente rotulado como *no oficial*.

### Qué está verificado y qué no

| | Mercado Libre México | TikTok Shop México |
|---|---|---|
| Columnas del archivo | Se leen de la plantilla oficial que subes | Se leen de la plantilla oficial que subes |
| Requisitos por categoría | **Verificado en vivo** con la API pública oficial: atributos obligatorios, de variación y condicionales, longitud máxima de título, fotos máximas, precio mínimo, variaciones máximas | No hay API pública accesible: solo los obligatorios que marca la plantilla |
| Imágenes | Documentación oficial: JPG/PNG, mínimo 500×500 px, recomendado 1200×1200 | Reglas reportadas por terceros (600×600, 9 fotos): se muestran como **advertencias no verificadas** |
| Predicción de categoría | Servicio oficial `domain_discovery` | — |
| Publicación/sincronización por API | **Pendiente** | **Pendiente** |

Las pruebas automatizadas usan respuestas **reales** de la API de Mercado Libre guardadas en `tests/fixtures` (20-oct-2026). Las plantillas Excel usadas en las pruebas son **sintéticas** (una de una fila de encabezado y otra con la estructura de varias filas típica: claves internas, nombres visibles, «Mandatory/Optional» e instrucciones), no plantillas oficiales: no se pudo obtener ninguna plantilla oficial sin una cuenta de vendedor. **Antes de tu primera carga real**, sube la plantilla oficial, revisa el mapeo propuesto, genera un archivo con 1–2 productos, ábrelo en Excel y súbelo al marketplace como prueba; el reporte de errores del marketplace es la verificación definitiva.

**Cómo obtener las plantillas oficiales**
- **Mercado Libre:** en tu cuenta de vendedor → *Publicaciones* → *Publicar* → opción de publicar **varios productos a la vez / con Excel** → elige la categoría (la misma que asignes en el sistema) → descarga la planilla. Los campos obligatorios vienen marcados con (*).
- **TikTok Shop México:** Seller Center → *Productos* → *Administrar productos* → *Herramientas por lote / Carga masiva* → elige categoría (y marca si aplica) → descarga la plantilla. Los obligatorios vienen marcados con *. Necesitas tener configurados almacén y plantilla de envío en Seller Center para que la carga funcione. Guías de terceros mencionan límites por archivo (p. ej. 50 productos para cuentas nuevas): **no verificado**; si TikTok rechaza el archivo por tamaño, exporta por partes.
- Si el marketplace entrega `.xls` o `.xlsm`, ábrelo en Excel y guárdalo como `.xlsx` antes de subirlo al sistema.

---

## Pruebas

```bash
npm test           # 38 pruebas, PostgreSQL real en carpeta temporal
npm run typecheck
```

`tests/scenario.test.ts` cubre el escenario obligatorio completo: dos negocios, productos distintos, fotos múltiples y duplicados, variantes talla × color con SKU automático, importación de lote con errores → corrección → confirmación transaccional, edición masiva, **reinicio completo** (app + PostgreSQL) con verificación de persistencia, aislamiento entre negocios (API y llaves foráneas), catálogo PDF y enlace público sin costos, exportaciones a Mercado Libre y TikTok, validación de obligatorios por plantilla, corrección y reexportación, vinculación de IDs y funciones pendientes identificadas. `tests/ai-queue.test.ts` prueba la cola de IA con un proveedor de prueba explícito (solo en pruebas). `tests/units.test.ts` cubre SKU, agrupación, reglas de IA y mapeo. `tests/stabilization.test.ts` cubre fotos subidas antes o después del Excel, CSV reales (Windows-1252 con «;», UTF-8 con BOM y comillas), un lote de 300 productos × 6 variantes con 60 fotos (tiempos medidos), recuperación sin duplicados (fallo a mitad de la transacción, conflicto de SKU tras validar, doble confirmación simultánea), fotos duplicadas y recomprimidas, validaciones de Mercado Libre con datos oficiales, plantillas de varias filas de encabezado, URLs firmadas de fotos, límites de importación, inyección de fórmulas, bloqueo de inicio de sesión, y respaldo + restauración.

Tiempos medidos en esta PC (lote de 300 productos / 1,800 variantes): subir 60 fotos ≈ 7 s · importar el Excel ≈ 0.7 s · validar ≈ 0.4 s · confirmar (una transacción) ≈ 6.7 s · edición masiva de 300 ≈ 0.9 s.

---

## Publicar en internet (necesario para las fotos de los marketplaces)

Mercado Libre y TikTok descargan las fotos desde las URLs del archivo exportado, así que el servidor debe ser accesible desde internet por HTTPS. **No expongas tu computadora**: aloja la aplicación en un servidor.

Opción recomendada (sin administrar servidores): una plataforma con contenedores (Railway, Render o Fly.io) usando el `Dockerfile` incluido:

1. Crea un PostgreSQL administrado en la misma plataforma y copia su URL a `DATABASE_URL`.
2. Crea el servicio desde este repositorio (Dockerfile). Variables: `APP_SECRET` (nuevo y aleatorio), `DATABASE_URL`, `PUBLIC_BASE_URL=https://<tu-dominio>`, `ANTHROPIC_API_KEY` (opcional). `HOST` y `DATA_DIR=/data` ya vienen en la imagen.
3. Monta un **volumen persistente en `/data`** (ahí quedan las fotos; sin volumen se pierden al redeplegar).
4. Health check: `GET /api/health`.
5. Entra a `https://<tu-dominio>`, crea el administrador y abre en otro dispositivo (con datos móviles) una URL de foto de un archivo exportado para confirmar que es pública.

Alternativa: un VPS (Ubuntu) con Node 22, PostgreSQL, este proyecto (`npm ci && npm run build && npm start` como servicio) y Caddy o Nginx como proxy HTTPS hacia `127.0.0.1:4000`.

Qué expone el servidor sin sesión: solo las fotos de productos mediante URLs **firmadas** (`/public/m/<id>/<firma>.jpg`, imposibles de adivinar) y los catálogos que compartas explícitamente. Todo lo demás requiere inicio de sesión. *El Dockerfile no se pudo construir en este equipo (no hay Docker instalado); valida el primer despliegue.*

Recomendación: si vas a usar un servidor, empieza a capturar mercancía real directamente allá. Migrar datos locales al servidor no está automatizado (el Excel exportado no incluye las fotos).

---

## Pendiente (Etapa 3) y requisitos

| Función | Estado | Qué se necesita |
|---|---|---|
| Publicar / actualizar precio y stock / consultar estado en **Mercado Libre** por API | Pendiente. Las operaciones se registran como *pendiente de integración* y no se ejecutan | Registrar una aplicación en developers.mercadolibre.com.mx (App ID, Secret Key, URL de redirección) y autorizar tu cuenta de vendedor (OAuth). |
| Lo mismo para **TikTok Shop** | Pendiente | App aprobada en TikTok Shop Partner Center (App Key/Secret) y autorización de la tienda. |
| URLs públicas de imágenes en exportaciones | Funciona si configuras `PUBLIC_BASE_URL` | Publicar el servidor en internet (o mover el almacenamiento a un bucket público). |
| Asistencia con IA | Implementada | `ANTHROPIC_API_KEY`. |
| Almacenamiento de objetos (S3/R2) | Interfaz lista, implementación local | Credenciales del bucket. |

La tabla `channel_operations` y la cola persistente ya están preparadas para registrar operaciones, reintentos y errores de sincronización cuando existan las credenciales.

---

## Video tutorial

En `tutorial/` está el video para nuevos usuarios (`tutorial/output/tutorial-catalogo-maestro.mp4`, 9:39 min, narrado en español con subtítulos), su guion y el proceso automatizado para regenerarlo. Ver `tutorial/README.md`.
