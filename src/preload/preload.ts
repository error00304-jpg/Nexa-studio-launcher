import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, IPC_EVENTS, type NexaApi } from '../shared/ipc';

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, v: T) => cb(v);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: NexaApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  saveSettings: (partial) => ipcRenderer.invoke(IPC.settingsSave, partial),
  resetSettings: () => ipcRenderer.invoke(IPC.settingsReset),
  pickDirectory: () => ipcRenderer.invoke(IPC.pickDir),
  openMinecraftDir: () => ipcRenderer.invoke(IPC.openDir),
  getLogs: () => ipcRenderer.invoke(IPC.logsGet),
  getAuthState: () => ipcRenderer.invoke(IPC.authGet),
  login: () => ipcRenderer.invoke(IPC.authLogin),
  cancelLogin: () => ipcRenderer.invoke(IPC.authCancel),
  logout: () => ipcRenderer.invoke(IPC.authLogout),
  onDeviceCode: (cb) => subscribe(IPC_EVENTS.deviceCode, cb),
  listVersions: () => ipcRenderer.invoke(IPC.mcVersions),
  installVersion: (id) => ipcRenderer.invoke(IPC.mcInstall, id),
  playVersion: (id) => ipcRenderer.invoke(IPC.mcPlay, id),
  cancelInstall: () => ipcRenderer.invoke(IPC.mcCancel),
  getMcStatus: () => ipcRenderer.invoke(IPC.mcStatusGet),
  onMcProgress: (cb) => subscribe(IPC_EVENTS.mcProgress, cb),
  onMcStatus: (cb) => subscribe(IPC_EVENTS.mcStatus, cb),
  loadModpack: () => ipcRenderer.invoke(IPC.modpackLoad),
  getModpack: () => ipcRenderer.invoke(IPC.modpackGet),
  installModpack: (repair) => ipcRenderer.invoke(IPC.modpackInstall, repair === true),
  playModpack: () => ipcRenderer.invoke(IPC.modpackPlay),
  getEvents: () => ipcRenderer.invoke(IPC.eventsGet),
  refreshEvents: () => ipcRenderer.invoke(IPC.eventsRefresh),
  installEvent: (id, repair) => ipcRenderer.invoke(IPC.eventsInstall, id, repair === true),
  playEvent: (id) => ipcRenderer.invoke(IPC.eventsPlay, id)
};

contextBridge.exposeInMainWorld('nexa', api);
