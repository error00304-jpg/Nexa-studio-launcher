import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC, isTrustedOrigin, type AppInfo } from '../shared/ipc';

function guard(event: IpcMainInvokeEvent, devUrl: string | null): void {
  const url = event.senderFrame?.url ?? '';
  if (!isTrustedOrigin(url, devUrl)) {
    throw new Error('Origen IPC no autorizado');
  }
}

export function registerIpc(devUrl: string | null): void {
  ipcMain.handle(IPC.appInfo, (event): AppInfo => {
    guard(event, devUrl);
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      electron: process.versions.electron
    };
  });
}
