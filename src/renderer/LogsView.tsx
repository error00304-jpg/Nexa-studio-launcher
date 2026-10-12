import { useCallback, useEffect, useState } from 'react';
import type { LogEntry } from '../shared/ipc';

export function LogsView() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    window.nexa.getLogs().then(setLogs).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Error'));
  }, []);
  useEffect(refresh, [refresh]);

  return (
    <>
      <div className="row between">
        <h3 className="section-title">Registro de actividad</h3>
        <button className="btn" onClick={refresh}>Actualizar</button>
      </div>
      {error && <p className="error">{error}</p>}
      <pre className="log">
        {logs.length === 0
          ? 'Sin entradas.'
          : logs.map((l) => `${l.time} [${l.level.toUpperCase()}] ${l.message}`).join('\n')}
      </pre>
    </>
  );
}
