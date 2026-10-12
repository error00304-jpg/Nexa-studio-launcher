// Contrato IPC compartido entre main, preload y renderer.
// Toda comunicación debe declararse aquí: lista cerrada de canales.
import type { Settings, SettingsErrors } from './settings';
import type { AuthState, DeviceCodeInfo, LoginResult } from './auth';
import type { EventsResult } from './events';
import type { McProgress, McResult, McStatus, McVersion, ModpackLoadResult, ModpackSummary } from './minecraft';

export const IPC = {
  appInfo: 'app:info',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  settingsReset: 'settings:reset',
  pickDir: 'dialog:pick-dir',
  openDir: 'shell:open-minecraft-dir',
  logsGet: 'logs:get',
  authGet: 'auth:get',
  authLogin: 'auth:login',
  authCancel: 'auth:cancel',
  authLogout: 'auth:logout',
  mcVersions: 'mc:versions',
  mcInstall: 'mc:install',
  mcPlay: 'mc:play',
  mcCancel: 'mc:cancel',
  mcStatusGet: 'mc:status-get',
  modpackLoad: 'modpack:load',
  modpackGet: 'modpack:get',
  modpackInstall: 'modpack:install',
  modpackPlay: 'modpack:play',
  eventsGet: 'events:get',
  eventsRefresh: 'events:refresh',
  eventsInstall: 'events:install',
  eventsPlay: 'events:play'
} as const;

// Eventos main -> renderer
export const IPC_EVENTS = {
  deviceCode: 'auth:device-code',
  mcProgress: 'mc:progress',
  mcStatus: 'mc:status'
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  electron: string;
  dev: boolean; // true en desarrollo: habilita herramientas de prueba
}

export interface LogEntry {
  time: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export type SaveResult =
  | { ok: true; settings: Settings }
  | { ok: false; errors: SettingsErrors };

export interface NexaApi {
  getAppInfo(): Promise<AppInfo>;
  getSettings(): Promise<Settings>;
  saveSettings(partial: Partial<Settings>): Promise<SaveResult>;
  resetSettings(): Promise<Settings>;
  pickDirectory(): Promise<string | null>;
  openMinecraftDir(): Promise<void>;
  getLogs(): Promise<LogEntry[]>;
  getAuthState(): Promise<AuthState>;
  login(): Promise<LoginResult>;
  cancelLogin(): Promise<void>;
  logout(): Promise<AuthState>;
  onDeviceCode(cb: (info: DeviceCodeInfo) => void): () => void;
  listVersions(): Promise<McVersion[]>;
  installVersion(id: string): Promise<McResult>;
  playVersion(id: string): Promise<McResult>;
  cancelInstall(): Promise<void>;
  getMcStatus(): Promise<McStatus>;
  onMcProgress(cb: (p: McProgress) => void): () => void;
  onMcStatus(cb: (s: McStatus) => void): () => void;
  loadModpack(): Promise<ModpackLoadResult | null>;
  getModpack(): Promise<ModpackSummary | null>;
  installModpack(repair: boolean): Promise<McResult>;
  playModpack(): Promise<McResult>;
  getEvents(): Promise<EventsResult | null>;
  refreshEvents(): Promise<EventsResult>;
  installEvent(id: string, repair: boolean): Promise<McResult>;
  playEvent(id: string): Promise<McResult>;
}

const ALLOWED = new Set<string>(Object.values(IPC));
export function isAllowedChannel(channel: unknown): channel is IpcChannel {
  return typeof channel === 'string' && ALLOWED.has(channel);
}

/** Valida que el origen de una petición IPC sea la propia app. */
export function isTrustedOrigin(url: string, devUrl: string | null): boolean {
  if (devUrl && url.startsWith(devUrl)) return true;
  return url.startsWith('file://');
}
