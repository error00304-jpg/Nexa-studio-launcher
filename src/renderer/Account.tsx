import { useEffect, useState } from 'react';
import type { AuthState, DeviceCodeInfo } from '../shared/auth';

interface Props {
  auth: AuthState;
  onChange: (a: AuthState) => void;
}

export function Account({ auth, onChange }: Props) {
  const [code, setCode] = useState<DeviceCodeInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => window.nexa.onDeviceCode(setCode), []);

  async function login() {
    setBusy(true);
    setError(null);
    setCode(null);
    try {
      const r = await window.nexa.login();
      if (r.ok) onChange(r.state);
      else if (r.error !== 'Inicio de sesión cancelado.') setError(r.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setBusy(false);
      setCode(null);
    }
  }

  async function logout() {
    try {
      onChange(await window.nexa.logout());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    }
  }

  return (
    <>
      <div className="account">
        {auth.loggedIn && auth.profile ? (
          <>
            <span className="avatar">{auth.profile.name.charAt(0).toUpperCase()}</span>
            <strong>{auth.profile.name}</strong>
            <button className="btn" onClick={logout}>Cerrar sesión</button>
          </>
        ) : (
          <>
            <span className="avatar">?</span>
            <button className="btn primary" onClick={login} disabled={busy}>Iniciar sesión</button>
          </>
        )}
      </div>

      {busy && (
        <div className="modal">
          <div className="card modal-card">
            <h3>Inicia sesión con Microsoft</h3>
            {code ? (
              <>
                <p className="muted">Se abrió tu navegador. Si no, entra a:</p>
                <p><strong>{code.verificationUri}</strong></p>
                <p className="muted">e introduce este código:</p>
                <p className="user-code">{code.userCode}</p>
              </>
            ) : (
              <p className="muted">Conectando con Microsoft…</p>
            )}
            <button className="btn" onClick={() => window.nexa.cancelLogin()}>Cancelar</button>
          </div>
        </div>
      )}

      {error && (
        <div className="modal">
          <div className="card modal-card">
            <h3>No se pudo iniciar sesión</h3>
            <p className="error">{error}</p>
            <button className="btn" onClick={() => setError(null)}>Cerrar</button>
          </div>
        </div>
      )}
    </>
  );
}
