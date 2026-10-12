// Instala Forge/NeoForge ejecutando su instalador oficial (headless) con hash SHA-256 fijado por el manifiesto.
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import { isValidVersionId } from '../../shared/minecraft';
import { downloadFile, type DlOptions } from './downloader';
import { launchGame } from './gameProcess';
import { pathExists, safeJoin } from './paths';
import { versionJsonPath } from './plan';

export type LoaderType = 'forge' | 'neoforge';
export interface LoaderSpec { type: LoaderType; version: string; minecraft: string; installerSha256: string }

export function validateLoader(l: LoaderSpec): void {
  if (l.type !== 'forge' && l.type !== 'neoforge') throw new Error('Modloader no soportado.');
  if (!/^[0-9A-Za-z._-]{1,40}$/.test(l.version)) throw new Error('Versión de modloader inválida.');
  if (!isValidVersionId(l.minecraft)) throw new Error('Versión de Minecraft inválida.');
  if (!/^[0-9a-f]{64}$/i.test(l.installerSha256)) throw new Error('installerSha256 debe ser un SHA-256 hexadecimal de 64 caracteres.');
}

/** Id de la versión que crea el instalador en versions/ */
export function loaderVersionId(l: LoaderSpec): string {
  return l.type === 'forge' ? `${l.minecraft}-forge-${l.version}` : `neoforge-${l.version}`;
}

export function installerUrl(l: LoaderSpec): string {
  return l.type === 'forge'
    ? `https://maven.minecraftforge.net/net/minecraftforge/forge/${l.minecraft}-${l.version}/forge-${l.minecraft}-${l.version}-installer.jar`
    : `https://maven.neoforged.net/releases/net/neoforged/neoforge/${l.version}/neoforge-${l.version}-installer.jar`;
}

export interface LoaderInstallOptions {
  minecraftDir: string;
  javaPath: string;
  force: boolean; // true: vuelve a ejecutar el instalador aunque ya exista (reparar)
  signal?: AbortSignal;
  onLine: (line: string) => void;
  download?: DlOptions;
  run?: typeof launchGame; // inyectable en pruebas
}

export async function ensureLoader(l: LoaderSpec, o: LoaderInstallOptions): Promise<string> {
  validateLoader(l);
  const dir = o.minecraftDir;
  const id = loaderVersionId(l);
  if (!o.force && (await pathExists(versionJsonPath(dir, id)))) return id;

  const installer = safeJoin(dir, 'cache', 'installers', `${l.type}-${l.minecraft}-${l.version}-installer.jar`);
  await downloadFile({ url: installerUrl(l), dest: installer, sha256: l.installerSha256 }, { ...o.download, verifyExisting: 'hash', signal: o.signal });

  // El instalador exige un launcher_profiles.json en la carpeta destino.
  const profiles = safeJoin(dir, 'launcher_profiles.json');
  if (!(await pathExists(profiles))) await fs.writeFile(profiles, JSON.stringify({ profiles: {}, version: 3 }));

  const run = o.run ?? launchGame;
  await new Promise<void>((resolve, reject) => {
    const child: ChildProcess = run(
      { command: o.javaPath, args: ['-jar', installer, '--installClient', dir] },
      dir,
      {
        onLine: o.onLine,
        onExit: (code) => (code === 0 ? resolve() : reject(new Error(`El instalador de ${l.type} terminó con error (código ${code}). Revisa el registro.`))),
        onError: reject
      }
    );
    o.signal?.addEventListener('abort', () => { child.kill(); reject(new Error('Instalación cancelada.')); }, { once: true });
  });

  if (!(await pathExists(versionJsonPath(dir, id)))) {
    throw new Error(`El instalador terminó pero no creó la versión ${id}. Revisa el registro y la versión indicada.`);
  }
  return id;
}
