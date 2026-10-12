import { useCallback, useEffect, useState } from 'react';
import type { AuthState } from '../shared/auth';
import type { EventStatus, EventView, NewsItem } from '../shared/events';
import type { McPhase } from '../shared/minecraft';
import { useMcStatus } from './useMcStatus';

const STATUS: Record<EventStatus, string> = {
  proximamente: 'Próximamente', disponible: 'Disponible', mantenimiento: 'Mantenimiento', finalizado: 'Finalizado'
};
const PHASES: Record<McPhase, string> = {
  metadatos: 'Metadatos', cliente: 'Cliente', bibliotecas: 'Bibliotecas', recursos: 'Recursos',
  modloader: 'Modloader', modpack: 'Modpack', listo: 'Listo'
};
const date = (iso: string) => new Date(iso).toLocaleDateString('es');

interface Data { events: EventView[]; news: NewsItem[]; offline: boolean; fetchedAt: string | null }

export function EventsView({ auth }: { auth: AuthState }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { status, progress } = useMcStatus();

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    try {
      const r = refresh ? await window.nexa.refreshEvents() : (await window.nexa.getEvents()) ?? (await window.nexa.refreshEvents());
      if (r.ok) {
        setData(r);
        setError(null);
        setSelectedId((s) => (s && r.events.some((e) => e.id === s) ? s : r.events[0]?.id ?? null));
      } else {
        setError(r.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(true); }, [load]);

  const busy = status.state !== 'idle';
  const ev = data?.events.find((e) => e.id === selectedId) ?? null;
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  async function run(kind: 'install' | 'repair' | 'play') {
    if (!ev) return;
    setMsg(null);
    try {
      const r = kind === 'play' ? await window.nexa.playEvent(ev.id) : await window.nexa.installEvent(ev.id, kind === 'repair');
      if (r.ok) setMsg(kind === 'play' ? null : { ok: true, text: 'Evento listo para jugar.' });
      else setMsg({ ok: false, text: r.error });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Error' });
    }
    await load(false);
  }

  return (
    <>
      <div className="row between">
        <h3 className="section-title">Eventos</h3>
        <button className="btn" disabled={loading || busy} onClick={() => load(true)}>{loading ? 'Actualizando…' : 'Actualizar'}</button>
      </div>

      {error && <div className="card warn">{error}</div>}
      {data?.offline && (
        <div className="card warn">Sin conexión: se muestran los datos verificados guardados{data.fetchedAt ? ` (${date(data.fetchedAt)})` : ''}.</div>
      )}
      {data && data.events.length === 0 && <div className="card empty"><p>No hay eventos publicados por ahora.</p></div>}

      <div className="event-grid">
        {data?.events.map((e) => (
          <button key={e.id} className={e.id === selectedId ? 'event-card selected' : 'event-card'} onClick={() => setSelectedId(e.id)}>
            <div className="event-banner" style={e.bannerDataUrl ? { backgroundImage: `url(${e.bannerDataUrl})` } : undefined} />
            <div className="event-body">
              <span className={`badge ${e.effectiveStatus}`}>{STATUS[e.effectiveStatus]}</span>
              <strong>{e.name}</strong>
              <span className="muted">Minecraft {e.minecraft} · {e.loader}</span>
            </div>
          </button>
        ))}
      </div>

      {ev && (
        <div className="card mc-panel" style={{ marginTop: 16 }}>
          <div className="row between">
            <h3 style={{ margin: 0 }}>{ev.name}</h3>
            <span className={`badge ${ev.effectiveStatus}`}>{STATUS[ev.effectiveStatus]}</span>
          </div>
          {ev.description && <p style={{ margin: 0 }}>{ev.description}</p>}
          <p className="muted">
            Modpack {ev.modpackVersion}{ev.installedVersion ? ` · instalado: ${ev.installedVersion}` : ''}
            {ev.serverAddress ? ` · Servidor: ${ev.serverAddress}` : ''}
          </p>
          {(ev.requirements.javaMajor || ev.requirements.minRamMb || ev.requirements.notes) && (
            <p className="muted">
              Requisitos:{ev.requirements.javaMajor ? ` Java ${ev.requirements.javaMajor}+` : ''}
              {ev.requirements.minRamMb ? ` · RAM ${ev.requirements.minRamMb} MB` : ''}
              {ev.requirements.notes ? ` · ${ev.requirements.notes}` : ''}
            </p>
          )}

          {busy && progress && (
            <div>
              <div className="progress"><div style={{ width: `${pct}%` }} /></div>
              <p className="muted">{PHASES[progress.phase]}: {progress.done}/{progress.total} ({pct}%) — {progress.label}</p>
            </div>
          )}

          <div className="row">
            {ev.blockedReason ? (
              <button className="play" disabled>{STATUS[ev.effectiveStatus].toUpperCase()}</button>
            ) : status.state === 'running' ? (
              <button className="play" disabled>EN EJECUCIÓN</button>
            ) : ev.ready ? (
              <button className="play" disabled={busy || !auth.loggedIn} onClick={() => run('play')}>JUGAR</button>
            ) : (
              <button className="play" disabled={busy} onClick={() => run('install')}>{ev.updateAvailable ? 'ACTUALIZAR' : 'INSTALAR'}</button>
            )}
            {!ev.blockedReason && ev.installedVersion && <button className="btn" disabled={busy} onClick={() => run('repair')}>Verificar / reparar</button>}
            {status.state === 'installing' && <button className="btn" onClick={() => window.nexa.cancelInstall()}>Cancelar</button>}
          </div>

          {ev.blockedReason && <p className="muted">{ev.blockedReason}</p>}
          {!ev.blockedReason && ev.ready && !auth.loggedIn && <p className="muted">Inicia sesión con tu cuenta Microsoft para jugar.</p>}
          {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}

          {ev.news.length > 0 && (
            <div>
              <h4 style={{ margin: '8px 0' }}>Novedades del evento</h4>
              {ev.news.map((n) => <NewsCard key={n.id} n={n} />)}
            </div>
          )}
        </div>
      )}

      {data && data.news.length > 0 && (
        <>
          <h3 className="section-title">Noticias</h3>
          {data.news.map((n) => <NewsCard key={n.id} n={n} />)}
        </>
      )}
    </>
  );
}

function NewsCard({ n }: { n: NewsItem }) {
  return (
    <div className="card news">
      <strong>{n.title}</strong> <span className="muted">· {date(n.publishedAt)}</span>
      <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{n.body}</p>
    </div>
  );
}
