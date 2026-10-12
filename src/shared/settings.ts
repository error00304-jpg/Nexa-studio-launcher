// Esquema y validación de ajustes. Código puro: se usa en main y en tests.
export interface Settings {
  minecraftDir: string;
  ramMb: number;
  javaPath: string; // '' = detección automática (Fase 4)
  resolutionWidth: number;
  resolutionHeight: number;
  language: 'es';
  jvmArgs: string[];
  maxConcurrentDownloads: number;
  showLogs: boolean;
  closeLauncherOnPlay: boolean;
}

export type SettingsErrors = Partial<Record<keyof Settings, string>>;
export type ValidationResult =
  | { ok: true; settings: Settings }
  | { ok: false; errors: SettingsErrors };

export const LIMITS = {
  ramMb: { min: 1024, max: 32768 },
  width: { min: 640, max: 7680 },
  height: { min: 480, max: 4320 },
  downloads: { min: 1, max: 16 },
  pathMax: 240,
  jvmArgsMax: 20
} as const;

export function defaultSettings(minecraftDir: string): Settings {
  return {
    minecraftDir,
    ramMb: 4096,
    javaPath: '',
    resolutionWidth: 1280,
    resolutionHeight: 720,
    language: 'es',
    jvmArgs: [],
    maxConcurrentDownloads: 4,
    showLogs: true,
    closeLauncherOnPlay: false
  };
}

const ABS_PATH = /^(?:[A-Za-z]:[\\/]|\/)/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f]/;

function checkPath(value: unknown): string | null {
  if (typeof value !== 'string') return 'Debe ser texto.';
  if (value.length > LIMITS.pathMax) return `Máximo ${LIMITS.pathMax} caracteres.`;
  if (CONTROL_CHARS.test(value)) return 'Contiene caracteres no válidos.';
  if (!ABS_PATH.test(value)) return 'Debe ser una ruta absoluta.';
  if (value.split(/[\\/]/).includes('..')) return 'No se permiten segmentos "..".';
  return null;
}

function checkInt(v: unknown, min: number, max: number): string | null {
  if (typeof v !== 'number' || !Number.isInteger(v)) return 'Debe ser un número entero.';
  if (v < min || v > max) return `Debe estar entre ${min} y ${max}.`;
  return null;
}

// Argumentos JVM permitidos. La RAM se configura aparte (ramMb), por eso -Xmx/-Xms no se admiten.
const JVM_ALLOWED = [
  /^-XX:[+-][A-Za-z0-9]+$/,
  /^-XX:[A-Za-z0-9]+=[A-Za-z0-9._-]+$/,
  /^-Dfile\.encoding=[A-Za-z0-9-]+$/
];
// Opciones que ejecutan comandos o cargan archivos externos.
const JVM_DENIED = /^-XX:[+-]?(OnError|OnOutOfMemoryError|Flags|VMOptionsFile|UnlockDiagnosticVMOptions)/i;

export function checkJvmArg(arg: string): boolean {
  return JVM_ALLOWED.some((r) => r.test(arg)) && !JVM_DENIED.test(arg);
}

/** Valida un objeto de ajustes COMPLETO. */
export function validateSettings(input: unknown): ValidationResult {
  const errors: SettingsErrors = {};
  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: { minecraftDir: 'Ajustes inválidos.' } };
  }
  const s = input as Record<string, unknown>;

  const dirErr = checkPath(s.minecraftDir);
  if (dirErr) errors.minecraftDir = dirErr;

  const ramErr = checkInt(s.ramMb, LIMITS.ramMb.min, LIMITS.ramMb.max);
  if (ramErr) errors.ramMb = ramErr;

  if (s.javaPath !== '') {
    const e = checkPath(s.javaPath);
    if (e) errors.javaPath = e;
    else if (!/(?:^|[\\/])javaw?(?:\.exe)?$/i.test(s.javaPath as string))
      errors.javaPath = 'Debe apuntar a java, java.exe o javaw.exe.';
  }

  const wErr = checkInt(s.resolutionWidth, LIMITS.width.min, LIMITS.width.max);
  if (wErr) errors.resolutionWidth = wErr;
  const hErr = checkInt(s.resolutionHeight, LIMITS.height.min, LIMITS.height.max);
  if (hErr) errors.resolutionHeight = hErr;

  if (s.language !== 'es') errors.language = 'Idioma no disponible.';

  if (!Array.isArray(s.jvmArgs) || s.jvmArgs.length > LIMITS.jvmArgsMax) {
    errors.jvmArgs = `Lista inválida (máximo ${LIMITS.jvmArgsMax} argumentos).`;
  } else {
    const bad = s.jvmArgs.find((a) => typeof a !== 'string' || !checkJvmArg(a));
    if (bad !== undefined) errors.jvmArgs = `Argumento no permitido: ${String(bad).slice(0, 60)}`;
  }

  const dlErr = checkInt(s.maxConcurrentDownloads, LIMITS.downloads.min, LIMITS.downloads.max);
  if (dlErr) errors.maxConcurrentDownloads = dlErr;

  if (typeof s.showLogs !== 'boolean') errors.showLogs = 'Valor inválido.';
  if (typeof s.closeLauncherOnPlay !== 'boolean') errors.closeLauncherOnPlay = 'Valor inválido.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, settings: s as unknown as Settings };
}
