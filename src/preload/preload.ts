import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type AppInfo, type NexaApi } from '../shared/ipc';

const api: NexaApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo) as Promise<AppInfo>
};

contextBridge.exposeInMainWorld('nexa', api);
