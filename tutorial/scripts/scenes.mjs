// Guion del tutorial: cada segmento tiene el texto narrado (y subtitulado) y las acciones reales en la app.
import path from 'node:path';
import { ASSETS } from './assets.mjs';

const foto = (f) => path.join(ASSETS, 'fotos', f);
export const ADMIN = { name: 'Ana Pérez', email: 'ana@boutique-demo.mx', password: 'Tutorial-2026' };

// Pronunciación para la voz (los subtítulos muestran el texto original)
export function speech(text) {
  return text
    .replace(/\bSKU\b/g, 'ese ka u')
    .replace(/\bPDF\b/g, 'pe de efe')
    .replace(/\bCSV\b/g, 'ce ese uve')
    .replace(/\bIA\b/g, 'i a')
    .replace(/\bIDs?\b/g, 'identificadores')
    .replace(/\bWhatsApp\b/g, 'guatsap')
    .replace(/\bTikTok\b/g, 'tik tok')
    .replace(/Seller Center/g, 'séler center')
    .replace(/\bAnthropic\b/g, 'ánthropic')
    .replace(/Otoño-invierno/gi, 'otoño invierno');
}

const L = {
  meta: (page, label) => page.locator(`xpath=//span[normalize-space()="${label}"]/parent::div/following-sibling::div[1]//*[self::input or self::select or self::textarea]`).first(),
  btn: (page, name) => page.getByRole('button', { name }).first(),
};

const card = (kicker, title, sub = '', extra = '') =>
  `<div class="logo"><i><svg width="26" height="26" viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h9" stroke="#4f46e5" stroke-width="2.6" stroke-linecap="round"/></svg></i>Catálogo Maestro</div>
   <div class="kicker">${kicker}</div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}${extra}`;

export const CHAPTER_TITLES = [
  'Inicio de sesión y panel principal',
  'Negocios independientes',
  'Registro de un producto',
  'Alta masiva con Excel o CSV',
  'Carga y asociación de fotografías',
  'Variantes por talla y color, y SKU',
  'Inteligencia artificial',
  'Catálogos PDF',
  'Exportar a Mercado Libre y TikTok Shop',
  'Validación de errores y recomendaciones',
];

const chapterCard = (n) => ({
  id: `c${n}-titulo`,
  text: `Capítulo ${n}. ${CHAPTER_TITLES[n - 1]}.`,
  tail: 0.2,
  run: async (d) => {
    await d.card(card(`Capítulo ${n} de 10`, CHAPTER_TITLES[n - 1]));
    await d.pause(1800);
  },
  after: async (d) => d.hideCard(),
});

export const CHAPTERS = [
  {
    title: 'Introducción',
    segments: [
      {
        id: 'intro-1',
        text: 'Bienvenido a Catálogo Maestro, la plataforma para administrar los catálogos de todos tus negocios en un solo lugar.',
        run: async (d) => d.card(card('Tutorial', 'Bienvenido a Catálogo Maestro', 'Administra los catálogos de todos tus negocios en un solo lugar.')),
      },
      {
        id: 'intro-2',
        text: 'En este tutorial aprenderás, paso a paso, a registrar tu mercancía, organizarla, crear catálogos y preparar tus archivos para Mercado Libre y TikTok Shop.',
        run: async (d) =>
          d.card(
            card('Contenido', 'Lo que vas a aprender', '', `<ol>${CHAPTER_TITLES.map((t, i) => `<li><span>${i + 1}</span>${t}</li>`).join('')}</ol>`),
          ),
      },
      {
        id: 'intro-3',
        text: 'Todos los datos que verás son ficticios, creados solo para este ejemplo.',
        run: async (d) => {
          await d.card(card('Antes de empezar', 'Datos de ejemplo', 'Los negocios, productos y fotos de este video son ficticios.'));
        },
        after: async (d) => d.hideCard(),
      },
    ],
  },
  {
    title: CHAPTER_TITLES[0],
    segments: [
      chapterCard(1),
      {
        id: 'c1-login',
        text: 'Abre la aplicación en tu navegador e inicia sesión con tu correo y tu contraseña.',
        run: async (d) => {
          const p = d.page;
          await d.type(p.getByLabel('Correo electrónico'), ADMIN.email);
          await d.type(p.getByLabel('Contraseña'), ADMIN.password, { delay: 60 });
          await d.click(L.btn(p, 'Entrar'), { wait: 1500 });
        },
      },
      {
        id: 'c1-panel',
        text: 'Este es el panel principal. Muestra cifras reales: cuántos productos y variantes tienes, cuáles están agotados, cuáles están incompletos y la actividad reciente.',
        run: async (d) => {
          await d.banner('Capítulo 1', 'Panel principal');
          await d.zoom(d.page.locator('main .grid').first(), 1.35, 2500);
          await d.unzoom();
        },
      },
      {
        id: 'c1-menu',
        text: 'A la izquierda está el menú. Arriba encontrarás el selector de negocio, para cambiar de tienda en cualquier momento.',
        run: async (d) => {
          const sel = d.page.locator('aside button').filter({ hasText: /negocio/ }).first();
          await d.highlight(sel);
          await d.moveTo(sel);
          await d.pause(2200);
          await d.unhighlight();
        },
      },
    ],
  },
  {
    title: CHAPTER_TITLES[1],
    segments: [
      chapterCard(2),
      {
        id: 'c2-intro',
        text: 'Cada negocio tiene su propio catálogo, precios, fotos e inventario, completamente separados de los demás. Vamos a crear uno nuevo.',
        run: async (d) => {
          const p = d.page;
          await d.click(p.locator('aside button').filter({ hasText: /negocio/ }).first());
          await d.click(p.getByRole('button', { name: 'Nuevo negocio' }));
        },
      },
      {
        id: 'c2-form',
        text: 'Escribe el nombre comercial, una breve descripción de lo que vendes, y elige el color de tu marca.',
        run: async (d) => {
          const p = d.page;
          await d.type(p.getByLabel('Nombre comercial'), 'Boutique Luna');
          await d.type(p.getByLabel('Descripción'), 'Ropa de temporada para dama: pijamas, chamarras y leggings.', { delay: 25 });
          await d.click(p.getByRole('button', { name: '#be185d' }));
          await d.click(L.btn(p, 'Crear negocio'), { wait: 1500 });
          d.bid = p.url().match(/\/b\/([0-9a-f-]{36})/)[1];
        },
      },
      {
        id: 'c2-logo',
        text: 'Listo, el negocio ya existe. En Configuración subes tu logotipo y defines cómo se generan los códigos SKU de tus productos.',
        run: async (d) => {
          const p = d.page;
          await d.moveTo(p.getByText('Subir logotipo'));
          await d.upload(p.locator('input[type=file][accept="image/*"]').first(), path.join(ASSETS, 'logo-boutique-luna.png'));
          await d.pause(1200);
          await d.zoom(p.getByText('Regla de SKU automático').locator('xpath=ancestor::section[1]'), 1.35, 1800);
          await d.unzoom();
        },
      },
      {
        id: 'c2-cat',
        text: 'Las categorías organizan tu catálogo. Creamos la categoría Pijamas, con un dato propio: la composición de la tela.',
        run: async (d) => {
          const p = d.page;
          await d.click(p.getByRole('button', { name: 'Categorías y atributos' }));
          await d.click(L.btn(p, 'Nueva categoría'));
          await d.type(p.getByRole('dialog').getByLabel('Nombre'), 'Pijamas');
          await d.click(p.getByRole('dialog').getByRole('button', { name: 'Atributo' }));
          await d.type(p.getByPlaceholder('Nombre (ej. Tipo de compresión)'), 'Composición');
          await d.click(p.getByRole('dialog').getByRole('button', { name: 'Guardar' }), { wait: 900 });
        },
      },
      {
        id: 'c2-switch',
        text: 'Si administras varias tiendas, cambias entre ellas desde el selector. Por ejemplo, Fajas Bella Forma muestra únicamente sus propios productos.',
        run: async (d) => {
          const p = d.page;
          await d.click(p.locator('aside button').filter({ hasText: 'Boutique Luna' }).first());
          await d.click(p.locator('aside').getByRole('button', { name: 'Fajas Bella Forma' }), { wait: 1500 });
          await d.pause(1500);
        },
      },
      {
        id: 'c2-back',
        text: 'Regresamos a Boutique Luna para seguir trabajando.',
        run: async (d) => {
          const p = d.page;
          await d.click(p.locator('aside button').filter({ hasText: 'Fajas Bella Forma' }).first());
          await d.click(p.locator('aside').getByRole('button', { name: 'Boutique Luna' }), { wait: 1200 });
        },
      },
    ],
  },
  {
    title: CHAPTER_TITLES[2],
    segments: [
      chapterCard(3),
      {
        id: 'c3-nuevo',
        text: 'Para registrar un producto, entra a Productos y presiona Nuevo producto.',
        run: async (d) => {
          const p = d.page;
          await d.click(L.btn(p, 'Nuevo producto'), { wait: 900 });
        },
      },
      {
        id: 'c3-datos',
        text: 'Escribe el nombre comercial, la marca y el modelo. Si no conoces un dato, déjalo vacío: el sistema nunca lo inventa.',
        run: async (d) => {
          const p = d.page;
          await d.type(p.getByPlaceholder('Ej. Pijama térmica de dos piezas'), 'Pijama térmica de dos piezas');
          await d.type(L.meta(p, 'Marca'), 'Boutique Luna', { delay: 35 });
          await d.type(p.getByLabel('Modelo / referencia'), 'PT-2P', { delay: 50 });
          await d.type(L.meta(p, 'Descripción corta'), 'Pijama afelpada de manga larga con pantalón.', { delay: 22 });
        },
      },
      {
        id: 'c3-cat',
        text: 'Elige la categoría. Al hacerlo, aparecen sus campos propios, como la composición.',
        run: async (d) => {
          const p = d.page;
          await d.select(L.meta(p, 'Categoría'), 'Pijamas');
          await d.type(L.meta(p, 'Composición'), '100% poliéster', { delay: 40 });
          await d.type(p.getByLabel('Peso (g)'), '450', { delay: 80 });
        },
      },
      {
        id: 'c3-precio',
        text: 'Captura el costo, que es privado y nunca aparece en catálogos ni exportaciones, y el precio de venta.',
        run: async (d) => {
          const p = d.page;
          await d.type(p.getByLabel('Costo unitario'), '180', { delay: 80 });
          await d.type(p.getByLabel('Precio de venta'), '399', { delay: 80 });
          await d.select(p.getByLabel('Estado'), 'Activo');
        },
      },
      {
        id: 'c3-guardar',
        text: 'Al guardar, el sistema asigna automáticamente el código SKU según la regla del negocio.',
        run: async (d) => {
          const p = d.page;
          await d.click(L.btn(p, 'Crear producto'), { wait: 1500 });
          d.pijama = p.url().split('/').pop();
          await d.zoom(p.locator('main h1').first(), 1.7, 1500);
          await d.unzoom();
        },
      },
    ],
  },
  {
    title: CHAPTER_TITLES[3],
    segments: [
      chapterCard(4),
      {
        id: 'c4-lote',
        text: 'Cuando llega mucha mercancía, usa Alta masiva. Crea un lote y, si quieres, asígnalo a una temporada.',
        run: async (d) => {
          const p = d.page;
          await d.click(p.locator('aside').getByRole('link', { name: 'Alta masiva' }), { wait: 700 });
          await d.click(L.btn(p, 'Nuevo lote'));
          await d.type(p.getByLabel('Nombre del lote'), 'Llegada de otoño', { delay: 40 });
          await d.click(p.getByRole('dialog').getByRole('button', { name: 'Crear nueva' }));
          await d.type(p.getByPlaceholder('Ej. Otoño-invierno 2026'), 'Otoño-invierno 2026', { delay: 40 });
          await d.click(p.getByRole('dialog').getByRole('button', { name: 'Crear lote' }), { wait: 1200 });
        },
      },
      {
        id: 'c4-excel',
        text: 'En tu Excel, cada fila es una variante. Las filas con el mismo grupo se convierten en un solo producto, y la columna fotos indica qué imágenes le corresponden. Aquí puedes descargar una plantilla de ejemplo.',
        run: async (d) => {
          const p = d.page;
          const link = p.getByText('Descargar plantilla de importación de ejemplo');
          await d.highlight(link);
          await d.moveTo(link);
          await d.pause(2500);
          await d.unhighlight();
        },
      },
      {
        id: 'c4-subir',
        text: 'Subimos el archivo. El sistema reconoce las columnas automáticamente, y puedes corregir cualquier asignación antes de importar.',
        run: async (d) => {
          const p = d.page;
          await d.moveTo(p.getByText('Elige un archivo .xlsx o .csv'));
          await d.upload(p.locator('input[type=file][accept=".xlsx,.csv"]'), path.join(ASSETS, 'lote-ejemplo.xlsx'));
          await p.getByRole('dialog').waitFor();
          await d.zoom(p.getByRole('dialog'), 1.25, 1500);
          await d.unzoom();
        },
      },
      {
        id: 'c4-importar',
        text: 'Seis filas del Excel se convierten en tres productos con sus variantes, listos para revisar.',
        run: async (d) => {
          const p = d.page;
          await d.click(L.btn(p, 'Importar al lote'), { wait: 1800 });
        },
      },
    ],
  },
  {
    title: CHAPTER_TITLES[4],
    segments: [
      chapterCard(5),
      {
        id: 'c5-subir',
        text: 'Ahora subimos las fotografías. Puedes arrastrarlas desde tu computadora o tomarlas con el celular. El sistema revisa cada imagen y detecta fotos repetidas.',
        run: async (d) => {
          const p = d.page;
          await d.click(p.getByRole('button', { name: '1. Cargar fotos y datos' }), { wait: 600 });
          await d.moveTo(p.getByText('Arrastra aquí muchas fotos a la vez'));
          await d.upload(p.locator('input[type=file][accept="image/*"]'), [
            'chamarra-negra_1.jpg',
            'chamarra-negra_2.jpg',
            'chamarra-olivo_1.jpg',
            'leggings-gris_1.jpg',
            'sudadera-lila_1.jpg',
            'sudadera-lila_2.jpg',
            'bufanda-tejida_1.jpg',
            'bufanda-tejida_2.jpg',
          ].map(foto));
          await p.getByText(/foto\(s\) subidas/).waitFor({ timeout: 30000 });
          await d.pause(800);
        },
      },
      {
        id: 'c5-asociar',
        text: 'Las fotos que aparecen en el Excel se asociaron solas a su producto. Las que sobran se agrupan por nombre de archivo o por parecido con el botón Agrupar fotos.',
        run: async (d) => {
          const p = d.page;
          await d.zoom(p.getByText(/sin agrupar/).first(), 1.5, 1200);
          await d.unzoom();
          await d.click(L.btn(p, 'Agrupar fotos en productos'), { wait: 1500 });
        },
      },
      {
        id: 'c5-tabla',
        text: 'En la tabla de revisión ves cada producto con sus fotos. Funciona como una hoja de cálculo: escribes directamente, y también puedes copiar y pegar desde Excel. Completemos la bufanda.',
        run: async (d) => {
          const p = d.page;
          const row = p.locator('table tbody tr').last();
          await d.click(row.locator('td.grid-cell').nth(0));
          await p.keyboard.type('Bufanda tejida', { delay: 70 });
          await p.keyboard.press('Tab');
          await p.keyboard.type('Accesorios', { delay: 60 });
          await p.keyboard.press('Tab');
          await p.keyboard.type('189', { delay: 90 });
          await p.keyboard.press('Enter');
          await d.pause(900);
        },
      },
      {
        id: 'c5-validar',
        text: 'Pasamos a validar. El sistema revisa los campos obligatorios, los precios y los posibles duplicados. Si todo está bien, confirmamos la importación.',
        run: async (d) => {
          const p = d.page;
          await d.click(p.getByRole('button', { name: '3. Validar y confirmar' }), { wait: 1800 });
          await d.click(p.getByRole('button', { name: /^Confirmar importación/ }), { wait: 2000 });
          await d.zoom(p.getByText(/Importación completada/).first(), 1.4, 1200);
          await d.unzoom();
        },
      },
    ],
  },
  {
    title: CHAPTER_TITLES[5],
    segments: [
      chapterCard(6),
      {
        id: 'c6-generar',
        text: 'Volvemos a la pijama. En la pestaña Variantes escribimos los colores y las tallas disponibles, y el sistema crea todas las combinaciones dentro de la misma ficha.',
        run: async (d) => {
          const p = d.page;
          await d.goto(`/b/${d.bid}/productos/${d.pijama}`);
          await d.click(p.getByRole('button', { name: /^Variantes e inventario/ }), { wait: 500 });
          const colors = p.getByPlaceholder('Rosa, Negro… (Enter)');
          await d.click(colors);
          for (const c of ['Rosa', 'Negro']) (await p.keyboard.type(c, { delay: 60 }), await p.keyboard.press('Enter'));
          const sizes = p.getByPlaceholder('CH, M, G… (Enter)');
          await d.click(sizes);
          for (const s of ['Chica', 'Mediana', 'Grande']) (await p.keyboard.type(s, { delay: 60 }), await p.keyboard.press('Enter'));
          await d.type(p.getByLabel('Existencias c/u'), '3', { delay: 80 });
          await d.click(L.btn(p, 'Generar'), { wait: 700 });
        },
      },
      {
        id: 'c6-guardar',
        text: 'Al guardar, cada variante recibe su propio SKU, por ejemplo PIJ-001-ROS-CH para la pijama rosa en talla chica. Puedes ajustar existencias, código de barras o precio de cada una.',
        speech: 'Al guardar, cada variante recibe su propio código, por ejemplo, el de la pijama rosa en talla chica. Puedes ajustar existencias, código de barras o precio de cada una.',
        run: async (d) => {
          const p = d.page;
          await d.click(L.btn(p, 'Guardar cambios'), { wait: 1500 });
          await d.zoom(p.locator('main table').first(), 1.3, 2500);
          await d.unzoom();
        },
      },
      {
        id: 'c6-fotos',
        text: 'En Fotografías subimos las imágenes del producto, y podemos indicar qué foto corresponde a cada color.',
        run: async (d) => {
          const p = d.page;
          await d.click(p.getByRole('button', { name: /^Fotografías/ }), { wait: 500 });
          await d.upload(p.locator('input[type=file][accept="image/*"]'), [foto('pijama-rosa.jpg'), foto('pijama-negra.jpg')]);
          await p.getByText('Todas las variantes').first().waitFor({ timeout: 20000 }).catch(() => {});
          await d.pause(800);
          const selects = p.locator('main select');
          if ((await selects.count()) >= 2) {
            await d.select(selects.nth(0), 'Rosa / Chica');
            await d.select(selects.nth(1), 'Negro / Chica');
          }
          await d.pause(600);
        },
      },
    ],
  },
  {
    title: CHAPTER_TITLES[6],
    segments: [
      chapterCard(7),
      {
        id: 'c7-que',
        text: 'Catálogo Maestro incluye inteligencia artificial: analiza las fotos de cada producto y propone el nombre, la categoría, la descripción, las palabras clave y las características visibles.',
        run: async (d) => {
          // Preparación fuera de cámara: un lote con fotos de un proveedor
          const b = await d.api('POST', `/api/b/${d.bid}/batches`, { name: 'Fotos del proveedor' });
          for (const f of ['IMG_2041.jpg', 'IMG_2042.jpg']) await d.apiUpload(`/api/b/${d.bid}/batches/${b.id}/photos`, foto(f));
          await d.api('POST', `/api/b/${d.bid}/batches/${b.id}/group`, {});
          await d.goto(`/b/${d.bid}/alta-masiva/${b.id}`);
          await d.pause(800);
        },
      },
      {
        id: 'c7-clave',
        text: 'En este video la IA todavía no está activada, por eso aparece este aviso. Para activarla, quien instala el sistema agrega una clave de Anthropic en la configuración del servidor.',
        run: async (d) => {
          const p = d.page;
          await d.zoom(p.getByText('Asistencia con IA no configurada').locator('xpath=ancestor::div[2]'), 1.45, 2500);
          await d.unzoom();
        },
      },
      {
        id: 'c7-uso',
        text: 'Ya activada, seleccionas las filas y presionas Analizar con IA. Las sugerencias quedan marcadas para revisión, y nada se da por bueno hasta que tú lo confirmas. La IA nunca inventa marcas ni materiales.',
        run: async (d) => {
          const p = d.page;
          await d.click(p.getByLabel('Seleccionar todas'));
          const bar = p.getByText(/fila\(s\)$/).first().locator('xpath=ancestor::div[1]');
          await d.highlight(bar);
          await d.pause(3500);
          await d.unhighlight();
        },
      },
    ],
  },
  {
    title: CHAPTER_TITLES[7],
    segments: [
      chapterCard(8),
      {
        id: 'c8-crear',
        text: 'Para compartir tu mercancía, crea un catálogo comercial. Le damos un título y elegimos los productos.',
        run: async (d) => {
          const p = d.page;
          await d.click(p.locator('aside').getByRole('link', { name: 'Catálogos PDF' }), { wait: 600 });
          await d.click(L.btn(p, 'Nuevo catálogo'));
          await d.type(p.getByRole('dialog').getByLabel('Título'), 'Colección Otoño-Invierno', { delay: 40 });
          await d.click(p.getByRole('button', { name: 'Crear y elegir productos' }), { wait: 1200 });
          await d.click(L.btn(p, 'Agregar productos'), { wait: 900 });
          await d.click(p.getByRole('dialog').getByText(/Seleccionar los \d+ resultados/));
          await d.click(p.getByRole('dialog').getByRole('button', { name: /^Agregar \d+/ }), { wait: 1000 });
        },
      },
      {
        id: 'c8-diseno',
        text: 'Puedes ordenar los productos, elegir el diseño y decidir si se muestran los precios. Los costos nunca aparecen.',
        run: async (d) => {
          const p = d.page;
          await d.click(p.getByRole('button', { name: 'Subir' }).nth(1), { wait: 500 });
          await d.click(p.getByRole('button', { name: '3 columnas' }), { wait: 600 });
          await d.click(L.btn(p, 'Guardar'), { wait: 1200 });
        },
      },
      {
        id: 'c8-pdf',
        text: 'Al descargar el PDF obtienes un catálogo con tu logotipo y tus colores, listo para enviar a tus clientes.',
        run: async (d) => {
          const p = d.page;
          const back = p.url();
          await d.moveTo(p.getByRole('button', { name: 'Descargar PDF' }));
          await d.pause(400);
          await d.showPdf(back);
        },
      },
      {
        id: 'c8-enlace',
        text: 'También puedes crear un enlace público para compartirlo por WhatsApp o redes sociales. Puedes desactivarlo cuando quieras.',
        run: async (d) => {
          const p = d.page;
          await d.click(L.btn(p, 'Crear enlace público'), { wait: 1000 });
          const url = await p.locator('input[readonly]').first().inputValue();
          const back = p.url();
          await d.goto(url);
          await d.pause(1500);
          await p.mouse.wheel(0, 500);
          await d.pause(1500);
          await d.goto(back);
        },
      },
    ],
  },
  {
    title: CHAPTER_TITLES[8],
    segments: [
      chapterCard(9),
      {
        id: 'c9-categoria',
        text: 'Para Mercado Libre, cada producto necesita su categoría. En la ficha, pestaña Canales de venta, el botón Sugerir consulta el servicio oficial de Mercado Libre.',
        run: async (d) => {
          const p = d.page;
          await d.goto(`/b/${d.bid}/productos/${d.pijama}`);
          await d.click(p.getByRole('button', { name: 'Canales de venta' }), { wait: 500 });
          await d.click(L.btn(p, 'Sugerir'), { wait: 1500 });
          await d.click(p.locator('button').filter({ hasText: /MLM\d+/ }).first(), { wait: 1800 });
        },
      },
      {
        id: 'c9-atributos',
        text: 'Aparecen los datos que esa categoría exige. Los que ya están en la ficha, como marca, color o talla, se toman solos. Completamos el resto y guardamos.',
        run: async (d) => {
          const p = d.page;
          const section = p.locator('section').filter({ hasText: 'Buscar categoría' });
          const selects = section.locator('select');
          const n = await selects.count();
          for (let i = 0; i < n; i++) {
            const s = selects.nth(i);
            if ((await s.inputValue()) !== '') continue;
            const opts = await s.locator('option').allTextContents();
            const pick = opts.find((o) => ['Mujer', 'Invierno', 'Adultos'].includes(o)) ?? opts[1];
            if (pick) await d.select(s, pick);
          }
          await d.click(L.btn(p, 'Guardar datos de Mercado Libre'), { wait: 1000 });
        },
      },
      {
        id: 'c9-validar',
        text: 'En la sección Mercado Libre elegimos los productos. El sistema los valida contra los requisitos oficiales de cada categoría antes de generar nada.',
        run: async (d) => {
          const p = d.page;
          await d.click(p.locator('aside').getByRole('link', { name: 'Mercado Libre' }), { wait: 800 });
          await d.click(L.btn(p, 'Elegir productos'), { wait: 800 });
          const dlg = p.getByRole('dialog');
          await d.click(dlg.locator('label').filter({ hasText: 'Pijama térmica' }));
          await d.click(dlg.locator('label').filter({ hasText: 'Chamarra acolchada' }));
          await d.click(dlg.getByRole('button', { name: /^Agregar/ }), { wait: 2500 });
        },
      },
      {
        id: 'c9-generar',
        text: 'La pijama está lista. La chamarra todavía no tiene categoría, así que queda fuera del archivo. Generamos el archivo solo con los productos válidos.',
        run: async (d) => {
          const p = d.page;
          await d.zoom(p.locator('main .card').filter({ hasText: 'Pijama térmica' }).last(), 1.25, 1800);
          await d.unzoom();
          await d.click(p.getByRole('button', { name: /^Generar archivo/ }), { wait: 1500 });
        },
      },
      {
        id: 'c9-tiktok',
        text: 'Para TikTok Shop, descarga desde Seller Center la plantilla oficial de tu categoría y súbela aquí. En este video usamos una plantilla de demostración con la misma estructura.',
        run: async (d) => {
          const p = d.page;
          await d.click(p.locator('aside').getByRole('link', { name: 'TikTok Shop' }), { wait: 800 });
          await d.click(p.getByRole('button', { name: /^Plantillas oficiales/ }), { wait: 500 });
          await d.upload(p.locator('input[type=file][accept=".xlsx"]'), path.join(ASSETS, 'plantilla-tiktok-DEMO.xlsx'));
          await p.getByRole('dialog').waitFor();
          await d.pause(600);
        },
      },
      {
        id: 'c9-mapeo',
        text: 'El sistema detecta las columnas obligatorias y propone de qué dato del catálogo se llena cada una. Revisamos el mapeo y lo guardamos.',
        run: async (d) => {
          const p = d.page;
          await d.zoom(p.getByRole('dialog'), 1.2, 2200);
          await d.unzoom();
          await d.click(L.btn(p, 'Guardar mapeo'), { wait: 900 });
        },
      },
    ],
  },
  {
    title: CHAPTER_TITLES[9],
    segments: [
      chapterCard(10),
      {
        id: 'c10-errores',
        text: 'Al validar con la plantilla aparecen los errores, con una explicación exacta. Aquí, la columna Category es obligatoria y no tiene valor.',
        run: async (d) => {
          const p = d.page;
          await d.click(p.getByRole('button', { name: 'Preparar exportación' }), { wait: 500 });
          await d.pickTwo();
          await d.select(p.getByLabel('Formato de salida'), 'Plantilla oficial: plantilla-tiktok-DEMO');
          await d.pause(1800);
          await d.zoom(p.locator('main .card.divide-y').first(), 1.3, 2000);
          await d.unzoom();
        },
      },
      {
        id: 'c10-corregir',
        text: 'Lo corregimos en el mapeo: indicamos que esa columna se llene con la categoría del producto. Y volvemos a validar.',
        run: async (d) => {
          const p = d.page;
          await d.click(p.getByRole('button', { name: /^Plantillas oficiales/ }), { wait: 500 });
          await d.click(p.getByRole('button', { name: 'Editar mapeo' }), { wait: 700 });
          const row = p.getByRole('dialog').locator('tr').filter({ hasText: 'Category*' });
          await d.select(row.locator('select'), 'Categoría interna');
          await d.click(L.btn(p, 'Guardar mapeo'), { wait: 800 });
          await d.click(p.getByRole('button', { name: 'Preparar exportación' }), { wait: 500 });
          await d.pickTwo();
          await d.select(p.getByLabel('Formato de salida'), 'Plantilla oficial: plantilla-tiktok-DEMO');
          await d.pause(1500);
        },
      },
      {
        id: 'c10-listo',
        text: 'La pijama ya está lista. A la chamarra le falta el peso del paquete: se corrige en su ficha. Generamos el archivo con los productos válidos.',
        run: async (d) => {
          const p = d.page;
          await d.zoom(p.locator('main .card.divide-y').first(), 1.25, 1500);
          await d.unzoom();
          await d.click(p.getByRole('button', { name: /^Generar archivo/ }), { wait: 1500 });
          await d.zoom(p.getByText('Archivo generado').first().locator('xpath=ancestor::div[2]'), 1.3, 1500);
          await d.unzoom();
        },
      },
      {
        id: 'c10-fotos',
        text: 'Revisa siempre los avisos. Este indica que las fotos todavía no tienen una dirección pública en internet. Los marketplaces descargan las imágenes desde ahí, así que el sistema debe estar publicado en un servidor antes de subir el archivo.',
        run: async (d) => {
          const p = d.page;
          await d.zoom(p.getByText('Las URLs de las fotos no serán públicas').locator('xpath=ancestor::div[2]'), 1.45, 3000);
          await d.unzoom();
        },
      },
      {
        id: 'c10-recom',
        text: 'Recomendaciones: prueba primero con uno o dos productos, abre el archivo en Excel para revisarlo, y usa el reporte de errores del marketplace. Recuerda que generar el archivo no publica nada: tú lo subes a cada plataforma.',
        run: async (d) => {
          await d.card(
            card(
              'Antes de subir tu archivo',
              'Recomendaciones',
              '',
              `<ol style="grid-template-columns:1fr"><li><span>1</span>Prueba primero con uno o dos productos.</li><li><span>2</span>Abre el archivo en Excel y revísalo.</li><li><span>3</span>Las fotos deben tener una dirección pública.</li><li><span>4</span>Lee el reporte de errores del marketplace.</li><li><span>5</span>Generar el archivo no publica: tú lo subes.</li></ol>`,
            ),
          );
        },
        after: async (d) => d.hideCard(),
      },
      {
        id: 'c10-vincular',
        text: 'Después de publicar, en la pestaña Vincular IDs pegas el SKU y el número de publicación de cada producto. Así sabrás qué está publicado en cada canal.',
        run: async (d) => {
          const p = d.page;
          await d.click(p.getByRole('button', { name: 'Vincular IDs' }), { wait: 600 });
          await d.zoom(p.locator('main section').first(), 1.3, 2000);
          await d.unzoom();
        },
      },
    ],
  },
  {
    title: 'Cierre',
    segments: [
      {
        id: 'cierre-1',
        text: '¡Listo! Ya sabes crear tus negocios, registrar productos uno por uno o de forma masiva, organizar tus fotos y variantes, crear catálogos y preparar tus archivos para Mercado Libre y TikTok Shop.',
        run: async (d) => d.card(card('Resumen', '¡Ya estás listo!', 'Negocios, productos, fotos, variantes, catálogos y exportaciones, en un solo lugar.')),
      },
      {
        id: 'cierre-2',
        text: 'Recuerda hacer respaldos periódicos de tu información. Gracias por ver este tutorial.',
        run: async (d) => {
          await d.card(card('Catálogo Maestro', 'Gracias por ver', 'Haz respaldos periódicos de tu información.'));
          await d.pause(1500);
        },
      },
    ],
  },
];

/** Datos de preparación (fuera de cámara): administrador y un segundo negocio con productos. */
export async function prepare(api) {
  await api.post('/api/auth/setup', ADMIN);
  const fajas = await api.post('/api/businesses', { name: 'Fajas Bella Forma', primaryColor: '#0f766e', description: 'Fajas colombianas y prendas de compresión.' });
  const cat = await api.post(`/api/b/${fajas.id}/categories`, {
    name: 'Fajas',
    fields: [{ key: 'compresion', label: 'Tipo de compresión', type: 'select', options: ['Media', 'Alta'], required: true }],
  });
  for (const [name, color, file, price] of [
    ['Faja reductora postparto', 'Beige', 'faja-beige.jpg', 1099],
    ['Faja moldeadora de uso diario', 'Negro', 'faja-negra.jpg', 899],
  ]) {
    const p = await api.post(`/api/b/${fajas.id}/products`, {
      name,
      categoryId: cat.id,
      price,
      cost: price / 2,
      status: 'active',
      shortDescription: 'Faja de compresión.',
      attributes: { compresion: 'Alta' },
      variants: ['S', 'M', 'L'].map((size) => ({ color, size, stock: 4 })),
    });
    await api.upload(`/api/b/${fajas.id}/media`, [foto(file)], { productId: p.id });
  }
}
