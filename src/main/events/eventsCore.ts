// Lógica pura (sin Electron) del sistema de eventos: firma, validación y reglas de disponibilidad.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { isValidVersionId } from '../../shared/minecraft';
import type { EventStatus, EventsPayload, NewsItem, NexaEvent } from '../../shared/events';
import type { ModpackManifest } from '../minecraft/modpack';

export class EventsError extends Error {}
const bad = (m: string) => new EventsError(`Metadatos de eventos inválidos: ${m}`);
type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === 'object' && v !== null && !Array.isArray(v);

export const sha256Hex = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

/** Verifica el sobre {alg, payload(base64), signature(base64)} y devuelve el texto JSON firmado. */
export function verifyEnvelope(envelopeText: string, publicKeyB64: string): string {
  let env: unknown;
  try { env = JSON.parse(envelopeText); } catch { throw new EventsError('El archivo de eventos no es JSON.'); }
  if (!isObj(env) || env.alg !== 'ed25519' || typeof env.payload !== 'string' || typeof env.signature !== 'string') {
    throw new EventsError('Formato de firma desconocido.');
  }
  const payload = Buffer.from(env.payload, 'base64');
  const sig = Buffer.from(env.signature, 'base64');
  if (payload.length === 0 || sig.length !== 64) throw new EventsError('Firma inválida.');
  let ok: boolean;
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' });
    ok = verify(null, payload, key, sig);
  } catch {
    throw new EventsError('La clave pública de firma configurada no es válida.');
  }
  if (!ok) throw new EventsError('La firma de los eventos no es válida: se descartan los datos.');
  return payload.toString('utf8');
}

const isDate = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
function str(v: unknown, w: string, min: number, max: number): string {
  if (typeof v !== 'string' || v.length < min || v.length > max) throw bad(w);
  return v;
}
function urlOk(v: unknown, w: string, hosts: readonly string[]): string {
  const s = str(v, w, 1, 500);
  let u: URL;
  try { u = new URL(s); } catch { throw bad(w); }
  if (u.protocol !== 'https:') throw bad(`${w}: debe ser HTTPS`);
  if (!hosts.includes(u.hostname)) throw bad(`${w}: servidor no autorizado (${u.hostname})`);
  return s;
}
const sha = (v: unknown, w: string): string => {
  if (typeof v !== 'string' || !/^[0-9a-f]{64}$/i.test(v)) throw bad(w);
  return v.toLowerCase();
};
const VERSION = /^[0-9A-Za-z._+-]{1,40}$/;
const ID = /^[a-z0-9][a-z0-9-]{1,48}$/;

function parseNews(v: unknown, w: string, max: number): NewsItem[] {
  if (!Array.isArray(v) || v.length > max) throw bad(w);
  return v.map((n: unknown) => {
    if (!isObj(n)) throw bad(w);
    const id = str(n.id, `${w}.id`, 1, 40);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw bad(`${w}.id`);
    if (!isDate(n.publishedAt)) throw bad(`${w}.publishedAt`);
    return { id, title: str(n.title, `${w}.title`, 1, 120), body: str(n.body, `${w}.body`, 0, 2000), publishedAt: n.publishedAt };
  });
}

function serverAddr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = str(v, 'serverAddress', 1, 260);
  const m = /^([A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?)(?::(\d{1,5}))?$/.exec(s);
  if (!m || (m[3] !== undefined && Number(m[3]) > 65535)) throw bad('serverAddress');
  return s;
}

function parseEvent(e: unknown, hosts: readonly string[]): NexaEvent {
  if (!isObj(e)) throw bad('evento');
  const id = str(e.id, 'id', 2, 49);
  if (!ID.test(id)) throw bad(`id de evento: ${id}`);
  const status = e.status;
  if (status !== 'proximamente' && status !== 'disponible' && status !== 'mantenimiento' && status !== 'finalizado') throw bad(`status de ${id}`);
  if (!isValidVersionId(e.minecraft)) throw bad(`minecraft de ${id}`);
  const lo = e.loader;
  if (!isObj(lo) || (lo.type !== 'forge' && lo.type !== 'neoforge') || typeof lo.version !== 'string' || !VERSION.test(lo.version)) throw bad(`loader de ${id}`);
  const mp = e.modpack;
  if (!isObj(mp) || typeof mp.id !== 'string' || !ID.test(mp.id) || typeof mp.version !== 'string' || !VERSION.test(mp.version)) throw bad(`modpack de ${id}`);
  let banner: NexaEvent['banner'] = null;
  if (e.banner !== null && e.banner !== undefined) {
    if (!isObj(e.banner)) throw bad(`banner de ${id}`);
    banner = { url: urlOk(e.banner.url, `banner de ${id}`, hosts), sha256: sha(e.banner.sha256, `banner.sha256 de ${id}`) };
  }
  const rq = isObj(e.requirements) ? e.requirements : {};
  const requirements: NexaEvent['requirements'] = {};
  if (rq.javaMajor !== undefined) {
    if (typeof rq.javaMajor !== 'number' || !Number.isInteger(rq.javaMajor) || rq.javaMajor < 8 || rq.javaMajor > 30) throw bad(`javaMajor de ${id}`);
    requirements.javaMajor = rq.javaMajor;
  }
  if (rq.minRamMb !== undefined) {
    if (typeof rq.minRamMb !== 'number' || !Number.isInteger(rq.minRamMb) || rq.minRamMb < 512 || rq.minRamMb > 65536) throw bad(`minRamMb de ${id}`);
    requirements.minRamMb = rq.minRamMb;
  }
  if (rq.notes !== undefined) requirements.notes = str(rq.notes, `notes de ${id}`, 0, 300);

  const ac = isObj(e.access) ? e.access : {};
  const opensAt = ac.opensAt ?? null;
  const closesAt = ac.closesAt ?? null;
  if ((opensAt !== null && !isDate(opensAt)) || (closesAt !== null && !isDate(closesAt))) throw bad(`access de ${id}`);
  if (!isDate(e.publishedAt) || !isDate(e.updatedAt)) throw bad(`fechas de ${id}`);

  return {
    id, name: str(e.name, `name de ${id}`, 1, 80), description: str(e.description, `description de ${id}`, 0, 1000),
    status: status as EventStatus, serverAddress: serverAddr(e.serverAddress), minecraft: e.minecraft,
    loader: { type: lo.type, version: lo.version },
    modpack: { id: mp.id, version: mp.version, manifestUrl: urlOk(mp.manifestUrl, `manifestUrl de ${id}`, hosts), manifestSha256: sha(mp.manifestSha256, `manifestSha256 de ${id}`) },
    banner, news: parseNews(e.news ?? [], `news de ${id}`, 20),
    publishedAt: e.publishedAt, updatedAt: e.updatedAt, requirements,
    access: { opensAt: opensAt as string | null, closesAt: closesAt as string | null }
  };
}

export function parseEventsPayload(text: string, hosts: readonly string[]): EventsPayload {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw bad('JSON'); }
  if (!isObj(raw) || raw.schema !== 1) throw bad('schema');
  if (typeof raw.sequence !== 'number' || !Number.isInteger(raw.sequence) || raw.sequence < 0) throw bad('sequence');
  if (!isDate(raw.issuedAt)) throw bad('issuedAt');
  if (raw.expiresAt !== undefined && !isDate(raw.expiresAt)) throw bad('expiresAt');
  if (!Array.isArray(raw.events) || raw.events.length > 100) throw bad('events');
  const ids = new Set<string>();
  const events = raw.events.map((e: unknown) => {
    const ev = parseEvent(e, hosts);
    if (ids.has(ev.id)) throw bad(`id duplicado: ${ev.id}`);
    ids.add(ev.id);
    return ev;
  });
  return {
    schema: 1, sequence: raw.sequence, issuedAt: raw.issuedAt,
    expiresAt: raw.expiresAt as string | undefined, events, news: parseNews(raw.news ?? [], 'news', 50)
  };
}

/** Protección contra reversión (sequence menor al ya visto) y caducidad. */
export function assertFresh(p: EventsPayload, lastSequence: number, now: Date): void {
  if (p.sequence < lastSequence) throw new EventsError('Los metadatos son más antiguos que los ya vistos: se rechazan (posible reversión).');
  if (p.expiresAt && Date.parse(p.expiresAt) < now.getTime()) throw new EventsError('Los metadatos de eventos han caducado.');
}

export function effectiveStatus(e: NexaEvent, now: Date): EventStatus {
  if (e.status !== 'disponible') return e.status;
  const t = now.getTime();
  if (e.access.opensAt && t < Date.parse(e.access.opensAt)) return 'proximamente';
  if (e.access.closesAt && t > Date.parse(e.access.closesAt)) return 'finalizado';
  return 'disponible';
}

export function blockReason(e: NexaEvent, now: Date): string | null {
  switch (effectiveStatus(e, now)) {
    case 'proximamente': return 'Este evento aún no está disponible.';
    case 'mantenimiento': return 'El evento está en mantenimiento. Inténtalo más tarde.';
    case 'finalizado': return 'El evento ha finalizado.';
    default: return null;
  }
}

/** El manifiesto descargado debe describir exactamente lo que el evento firmado anuncia. */
export function checkManifestMatchesEvent(m: ModpackManifest, e: NexaEvent): void {
  const same =
    m.id === e.modpack.id && m.version === e.modpack.version && m.minecraft === e.minecraft &&
    m.loader.type === e.loader.type && m.loader.version === e.loader.version;
  if (!same) throw new EventsError('El manifiesto del modpack no coincide con los datos firmados del evento.');
}

export function sniffImageType(b: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && Buffer.from(b.subarray(0, 4)).toString('latin1') === 'RIFF' && Buffer.from(b.subarray(8, 12)).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
