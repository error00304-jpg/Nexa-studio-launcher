export type McPhase = 'metadatos' | 'cliente' | 'bibliotecas' | 'recursos' | 'modloader' | 'modpack' | 'listo';
export interface McProgress { phase: McPhase; done: number; total: number; label: string }
export interface McVersion { id: string; type: 'release'; releaseTime: string; installed: boolean }
export type McRunState = 'idle' | 'installing' | 'running';
export interface McStatus { state: McRunState; versionId: string | null }
export type McResult = { ok: true } | { ok: false; error: string };

const VERSION_ID = /^[A-Za-z0-9._-]{1,64}$/;
export function isValidVersionId(v: unknown): v is string {
  return typeof v === 'string' && VERSION_ID.test(v);
}

export interface ModpackSummary {
  id: string;
  name: string;
  version: string;
  minecraft: string;
  loader: string;
  fileCount: number;
  totalBytes: number;
  installedVersion: string | null;
  ready: boolean; // instalado y al día respecto al manifiesto cargado
}
export type ModpackLoadResult = { ok: true; summary: ModpackSummary } | { ok: false; error: string };
