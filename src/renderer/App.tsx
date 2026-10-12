import { useEffect, useState } from 'react';
import type { AppInfo } from '../shared/ipc';

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.nexa.getAppInfo().then(setInfo).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    });
  }, []);

  return (
    <main className="shell">
      <h1>NexaStudios Launcher</h1>
      <p className="muted">Fase 1: esqueleto ejecutable. Aún no hay eventos ni autenticación.</p>
      {error && <p className="error">No se pudo contactar con el proceso principal: {error}</p>}
      {info && (
        <p className="muted">
          v{info.version} · {info.platform} · Electron {info.electron}
        </p>
      )}
    </main>
  );
}
