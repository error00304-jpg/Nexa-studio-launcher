import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { EventsPayload, EventsResult, EventView, NexaEvent } from '../../shared/events';
import type { McResult } from '../../shared/minecraft';
import { getMetadataUrl, getModpackHosts, getSigningPublicKey } from '../config';
import { getBytes } from '../http';
import { log } from '../logger';
import { installPack, playPack, setActivePack } from '../minecraft/mcService';
import { loaderVersionId } from '../minecraft/loaderInstaller';
import { instanceDir, parseModpackManifest, readState, type ModpackManifest } from '../minecraft/modpack';
import { pathExists } from '../minecraft/paths';
import { versionJsonPath } from '../minecraft/plan';
import { getSettings } from '../settingsStore';
import { assertFresh, blockReason, checkManifestMatchesEvent, effectiveStatus, parseEventsPayload, sha256Hex, sniffImageType, verifyEnvelope } from './eventsCore';

interface Loaded { payload: EventsPayload; offline: boolean; fetchedAt: string | null }
let current: Loaded | null = null;
const banners = new Map<string, string>(); // sha256 -> data URL (ya verificado)

const userFile = (...p: string[]) => path.join(app.getPath('userData'), ...p);
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Error desconocido.');

async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as T; } catch { return null; }
}
async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(data));
  await fs.rename(`${file}.tmp`, file);
}

const contentHosts = (metadataUrl: string) => [new URL(metadataUrl).hostname, ...getModpackHosts()];

async function loadBanner(e: NexaEvent, hosts: string[]): Promise<string | null> {
  if (!e.banner) return null;
  const cached = banners.get(e.banner.sha256);
  if (cached) return cached;
  try {
    if (!hosts.includes(new URL(e.banner.url).hostname)) return null;
    const bytes = await getBytes(e.banner.url, 1_500_000);
    const mime = sniffImageType(bytes);
    if (!mime || sha256Hex(bytes) !== e.banner.sha256) {
      log.warn(`Banner de ${e.id} rechazado (tipo o hash incorrectos).`);
      return null;
    }
    const url = `data:${mime};base64,${bytes.toString('base64')}`;
    banners.set(e.banner.sha256, url);
    return url;
  } catch (err) {
    log.warn(`No se pudo cargar el banner de ${e.id}: ${msg(err)}`);
    return null;
  }
}

async function buildView(e: NexaEvent, now: Date, bannerDataUrl: string | null): Promise<EventView> {
  const s = await getSettings();
  const st = await readState(instanceDir(s.minecraftDir, e.modpack.id));
  const loaderOk = await pathExists(versionJsonPath(s.minecraftDir, loaderVersionId({ ...e.loader, minecraft: e.minecraft, installerSha256: '0'.repeat(64) })));
  const installedVersion = st && st.manifestId === e.modpack.id ? st.version : null;
  return {
    id: e.id, name: e.name, description: e.description, effectiveStatus: effectiveStatus(e, now),
    serverAddress: e.serverAddress, minecraft: e.minecraft, loader: `${e.loader.type} ${e.loader.version}`,
    modpackVersion: e.modpack.version, bannerDataUrl, news: e.news, publishedAt: e.publishedAt, updatedAt: e.updatedAt,
    requirements: e.requirements, access: e.access, installedVersion,
    ready: installedVersion === e.modpack.version && loaderOk,
    updateAvailable: installedVersion !== null && installedVersion !== e.modpack.version,
    blockedReason: blockReason(e, now)
  };
}

async function toResult(l: Loaded): Promise<EventsResult> {
  const now = new Date();
  const url = getMetadataUrl();
  const hosts = url ? contentHosts(url) : [];
  const events = await Promise.all(l.payload.events.map(async (e) => buildView(e, now, await loadBanner(e, hosts))));
  return { ok: true, events, news: l.payload.news, offline: l.offline, fetchedAt: l.fetchedAt };
}

/** Descarga, verifica la firma y valida los eventos. Sin red usa la última copia verificada. */
export async function refreshEvents(): Promise<EventsResult> {
  const url = getMetadataUrl();
  const key = getSigningPublicKey();
  if (!url || !key) {
    return { ok: false, error: 'Falta configurar "metadataUrl" y "signingPublicKey" en launcher.config.json (ver docs/EVENTOS.md).' };
  }
  const hosts = contentHosts(url);
  const last = (await readJson<{ lastSequence: number }>(userFile('metadata-state.json')))?.lastSequence ?? 0;

  let text: string | null = null;
  try {
    text = (await getBytes(url, 1_000_000)).toString('utf8');
  } catch (e) {
    log.warn(`No se pudo descargar los eventos: ${msg(e)}`);
  }

  try {
    if (text !== null) {
      const payload = parseEventsPayload(verifyEnvelope(text, key), hosts);
      assertFresh(payload, last, new Date());
      const fetchedAt = new Date().toISOString();
      await writeJson(userFile('events-cache.json'), { envelope: text, fetchedAt });
      await writeJson(userFile('metadata-state.json'), { lastSequence: Math.max(last, payload.sequence) });
      current = { payload, offline: false, fetchedAt };
      log.info(`Eventos actualizados (secuencia ${payload.sequence}, ${payload.events.length} eventos).`);
    } else {
      const cache = await readJson<{ envelope: string; fetchedAt: string }>(userFile('events-cache.json'));
      if (!cache) return { ok: false, error: 'Sin conexión y sin datos guardados de eventos.' };
      const payload = parseEventsPayload(verifyEnvelope(cache.envelope, key), hosts);
      assertFresh(payload, last, new Date());
      current = { payload, offline: true, fetchedAt: cache.fetchedAt };
      log.info('Mostrando eventos desde la copia verificada guardada (sin conexión).');
    }
  } catch (e) {
    log.error(`Eventos rechazados: ${msg(e)}`);
    return { ok: false, error: msg(e) };
  }
  return toResult(current);
}

export async function getEventsView(): Promise<EventsResult | null> {
  return current ? toResult(current) : null;
}

async function loadManifest(e: NexaEvent): Promise<ModpackManifest> {
  const sha = e.modpack.manifestSha256;
  const cacheFile = userFile('manifest-cache', `${sha}.json`);
  let bytes: Buffer;
  let downloaded = false;
  try {
    bytes = await getBytes(e.modpack.manifestUrl, 2_000_000);
    downloaded = true;
  } catch (err) {
    log.warn(`No se pudo descargar el manifiesto (${msg(err)}); se busca una copia verificada.`);
    try { bytes = await fs.readFile(cacheFile); } catch { throw new Error('No se pudo descargar el manifiesto del evento y no hay copia local.'); }
  }
  if (sha256Hex(bytes) !== sha) throw new Error('El manifiesto del evento no coincide con el hash firmado: se rechaza.');
  let raw: unknown;
  try { raw = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('El manifiesto del evento no es JSON válido.'); }
  const m = parseModpackManifest(raw, getModpackHosts());
  checkManifestMatchesEvent(m, e);
  if (downloaded) await fs.mkdir(path.dirname(cacheFile), { recursive: true }).then(() => fs.writeFile(cacheFile, bytes));
  return m;
}

async function prepare(eventId: string): Promise<{ error: string } | { manifest: ModpackManifest }> {
  const e = current?.payload.events.find((x) => x.id === eventId);
  if (!e) return { error: 'Evento desconocido. Actualiza la lista de eventos.' };
  const reason = blockReason(e, new Date()); // se aplica aquí, no solo en la interfaz
  if (reason) return { error: reason };
  try {
    return { manifest: await loadManifest(e) };
  } catch (err) {
    log.error(`Manifiesto de ${eventId}: ${msg(err)}`);
    return { error: msg(err) };
  }
}

export async function installEvent(eventId: string, repair: boolean): Promise<McResult> {
  const r = await prepare(eventId);
  if ('error' in r) return { ok: false, error: r.error };
  setActivePack(r.manifest);
  return installPack(repair);
}

export async function playEvent(eventId: string): Promise<McResult> {
  const r = await prepare(eventId);
  if ('error' in r) return { ok: false, error: r.error };
  setActivePack(r.manifest);
  return playPack();
}
