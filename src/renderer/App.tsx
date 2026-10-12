import { useEffect, useState } from 'react';
import type { AppInfo } from '../shared/ipc';
import type { Settings } from '../shared/settings';
import type { AuthState } from '../shared/auth';
import { brand } from './brand';
import { SettingsView } from './SettingsView';
import { LogsView } from './LogsView';
import { Account } from './Account';
import { EventsView } from './EventsView';
import { MinecraftPanel } from './MinecraftPanel';
import { ModpackPanel } from './ModpackPanel';

type View = 'inicio' | 'ajustes' | 'registro';

function Home({ auth, dev }: { auth: AuthState; dev: boolean }) {
  return (
    <>
      <section className="banner">
        <h2>{brand.name}</h2>
        <p>{brand.tagline}</p>
      </section>
      {!auth.configured && (
        <div className="card warn">
          Falta configurar el Client ID de Microsoft (ver docs/MICROSOFT_AUTH.md). Sin él no se puede iniciar sesión.
        </div>
      )}
      <EventsView auth={auth} />
      {dev && (
        <>
          <h3 className="section-title">Herramientas de desarrollo</h3>
          <MinecraftPanel auth={auth} />
          <div style={{ height: 12 }} />
          <ModpackPanel auth={auth} />
        </>
      )}
    </>
  );
}

export function App() {
  const [view, setView] = useState<View>('inicio');
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([window.nexa.getAppInfo(), window.nexa.getSettings(), window.nexa.getAuthState()])
      .then(([i, s, a]) => { setInfo(i); setSettings(s); setAuth(a); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Error desconocido'));
  }, []);

  if (error) return <main className="center"><p className="error">Error al iniciar: {error}</p></main>;
  if (!settings || !info || !auth) return <main className="center"><p className="muted">Cargando…</p></main>;

  const current: View = view === 'registro' && !settings.showLogs ? 'inicio' : view;
  const tabs: Array<[View, string]> = [['inicio', 'Inicio'], ['ajustes', 'Ajustes']];
  if (settings.showLogs) tabs.push(['registro', 'Registro']);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          {brand.logoUrl ? <img src={brand.logoUrl} alt="" /> : <span className="logo-mark">N</span>}
          <strong>{brand.name}</strong>
        </div>
        <nav>
          {tabs.map(([id, label]) => (
            <button key={id} className={id === current ? 'tab active' : 'tab'} onClick={() => setView(id)}>{label}</button>
          ))}
        </nav>
        <Account auth={auth} onChange={setAuth} />
      </header>
      <main className="content">
        {current === 'inicio' && <Home auth={auth} dev={info.dev} />}
        {current === 'ajustes' && <SettingsView settings={settings} info={info} onChange={setSettings} />}
        {current === 'registro' && <LogsView />}
      </main>
    </div>
  );
}
