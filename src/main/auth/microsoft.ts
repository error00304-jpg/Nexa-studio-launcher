// Cadena de autenticación: Microsoft (device code) -> Xbox Live -> XSTS -> Minecraft Services.
// Referencia: https://minecraft.wiki/w/Microsoft_authentication
import { getJson, postForm, postJson } from '../http';
import { buildIdentityToken, xstsErrorMessage, type AuthProfile } from '../../shared/auth';

const AUTH_BASE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPE = 'XboxLive.signin offline_access';

export type AuthErrorCode = 'generic' | 'session_expired' | 'app_not_approved' | 'no_game' | 'cancelled';
export class AuthError extends Error {
  constructor(message: string, readonly code: AuthErrorCode = 'generic') {
    super(message);
    this.name = 'AuthError';
  }
}

type Json = Record<string, unknown>;
const BAD = 'Respuesta inesperada del servidor.';

function asObj(v: unknown): Json {
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as Json;
  throw new AuthError(BAD);
}
function reqStr(o: Json, k: string): string {
  const v = o[k];
  if (typeof v === 'string' && v.length > 0) return v;
  throw new AuthError(BAD);
}
function reqNum(o: Json, k: string): number {
  const v = o[k];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  throw new AuthError(BAD);
}
function extractUhs(o: Json): string {
  const xui = asObj(o.DisplayClaims).xui;
  if (!Array.isArray(xui) || xui.length === 0) throw new AuthError(BAD);
  return reqStr(asObj(xui[0]), 'uhs');
}

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}
export interface MsTokens {
  accessToken: string;
  refreshToken: string;
}

export async function requestDeviceCode(clientId: string): Promise<DeviceCode> {
  const r = await postForm(`${AUTH_BASE}/devicecode`, { client_id: clientId, scope: SCOPE });
  if (r.status !== 200) {
    throw new AuthError('Microsoft no aceptó el Client ID. Revisa el registro de la aplicación en Azure.');
  }
  const o = asObj(r.json);
  return {
    deviceCode: reqStr(o, 'device_code'),
    userCode: reqStr(o, 'user_code'),
    verificationUri: reqStr(o, 'verification_uri'),
    expiresIn: reqNum(o, 'expires_in'),
    interval: typeof o.interval === 'number' && o.interval > 0 ? o.interval : 5
  };
}

function parseTokens(o: Json): MsTokens {
  return { accessToken: reqStr(o, 'access_token'), refreshToken: reqStr(o, 'refresh_token') };
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

export async function pollDeviceToken(
  clientId: string,
  dc: DeviceCode,
  opts: { sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; signal?: AbortSignal } = {}
): Promise<MsTokens> {
  const sleep = opts.sleep ?? defaultSleep;
  let interval = dc.interval;
  const deadline = Date.now() + dc.expiresIn * 1000;
  const cancelled = () => new AuthError('Inicio de sesión cancelado.', 'cancelled');

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw cancelled();
    await sleep(interval * 1000, opts.signal);
    if (opts.signal?.aborted) throw cancelled();

    const r = await postForm(`${AUTH_BASE}/token`, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: clientId,
      device_code: dc.deviceCode
    });
    const o = asObj(r.json);
    if (r.status === 200) return parseTokens(o);
    switch (o.error) {
      case 'authorization_pending':
        continue;
      case 'slow_down':
        interval += 5;
        continue;
      case 'authorization_declined':
        throw new AuthError('Rechazaste el inicio de sesión en Microsoft.');
      case 'expired_token':
      case 'bad_verification_code':
        throw new AuthError('El código expiró. Vuelve a intentarlo.');
      default:
        throw new AuthError('Microsoft rechazó el inicio de sesión.');
    }
  }
  throw new AuthError('El código expiró. Vuelve a intentarlo.');
}

export async function refreshTokens(clientId: string, refreshToken: string): Promise<MsTokens> {
  const r = await postForm(`${AUTH_BASE}/token`, {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
    scope: SCOPE
  });
  if (r.status === 200) return parseTokens(asObj(r.json));
  const err = typeof r.json === 'object' && r.json !== null ? (r.json as Json).error : undefined;
  if (err === 'invalid_grant') throw new AuthError('Tu sesión expiró. Inicia sesión de nuevo.', 'session_expired');
  throw new AuthError('No se pudo renovar la sesión de Microsoft.');
}

export async function xboxAuth(msAccessToken: string): Promise<{ token: string; uhs: string }> {
  const r = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT'
  });
  if (r.status !== 200) throw new AuthError('Falló la autenticación con Xbox Live.');
  const o = asObj(r.json);
  return { token: reqStr(o, 'Token'), uhs: extractUhs(o) };
}

export async function xstsAuth(xblToken: string): Promise<{ token: string; uhs: string }> {
  const r = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT'
  });
  if (r.status === 401) {
    const xerr = typeof r.json === 'object' && r.json !== null ? (r.json as Json).XErr : undefined;
    throw new AuthError(xstsErrorMessage(typeof xerr === 'number' ? xerr : undefined));
  }
  if (r.status !== 200) throw new AuthError('Falló la autorización XSTS de Xbox.');
  const o = asObj(r.json);
  return { token: reqStr(o, 'Token'), uhs: extractUhs(o) };
}

export async function minecraftLogin(uhs: string, xstsToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const r = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: buildIdentityToken(uhs, xstsToken)
  });
  if (r.status === 403) {
    throw new AuthError(
      'Minecraft Services rechazó la aplicación (Invalid app registration): el Client ID aún no está aprobado por Mojang. Consulta docs/MICROSOFT_AUTH.md.',
      'app_not_approved'
    );
  }
  if (r.status !== 200) throw new AuthError('No se pudo iniciar sesión en Minecraft Services.');
  const o = asObj(r.json);
  return { accessToken: reqStr(o, 'access_token'), expiresIn: typeof o.expires_in === 'number' ? o.expires_in : 86400 };
}

export async function fetchProfile(mcAccessToken: string): Promise<AuthProfile> {
  const r = await getJson('https://api.minecraftservices.com/minecraft/profile', {
    Authorization: `Bearer ${mcAccessToken}`
  });
  if (r.status === 404) {
    throw new AuthError('Esta cuenta no tiene Minecraft Java Edition. Compra el juego o revisa con qué cuenta entraste.', 'no_game');
  }
  if (r.status !== 200) throw new AuthError('No se pudo obtener el perfil de Minecraft.');
  const o = asObj(r.json);
  const uuid = reqStr(o, 'id');
  const name = reqStr(o, 'name');
  if (!/^[0-9a-f]{32}$/i.test(uuid) || !/^[A-Za-z0-9_]{1,16}$/.test(name)) throw new AuthError(BAD);
  return { uuid, name };
}
