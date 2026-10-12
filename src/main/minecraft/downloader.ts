import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

// Orígenes por defecto: Mojang y los repositorios oficiales de los modloaders.
export const MOJANG_HOSTS: readonly string[] = [
  'piston-meta.mojang.com', 'piston-data.mojang.com', 'launchermeta.mojang.com',
  'launcher.mojang.com', 'libraries.minecraft.net', 'resources.download.minecraft.net',
  'maven.minecraftforge.net', 'maven.neoforged.net'
];

export interface FileSpec { url: string; dest: string; sha1?: string; sha256?: string; size?: number }
export interface DlOptions {
  allowedHosts?: readonly string[];
  fetchImpl?: typeof fetch;
  retries?: number;
  baseDelayMs?: number;
  verifyExisting?: 'hash' | 'size';
  signal?: AbortSignal;
  timeoutMs?: number;
}
const MAX_UNKNOWN_SIZE = 600 * 1024 * 1024;

async function hashFile(file: string, algo: 'sha1' | 'sha256'): Promise<string> {
  const h = createHash(algo);
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest('hex');
}

export async function isValidFile(spec: FileSpec, mode: 'hash' | 'size'): Promise<boolean> {
  try {
    const st = await fs.stat(spec.dest);
    if (!st.isFile()) return false;
    if (spec.size !== undefined && st.size !== spec.size) return false;
    if (mode === 'hash') {
      if (spec.sha1 && (await hashFile(spec.dest, 'sha1')) !== spec.sha1.toLowerCase()) return false;
      if (spec.sha256 && (await hashFile(spec.dest, 'sha256')) !== spec.sha256.toLowerCase()) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Descarga a un .part, verifica tamaño y hashes, y solo entonces reemplaza el destino. */
export async function downloadFile(spec: FileSpec, opts: DlOptions = {}): Promise<'skipped' | 'downloaded'> {
  if (await isValidFile(spec, opts.verifyExisting ?? 'hash')) return 'skipped';
  if (!spec.url) throw new Error(`Falta ${path.basename(spec.dest)}: lo genera el instalador del modloader.`);

  const url = new URL(spec.url);
  const hosts = opts.allowedHosts ?? MOJANG_HOSTS;
  if (url.protocol !== 'https:' || !hosts.includes(url.hostname)) {
    throw new Error(`Origen de descarga no autorizado: ${url.hostname}`);
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const retries = opts.retries ?? 3;
  const part = `${spec.dest}.part`;
  await fs.mkdir(path.dirname(spec.dest), { recursive: true });

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) throw new Error('Descarga cancelada.');
    try {
      const timeout = AbortSignal.timeout(opts.timeoutMs ?? 60_000);
      const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
      const res = await fetchImpl(spec.url, { signal });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const max = spec.size ?? MAX_UNKNOWN_SIZE;
      const h1 = createHash('sha1');
      const h256 = createHash('sha256');
      let bytes = 0;
      const guard = new Transform({
        transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
          bytes += chunk.length;
          if (bytes > max) return cb(new Error('Archivo más grande de lo esperado.'));
          h1.update(chunk);
          h256.update(chunk);
          cb(null, chunk);
        }
      });
      await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), guard, createWriteStream(part));

      if (spec.size !== undefined && bytes !== spec.size) throw new Error('Tamaño incorrecto.');
      if (spec.sha1 && h1.digest('hex') !== spec.sha1.toLowerCase()) throw new Error('Hash SHA-1 incorrecto.');
      if (spec.sha256 && h256.digest('hex') !== spec.sha256.toLowerCase()) throw new Error('Hash SHA-256 incorrecto.');
      await fs.rename(part, spec.dest);
      return 'downloaded';
    } catch (e) {
      lastErr = e;
      await fs.rm(part, { force: true });
      if (opts.signal?.aborted) throw new Error('Descarga cancelada.');
      if (attempt < retries) await new Promise((r) => setTimeout(r, (opts.baseDelayMs ?? 500) * 2 ** attempt));
    }
  }
  throw new Error(`No se pudo descargar ${path.basename(spec.dest)}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

export async function downloadAll(specs: FileSpec[], concurrency: number, opts: DlOptions, onFile?: () => void): Promise<void> {
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed) {
      const i = next++;
      if (i >= specs.length) return;
      try {
        await downloadFile(specs[i], opts);
      } catch (e) {
        failed = true;
        throw e;
      }
      onFile?.();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, specs.length)) }, worker));
}
