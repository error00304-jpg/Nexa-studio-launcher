import { useCallback, useEffect, useState } from 'react';
import type { AuthState } from '../shared/auth';
import type { McPhase, McProgress, McStatus, ModpackSummary } from '../shared/minecraft';

const PHASES: Record<McPhase, string> = {
  metadatos: 'Metadatos', cliente: 'Cliente', bibliotecas: 'Bibliotecas', recursos: 'Recursos',
  modloader: 'Modloader', modpack: 'Modpack', listo: 'Listo'
};
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

export function ModpackPanel({ auth }: { auth: AuthState }) {
  const [pack, setPack] = useState<ModpackSummary | null>(null);
  const [status, setStatus] = useState<McStatus>({ state: 'idle', versionId: null });
  const [progress, setProgress] = useState<McProgress | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(() => {
    window.nexa.getModpack().then(setPack).catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    window.nexa.getMcStatus().then(setStatus).catch(() => undefined);
    const offStatus = window.nexa.onMcStatus((s) => { setStatus(s); if (s.state === 'idle') setProgress(null); });
    const offProgress = window.nexa.onMcProgress(setProgress);
    return () => { offStatus(); offProgress(); };
  }, [refresh]);

  const busy = status.state !== 'idle';

  async function load() {
    setMsg(null);
    try {
      const r = await window.nexa.loadModpack();
      if (!r) return;
      if (r.ok) setPack(r.summary);
      else setMsg({ ok: false, text: r.error });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Error' });
    }
  }

  async function run(kind: 'install' | 'repair' | 'play') {
    setMsg(null);
    try {
      const r = kind === 'play' ? await window.nexa.playModpack() : await window.nexa.installModpack(kind === 'repair');
      if (r.ok) setMsg(kind === 'play' ? null : { ok: true, text: 'Modpack listo.' });
      else setMsg({ ok: false, text: r.error });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Error' });
    }
    refresh();
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="card mc-panel">
      <div className="row between">
        <div>
          {pack ? <strong>{pack.name} {pack.version}</strong> : <span className="muted">Ningún manifiesto cargado.</span>}
          {pack && <p className="muted">Minecraft {pack.minecraft} · {pack.loader} · {pack.fileCount} archivos ({mb(pack.totalBytes)})
            {pack.installedVersion ? ` · instalado: ${pack.installedVersion}` : ''}</p>}
        </div>
        <button className="btn" disabled={busy} onClick={load}>Cargar manifiesto…</button>
      </div>

      {busy && progress && (
        <div>
          <div className="progress"><div style={{ width: `${pct}%` }} /></div>
          <p className="muted">{PHASES[progress.phase]}: {progress.done}/{progress.total} ({pct}%) — {progress.label}</p>
        </div>
      )}

      {pack && (
        <div className="row">
          {status.state === 'running' && status.versionId === pack.id ? (
            <button className="play" disabled>EN EJECUCIÓN</button>
          ) : pack.ready ? (
            <button className="play" disabled={busy || !auth.loggedIn} onClick={() => run('play')}>JUGAR</button>
          ) : (
            <button className="play" disabled={busy} onClick={() => run('install')}>{pack.installedVersion ? 'ACTUALIZAR' : 'INSTALAR'}</button>
          )}
          {pack.installedVersion && <button className="btn" disabled={busy} onClick={() => run('repair')}>Verificar / reparar</button>}
          {status.state === 'installing' && <button className="btn" onClick={() => window.nexa.cancelInstall()}>Cancelar</button>}
        </div>
      )}

      {!auth.loggedIn && pack && <p className="muted">Modo invitado: puedes instalar. Para jugar inicia sesión.</p>}
      <p className="muted">Solo pruebas: en la Fase 6 los modpacks vendrán de eventos con manifiesto firmado.</p>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}
    </div>
  );
}
