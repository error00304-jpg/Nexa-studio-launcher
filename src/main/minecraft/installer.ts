import fs from 'node:fs/promises';
import { isValidVersionId, type McPhase, type McProgress } from '../../shared/minecraft';
import { downloadAll, downloadFile, type DlOptions, type FileSpec } from './downloader';
import { safeJoin } from './paths';
import { assertSupported, clientJarPath, planLibraries, versionJsonPath } from './plan';
import { currentContext, type RuleContext } from './rules';
import { listManifest, mergeVersions, parseAssetIndex, parseVersionJson, parseVersionPartial, type VersionJson } from './versionData';

export interface InstallOptions {
  versionId: string;
  minecraftDir: string;
  concurrency: number;
  quick: boolean; // true: usa el JSON local y solo comprueba tamaños; false: verifica hashes (reparar)
  onProgress?: (p: McProgress) => void;
  signal?: AbortSignal;
  ctx?: RuleContext;
  download?: DlOptions; // inyectable en pruebas
}
export type FilesOptions = Omit<InstallOptions, 'versionId'>;

async function readLocal(file: string): Promise<VersionJson | null> {
  try {
    return parseVersionJson(JSON.parse(await fs.readFile(file, 'utf8')));
  } catch {
    return null;
  }
}

export async function isInstalled(dir: string, id: string): Promise<boolean> {
  try {
    await fs.access(versionJsonPath(dir, id));
    await fs.access(clientJarPath(dir, id));
    return true;
  } catch {
    return false;
  }
}

export async function listLocalVersions(dir: string): Promise<string[]> {
  try {
    const names = await fs.readdir(safeJoin(dir, 'versions'));
    const ok: string[] = [];
    for (const n of names) if (isValidVersionId(n) && (await isInstalled(dir, n))) ok.push(n);
    return ok;
  } catch {
    return [];
  }
}

/** Lee una versión instalada; si hereda de otra (Forge/NeoForge), la fusiona con su padre vanilla. */
export async function resolveInstalledVersion(dir: string, id: string): Promise<VersionJson> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(versionJsonPath(dir, id), 'utf8'));
    const child = parseVersionPartial(raw);
    if (!child.inheritsFrom) return parseVersionJson(raw);
    const parent = parseVersionJson(JSON.parse(await fs.readFile(versionJsonPath(dir, child.inheritsFrom), 'utf8')));
    return mergeVersions(parent, child);
  } catch (e) {
    throw new Error(`No se pudo leer la versión ${id}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Descarga cliente, bibliotecas y recursos de una versión ya resuelta (vanilla o fusionada). */
export async function downloadVersionFiles(version: VersionJson, o: FilesOptions): Promise<void> {
  const ctx = o.ctx ?? currentContext();
  assertSupported(version, ctx);
  const dir = o.minecraftDir;
  const report = (phase: McPhase, done: number, total: number, label: string) => o.onProgress?.({ phase, done, total, label });
  const dl: DlOptions = { verifyExisting: o.quick ? 'size' : 'hash', signal: o.signal, ...o.download };

  const phase = async (name: McPhase, specs: FileSpec[], label: string) => {
    let done = 0;
    report(name, 0, specs.length, label);
    await downloadAll(specs, o.concurrency, dl, () => report(name, ++done, specs.length, label));
  };

  const jar = clientJarPath(dir, version.jarId ?? version.id);
  await phase('cliente', [{ url: version.clientDownload.url, dest: jar, sha1: version.clientDownload.sha1, size: version.clientDownload.size }], 'Cliente de Minecraft');

  const libs = planLibraries(version, dir, ctx);
  if (version.logging) {
    const f = version.logging.file;
    libs.push({ url: f.url, dest: safeJoin(dir, 'assets', 'log_configs', f.id), sha1: f.sha1, size: f.size });
  }
  await phase('bibliotecas', libs, 'Bibliotecas');

  const idxPath = safeJoin(dir, 'assets', 'indexes', `${version.assetIndex.id}.json`);
  await downloadFile({ url: version.assetIndex.url, dest: idxPath, sha1: version.assetIndex.sha1, size: version.assetIndex.size }, dl);
  const objects = parseAssetIndex(JSON.parse(await fs.readFile(idxPath, 'utf8')));
  const assets: FileSpec[] = objects.map((a) => ({
    url: `https://resources.download.minecraft.net/${a.hash.slice(0, 2)}/${a.hash}`,
    dest: safeJoin(dir, 'assets', 'objects', a.hash.slice(0, 2), a.hash),
    sha1: a.hash,
    size: a.size
  }));
  await phase('recursos', assets, 'Recursos');

  await fs.mkdir(safeJoin(dir, 'versions', version.id, 'natives'), { recursive: true });
}

export async function installVersion(o: InstallOptions): Promise<VersionJson> {
  if (!isValidVersionId(o.versionId)) throw new Error('Identificador de versión inválido.');
  const report = (done: number, label: string) => o.onProgress?.({ phase: 'metadatos', done, total: 1, label });
  const dl: DlOptions = { signal: o.signal, ...o.download };

  report(0, 'Metadatos de la versión');
  const jsonPath = versionJsonPath(o.minecraftDir, o.versionId);
  let version = o.quick ? await readLocal(jsonPath) : null;
  if (!version) {
    const entry = (await listManifest()).find((e) => e.id === o.versionId);
    if (!entry) throw new Error(`La versión ${o.versionId} no existe en el manifiesto oficial.`);
    await downloadFile({ url: entry.url, dest: jsonPath, sha1: entry.sha1 }, { ...dl, verifyExisting: 'hash' });
    version = parseVersionJson(JSON.parse(await fs.readFile(jsonPath, 'utf8')));
  }
  if (version.id !== o.versionId) throw new Error('El manifiesto de la versión no coincide con el id solicitado.');

  await downloadVersionFiles(version, o);
  o.onProgress?.({ phase: 'listo', done: 1, total: 1, label: 'Instalación completa' });
  return version;
}
