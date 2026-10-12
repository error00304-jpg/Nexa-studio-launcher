// Tipos y funciones puras de autenticación (usables en main, renderer y tests).
export interface AuthProfile {
  name: string;
  uuid: string; // 32 hex sin guiones, tal como lo devuelve Minecraft Services
}

export interface AuthState {
  configured: boolean; // hay Client ID válido
  loggedIn: boolean;
  profile: AuthProfile | null;
}

export interface DeviceCodeInfo {
  userCode: string;
  verificationUri: string;
  expiresInSec: number;
}

export type LoginResult = { ok: true; state: AuthState } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isMicrosoftClientId(v: string): boolean {
  return UUID_RE.test(v);
}

export function isTrustedMicrosoftUrl(u: string): boolean {
  try {
    const url = new URL(u);
    const h = url.hostname;
    return (
      url.protocol === 'https:' &&
      (h === 'microsoft.com' || h.endsWith('.microsoft.com') || h === 'microsoftonline.com' || h.endsWith('.microsoftonline.com'))
    );
  } catch {
    return false;
  }
}

export function buildIdentityToken(uhs: string, xstsToken: string): string {
  return `XBL3.0 x=${uhs};${xstsToken}`;
}

export function xstsErrorMessage(xerr: number | undefined): string {
  switch (xerr) {
    case 2148916233:
      return 'Esta cuenta Microsoft no tiene perfil de Xbox. Crea uno en xbox.com e inténtalo de nuevo.';
    case 2148916235:
      return 'Xbox Live no está disponible en tu país o región.';
    case 2148916236:
    case 2148916237:
      return 'La cuenta requiere verificación de edad de adulto en Xbox.';
    case 2148916238:
      return 'Es una cuenta de menor de edad: un adulto debe añadirla a una familia de Microsoft.';
    default:
      return `Xbox rechazó la autenticación${xerr ? ` (código ${xerr})` : ''}.`;
  }
}
