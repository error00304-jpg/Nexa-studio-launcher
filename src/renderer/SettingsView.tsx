import { useState, type ReactNode } from 'react';
import type { AppInfo } from '../shared/ipc';
import type { Settings, SettingsErrors } from '../shared/settings';

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error && <small className="error">{error}</small>}
    </label>
  );
}

interface Props {
  settings: Settings;
  info: AppInfo;
  onChange: (s: Settings) => void;
}

export function SettingsView({ settings, info, onChange }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [jvm, setJvm] = useState(settings.jvmArgs.join(' '));
  const [errors, setErrors] = useState<SettingsErrors>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
  const apply = (s: Settings) => {
    setDraft(s);
    setJvm(s.jvmArgs.join(' '));
    onChange(s);
  };
  const fail = (e: unknown) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Error desconocido' });

  async function save() {
    try {
      const res = await window.nexa.saveSettings({ ...draft, jvmArgs: jvm.split(/\s+/).filter(Boolean) });
      if (res.ok) {
        setErrors({});
        apply(res.settings);
        setMsg({ ok: true, text: 'Ajustes guardados.' });
      } else {
        setErrors(res.errors);
        setMsg({ ok: false, text: 'Hay valores no válidos. Revísalos.' });
      }
    } catch (e) {
      fail(e);
    }
  }

  async function reset() {
    if (!window.confirm('¿Restablecer todos los ajustes a sus valores por defecto?')) return;
    try {
      apply(await window.nexa.resetSettings());
      setErrors({});
      setMsg({ ok: true, text: 'Ajustes restablecidos.' });
    } catch (e) {
      fail(e);
    }
  }

  async function pick() {
    try {
      const dir = await window.nexa.pickDirectory();
      if (dir) set('minecraftDir', dir);
    } catch (e) {
      fail(e);
    }
  }

  return (
    <>
      <h3 className="section-title">Ajustes</h3>
      <div className="card form">
        <Field label="Directorio de Minecraft" error={errors.minecraftDir}>
          <div className="row">
            <input value={draft.minecraftDir} onChange={(e) => set('minecraftDir', e.target.value)} />
            <button className="btn" type="button" onClick={pick}>Elegir…</button>
            <button className="btn" type="button" onClick={() => window.nexa.openMinecraftDir().catch(fail)}>Abrir</button>
          </div>
        </Field>
        <Field label="Memoria RAM (MB)" error={errors.ramMb}>
          <input type="number" step={256} value={Number.isNaN(draft.ramMb) ? '' : draft.ramMb} onChange={(e) => set('ramMb', num(e.target.value))} />
        </Field>
        <Field label="Ruta de Java (vacío = automática)" error={errors.javaPath}>
          <input value={draft.javaPath} onChange={(e) => set('javaPath', e.target.value)} />
        </Field>
        <div className="row">
          <Field label="Ancho" error={errors.resolutionWidth}>
            <input type="number" value={Number.isNaN(draft.resolutionWidth) ? '' : draft.resolutionWidth} onChange={(e) => set('resolutionWidth', num(e.target.value))} />
          </Field>
          <Field label="Alto" error={errors.resolutionHeight}>
            <input type="number" value={Number.isNaN(draft.resolutionHeight) ? '' : draft.resolutionHeight} onChange={(e) => set('resolutionHeight', num(e.target.value))} />
          </Field>
          <Field label="Descargas simultáneas" error={errors.maxConcurrentDownloads}>
            <input type="number" value={Number.isNaN(draft.maxConcurrentDownloads) ? '' : draft.maxConcurrentDownloads} onChange={(e) => set('maxConcurrentDownloads', num(e.target.value))} />
          </Field>
        </div>
        <Field label="Argumentos JVM extra (separados por espacio)" error={errors.jvmArgs}>
          <input value={jvm} onChange={(e) => setJvm(e.target.value)} placeholder="-XX:+UseG1GC" />
        </Field>
        <Field label="Idioma" error={errors.language}>
          <select value={draft.language} onChange={() => set('language', 'es')}>
            <option value="es">Español</option>
          </select>
        </Field>
        <label className="check">
          <input type="checkbox" checked={draft.showLogs} onChange={(e) => set('showLogs', e.target.checked)} /> Mostrar registros
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.closeLauncherOnPlay} onChange={(e) => set('closeLauncherOnPlay', e.target.checked)} /> Cerrar el launcher al iniciar el juego
        </label>
        <div className="row">
          <button className="btn primary" onClick={save}>Guardar</button>
          <button className="btn" onClick={reset}>Restablecer</button>
          {msg && <span className={msg.ok ? 'ok' : 'error'}>{msg.text}</span>}
        </div>
      </div>
      <p className="muted">
        {info.name} v{info.version} · {info.platform} · Electron {info.electron}
      </p>
    </>
  );
}
