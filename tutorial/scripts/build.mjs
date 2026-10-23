// Construye el video tutorial completo:
//   1) materiales ficticios  2) narración (voz local es-MX)  3) instancia aislada de la app
//   4) grabación real con el navegador  5) pista de audio + subtítulos  6) MP4 final  7) verificación
// Uso: npm run build   (desde la carpeta tutorial/)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';
import { buildAssets } from './assets.mjs';
import { Director, OVERLAY_SCRIPT } from './director.mjs';
import { startInstance, apiClient } from './instance.mjs';
import { CHAPTERS, prepare, speech } from './scenes.mjs';

const TUT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(TUT, 'output');
const NARR = path.join(OUT, 'narracion');
const FRAMES = path.join(OUT, 'cuadros');
const SIZE = { width: 1600, height: 900 };
const FINAL = path.join(OUT, 'tutorial-catalogo-maestro.mp4');
const only = process.argv.includes('--solo-audio');

const log = (...a) => console.log(new Date().toLocaleTimeString('es-MX'), '·', ...a);

function wavInfo(file) {
  const b = fs.readFileSync(file);
  let off = 12;
  let fmt = null;
  while (off < b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { rate: b.readUInt32LE(off + 12), channels: b.readUInt16LE(off + 10), bits: b.readUInt16LE(off + 22) };
    if (id === 'data') return { ...fmt, pcm: b.subarray(off + 8, off + 8 + size) };
    off += 8 + size;
  }
  throw new Error(`WAV inválido: ${file}`);
}

function writeWav(file, pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, pcm]));
}

const srtTime = (t) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, '0')}`;
};

/** Divide un texto en subtítulos de máximo ~2 líneas y reparte el tiempo según la longitud. */
function subtitleChunks(text, start, duration) {
  const parts = text.match(/[^.;:!?]+[.;:!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const chunks = [];
  for (const p of parts) {
    if (p.length <= 90) chunks.push(p);
    else {
      let cur = '';
      for (const w of p.split(' ')) {
        if ((cur + ' ' + w).trim().length > 80 && cur) (chunks.push(cur.trim()), (cur = ''));
        cur += ' ' + w;
      }
      if (cur.trim()) chunks.push(cur.trim());
    }
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  let t = start;
  return chunks.map((c) => {
    const d = (c.length / total) * duration;
    const item = { start: t, end: t + d, text: c.length > 45 ? wrap2(c) : c };
    t += d;
    return item;
  });
}
function wrap2(s) {
  const mid = Math.floor(s.length / 2);
  let i = s.lastIndexOf(' ', mid);
  if (i < 10) i = s.indexOf(' ', mid);
  return i > 0 ? `${s.slice(0, i)}\n${s.slice(i + 1)}` : s;
}

function staticServer(root, port) {
  const types = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.html': 'text/html', '.pdf': 'application/pdf', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    const p = path.normalize(path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] ?? 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}

function ff(args, opts = {}) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-y', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) throw new Error(`ffmpeg falló:\n${r.stderr.slice(-3000)}`);
  return r.stderr;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  log('1/7 Materiales de ejemplo');
  await buildAssets();

  log('2/7 Narración con voz local en español de México');
  const segs = CHAPTERS.flatMap((c) => c.segments);
  fs.mkdirSync(NARR, { recursive: true });
  const list = segs.map((s) => ({ id: s.id, speech: s.speech ?? speech(s.text) }));
  fs.writeFileSync(path.join(NARR, 'segmentos.json'), JSON.stringify(list, null, 2));
  const voice = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(TUT, 'scripts/tts.ps1'), '-Json', path.join(NARR, 'segmentos.json'), '-OutDir', NARR], { encoding: 'utf8' }).trim();
  log('  ', voice);
  const durations = {};
  let rate = 44100;
  for (const s of segs) {
    const w = wavInfo(path.join(NARR, `${s.id}.wav`));
    rate = w.rate;
    durations[s.id] = w.pcm.length / (w.rate * (w.bits / 8) * w.channels);
  }
  const narrTotal = Object.values(durations).reduce((a, b) => a + b, 0);
  log(`   ${segs.length} segmentos, ${Math.round(narrTotal)} s de narración`);
  if (only) return;

  log('3/7 Instancia aislada de la aplicación (datos temporales)');
  const inst = await startInstance();
  const viewer = await staticServer(TUT, 4399);
  let browser;
  try {
    await prepare(apiClient(inst.url));

    log('4/7 Grabando la interfaz real');
    fs.rmSync(FRAMES, { recursive: true, force: true });
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, locale: 'es-MX', acceptDownloads: true });
    await context.addInitScript(OVERLAY_SCRIPT);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(inst.url);
    await page.getByLabel('Correo electrónico').waitFor();
    const cdp = await context.newCDPSession(page);
    const d = new Director({ page, cdp, framesDir: FRAMES, baseUrl: inst.url, durations, size: SIZE, outDir: OUT, viewerUrl: 'http://127.0.0.1:4399' });
    await d.startCapture();
    for (const [ci, ch] of CHAPTERS.entries()) {
      log(`   ${ch.title}`);
      for (const seg of ch.segments) {
        try {
          await d.segment(seg, ci);
        } catch (e) {
          await page.screenshot({ path: path.join(OUT, `error-${seg.id}.png`) });
          throw new Error(`Falló el segmento ${seg.id}: ${e.message}`);
        }
      }
    }
    await d.pause(1200);
    await d.stopCapture();
    const timeline = d.timeline;
    const end = d.endTs - d.origin;
    fs.writeFileSync(path.join(OUT, 'linea-de-tiempo.json'), JSON.stringify({ end, timeline }, null, 2));
    log(`   ${d.frames.length} cuadros capturados, ${Math.round(end)} s de video`);

    log('5/7 Pista de narración y subtítulos');
    const pcm = Buffer.alloc(Math.ceil(end * rate) * 2);
    for (const t of timeline) {
      const w = wavInfo(path.join(NARR, `${t.id}.wav`));
      const at = Math.round(t.start * rate) * 2;
      w.pcm.copy(pcm, at, 0, Math.min(w.pcm.length, pcm.length - at));
    }
    writeWav(path.join(OUT, 'narracion-completa.wav'), pcm, rate);
    const subs = timeline.flatMap((t) => subtitleChunks(t.text, t.start, t.duration));
    fs.writeFileSync(path.join(OUT, 'subtitulos.srt'), subs.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`).join('\n'), 'utf8');
    // Capítulos (para reproductores que los soportan)
    const chapters = CHAPTERS.map((c, i) => ({ title: c.title, start: timeline.find((t) => t.chapter === i)?.start ?? 0 }));
    const meta = [';FFMETADATA1', 'title=Tutorial de Catálogo Maestro', 'language=spa'];
    chapters.forEach((c, i) => meta.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(c.start * 1000)}`, `END=${Math.round((chapters[i + 1]?.start ?? end) * 1000)}`, `title=${c.title}`));
    fs.writeFileSync(path.join(OUT, 'capitulos.txt'), meta.join('\n'), 'utf8');

    log('6/7 Video final (H.264 1920×1080, subtítulos incrustados)');
    const lines = [];
    d.frames.forEach((f, i) => {
      const next = d.frames[i + 1]?.ts ?? d.endTs;
      lines.push(`file '${path.basename(f.file)}'`, `duration ${Math.max(0.001, next - f.ts).toFixed(4)}`);
    });
    lines.push(`file '${path.basename(d.frames[d.frames.length - 1].file)}'`);
    fs.writeFileSync(path.join(FRAMES, 'lista.txt'), lines.join('\n'));
    const style = 'FontName=Segoe UI,FontSize=14,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H38000000,BorderStyle=4,Outline=0,Shadow=0,MarginV=26,Alignment=2';
    ff(
      [
        '-f', 'concat', '-safe', '0', '-i', 'cuadros/lista.txt',
        '-i', 'narracion-completa.wav',
        '-i', 'capitulos.txt', '-map_metadata', '2', '-map_chapters', '2',
        '-map', '0:v', '-map', '1:a',
        '-vf', `scale=1920:1080:flags=lanczos,fps=30,subtitles=subtitulos.srt:force_style='${style}'`,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        '-c:a', 'aac', '-b:a', '160k', '-t', end.toFixed(2),
        path.basename(FINAL),
      ],
      { cwd: OUT },
    );

    log('7/7 Verificación');
    const info = ff(['-i', path.basename(FINAL), '-f', 'null', '-'], { cwd: OUT });
    const dur = info.match(/Duration: ([\d:.]+)/)?.[1];
    for (const [i, t] of [5, end * 0.3, end * 0.6, end - 8].entries()) {
      ff(['-ss', t.toFixed(1), '-i', path.basename(FINAL), '-frames:v', '1', `muestra-${i + 1}.jpg`], { cwd: OUT });
    }
    const guion = [
      '# Guion del tutorial — Catálogo Maestro',
      '',
      'Narración en español latinoamericano (voz local «Microsoft Sabina», es-MX). Tiempos tomados de la grabación real.',
      '',
      ...CHAPTERS.flatMap((c, i) => [
        `## ${i === 0 ? '' : i === CHAPTERS.length - 1 ? '' : `${i}. `}${c.title}`,
        '',
        ...c.segments.map((s) => {
          const t = timeline.find((x) => x.id === s.id);
          return `- **${srtTime(t?.start ?? 0).slice(0, 8)}** — ${s.text}`;
        }),
        '',
      ]),
    ].join('\n');
    fs.writeFileSync(path.join(TUT, 'guion.md'), guion, 'utf8');
    // Los cuadros son intermedios y pesados (cientos de MB): se eliminan salvo que se pida conservarlos
    if (!process.argv.includes('--conservar-cuadros')) fs.rmSync(FRAMES, { recursive: true, force: true });
    log(`Listo: ${FINAL} (duración ${dur}, ${(fs.statSync(FINAL).size / 1048576).toFixed(1)} MB)`);
  } finally {
    await browser?.close().catch(() => {});
    viewer.close();
    await inst.stop();
  }
}

main().catch((e) => {
  console.error('\n[error]', e.message);
  process.exit(1);
});
