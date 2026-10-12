import { app } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaultSettings, validateSettings, type Settings, type SettingsErrors } from '../shared/settings';
import type { SaveResult } from '../shared/ipc';
import { log } from './logger';

let cache: Settings | null = null;

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const defaults = () => defaultSettings(path.join(app.getPath('appData'), '.nexastudios'));

async function writeAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(tmp, data, 'utf8');
  await fs.rename(tmp, file);
}

export async function getSettings(): Promise<Settings> {
  if (cache) return cache;
  const base = defaults();
  try {
    const raw = await fs.readFile(settingsFile(), 'utf8');
    const merged = { ...base, ...(JSON.parse(raw) as object) };
    const res = validateSettings(merged);
    if (res.ok) {
      cache = res.settings;
    } else {
      log.warn('settings.json inválido; se usan valores por defecto.');
      cache = base;
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('No se pudo leer settings.json; se usan valores por defecto.');
    cache = base;
  }
  return cache;
}

export async function saveSettings(partial: unknown): Promise<SaveResult> {
  if (typeof partial !== 'object' || partial === null || Array.isArray(partial)) {
    throw new Error('Datos de ajustes inválidos.');
  }
  const current = await getSettings();
  const known = new Set(Object.keys(current));
  const picked: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(partial)) if (known.has(k)) picked[k] = v;

  const res = validateSettings({ ...current, ...picked });
  if (!res.ok) return res;
  const s = res.settings;

  // Comprobaciones que dependen del sistema
  const errors: SettingsErrors = {};
  if (s.ramMb > Math.floor(os.totalmem() / 1024 / 1024)) {
    errors.ramMb = 'Supera la memoria total del equipo.';
  }
  try {
    await fs.mkdir(s.minecraftDir, { recursive: true });
    await fs.access(s.minecraftDir, fs.constants.W_OK);
  } catch {
    errors.minecraftDir = 'No se puede crear o escribir en esa carpeta.';
  }
  if (s.javaPath) {
    try {
      if (!(await fs.stat(s.javaPath)).isFile()) throw new Error();
    } catch {
      errors.javaPath = 'El archivo de Java no existe.';
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  await writeAtomic(settingsFile(), JSON.stringify(s, null, 2));
  cache = s;
  log.info('Ajustes guardados.');
  return { ok: true, settings: s };
}

export async function resetSettings(): Promise<Settings> {
  cache = defaults();
  await writeAtomic(settingsFile(), JSON.stringify(cache, null, 2));
  log.info('Ajustes restablecidos.');
  return cache;
}
