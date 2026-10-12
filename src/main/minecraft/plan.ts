import type { FileSpec } from './downloader';
import { safeJoin } from './paths';
import { rulesAllow, type RuleContext } from './rules';
import type { VersionJson } from './versionData';

export class UnsupportedError extends Error {}

export const versionJsonPath = (dir: string, id: string) => safeJoin(dir, 'versions', id, `${id}.json`);
export const clientJarPath = (dir: string, id: string) => safeJoin(dir, 'versions', id, `${id}.jar`);

/** Esta fase solo soporta versiones modernas sin extracción de nativos ni herencia. */
export function assertSupported(v: VersionJson, ctx: RuleContext): void {
  if (v.inheritsFrom) throw new UnsupportedError('Las versiones con herencia (modloaders) llegan en la Fase 5.');
  if (!v.arguments) {
    throw new UnsupportedError(`La versión ${v.id} usa el formato antiguo de argumentos; aún no está soportada.`);
  }
  for (const lib of v.libraries) {
    if (lib.needsNatives && rulesAllow(lib.rules, ctx)) {
      throw new UnsupportedError(`La versión ${v.id} requiere extraer bibliotecas nativas; aún no está soportada.`);
    }
  }
}

export function planLibraries(v: VersionJson, dir: string, ctx: RuleContext): FileSpec[] {
  const seen = new Set<string>();
  const out: FileSpec[] = [];
  for (const lib of v.libraries) {
    if (!rulesAllow(lib.rules, ctx)) continue;
    if (!lib.artifact?.path) throw new UnsupportedError(`La biblioteca ${lib.name} no trae información de descarga.`);
    const dest = safeJoin(dir, 'libraries', lib.artifact.path);
    if (seen.has(dest)) continue;
    seen.add(dest);
    out.push({ url: lib.artifact.url, dest, sha1: lib.artifact.sha1 || undefined, size: lib.artifact.size || undefined });
  }
  return out;
}
