import { isTrustedMicrosoftUrl, type AuthProfile, type AuthState, type DeviceCodeInfo, type LoginResult } from '../../shared/auth';
import { getClientId } from '../config';
import { log } from '../logger';
import { clearSession, loadSession, saveSession } from './sessionStore';
import {
  AuthError, fetchProfile, minecraftLogin, pollDeviceToken, refreshTokens, requestDeviceCode, xboxAuth, xstsAuth
} from './microsoft';

let profile: AuthProfile | null = null;
let refreshToken: string | null = null; // también en memoria por si no se puede persistir
let mc: { accessToken: string; expiresAt: number } | null = null;

export async function restoreSession(): Promise<void> {
  const s = await loadSession();
  profile = s?.profile ?? null;
  refreshToken = s?.refreshToken ?? null;
  if (profile) log.info(`Sesión restaurada para ${profile.name}.`);
}

export function getState(): AuthState {
  return { configured: getClientId() !== null, loggedIn: profile !== null, profile };
}

async function completeChain(msAccessToken: string): Promise<AuthProfile> {
  const xbl = await xboxAuth(msAccessToken);
  const xsts = await xstsAuth(xbl.token);
  const login = await minecraftLogin(xsts.uhs, xsts.token);
  const p = await fetchProfile(login.accessToken); // 404 => no posee Minecraft Java
  mc = { accessToken: login.accessToken, expiresAt: Date.now() + login.expiresIn * 1000 };
  return p;
}

function toMessage(e: unknown): string {
  if (e instanceof AuthError) return e.message;
  const name = e instanceof Error ? e.name : '';
  if (name === 'TypeError' || name === 'TimeoutError' || name === 'AbortError') {
    return 'No se pudo conectar con los servidores de Microsoft/Minecraft. Revisa tu conexión.';
  }
  log.error(`Error inesperado de autenticación: ${e instanceof Error ? e.message : String(e)}`);
  return 'Ocurrió un error inesperado al iniciar sesión.';
}

export async function login(onCode: (c: DeviceCodeInfo) => void, signal: AbortSignal): Promise<LoginResult> {
  const clientId = getClientId();
  if (!clientId) {
    return { ok: false, error: 'Falta configurar el Client ID de Microsoft. Consulta docs/MICROSOFT_AUTH.md.' };
  }
  try {
    const dc = await requestDeviceCode(clientId);
    if (!isTrustedMicrosoftUrl(dc.verificationUri)) throw new AuthError('Dirección de verificación no confiable.');
    onCode({ userCode: dc.userCode, verificationUri: dc.verificationUri, expiresInSec: dc.expiresIn });

    const tokens = await pollDeviceToken(clientId, dc, { signal });
    const p = await completeChain(tokens.accessToken);
    profile = p;
    refreshToken = tokens.refreshToken;
    await saveSession({ refreshToken: tokens.refreshToken, profile: p });
    log.info(`Sesión iniciada: ${p.name}.`);
    return { ok: true, state: getState() };
  } catch (e) {
    const msg = toMessage(e);
    log.warn(`Inicio de sesión fallido: ${msg}`);
    return { ok: false, error: msg };
  }
}

/** Para la Fase 4: devuelve un token de Minecraft válido, renovándolo si hace falta. */
export async function getMinecraftSession(): Promise<{ accessToken: string; profile: AuthProfile }> {
  if (!profile || !refreshToken) throw new AuthError('No has iniciado sesión.', 'session_expired');
  if (mc && mc.expiresAt - Date.now() > 60_000) return { accessToken: mc.accessToken, profile };

  const clientId = getClientId();
  if (!clientId) throw new AuthError('Falta configurar el Client ID de Microsoft.');
  try {
    const tokens = await refreshTokens(clientId, refreshToken);
    const p = await completeChain(tokens.accessToken);
    profile = p;
    refreshToken = tokens.refreshToken;
    await saveSession({ refreshToken: tokens.refreshToken, profile: p });
    return { accessToken: mc!.accessToken, profile: p };
  } catch (e) {
    if (e instanceof AuthError && e.code === 'session_expired') await logout();
    throw e;
  }
}

export async function logout(): Promise<AuthState> {
  profile = null;
  refreshToken = null;
  mc = null;
  await clearSession();
  log.info('Sesión cerrada (tokens locales eliminados).');
  return getState();
}
