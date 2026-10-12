import { useCallback, useEffect, useState } from 'react';
import type { AuthState } from '../shared/auth';
import type { McPhase, McProgress, McStatus, McVersion } from '../shared/minecraft';

const PHASES: Record<McPhase, string> = {
  metadatos: 'Metadatos', cliente: 'Cliente', bibliotecas: 'Bibliotecas', recursos: 'Recursos', modloader: 'Modloader', modpack: 'Modpack', listo: 'Listo'
};

export function MinecraftPanel({ auth }: { auth: AuthState }) {
  const [versions, setVersions] = useState<McVersion[]>([]);
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState<McStatus>({ state: 'idle', versionId: null });
  const [progress, setProgress] = useState<McProgress | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(() => {
    window.nexa.listVersions()
      .then((v) => {
        setVersions(v);
        setSelected((s) => s || (v.find((x) => x.installed) ?? v[0])?.id || '');
      })
      .catch((e: unknown) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Error' }));
  }, []);

  useEffect(() => {
    refresh();
    window.nexa.getMcStatus().then(setStatus).catch(() => undefined);
    const offStatus = window.nexa.onMcStatus((s) => { setStatus(s); if (s.state === 'idle') setProgress(null); });
    const offProgress = window.nexa.onMcProgress(setProgress);
    return () => { offStatus(); offProgress(); };
  }, [refresh]);

  const busy = status.state !== 'idle';
  const current = versions.find((v) => v.id === selected);

  async function run(kind: 'install' | 'play') {
    setMsg(null);
    try {
      const r = kind === 'install' ? await window.nexa.installVersion(selected) : await window.nexa.playVersion(selected);
      if (r.ok) setMsg(kind === 'install' ? { ok: true, text: 'Instalación verificada.' } : null);
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
        <h3 style={{ margin: 0 }}>Minecraft Vanilla</h3>
        <select value={selected} disabled={busy} onChange={(e) => setSelected(e.target.value)} style={{ width: 'auto' }}>
          {versions.map((v) => <option key={v.id} value={v.id}>{v.id}{v.installed ? ' ✓' : ''}</option>)}
        </select>
      </div>

      {busy && progress && (
        <div>
          <div className="progress"><div style={{ width: `${pct}%` }} /></div>
          <p className="muted">{PHASES[progress.phase]}: {progress.done}/{progress.total} ({pct}%)</p>
        </div>
      )}

      <div className="row">
        {status.state === 'running' ? (
          <button className="play" disabled>EN EJECUCIÓN</button>
        ) : current?.installed ? (
          <button className="play" disabled={busy || !auth.loggedIn} onClick={() => run('play')}>JUGAR</button>
        ) : (
          <button className="play" disabled={busy || !selected} onClick={() => run('install')}>INSTALAR</button>
        )}
        {current?.installed && <button className="btn" disabled={busy} onClick={() => run('install')}>Verificar / reparar</button>}
        {status.state === 'installing' && <button className="btn" onClick={() => window.nexa.cancelInstall()}>Cancelar</button>}
      </div>

      {!auth.loggedIn && (
        <p className="muted">Modo invitado: puedes instalar y verificar archivos. Para jugar inicia sesión con una cuenta que tenga Minecraft Java.</p>
      )}
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}
    </div>
  );
}
