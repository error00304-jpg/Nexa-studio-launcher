// Contrato IPC compartido entre main, preload y renderer.
// Toda comunicación debe declararse aquí: lista cerrada de canales.
export const IPC = {
  appInfo: 'app:info'
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  electron: string;
}

export interface NexaApi {
  getAppInfo(): Promise<AppInfo>;
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
