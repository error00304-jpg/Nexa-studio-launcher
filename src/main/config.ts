import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { isMicrosoftClientId } from '../shared/auth';

interface LauncherConfig { microsoftClientId?: unknown; modpackHosts?: unknown; metadataUrl?: unknown; signingPublicKey?: unknown }

function readConfig(): LauncherConfig {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'launcher.config.json'), 'utf8')) as LauncherConfig;
  } catch {
    return {};
  }
}

/** Client ID de Microsoft Entra. No es un secreto. Prioridad: variable de entorno > launcher.config.json */
export function getClientId(): string | null {
  const env = process.env.NEXA_MS_CLIENT_ID?.trim();
  if (env && isMicrosoftClientId(env)) return env;
  const id = readConfig().microsoftClientId;
  return typeof id === 'string' && isMicrosoftClientId(id.trim()) ? id.trim() : null;
}

/** Servidores desde los que se permite descargar archivos de modpacks (solo nombres de host). */
export function getModpackHosts(): string[] {
  const fromEnv = (process.env.NEXA_MODPACK_HOSTS ?? '').split(',').map((h) => h.trim());
  const cfg = readConfig().modpackHosts;
  const fromFile = Array.isArray(cfg) ? cfg.filter((h): h is string => typeof h === 'string') : [];
  return [...new Set([...fromEnv, ...fromFile].filter((h) => /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(h)))];
}

/** URL HTTPS completa del archivo firmado de eventos. */
export function getMetadataUrl(): string | null {
  const v = (process.env.NEXA_METADATA_URL ?? '').trim() || readConfig().metadataUrl;
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Clave pública Ed25519 (SPKI DER en base64) con la que se verifican los metadatos. No es secreta. */
export function getSigningPublicKey(): string | null {
  const v = (process.env.NEXA_SIGNING_PUBLIC_KEY ?? '').trim() || readConfig().signingPublicKey;
  return typeof v === 'string' && /^[A-Za-z0-9+/]{40,200}={0,2}$/.test(v) ? v : null;
}
