import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config';

/**
 * Almacenamiento de archivos. Implementación local en disco; la interfaz permite cambiarla
 * por almacenamiento de objetos (S3, R2, GCS) sin tocar el resto del sistema.
 */
export interface StorageDriver {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  stream(key: string): NodeJS.ReadableStream;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
}

class LocalStorage implements StorageDriver {
  constructor(private root: string) {}
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Ruta de archivo inválida');
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, p);
  }
  get(key: string) {
    return fs.readFile(this.resolve(key));
  }
  stream(key: string) {
    return createReadStream(this.resolve(key));
  }
  async exists(key: string) {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
  async remove(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }
}

let driver: StorageDriver | null = null;
export function storage(): StorageDriver {
  if (!driver) driver = new LocalStorage(config.storageDir);
  return driver;
}
export function setStorageRoot(root: string) {
  driver = new LocalStorage(root);
}

/** Las llaves siempre incluyen el negocio: archivos de negocios distintos nunca comparten carpeta. */
export function newKey(businessId: string, kind: string, ext: string) {
  const month = new Date().toISOString().slice(0, 7);
  return `${businessId}/${kind}/${month}/${crypto.randomUUID()}${ext}`;
}
