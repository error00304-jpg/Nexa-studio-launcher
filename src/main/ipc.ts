import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs/promises';
import { IPC, IPC_EVENTS, isTrustedOrigin, type AppInfo } from '../shared/ipc';
import type { LoginResult } from '../shared/auth';
import { isValidVersionId, type ModpackLoadResult } from '../shared/minecraft';
import { isValidEventId } from '../shared/events';
import { getEventsView, installEvent, playEvent, refreshEvents } from './events/eventsService';
import {
  cancel, getModpackSummary, getStatus, install, installPack, listVersions, loadModpackText, play, playPack, setEmitter
} from './minecraft/mcService';
import { getState, login, logout } from './auth/authService';
import { getSettings, resetSettings, saveSettings } from './settingsStore';
import { getLogs, log } from './logger';

function guard(event: IpcMainInvokeEvent, devUrl: string | null): void {
  const url = event.senderFrame?.url ?? '';
  if (!isTrustedOrigin(url, devUrl)) {
    log.error('Petición IPC rechazada: origen no autorizado.');
    throw new Error('Origen IPC no autorizado');
  }
}

let loginAbort: AbortController | null = null;

export function registerIpc(devUrl: string | null): void {
  const broadcast = (channel: string, payload: unknown) =>
    BrowserWindow.getAllWindows().forEach((w) => { if (!w.isDestroyed()) w.webContents.send(channel, payload); });
  setEmitter({
    progress: (p) => broadcast(IPC_EVENTS.mcProgress, p),
    status: (s) => broadcast(IPC_EVENTS.mcStatus, s)
  });

  const handle = <T>(channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => T | Promise<T>) =>
    ipcMain.handle(channel, (event, ...args) => {
      guard(event, devUrl);
      return fn(event, ...args);
    });

  handle(IPC.appInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron ?? '',
    dev: !app.isPackaged || process.env.NEXA_DEV === '1'
  }));

  handle(IPC.settingsGet, () => getSettings());
  handle(IPC.settingsSave, (_e, partial) => saveSettings(partial));
  handle(IPC.settingsReset, () => resetSettings());
  handle(IPC.logsGet, () => getLogs());

  handle(IPC.pickDir, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = { properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });

  handle(IPC.openDir, async () => {
    const { minecraftDir } = await getSettings();
    await fs.mkdir(minecraftDir, { recursive: true });
    const err = await shell.openPath(minecraftDir);
    if (err) throw new Error(err);
  });

  handle(IPC.authGet, () => getState());
  handle(IPC.authLogout, () => logout());
  handle(IPC.authCancel, () => {
    loginAbort?.abort();
  });
  handle(IPC.authLogin, async (event): Promise<LoginResult> => {
    if (loginAbort) return { ok: false, error: 'Ya hay un inicio de sesión en curso.' };
    const ac = new AbortController();
    loginAbort = ac;
    try {
      return await login((info) => {
        if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.deviceCode, info);
        void shell.openExternal(info.verificationUri); // ya validada como https de Microsoft
      }, ac.signal);
    } finally {
      loginAbort = null;
    }
  });

  const versionArg = (id: unknown): string => {
    if (!isValidVersionId(id)) throw new Error('Versión inválida.');
    return id;
  };
  handle(IPC.mcVersions, () => listVersions());
  handle(IPC.mcInstall, (_e, id) => install(versionArg(id)));
  handle(IPC.mcPlay, (_e, id) => play(versionArg(id)));
  handle(IPC.mcCancel, () => { cancel(); });
  handle(IPC.mcStatusGet, () => getStatus());

  // El renderer nunca envía rutas: el archivo se elige con un diálogo del proceso principal.
  handle(IPC.modpackLoad, async (event): Promise<ModpackLoadResult | null> => {
    if (app.isPackaged && process.env.NEXA_DEV !== '1') throw new Error('Solo disponible en desarrollo.');
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = {
      title: 'Cargar manifiesto de modpack',
      filters: [{ name: 'Manifiesto JSON', extensions: ['json'] }],
      properties: ['openFile' as const]
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const file = res.filePaths[0];
    if (res.canceled || !file) return null;
    if ((await fs.stat(file)).size > 2_000_000) return { ok: false, error: 'El manifiesto es demasiado grande.' };
    return loadModpackText(await fs.readFile(file, 'utf8'));
  });
  handle(IPC.modpackGet, () => getModpackSummary());
  handle(IPC.modpackInstall, (_e, repair) => installPack(repair === true));
  handle(IPC.modpackPlay, () => playPack());

  const eventArg = (id: unknown): string => {
    if (!isValidEventId(id)) throw new Error('Evento inválido.');
    return id;
  };
  handle(IPC.eventsGet, () => getEventsView());
  handle(IPC.eventsRefresh, () => refreshEvents());
  handle(IPC.eventsInstall, (_e, id, repair) => installEvent(eventArg(id), repair === true));
  handle(IPC.eventsPlay, (_e, id) => playEvent(eventArg(id)));
}
