import { app } from 'electron';
import fs from 'node:fs/promises';
import type { McProgress, McResult, McStatus, McVersion, ModpackLoadResult, ModpackSummary } from '../../shared/minecraft';
import type { Settings } from '../../shared/settings';
import { getMinecraftSession } from '../auth/authService';
import { getModpackHosts } from '../config';
import { log } from '../logger';
import { getSettings } from '../settingsStore';
import { launchGame } from './gameProcess';
import { downloadVersionFiles, installVersion, isInstalled, listLocalVersions, resolveInstalledVersion } from './installer';
import { findJava, type JavaInfo } from './javaDetect';
import { buildLaunch, describeCommand } from './launchArgs';
import { ensureLoader, loaderVersionId } from './loaderInstaller';
import { installModpack, instanceDir, parseModpackManifest, readState, type ModpackManifest } from './modpack';
import { pathExists, safeJoin } from './paths';
import { versionJsonPath } from './plan';
import { currentContext } from './rules';
import { listManifest, type VersionJson } from './versionData';

export interface Emitter { progress(p: McProgress): void; status(s: McStatus): void }
let emit: Emitter = { progress() {}, status() {} };
export const setEmitter = (e: Emitter) => { emit = e; };

let status: McStatus = { state: 'idle', versionId: null };
let abort: AbortController | null = null;
let pack: ModpackManifest | null = null;
export const getStatus = () => status;
export const setActivePack = (m: ModpackManifest) => { pack = m; };
function setStatus(s: McStatus) { status = s; emit.status(s); }
const idle = () => setStatus({ state: 'idle', versionId: null });

let lastSent = 0;
const onProgress = (p: McProgress) => {
  const now = Date.now();
  if (p.done >= p.total || now - lastSent > 120) { lastSent = now; emit.progress(p); }
};
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Error desconocido.');

export async function listVersions(): Promise<McVersion[]> {
  const { minecraftDir } = await getSettings();
  try {
    const releases = (await listManifest()).filter((e) => e.type === 'release');
    return await Promise.all(releases.map(async (e) => ({
      id: e.id, type: 'release' as const, releaseTime: e.releaseTime, installed: await isInstalled(minecraftDir, e.id)
    })));
  } catch (e) {
    log.warn(`Sin lista oficial de versiones (${msg(e)}). Se muestran solo las instaladas.`);
    return (await listLocalVersions(minecraftDir)).map((id) => ({ id, type: 'release' as const, releaseTime: '', installed: true }));
  }
}

export function cancel(): void { abort?.abort(); }

/** Lanza el juego con una versión ya resuelta. Devuelve true si el launcher sigue vigilando el proceso. */
async function startGame(a: {
  version: VersionJson; java: JavaInfo; s: Settings; gameDir: string; statusId: string;
  session: { accessToken: string; profile: { name: string; uuid: string } };
}): Promise<boolean> {
  await fs.mkdir(a.gameDir, { recursive: true });
  const cmd = buildLaunch({
    version: a.version, minecraftDir: a.s.minecraftDir, gameDir: a.gameDir, javaPath: a.java.path, ramMb: a.s.ramMb,
    extraJvmArgs: a.s.jvmArgs, resolution: { width: a.s.resolutionWidth, height: a.s.resolutionHeight },
    session: { name: a.session.profile.name, uuid: a.session.profile.uuid, accessToken: a.session.accessToken },
    launcherName: 'NexaStudios', launcherVersion: app.getVersion(), ctx: currentContext()
  });
  log.info(`Java ${a.java.version} en ${a.java.path}`);
  log.info(`Lanzando: ${describeCommand(cmd)}`); // el registro oculta el token

  launchGame(cmd, a.gameDir, {
    onLine: (l) => log.info(`[MC] ${l}`),
    onExit: (code) => { log.info(`Minecraft terminó (código ${code}).`); idle(); },
    onError: (err) => { log.error(`No se pudo iniciar Java: ${err.message}`); idle(); }
  }, a.s.closeLauncherOnPlay);

  if (a.s.closeLauncherOnPlay) { app.quit(); return false; }
  setStatus({ state: 'running', versionId: a.statusId });
  return true;
}

async function operation(id: string, fn: (s: Settings, signal: AbortSignal) => Promise<boolean | void>): Promise<McResult> {
  if (status.state !== 'idle') return { ok: false, error: 'Hay otra operación en curso.' };
  const s = await getSettings();
  abort = new AbortController();
  setStatus({ state: 'installing', versionId: id });
  let running = false;
  try {
    running = (await fn(s, abort.signal)) === true;
    return { ok: true };
  } catch (e) {
    log.error(`Operación fallida: ${msg(e)}`);
    return { ok: false, error: msg(e) };
  } finally {
    abort = null;
    if (!running) idle();
  }
}

// ---------- Vanilla ----------
export const install = (versionId: string) =>
  operation(versionId, async (s, signal) => {
    log.info(`Instalando/verificando Minecraft ${versionId}…`);
    await installVersion({ versionId, minecraftDir: s.minecraftDir, concurrency: s.maxConcurrentDownloads, quick: false, onProgress, signal });
    log.info(`Minecraft ${versionId} listo.`);
  });

export const play = (versionId: string) =>
  operation(versionId, async (s, signal) => {
    const session = await getMinecraftSession(); // exige sesión real con Minecraft Java
    const version = await installVersion({ versionId, minecraftDir: s.minecraftDir, concurrency: s.maxConcurrentDownloads, quick: true, onProgress, signal });
    const java = await findJava(version.javaMajor ?? 8, s.javaPath);
    return startGame({ version, java, s, session, gameDir: safeJoin(s.minecraftDir, 'instances', `vanilla-${versionId}`), statusId: versionId });
  });

// ---------- Modpack (Forge / NeoForge) ----------
async function summarize(m: ModpackManifest): Promise<ModpackSummary> {
  const s = await getSettings();
  const st = await readState(instanceDir(s.minecraftDir, m.id));
  const loaderOk = await pathExists(versionJsonPath(s.minecraftDir, loaderVersionId(m.loader)));
  return {
    id: m.id, name: m.name, version: m.version, minecraft: m.minecraft, loader: `${m.loader.type} ${m.loader.version}`,
    fileCount: m.files.length, totalBytes: m.files.reduce((n, f) => n + f.size, 0),
    installedVersion: st?.version ?? null,
    ready: st !== null && st.manifestId === m.id && st.version === m.version && loaderOk
  };
}

export async function loadModpackText(text: string): Promise<ModpackLoadResult> {
  try {
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new Error('El archivo no es un JSON válido.'); }
    const m = parseModpackManifest(raw, getModpackHosts());
    pack = m;
    log.info(`Manifiesto cargado: ${m.name} ${m.version} (${m.files.length} archivos).`);
    return { ok: true, summary: await summarize(m) };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
export const getModpackSummary = async (): Promise<ModpackSummary | null> => (pack ? summarize(pack) : null);

async function preparePack(m: ModpackManifest, s: Settings, o: { quick: boolean; repair: boolean; signal: AbortSignal }) {
  const base = { minecraftDir: s.minecraftDir, concurrency: s.maxConcurrentDownloads, onProgress, signal: o.signal };
  const vanilla = await installVersion({ ...base, versionId: m.minecraft, quick: o.quick });
  const java = await findJava(vanilla.javaMajor ?? 8, s.javaPath);

  onProgress({ phase: 'modloader', done: 0, total: 1, label: `Instalando ${m.loader.type}…` });
  const loaderId = await ensureLoader(m.loader, {
    minecraftDir: s.minecraftDir, javaPath: java.path, force: o.repair, signal: o.signal,
    onLine: (l) => log.info(`[${m.loader.type}] ${l}`)
  });
  onProgress({ phase: 'modloader', done: 1, total: 1, label: m.loader.type });

  const version = await resolveInstalledVersion(s.minecraftDir, loaderId);
  await downloadVersionFiles(version, { ...base, quick: o.quick });
  await installModpack(m, { ...base, quick: o.quick, allowedHosts: getModpackHosts() });
  return { version, java };
}

export const installPack = (repair: boolean): Promise<McResult> => {
  const m = pack;
  if (!m) return Promise.resolve({ ok: false, error: 'Primero carga un manifiesto.' });
  return operation(m.id, async (s, signal) => {
    log.info(`${repair ? 'Reparando' : 'Instalando'} ${m.name} ${m.version}…`);
    await preparePack(m, s, { quick: !repair, repair, signal });
    log.info(`${m.name} listo.`);
  });
};

export const playPack = (): Promise<McResult> => {
  const m = pack;
  if (!m) return Promise.resolve({ ok: false, error: 'Primero carga un manifiesto.' });
  return operation(m.id, async (s, signal) => {
    const session = await getMinecraftSession();
    const { version, java } = await preparePack(m, s, { quick: true, repair: false, signal });
    return startGame({ version, java, s, session, gameDir: instanceDir(s.minecraftDir, m.id), statusId: m.id });
  });
};
