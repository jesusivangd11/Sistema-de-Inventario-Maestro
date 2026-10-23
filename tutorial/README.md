# Video tutorial de Catálogo Maestro

Video para enseñar a una persona sin conocimientos técnicos a usar el sistema desde cero, grabado sobre la **aplicación real** con datos ficticios.

| Archivo | Contenido |
|---|---|
| `output/tutorial-catalogo-maestro.mp4` | Video final: H.264 1920×1080, 30 fps, audio AAC, subtítulos incrustados, capítulos en los metadatos. |
| `output/subtitulos.srt` | Subtítulos en archivo aparte (para YouTube u otros reproductores). |
| `output/narracion-completa.wav` | Pista de narración completa. |
| `output/narracion/*.wav` | Narración por segmento. |
| `output/catalogo-ejemplo.pdf` | El PDF real que generó la aplicación durante la grabación. |
| `output/linea-de-tiempo.json` | Tiempos reales de cada segmento en el video. |
| `guion.md` | Guion con los tiempos de cada frase. |
| `scripts/scenes.mjs` | Guion fuente: texto narrado + acciones en la aplicación de cada segmento. |
| `scripts/build.mjs` | Orquestador de todo el proceso. |
| `assets/` | Materiales ficticios: fotos ilustradas, logotipo, Excel de ejemplo y plantilla de demostración. |

## Cómo se produce

1. **Materiales:** se generan fotos ilustradas de prendas ficticias, el logotipo «Boutique Luna», un Excel de ejemplo y una plantilla con estructura tipo marketplace (rotulada como DEMOSTRACIÓN).
2. **Narración:** voz local de Windows **Microsoft Sabina (español de México)**; no se usa ningún servicio externo.
3. **Instancia aislada:** se inicia una copia de la aplicación con base de datos y archivos en una carpeta temporal y en otro puerto (4300). Nunca toca los datos reales.
4. **Grabación:** Playwright controla Microsoft Edge (sin ventana) y ejecuta las acciones reales; los cuadros se capturan por el protocolo del navegador en JPEG de alta calidad. Se añaden un cursor visible, acercamientos, tarjetas de capítulo e introducción/cierre como una capa visual que no modifica la aplicación.
5. **Edición:** FFmpeg une los cuadros con su tiempo real, coloca cada narración en su momento, incrusta los subtítulos y escala a 1920×1080.
6. **Verificación:** se decodifica el video completo y se extraen cuadros de muestra.

## Regenerar el video

Requisitos: Windows con la voz «Microsoft Sabina» (Configuración → Hora e idioma → Voz) y Microsoft Edge. Desde esta carpeta:

```bash
npm install          # Playwright, FFmpeg estático y pdf.js, solo para el tutorial
npm run build        # unos 15 minutos; deja el MP4 en output/
```

La aplicación debe estar compilada (`npm run build` en la carpeta raíz). Para cambiar textos o pasos, edita `scripts/scenes.mjs`.

## Notas de honestidad

- **Inteligencia artificial:** en la grabación la IA no estaba activada (no hay `ANTHROPIC_API_KEY` en el entorno), así que el video muestra el aviso real, explica cómo activarla y cómo funciona la revisión de sugerencias. No se simularon resultados de IA.
- **TikTok Shop:** se usa una plantilla de **demostración** con la estructura habitual (claves internas, nombres visibles, «Mandatory/Optional», instrucciones). La narración aclara que la oficial se descarga de Seller Center.
- **Mercado Libre:** la categoría y sus atributos obligatorios se consultaron en vivo en la API pública oficial durante la grabación.
- Todos los negocios, productos, personas y fotos son ficticios.
