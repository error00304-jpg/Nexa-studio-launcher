import { getJson } from '../http';
import { isValidVersionId } from '../../shared/minecraft';
import type { Rule } from './rules';

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const SHA1 = /^[0-9a-f]{40}$/i;
type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (w: string) => new Error(`Metadatos de Minecraft inválidos (${w}).`);

export interface DownloadInfo { url: string; sha1: string; size: number; path?: string }
export interface Library { name: string; artifact?: DownloadInfo; rules?: Rule[]; needsNatives: boolean }
export type ArgPart = string | { rules?: Rule[]; value: string | string[] };
export interface VersionJson {
  id: string;
  type: string;
  mainClass: string;
  assetIndex: { id: string } & DownloadInfo;
  clientDownload: DownloadInfo;
  libraries: Library[];
  arguments?: { game: ArgPart[]; jvm: ArgPart[] };
  minecraftArguments?: string;
  javaMajor?: number;
  logging?: { argument: string; file: { id: string } & DownloadInfo };
  inheritsFrom?: string;
  jarId?: string; // versión cuyo .jar va en el classpath (la heredada, p. ej. 1.20.1)
}
export type PartialVersion = Omit<VersionJson, 'assetIndex' | 'clientDownload'> & {
  assetIndex?: VersionJson['assetIndex'];
  clientDownload?: VersionJson['clientDownload'];
};
export interface ManifestEntry { id: string; type: string; url: string; sha1: string; releaseTime: string }

function dl(v: unknown, w: string, needPath = false): DownloadInfo {
  if (!isObj(v) || typeof v.url !== 'string' || typeof v.sha1 !== 'string' || !SHA1.test(v.sha1) ||
      typeof v.size !== 'number' || !Number.isInteger(v.size) || v.size < 0) throw bad(w);
  if (needPath && typeof v.path !== 'string') throw bad(w);
  return { url: v.url, sha1: v.sha1.toLowerCase(), size: v.size, ...(typeof v.path === 'string' ? { path: v.path } : {}) };
}
function rulesOf(v: unknown): Rule[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw bad('rules');
  return v as Rule[];
}
function argParts(v: unknown, w: string): ArgPart[] {
  if (!Array.isArray(v)) throw bad(w);
  for (const p of v) {
    if (typeof p === 'string') continue;
    const ok = isObj(p) && (typeof p.value === 'string' || (Array.isArray(p.value) && p.value.every((x) => typeof x === 'string')));
    if (!ok) throw bad(w);
  }
  return v as ArgPart[];
}

function libArtifact(a: unknown, name: string): DownloadInfo {
  // Los archivos que genera el instalador del modloader traen url vacía.
  if (isObj(a) && a.url === '' && typeof a.path === 'string') {
    return {
      url: '',
      sha1: typeof a.sha1 === 'string' && SHA1.test(a.sha1) ? a.sha1.toLowerCase() : '',
      size: typeof a.size === 'number' && Number.isInteger(a.size) && a.size > 0 ? a.size : 0,
      path: a.path
    };
  }
  return dl(a, name, true);
}

export function parseVersionPartial(raw: unknown): PartialVersion {
  if (!isObj(raw)) throw bad('raíz');
  if (!isValidVersionId(raw.id)) throw bad('id');
  if (typeof raw.mainClass !== 'string' || !/^[\w.$]+$/.test(raw.mainClass)) throw bad('mainClass');
  if (typeof raw.type !== 'string') throw bad('type');
  if (!Array.isArray(raw.libraries)) throw bad('libraries');
  if (raw.inheritsFrom !== undefined && !isValidVersionId(raw.inheritsFrom)) throw bad('inheritsFrom');

  let assetIndex: PartialVersion['assetIndex'];
  if (raw.assetIndex !== undefined) {
    const ai = raw.assetIndex;
    if (!isObj(ai) || !isValidVersionId(ai.id)) throw bad('assetIndex');
    assetIndex = { id: ai.id, ...dl(ai, 'assetIndex') };
  }
  const clientDownload = isObj(raw.downloads) && raw.downloads.client !== undefined ? dl(raw.downloads.client, 'client') : undefined;

  const libraries: Library[] = raw.libraries.map((l: unknown) => {
    if (!isObj(l) || typeof l.name !== 'string') throw bad('library');
    const artifact = isObj(l.downloads) && l.downloads.artifact !== undefined ? libArtifact(l.downloads.artifact, l.name) : undefined;
    return { name: l.name, artifact, rules: rulesOf(l.rules), needsNatives: l.natives !== undefined || l.extract !== undefined };
  });

  let logging: VersionJson['logging'];
  const lc = isObj(raw.logging) && isObj(raw.logging.client) ? raw.logging.client : null;
  if (lc) {
    if (typeof lc.argument !== 'string' || !isObj(lc.file) || typeof lc.file.id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(lc.file.id)) throw bad('logging');
    logging = { argument: lc.argument, file: { id: lc.file.id, ...dl(lc.file, 'logging') } };
  }

  return {
    id: raw.id,
    type: raw.type,
    mainClass: raw.mainClass,
    assetIndex,
    clientDownload,
    libraries,
    arguments: isObj(raw.arguments) ? { game: argParts(raw.arguments.game, 'game'), jvm: argParts(raw.arguments.jvm, 'jvm') } : undefined,
    minecraftArguments: typeof raw.minecraftArguments === 'string' ? raw.minecraftArguments : undefined,
    javaMajor: isObj(raw.javaVersion) && typeof raw.javaVersion.majorVersion === 'number' ? raw.javaVersion.majorVersion : undefined,
    logging,
    inheritsFrom: typeof raw.inheritsFrom === 'string' ? raw.inheritsFrom : undefined
  };
}

export function parseVersionJson(raw: unknown): VersionJson {
  const p = parseVersionPartial(raw);
  if (!p.assetIndex || !p.clientDownload) throw bad('assetIndex/downloads');
  return { ...p, assetIndex: p.assetIndex, clientDownload: p.clientDownload };
}

/** group:artifact[:classifier] — la versión no cuenta: la del hijo sustituye a la del padre. */
function libKey(name: string): string {
  const [g, a, , c] = name.split(':');
  return `${g}:${a}:${(c ?? '').split('@')[0]}`;
}

export function mergeVersions(parent: VersionJson, child: PartialVersion): VersionJson {
  const libs = new Map<string, Library>();
  for (const l of [...parent.libraries, ...child.libraries]) libs.set(libKey(l.name), l);
  const hasArgs = parent.arguments || child.arguments;
  return {
    id: child.id,
    type: child.type || parent.type,
    mainClass: child.mainClass,
    assetIndex: child.assetIndex ?? parent.assetIndex,
    clientDownload: child.clientDownload ?? parent.clientDownload,
    libraries: [...libs.values()],
    arguments: hasArgs
      ? {
          game: [...(parent.arguments?.game ?? []), ...(child.arguments?.game ?? [])],
          jvm: [...(parent.arguments?.jvm ?? []), ...(child.arguments?.jvm ?? [])]
        }
      : undefined,
    minecraftArguments: child.minecraftArguments ?? parent.minecraftArguments,
    javaMajor: child.javaMajor ?? parent.javaMajor,
    logging: child.logging ?? parent.logging,
    jarId: parent.jarId ?? parent.id,
    inheritsFrom: undefined
  };
}

export interface AssetObject { name: string; hash: string; size: number }
export function parseAssetIndex(raw: unknown): AssetObject[] {
  if (!isObj(raw) || !isObj(raw.objects)) throw bad('índice de recursos');
  const entries = Object.entries(raw.objects);
  if (entries.length > 200_000) throw bad('demasiados recursos');
  return entries.map(([name, o]) => {
    if (!isObj(o) || typeof o.hash !== 'string' || !SHA1.test(o.hash) || typeof o.size !== 'number' || !Number.isInteger(o.size) || o.size < 0) throw bad('recurso');
    return { name, hash: o.hash.toLowerCase(), size: o.size };
  });
}

let cache: { at: number; list: ManifestEntry[] } | null = null;
export async function listManifest(): Promise<ManifestEntry[]> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.list;
  const r = await getJson(MANIFEST_URL, {}, 8_000_000);
  if (r.status !== 200 || !isObj(r.json) || !Array.isArray(r.json.versions)) {
    throw new Error('No se pudo obtener la lista de versiones de Minecraft.');
  }
  const list: ManifestEntry[] = [];
  for (const e of r.json.versions as unknown[]) {
    if (isObj(e) && isValidVersionId(e.id) && typeof e.type === 'string' && typeof e.url === 'string' &&
        typeof e.sha1 === 'string' && SHA1.test(e.sha1) && typeof e.releaseTime === 'string') {
      list.push({ id: e.id, type: e.type, url: e.url, sha1: e.sha1.toLowerCase(), releaseTime: e.releaseTime });
    }
  }
  cache = { at: Date.now(), list };
  return list;
}
