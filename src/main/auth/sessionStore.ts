// Persistencia cifrada (DPAPI en Windows vía safeStorage). Nunca se guarda texto plano.
import { app, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AuthProfile } from '../../shared/auth';
import { log } from '../logger';

export interface StoredSession {
  refreshToken: string;
  profile: AuthProfile;
}

const file = () => path.join(app.getPath('userData'), 'session.bin');

export async function saveSession(s: StoredSession): Promise<boolean> {
  if (!safeStorage.isEncryptionAvailable()) {
    log.warn('Cifrado del sistema no disponible: la sesión no se guardará en disco.');
    return false;
  }
  const enc = safeStorage.encryptString(JSON.stringify(s));
  const tmp = `${file()}.tmp`;
  await fs.mkdir(path.dirname(file()), { recursive: true });
  await fs.writeFile(tmp, enc);
  await fs.rename(tmp, file());
  return true;
}

export async function loadSession(): Promise<StoredSession | null> {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const data = JSON.parse(safeStorage.decryptString(await fs.readFile(file()))) as Partial<StoredSession>;
    const p = data.profile;
    if (typeof data.refreshToken === 'string' && p && typeof p.name === 'string' && typeof p.uuid === 'string') {
      return { refreshToken: data.refreshToken, profile: { name: p.name, uuid: p.uuid } };
    }
  } catch {
    /* sin sesión o archivo ilegible */
  }
  return null;
}

export async function clearSession(): Promise<void> {
  await fs.rm(file(), { force: true });
}
