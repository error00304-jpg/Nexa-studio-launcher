export type EventStatus = 'proximamente' | 'disponible' | 'mantenimiento' | 'finalizado';

export interface NewsItem { id: string; title: string; body: string; publishedAt: string }

/** Evento tal como lo publica el servicio de metadatos (dentro de un documento firmado). */
export interface NexaEvent {
  id: string;
  name: string;
  description: string;
  status: EventStatus;
  serverAddress: string | null;
  minecraft: string;
  loader: { type: 'forge' | 'neoforge'; version: string };
  modpack: { id: string; version: string; manifestUrl: string; manifestSha256: string };
  banner: { url: string; sha256: string } | null;
  news: NewsItem[];
  publishedAt: string;
  updatedAt: string;
  requirements: { javaMajor?: number; minRamMb?: number; notes?: string };
  access: { opensAt: string | null; closesAt: string | null };
}

export interface EventsPayload {
  schema: 1;
  sequence: number; // creciente: impide volver a una versión antigua de los metadatos
  issuedAt: string;
  expiresAt?: string;
  events: NexaEvent[];
  news: NewsItem[];
}

/** Lo que ve la interfaz: datos del evento + estado real calculado en el launcher. */
export interface EventView {
  id: string;
  name: string;
  description: string;
  effectiveStatus: EventStatus;
  serverAddress: string | null;
  minecraft: string;
  loader: string;
  modpackVersion: string;
  bannerDataUrl: string | null;
  news: NewsItem[];
  publishedAt: string;
  updatedAt: string;
  requirements: NexaEvent['requirements'];
  access: NexaEvent['access'];
  installedVersion: string | null;
  ready: boolean; // instalado y al día
  updateAvailable: boolean;
  blockedReason: string | null; // si no es null, no se puede instalar ni jugar
}

export type EventsResult =
  | { ok: true; events: EventView[]; news: NewsItem[]; offline: boolean; fetchedAt: string | null }
  | { ok: false; error: string };

export const isValidEventId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{1,48}$/.test(v);
