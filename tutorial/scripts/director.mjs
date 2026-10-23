// Herramientas de grabación: captura de cuadros por CDP (alta calidad), cursor visible, acercamientos,
// tarjetas de título y sincronización de cada acción con su narración.
import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Capa visual inyectada en la página: solo afecta la presentación del video, no la aplicación. */
export const OVERLAY_SCRIPT = `
(() => {
  if (window.__tut) return;
  const css = \`
    #tut-cursor{position:fixed;left:0;top:0;width:30px;height:30px;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));transition:opacity .2s}
    .tut-ripple{position:fixed;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;border:3px solid #6366f1;z-index:2147483646;pointer-events:none;animation:tutr .55s ease-out forwards}
    @keyframes tutr{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
    #tut-card{position:fixed;inset:0;z-index:2147483640;display:flex;align-items:center;justify-content:center;background:radial-gradient(1200px 700px at 30% 20%,#4f46e5 0%,#312e81 45%,#111827 100%);color:#fff;font-family:Inter,Segoe UI,sans-serif;opacity:0;transition:opacity .6s}
    #tut-card.on{opacity:1}
    #tut-card .box{max-width:1100px;padding:0 60px;transform:translateY(16px);transition:transform .8s}
    #tut-card.on .box{transform:none}
    #tut-card .kicker{font-size:22px;letter-spacing:.18em;text-transform:uppercase;color:#c7d2fe;font-weight:600}
    #tut-card h1{font-size:64px;line-height:1.08;margin:14px 0 18px;font-weight:700}
    #tut-card p{font-size:26px;color:#e0e7ff;margin:0;line-height:1.45}
    #tut-card ol{margin:28px 0 0;padding:0;list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:10px 48px;font-size:22px;color:#e0e7ff}
    #tut-card ol li span{display:inline-block;width:38px;color:#a5b4fc;font-weight:700}
    #tut-card .logo{display:flex;align-items:center;gap:14px;margin-bottom:30px;font-size:24px;font-weight:600}
    #tut-card .logo i{width:46px;height:46px;border-radius:12px;background:#fff;display:inline-flex;align-items:center;justify-content:center}
    #tut-banner{position:fixed;left:28px;bottom:120px;z-index:2147483639;background:rgba(17,24,39,.92);color:#fff;font-family:Inter,Segoe UI,sans-serif;padding:14px 22px;border-radius:14px;font-size:22px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.25);opacity:0;transform:translateY(10px);transition:all .45s;border-left:6px solid #818cf8}
    #tut-banner.on{opacity:1;transform:none}
    #tut-banner small{display:block;font-size:14px;color:#a5b4fc;letter-spacing:.12em;text-transform:uppercase;margin-bottom:2px}
    #root.tut-zoom{transition:transform .8s cubic-bezier(.4,0,.2,1)}
    .tut-hl{position:fixed;z-index:2147483638;border:4px solid #f59e0b;border-radius:12px;pointer-events:none;box-shadow:0 0 0 9999px rgba(15,23,42,.18);transition:all .3s}
  \`;
  const style = document.createElement('style'); style.textContent = css;
  const cursor = document.createElement('div'); cursor.id = 'tut-cursor';
  cursor.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M4 2 L4 20 L9 15.5 L12.5 22 L15.5 20.6 L12 14 L19 14 Z" fill="#111827" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const mount = () => { document.head.appendChild(style); document.body.appendChild(cursor); };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  window.addEventListener('mousemove', (e) => { cursor.style.left = e.clientX + 'px'; cursor.style.top = e.clientY + 'px'; }, true);
  window.addEventListener('mousedown', (e) => { const r = document.createElement('div'); r.className = 'tut-ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 700); }, true);
  window.__tut = {
    card(html) { let c = document.getElementById('tut-card'); if (!c) { c = document.createElement('div'); c.id = 'tut-card'; document.body.appendChild(c); } c.innerHTML = '<div class="box">' + html + '</div>'; requestAnimationFrame(() => requestAnimationFrame(() => c.classList.add('on'))); cursor.style.opacity = 0; },
    hideCard() { const c = document.getElementById('tut-card'); if (c) { c.classList.remove('on'); setTimeout(() => c.remove(), 700); } cursor.style.opacity = 1; },
    banner(kicker, text) { let b = document.getElementById('tut-banner'); if (!b) { b = document.createElement('div'); b.id = 'tut-banner'; document.body.appendChild(b); } b.innerHTML = '<small>' + kicker + '</small>' + text; requestAnimationFrame(() => b.classList.add('on')); clearTimeout(window.__tutB); window.__tutB = setTimeout(() => b.classList.remove('on'), 5200); },
    zoom(x, y, s) { const root = document.getElementById('root'); root.classList.add('tut-zoom'); root.style.transformOrigin = (x + window.scrollX) + 'px ' + (y + window.scrollY) + 'px'; root.style.transform = 'scale(' + s + ')'; cursor.style.opacity = 0; },
    unzoom() { const root = document.getElementById('root'); root.style.transform = 'none'; cursor.style.opacity = 1; },
    highlight(r) { let h = document.querySelector('.tut-hl'); if (!h) { h = document.createElement('div'); h.className = 'tut-hl'; document.body.appendChild(h); } Object.assign(h.style, { left: (r.x - 8) + 'px', top: (r.y - 8) + 'px', width: (r.width + 16) + 'px', height: (r.height + 16) + 'px' }); },
    unhighlight() { document.querySelectorAll('.tut-hl').forEach((h) => h.remove()); },
  };
})();
`;

export class Director {
  constructor({ page, cdp, framesDir, baseUrl, durations, size, outDir, viewerUrl }) {
    Object.assign(this, { page, cdp, framesDir, baseUrl, durations, size, outDir, viewerUrl });
    this.frames = [];
    this.timeline = [];
    this.n = 0;
    this.bid = null;
  }

  async startCapture() {
    fs.mkdirSync(this.framesDir, { recursive: true });
    this.cdp.on('Page.screencastFrame', (f) => {
      const file = path.join(this.framesDir, `f${String(++this.n).padStart(6, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
      this.frames.push({ file, ts: Date.now() / 1000 }); // hora de recepción: mismo reloj que la narración
      this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: this.size.width, maxHeight: this.size.height, everyNthFrame: 1 });
    // El reloj del video arranca con el primer cuadro
    for (let i = 0; i < 100 && !this.frames.length; i++) await sleep(50);
    this.origin = this.frames[0]?.ts ?? Date.now() / 1000;
  }

  async stopCapture() {
    this.endTs = Date.now() / 1000;
    await this.cdp.send('Page.stopScreencast').catch(() => {});
  }

  now() {
    return Date.now() / 1000 - this.origin;
  }

  /** Ejecuta las acciones de un segmento mientras se reproduce su narración; espera a que termine de hablar. */
  async segment(seg, chapter) {
    const dur = this.durations[seg.id];
    if (dur === undefined) throw new Error(`Falta el audio del segmento ${seg.id}`);
    const start = this.now();
    this.timeline.push({ id: seg.id, chapter, text: seg.text, start, duration: dur });
    await seg.run(this);
    const left = start + dur + (seg.tail ?? 0.45) - this.now();
    if (left > 0) await sleep(left * 1000);
    if (seg.after) await seg.after(this);
  }

  /** Muestra el PDF real generado por la app (renderizado con pdf.js en una capa sobre la página) y lo guarda. */
  async showPdf(backUrl) {
    const catalogId = backUrl.split('/').pop();
    const pdfPath = `/api/b/${this.bid}/catalogs/${catalogId}/pdf`;
    const r = await this.page.request.get(this.baseUrl + pdfPath);
    if (!r.ok()) throw new Error(`PDF → ${r.status()}`);
    fs.writeFileSync(path.join(this.outDir, 'catalogo-ejemplo.pdf'), await r.body());
    await this.page.evaluate(
      async ({ viewer, pdfPath }) => {
        const pdfjs = await import(viewer + '/node_modules/pdfjs-dist/build/pdf.min.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = viewer + '/node_modules/pdfjs-dist/build/pdf.worker.min.mjs';
        const data = new Uint8Array(await (await fetch(pdfPath)).arrayBuffer());
        const pdf = await pdfjs.getDocument({ data }).promise;
        const wrap = document.createElement('div');
        wrap.id = 'tut-pdf';
        wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483630;background:linear-gradient(135deg,#e0e7ff,#f8fafc);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;opacity:0;transition:opacity .5s;font-family:Inter,Segoe UI,sans-serif';
        wrap.innerHTML = '<div style="font-size:26px;font-weight:700;color:#312e81">PDF generado por la aplicación</div><div id="tut-pages" style="display:flex;gap:28px"></div>';
        document.body.appendChild(wrap);
        for (let i = 1; i <= Math.min(2, pdf.numPages); i++) {
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: (window.innerHeight - 140) / base.height });
          const c = document.createElement('canvas');
          c.width = vp.width;
          c.height = vp.height;
          c.style.cssText = 'box-shadow:0 20px 50px rgba(30,27,75,.25);border-radius:6px;background:#fff';
          document.getElementById('tut-pages').appendChild(c);
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        }
        requestAnimationFrame(() => (wrap.style.opacity = '1'));
      },
      { viewer: this.viewerUrl, pdfPath },
    );
    await sleep(4200);
    await this.page.evaluate(() => {
      const w = document.getElementById('tut-pdf');
      w.style.opacity = '0';
      setTimeout(() => w.remove(), 600);
    });
    await sleep(700);
  }

  /** Abre el selector de productos y elige la pijama y la chamarra. */
  async pickTwo() {
    const p = this.page;
    await this.click(p.getByRole('button', { name: 'Elegir productos' }).first(), { wait: 800 });
    const dlg = p.getByRole('dialog');
    await this.click(dlg.locator('label').filter({ hasText: 'Pijama térmica' }));
    await this.click(dlg.locator('label').filter({ hasText: 'Chamarra acolchada' }));
    await this.click(dlg.getByRole('button', { name: /^Agregar/ }), { wait: 1500 });
  }

  // ───────── Acciones visibles ─────────

  async goto(p) {
    await this.page.goto(p.startsWith('http') ? p : this.baseUrl + p);
    await this.page.waitForLoadState('networkidle').catch(() => {});
  }

  async moveTo(locator) {
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    const b = await locator.boundingBox();
    if (!b) throw new Error(`Elemento no visible: ${locator}`);
    const x = b.x + Math.min(b.width / 2, 60);
    const y = b.y + b.height / 2;
    await this.page.mouse.move(x, y, { steps: 18 });
    return { x, y, b };
  }

  async click(locator, { wait = 350 } = {}) {
    await locator.waitFor({ state: 'visible', timeout: 15000 });
    const { x, y } = await this.moveTo(locator);
    await sleep(180);
    await this.page.mouse.click(x, y);
    await sleep(wait);
  }

  async type(locator, text, { delay = 45, clear = true } = {}) {
    await this.click(locator, { wait: 120 });
    if (clear) {
      await locator.fill('');
    }
    await this.page.keyboard.type(text, { delay });
    await sleep(200);
  }

  async select(locator, label) {
    await this.moveTo(locator);
    await sleep(250);
    await locator.selectOption({ label });
    await sleep(350);
  }

  async upload(input, files) {
    await input.setInputFiles(files);
    await sleep(400);
  }

  async zoom(locator, scale = 1.6, hold = 0) {
    const b = await locator.boundingBox();
    if (!b) return;
    await this.page.evaluate(([x, y, s]) => window.__tut.zoom(x, y, s), [b.x + b.width / 2, b.y + b.height / 2, scale]);
    await sleep(900 + hold);
  }

  async unzoom() {
    await this.page.evaluate(() => window.__tut.unzoom());
    await sleep(850);
  }

  async highlight(locator) {
    const b = await locator.boundingBox();
    if (b) await this.page.evaluate((r) => window.__tut.highlight(r), b);
  }

  async unhighlight() {
    await this.page.evaluate(() => window.__tut.unhighlight());
  }

  async card(html) {
    await this.page.evaluate((h) => window.__tut.card(h), html);
    await sleep(700);
  }

  async hideCard() {
    await this.page.evaluate(() => window.__tut.hideCard());
    await sleep(700);
  }

  async banner(kicker, text) {
    await this.page.evaluate(([k, t]) => window.__tut.banner(k, t), [kicker, text]);
  }

  async pause(ms) {
    await sleep(ms);
  }

  /** Petición autenticada con la sesión del navegador (preparación fuera de cámara). */
  async api(method, p, data) {
    const r = await this.page.request.fetch(this.baseUrl + p, { method, headers: { 'X-Requested-With': 'catalogo-maestro' }, data });
    if (!r.ok()) throw new Error(`${method} ${p} → ${r.status()} ${await r.text()}`);
    return r.json();
  }

  async apiUpload(p, file, fields = {}) {
    const r = await this.page.request.post(this.baseUrl + p, {
      headers: { 'X-Requested-With': 'catalogo-maestro' },
      multipart: { ...fields, files: { name: path.basename(file), mimeType: 'image/jpeg', buffer: fs.readFileSync(file) } },
    });
    if (!r.ok()) throw new Error(`POST ${p} → ${r.status()} ${await r.text()}`);
    return r.json();
  }
}
