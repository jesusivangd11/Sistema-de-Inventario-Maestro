// Genera los materiales ficticios del tutorial: fotos ilustradas de productos, logotipo,
// Excel de ejemplo y una plantilla de DEMOSTRACIÓN con estructura tipo marketplace.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import ExcelJS from 'exceljs';

export const ASSETS = path.resolve(import.meta.dirname, '../assets');
const PHOTOS = path.join(ASSETS, 'fotos');

const garments = {
  pijama: (c, d) => `
    <path d="M330 250 L440 210 Q512 250 584 210 L694 250 L760 400 L680 430 L650 360 L650 560 L374 560 L374 360 L344 430 L264 400 Z" fill="${c}" stroke="${d}" stroke-width="6"/>
    <circle cx="450" cy="330" r="12" fill="#fff" opacity=".7"/><circle cx="560" cy="400" r="10" fill="#fff" opacity=".7"/><circle cx="480" cy="470" r="9" fill="#fff" opacity=".7"/>
    <path d="M384 580 L640 580 L660 860 L540 860 L512 650 L484 860 L364 860 Z" fill="${c}" stroke="${d}" stroke-width="6"/>`,
  chamarra: (c, d) => `
    <path d="M320 260 Q512 170 704 260 L780 520 L700 540 L680 420 L680 820 L344 820 L344 420 L324 540 L244 520 Z" fill="${c}" stroke="${d}" stroke-width="6"/>
    <path d="M440 220 Q512 300 584 220 Q560 160 512 160 Q464 160 440 220Z" fill="${d}" opacity=".5"/>
    <line x1="512" y1="290" x2="512" y2="820" stroke="${d}" stroke-width="6"/>
    ${[380, 460, 540, 620, 700].map((y) => `<line x1="350" y1="${y}" x2="674" y2="${y}" stroke="${d}" stroke-width="3" opacity=".5"/>`).join('')}`,
  leggings: (c, d) => `
    <path d="M380 220 L644 220 L670 880 L556 880 L512 420 L468 880 L354 880 Z" fill="${c}" stroke="${d}" stroke-width="6"/>
    <rect x="380" y="220" width="264" height="40" fill="${d}" opacity=".4"/>`,
  sudadera: (c, d) => `
    <path d="M330 270 L440 230 Q512 290 584 230 L694 270 L780 560 L700 580 L670 440 L670 800 L354 800 L354 440 L324 580 L244 560 Z" fill="${c}" stroke="${d}" stroke-width="6"/>
    <rect x="420" y="560" width="184" height="110" rx="20" fill="${d}" opacity=".35"/>`,
  bufanda: (c, d) => `
    <path d="M300 300 Q512 200 724 300 Q760 360 700 390 Q512 300 324 390 Q264 360 300 300Z" fill="${c}" stroke="${d}" stroke-width="6"/>
    <path d="M580 360 L640 380 L620 820 L540 820 Z" fill="${c}" stroke="${d}" stroke-width="6"/>
    ${[560, 620, 680, 740, 800].map((y) => `<line x1="545" y1="${y}" x2="625" y2="${y}" stroke="${d}" stroke-width="4" opacity=".5"/>`).join('')}`,
  faja: (c, d) => `
    <path d="M370 240 Q512 200 654 240 L680 520 Q620 700 600 820 L424 820 Q404 700 344 520 Z" fill="${c}" stroke="${d}" stroke-width="6"/>
    ${[300, 360, 420, 480, 540].map((y) => `<circle cx="512" cy="${y}" r="7" fill="${d}"/>`).join('')}`,
};

async function photo(file, kind, color, dark, bg, angle = 0) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
    <defs><radialGradient id="g" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${bg}"/></radialGradient></defs>
    <rect width="1024" height="1024" fill="url(#g)"/>
    <ellipse cx="512" cy="900" rx="300" ry="40" fill="#000" opacity=".08"/>
    <g transform="rotate(${angle} 512 512)">${garments[kind](color, dark)}</g>
  </svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toFile(path.join(PHOTOS, file));
}

export async function buildAssets() {
  fs.mkdirSync(PHOTOS, { recursive: true });
  // Fotos referenciadas en el Excel (columna "fotos")
  await photo('chamarra-negra_1.jpg', 'chamarra', '#2b2d42', '#14151f', '#e9ecef');
  await photo('chamarra-negra_2.jpg', 'chamarra', '#2b2d42', '#14151f', '#dee2e6', -6);
  await photo('chamarra-olivo_1.jpg', 'chamarra', '#6b705c', '#3f4234', '#e9ecef');
  await photo('leggings-gris_1.jpg', 'leggings', '#8d99ae', '#4a5568', '#f1f3f5');
  await photo('sudadera-lila_1.jpg', 'sudadera', '#b8a1e3', '#6c5a96', '#f3f0ff');
  await photo('sudadera-lila_2.jpg', 'sudadera', '#b8a1e3', '#6c5a96', '#ede7ff', 5);
  // Fotos sin Excel: se agrupan por nombre
  await photo('bufanda-tejida_1.jpg', 'bufanda', '#e5989b', '#9d5c63', '#fff1f2');
  await photo('bufanda-tejida_2.jpg', 'bufanda', '#e5989b', '#9d5c63', '#ffe4e6', -8);
  // Pijama del producto individual
  await photo('pijama-rosa.jpg', 'pijama', '#f4a6c1', '#b55d80', '#fff0f6');
  await photo('pijama-negra.jpg', 'pijama', '#343a40', '#111418', '#f1f3f5');
  // Fotos del proveedor (capítulo de IA)
  await photo('IMG_2041.jpg', 'sudadera', '#90caf9', '#3c6e9e', '#eef6ff');
  await photo('IMG_2042.jpg', 'leggings', '#ef9a9a', '#a35656', '#fff3f3');
  // Otro negocio (fajas)
  await photo('faja-beige.jpg', 'faja', '#e9c9a7', '#a3825f', '#fbf6f1');
  await photo('faja-negra.jpg', 'faja', '#2d2d2d', '#111', '#f4f4f4');

  // Logotipo
  const logo = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <rect width="512" height="512" rx="110" fill="#be185d"/>
    <circle cx="236" cy="230" r="120" fill="#fff"/><circle cx="290" cy="196" r="108" fill="#be185d"/>
    <text x="256" y="430" font-family="Segoe UI, Arial" font-size="74" font-weight="700" fill="#fff" text-anchor="middle">LUNA</text>
  </svg>`;
  await sharp(Buffer.from(logo)).png().toFile(path.join(ASSETS, 'logo-boutique-luna.png'));

  // Excel de ejemplo: una fila por variante; mismo "grupo" = mismo producto
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Productos');
  ws.addRow(['grupo', 'nombre', 'marca', 'categoria', 'color', 'talla', 'existencias', 'costo', 'precio', 'descripcion corta', 'fotos']);
  const rows = [
    ['CHA-01', 'Chamarra acolchada con capucha', 'Boutique Luna', 'Chamarras', 'Negro', 'M', 4, 420, 899, 'Chamarra acolchada ligera con capucha.', 'chamarra-negra_1.jpg, chamarra-negra_2.jpg'],
    ['CHA-01', 'Chamarra acolchada con capucha', 'Boutique Luna', 'Chamarras', 'Negro', 'G', 3, 420, 899, '', ''],
    ['CHA-01', 'Chamarra acolchada con capucha', 'Boutique Luna', 'Chamarras', 'Verde olivo', 'M', 2, 420, 899, '', 'chamarra-olivo_1.jpg'],
    ['LEG-01', 'Leggings térmicos afelpados', 'Boutique Luna', 'Leggings', 'Gris', 'CH', 6, 110, 249, 'Leggings afelpados por dentro.', 'leggings-gris_1.jpg'],
    ['LEG-01', 'Leggings térmicos afelpados', 'Boutique Luna', 'Leggings', 'Gris', 'M', 5, 110, 249, '', ''],
    ['SUD-01', 'Sudadera oversize lila', 'Boutique Luna', 'Sudaderas', 'Lila', 'Unitalla', 8, 230, 459, 'Sudadera oversize de felpa.', 'sudadera-lila_1.jpg, sudadera-lila_2.jpg'],
  ];
  rows.forEach((r) => ws.addRow(r));
  ws.columns.forEach((c) => (c.width = 20));
  await wb.xlsx.writeFile(path.join(ASSETS, 'lote-ejemplo.xlsx'));

  // Plantilla de DEMOSTRACIÓN (estructura tipo marketplace; NO es una plantilla oficial de TikTok Shop)
  const t = new ExcelJS.Workbook();
  const sh = t.addWorksheet('Template');
  const names = ['Category*', 'Brand', 'Product Name*', 'Product Description*', 'Main Product Image*', 'Product Image 2', 'Seller SKU', 'Retail Price (Local Currency)*', 'Quantity*', 'Variation 1 value', 'Variation 2 value', 'Package Weight(kg)*'];
  sh.getRow(1).values = ['category', 'brand', 'product_name', 'product_description', 'main_image', 'image_2', 'seller_sku', 'price', 'quantity', 'variation_1_value', 'variation_2_value', 'package_weight'];
  sh.getRow(2).values = names;
  sh.getRow(3).values = names.map((n) => (n.endsWith('*') ? 'Mandatory' : 'Optional'));
  sh.getRow(4).values = names.map(() => 'PLANTILLA DE DEMOSTRACIÓN PARA EL TUTORIAL. Descarga la oficial de tu categoría en TikTok Shop Seller Center.');
  await t.xlsx.writeFile(path.join(ASSETS, 'plantilla-tiktok-DEMO.xlsx'));
  return { photos: PHOTOS };
}

if (process.argv[1] === import.meta.filename) buildAssets().then(() => console.log('Materiales listos en', ASSETS));
