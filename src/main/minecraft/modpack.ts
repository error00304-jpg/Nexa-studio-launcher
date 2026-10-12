import fs from 'node:fs/promises';
import path from 'node:path';
import { isValidVersionId, type McProgress } from '../../shared/minecraft';
import { downloadAll, type DlOptions, type FileSpec } from './downloader';
import { validateLoader, type LoaderSpec } from './loaderInstaller';
import { safeJoin } from './paths';

/** Únicas carpetas que un manifiesto puede tocar. Nunca saves/, screenshots/, etc. */
export const MANAGED_DIRS: readonly string[] = ['mods', 'config', 'defaultconfigs', 'resourcepacks', 'shaderpacks', 'kubejs', 'scripts'];
export type FilePolicy = 'enforce' | 'initial'; // enforce: siempre igual al manifiesto; initial: solo si falta

export interface ModpackFile { path: string; url: string; sha256: string; size: number; policy: FilePolicy }
export interface ModpackManifest {
  schema: 1;
  id: string;
  name: string;
  version: string;
  minecraft: string;
  loader: LoaderSpec;
  files: ModpackFile[];
}

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === 'object' && v !== null && !Array.isArray(v);
const fail = (m: string) => new Error(`Manifiesto de modpack inválido: ${m}`);
const SHA256 = /^[0-9a-f]{64}$/i;
const MAX_FILE = 512 * 1024 * 1024;
const MAX_TOTAL = 20 * 1024 ** 3;

export function checkRelPath(p: unknown): string {
  if (typeof p !== 'string' || p.length === 0 || p.length > 200) throw fail('ruta de archivo');
  // eslint-disable-next-line no-control-regex
  if (/[\\:\u0000-\u001f]/.test(p) || p.startsWith('/')) throw fail(`ruta no permitida: ${p}`);
  const segs = p.split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..')) throw fail(`ruta no permitida: ${p}`);
  if (segs.length < 2 || !MANAGED_DIRS.includes(segs[0])) throw fail(`carpeta no permitida: ${p}`);
  if (segs[0] === 'mods' && !p.endsWith('.jar')) throw fail(`en mods/ solo se permiten .jar: ${p}`);
  return p;
}

export function parseModpackManifest(raw: unknown, allowedHosts: readonly string[]): ModpackManifest {
  if (!isObj(raw) || raw.schema !== 1) throw fail('schema debe ser 1');
  if (typeof raw.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,48}$/.test(raw.id)) throw fail('id (minúsculas, números y guiones)');
  if (typeof raw.name !== 'string' || raw.name.length < 1 || raw.name.length > 80) throw fail('name');
  if (typeof raw.version !== 'string' || !/^[0-9A-Za-z._+-]{1,32}$/.test(raw.version)) throw fail('version');
  if (!isValidVersionId(raw.minecraft)) throw fail('minecraft');
  const lo = raw.loader;
  if (!isObj(lo) || typeof lo.type !== 'string' || typeof lo.version !== 'string' || typeof lo.installerSha256 !== 'string') throw fail('loader');
  const loader: LoaderSpec = { type: lo.type as LoaderSpec['type'], version: lo.version, minecraft: raw.minecraft, installerSha256: lo.installerSha256 };
  try { validateLoader(loader); } catch (e) { throw fail((e as Error).message); }

  if (!Array.isArray(raw.files) || raw.files.length === 0 || raw.files.length > 5000) throw fail('files (1 a 5000)');
  if (allowedHosts.length === 0) {
    throw fail('no hay servidores de descarga autorizados. Configura "modpackHosts" en launcher.config.json');
  }
  const seen = new Set<string>();
  let total = 0;
  const files: ModpackFile[] = raw.files.map((f: unknown) => {
    if (!isObj(f)) throw fail('archivo');
    const p = checkRelPath(f.path);
    if (seen.has(p.toLowerCase())) throw fail(`ruta duplicada: ${p}`);
    seen.add(p.toLowerCase());
    if (typeof f.url !== 'string') throw fail(`url de ${p}`);
    let url: URL;
    try { url = new URL(f.url); } catch { throw fail(`url de ${p}`); }
    if (url.protocol !== 'https:') throw fail(`${p}: la URL debe ser HTTPS`);
    if (!allowedHosts.includes(url.hostname)) throw fail(`${p}: servidor no autorizado (${url.hostname})`);
    if (typeof f.sha256 !== 'string' || !SHA256.test(f.sha256)) throw fail(`sha256 de ${p}`);
    if (typeof f.size !== 'number' || !Number.isInteger(f.size) || f.size < 0 || f.size > MAX_FILE) throw fail(`size de ${p}`);
    total += f.size;
    const def: FilePolicy = p.startsWith('mods/') ? 'enforce' : 'initial';
    const policy = f.policy === undefined ? def : f.policy;
    if (policy !== 'enforce' && policy !== 'initial') throw fail(`policy de ${p}`);
    return { path: p, url: f.url, sha256: f.sha256.toLowerCase(), size: f.size, policy };
  });
  if (total > MAX_TOTAL) throw fail('tamaño total excesivo');
  return { schema: 1, id: raw.id, name: raw.name, version: raw.version, minecraft: raw.minecraft, loader, files };
}

export const instanceDir = (minecraftDir: string, packId: string) => safeJoin(minecraftDir, 'instances', packId);

export interface InstanceState { manifestId: string; version: string; files: string[] }

export async function readState(inst: string): Promise<InstanceState | null> {
  try {
    const s = JSON.parse(await fs.readFile(path.join(inst, 'nexa-instance.json'), 'utf8')) as Partial<InstanceState>;
    if (typeof s.manifestId === 'string' && typeof s.version === 'string' && Array.isArray(s.files) && s.files.every((f) => typeof f === 'string')) {
      return { manifestId: s.manifestId, version: s.version, files: s.files };
    }
  } catch { /* sin estado */ }
  return null;
}

async function writeState(inst: string, s: InstanceState): Promise<void> {
  const file = path.join(inst, 'nexa-instance.json');
  await fs.mkdir(inst, { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(s, null, 2));
  await fs.rename(`${file}.tmp`, file);
}

export interface ModpackInstallOptions {
  minecraftDir: string;
  concurrency: number;
  quick: boolean;
  allowedHosts: readonly string[];
  onProgress?: (p: McProgress) => void;
  signal?: AbortSignal;
  download?: DlOptions;
}

/** Descarga solo lo que falta o cambió. Nunca toca carpetas fuera de MANAGED_DIRS ni archivos que no instaló. */
export async function installModpack(m: ModpackManifest, o: ModpackInstallOptions): Promise<void> {
  const inst = instanceDir(o.minecraftDir, m.id);
  const state = await readState(inst);
  const unchanged = state !== null && state.manifestId === m.id && state.version === m.version;
  await fs.mkdir(inst, { recursive: true });

  const specs: FileSpec[] = [];
  for (const f of m.files) {
    const dest = safeJoin(inst, ...f.path.split('/'));
    if (f.policy === 'initial') {
      try { await fs.access(dest); continue; } catch { /* falta: se descarga */ }
    }
    specs.push({ url: f.url, dest, sha256: f.sha256, size: f.size });
  }

  let done = 0;
  const label = `Modpack ${m.name}`;
  o.onProgress?.({ phase: 'modpack', done: 0, total: specs.length, label });
  const dl: DlOptions = { verifyExisting: o.quick && unchanged ? 'size' : 'hash', signal: o.signal, allowedHosts: o.allowedHosts, ...o.download };
  await downloadAll(specs, o.concurrency, dl, () => o.onProgress?.({ phase: 'modpack', done: ++done, total: specs.length, label }));

  // Elimina solo archivos 'enforce' que este launcher instaló antes y que ya no están en el manifiesto.
  const wanted = new Set(m.files.map((f) => f.path));
  for (const p of state?.files ?? []) {
    if (wanted.has(p)) continue;
    const segs = p.split('/');
    if (segs.length < 2 || !MANAGED_DIRS.includes(segs[0])) continue; // estado manipulado: se ignora
    await fs.rm(safeJoin(inst, ...segs), { force: true });
  }

  await writeState(inst, { manifestId: m.id, version: m.version, files: m.files.filter((f) => f.policy === 'enforce').map((f) => f.path) });
}
