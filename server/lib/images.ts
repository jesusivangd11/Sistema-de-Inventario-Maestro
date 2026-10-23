import sharp, { type Metadata } from 'sharp';
import crypto from 'node:crypto';

const ALLOWED = new Set(['jpeg', 'png', 'webp', 'heif', 'avif', 'tiff', 'gif']);

export type ProcessedImage = {
  main: Buffer;
  mainExt: string;
  mime: string;
  thumb: Buffer;
  width: number;
  height: number;
  sha256: string;
  phash: string;
};

/**
 * Valida el contenido real del archivo (no solo la extensión), corrige orientación EXIF,
 * elimina metadatos (GPS, etc.) y genera miniatura + hashes para detectar duplicados.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  let meta: Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new Error('El archivo no es una imagen válida');
  }
  if (!meta.format || !ALLOWED.has(meta.format)) {
    throw new Error(`Formato de imagen no soportado: ${meta.format ?? 'desconocido'}`);
  }
  const sha256 = crypto.createHash('sha256').update(input).digest('hex');
  const base = sharp(input, { failOn: 'error' }).rotate();
  // Se guarda como JPEG (o PNG con transparencia), formatos aceptados por los marketplaces; máx. 2400 px por lado.
  const keepPng = meta.format === 'png' && Boolean(meta.hasAlpha);
  const resized = base.clone().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true });
  const main = keepPng
    ? await resized.png({ compressionLevel: 8 }).toBuffer()
    : await resized.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  const info = await sharp(main).metadata();
  const thumb = await base.clone().resize({ width: 480, height: 480, fit: 'inside' }).webp({ quality: 78 }).toBuffer();
  return {
    main,
    mainExt: keepPng ? '.png' : '.jpg',
    mime: keepPng ? 'image/png' : 'image/jpeg',
    thumb,
    width: info.width ?? 0,
    height: info.height ?? 0,
    sha256,
    phash: await dHash(input),
  };
}

/** Hash de diferencia (dHash) de 64 bits: fotos casi idénticas → distancia de Hamming baja. */
export async function dHash(input: Buffer) {
  const px = await sharp(input).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

export function hamming(a: string, b: string) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}
